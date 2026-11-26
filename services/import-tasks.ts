import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { writeReceipt, type WriteContext } from "@/db/queries/catalog";
import * as store from "@/db/queries/import-tasks";
import { contextImportNamespace } from "@/domain/context-reference";
import { inspectCandidate, inspectTopicCandidate } from "@/domain/import-evidence";
import { taskImportPrefix, type ImportCheckpoint, type ImportTaskInput } from "@/domain/import-task";
import { importDigest, isTopicCandidate, validateImport } from "@/domain/imports";
import { normalizeTaskCandidate } from "@/domain/mcp-candidate-normalization";
import { Problem } from "@/domain/problem";
import { checkDraft, checkEvidence, checkSegment, projectCoverage, projectGaps, sameCheckpoint, segmentsFrom,
  type Checkpoint } from "@/services/import-task-material";
import { getImport } from "@/services/imports";
import { receiveAndReview } from "@/services/ai-review";
import { conflict, errorDetails, existingResult, requireWriteAccess } from "@/services/writes";

type Task = Awaited<ReturnType<typeof loadTask>>;
type Submission = Checkpoint & { event: Extract<ImportCheckpoint, { type: "submitted" }> };

const notFound = () => new Problem(404, "NOT_FOUND", "找不到此整理任务或处理单元。");
const reviewRequired = () => new Problem(409, "REVIEW_REQUIRED", "请先在审核页处理上一份候选。可由 owner 修订，或在跳过、拒绝或入库后提交关联提案。");

async function loadTask(ownerId: string, id: string) {
  const found = await store.readImportTask(ownerId, id);
  if (!found) throw notFound();
  return found;
}

function isSubmission(row: Checkpoint): row is Submission {
  return row.event.type === "submitted";
}

function unitRows(task: Task) {
  const units = new Map<string, Checkpoint[]>();
  for (const row of task.checkpoints) {
    if (row.event.type === "segment") continue;
    const rows = units.get(row.unitId);
    if (rows) rows.push(row);
    else units.set(row.unitId, [row]);
  }
  return units;
}

function formalResult(rows: Checkpoint[]) {
  return rows.findLast(({ item }) => item?.status === "committed")?.item ?? null;
}

const missingEvidenceCodes = new Set([
  "DECLARED_GAP", "UNRESOLVED_COURSE", "SOURCE_NEEDS_VERIFICATION", "STATEMENT_NEEDS_VERIFICATION", "UNAVAILABLE_SOURCE",
]);

type Preparation = "unprocessed" | "drafting" | "needs_evidence" | "retry" | "submitted" | "owner_action" | "unknown";

function currentDraft(rows: Checkpoint[], latest: Submission | undefined) {
  const saved = rows.findLast(({ event }) => event.type === "draft");
  if (saved?.event.type !== "draft") return null;
  const active = (!latest || saved.version > latest.version) && saved.event.reviewVersion === (latest?.item?.rowVersion ?? null);
  return { version: saved.version, active, draft: saved.event.draft };
}

function gapsForProposal(gaps: ReturnType<typeof projectGaps>, latest: Submission | undefined) {
  return gaps.filter((gap) => gap.gapKind && gap.version > (latest?.version ?? 0));
}

async function projectUnit(ownerId: string, rows: Checkpoint[]) {
  const first = rows[0];
  if (first.event.type !== "registered") throw new Error("Task unit is missing its registration.");
  const last = rows[rows.length - 1];
  const latest = rows.findLast(isSubmission);
  const current = latest?.item ?? null;
  const gaps = projectGaps(rows);
  const proposalGaps = gapsForProposal(gaps, latest);
  const draft = currentDraft(rows, latest);
  let issues = null;
  if (latest?.batchId && current) {
    const review = await getImport(ownerId, latest.batchId);
    const item = review.items.find(({ id, rowVersion }) => current.id === id && current.rowVersion === rowVersion);
    if (item) issues = item.issues;
  }
  let preparation: Preparation;
  if (proposalGaps.some(({ provided }) => !provided)
    || last.event.type === "needs_evidence" && !last.event.gapKind) preparation = "needs_evidence";
  else if (last.event.type === "failed") preparation = "retry";
  else if (draft?.active) preparation = "drafting";
  else if (proposalGaps.length) preparation = "unprocessed";
  else if (!latest) preparation = "unprocessed";
  else if (!current || !issues) preparation = "unknown";
  else if (["skipped", "rejected", "failed", "conflict"].includes(current.status)) preparation = "owner_action";
  else if (issues.some(({ code, severity }) => severity === "blocking" && missingEvidenceCodes.has(code))) {
    preparation = "needs_evidence";
  } else if (issues.some(({ severity }) => severity === "blocking")) preparation = "retry";
  else preparation = "submitted";

  return {
    unitId: first.unitId, externalId: taskImportPrefix + first.unitId,
    title: first.event.title, kind: first.event.kind, locator: first.event.locator, identityEvidence: first.event.identityEvidence,
    preparation, currentReview: latest ? { batchId: latest.batchId, item: current, issues } : null,
    draft, gaps,
    formalResult: formalResult(rows),
    checkpoints: rows.map(({ version, event, batchId, item, createdAt }) => ({
      version, event, batchId, item, savedAt: createdAt,
    })),
  };
}

export async function getImportTask(ownerId: string, id: string, savedVersion: number | null = null) {
  const snapshot = await loadTask(ownerId, id);
  const segments = segmentsFrom(snapshot.checkpoints);
  const coverage = projectCoverage(segments);
  // Plan reviews in order to keep D1 and Markdown work bounded per read.
  const units: Awaited<ReturnType<typeof projectUnit>>[] = [];
  for (const rows of unitRows(snapshot).values()) units.push(await projectUnit(ownerId, rows));
  const count = (preparation: Preparation) => units.filter((unit) => unit.preparation === preparation).length;
  const waitingReview = units.filter(({ currentReview }) => currentReview?.item?.status === "pending").length;
  const readyToCommit = units.filter(({ currentReview }) => currentReview?.item?.status === "approved").length;
  const counts = {
    units: units.length, proposed: units.filter(({ currentReview }) => currentReview !== null).length,
    waitingReview, readyToCommit, committed: units.filter((unit) => unit.formalResult !== null).length,
    needsEvidence: count("needs_evidence"), retry: count("retry"), unprocessed: count("unprocessed"), drafting: count("drafting"),
    ownerAction: count("owner_action"), unknown: count("unknown"),
  };
  const next = units.find(({ preparation }) => preparation === "drafting")
    ?? units.find(({ preparation }) => preparation === "unprocessed" || preparation === "retry")
    ?? units.find(({ preparation }) => preparation !== "submitted");
  const { task } = snapshot;
  const saved = snapshot.checkpoints.find(({ version }) => version === savedVersion);
  return {
    taskId: id, scope: task.scope, rowVersion: task.rowVersion, updatedAt: task.updatedAt, cancelledAt: task.cancelledAt,
    taskPath: `/imports/tasks/${id}`,
    counts, preparationComplete: coverage.nextOrder === null && units.length > 0 && count("submitted") === units.length,
    nextUnitId: next?.unitId ?? null, units, segments, coverage,
    saved: saved ? { version: saved.version, unitId: saved.unitId, event: saved.event, batchId: saved.batchId } : null,
  };
}

async function rememberReplay(ctx: WriteContext, id: string, rowVersion: number) {
  const result = { id, rowVersion };
  const db = getDb();
  await writeReceipt(db, ctx, result, sql`1`).run();
  return result;
}

async function submit(
  ctx: WriteContext, args: Extract<ImportTaskInput, { action: "submit" }>, rows: Checkpoint[], currentVersion: number,
) {
  const { taskId, unitId, expectedVersion, materialNote } = args;
  const previous = rows.findLast(isSubmission);
  const reference = previous?.item ?? undefined;
  if (args.draftVersion !== undefined) {
    const draft = currentDraft(rows, previous);
    if (!draft?.active || draft.version !== args.draftVersion) {
      throw new Problem(409, "TASK_DRAFT_STALE", "草稿或关联审核已有更新，请重新恢复并核对后继续。", {
        draftVersion: args.draftVersion, currentDraftVersion: draft?.version ?? null,
      });
    }
  }
  const externalId = taskImportPrefix + unitId;
  const itemKeys = { item_key: unitId, external_id: externalId };
  const original = { schema_version: "1.2", namespace: contextImportNamespace, sources: args.sources,
    items: [{ ...args.candidate, ...itemKeys }] };
  const originalFingerprint = await importDigest(original);
  const content = { ...original, items: [{ ...normalizeTaskCandidate(args.candidate), ...itemKeys }] };
  const fingerprint = await importDigest(content);
  const already = rows.find((row) => isSubmission(row) &&
    (row.event.fingerprint === originalFingerprint || row.event.fingerprint === fingerprint));
  const suppliedKeys = ["item_key", "external_id"].some((field) => Object.hasOwn(args.candidate, field));
  if (already && !suppliedKeys) return rememberReplay(ctx, taskId, already.version);
  if (currentVersion !== expectedVersion) throw conflict(currentVersion);
  const gaps = gapsForProposal(projectGaps(rows), previous);
  const unresolved = gaps.find(({ provided }) => !provided);
  if (unresolved) throw new Problem(422, "TASK_EVIDENCE_REQUIRED", unresolved.missing, { unitId, gapVersion: unresolved.version });
  try {
    const batch = { ...content, batch_key: taskImportPrefix + fingerprint };
    const raw = JSON.stringify(batch);
    if (new TextEncoder().encode(raw).length > 900_000) throw new Problem(413, "TOO_LARGE", "候选批次不得超过 900,000 字节。");
    const parsed = validateImport(batch);
    const first = rows[0].event;
    const item = parsed.items[0];
    if (suppliedKeys) {
      throw new Problem(422, "TASK_IMPORT_KEY", "请省略 item_key 和 external_id，服务会使用本处理单元的固定标识。");
    }
    if (first.type !== "registered" || (isTopicCandidate(item) ? "topic" : "question") !== first.kind) {
      throw new Problem(422, "TASK_UNIT_KIND", "候选类型必须与处理单元一致。");
    }
    for (const gap of gaps) {
      if (gap.gapKind !== "original_image") continue;
      const assetId = gap.supplements.at(-1)?.evidence.assetId;
      if (!assetId || isTopicCandidate(item) || !item.original_asset_ids?.includes(assetId)) {
        throw new Problem(422, "TASK_IMAGE_REQUIRED", "请在候选的 original_asset_ids 引用本次补充的原图。", { gapVersion: gap.version, assetId });
      }
    }
    const committed = formalResult(rows);
    if (committed ? item.operation !== "propose_update" || item.target_id !== (committed.questionId ?? committed.topicId)
      : item.operation !== "create") {
      throw new Problem(422, "TASK_TARGET", "初次提案使用 create。正式入库后只可提议更新此单元的已入库对象。");
    }
    if (previous && (!reference || !["rejected", "skipped", "committed"].includes(reference.status))) throw reviewRequired();
    if (previous && !committed) {
      const { groups } = isTopicCandidate(item)
        ? inspectTopicCandidate(item, parsed.sources, contextImportNamespace)
        : inspectCandidate(item, parsed.sources, "1.2", contextImportNamespace);
      const readableSources = new Set(parsed.sources.filter(({ acquisition_status }) => acquisition_status !== "unavailable")
        .map(({ source_key }) => source_key));
      const matches = groups.some(({ evidence }) => evidence.some(({ locator, quote, source_key }) =>
        locator === first.locator && quote === first.identityEvidence && readableSources.has(source_key)
        && item.source_keys?.includes(source_key)));
      if (!matches) {
        throw new Problem(422, "TASK_IDENTITY_EVIDENCE", "关联提案须引用该单元登记的原始定位和原话。请重新提供证据，或由 owner 在审核页核实修订。");
      }
    }
    const checkpoint = store.taskCheckpoint(ctx, taskId, expectedVersion, unitId, { type: "submitted", materialNote, fingerprint }, reference);
    return await receiveAndReview(parsed, raw, ctx, checkpoint);
  } catch (error) {
    if (!(error instanceof Problem) || ![413, 422].includes(error.status)) throw error;
    return store.saveTaskCheckpoint(ctx, store.taskCheckpoint(ctx, taskId, expectedVersion, unitId, {
      type: "failed", error: { code: error.code, message: error.message, fields: error.fields },
    }));
  }
}

async function changeTask(ctx: WriteContext, args: Exclude<ImportTaskInput, { action: "start" | "resume" }>) {
  const snapshot = await loadTask(ctx.actorId, args.taskId);
  if (snapshot.task.cancelledAt) throw new Problem(409, "TASK_CANCELLED", "整理任务已取消。");
  const { taskId, expectedVersion } = args;
  const units = unitRows(snapshot);
  const assertVersion = () => {
    if (snapshot.task.rowVersion !== expectedVersion) throw conflict(snapshot.task.rowVersion);
  };
  const save = (unitId: string, event: ImportCheckpoint, previous?: { id: string; rowVersion: number }) =>
    store.saveTaskCheckpoint(ctx, store.taskCheckpoint(ctx, taskId, expectedVersion, unitId, event, previous));
  const segments = segmentsFrom(snapshot.checkpoints);
  if (args.action === "record_segment") {
    const { segment } = args;
    const existing = snapshot.checkpoints.findLast(({ event }) => event.type === "segment" && sameCheckpoint(event.segment, segment));
    if (existing) return rememberReplay(ctx, taskId, existing.version);
    assertVersion();
    checkSegment(segment, segments, new Set(units.keys()));
    return save(taskId, { type: "segment", segment });
  }
  if (args.action === "register") {
    const { kind, title, locator, identityEvidence } = args;
    const found = snapshot.checkpoints.find(({ event }) => event.type === "registered" && event.locator === locator);
    if (found?.event.type === "registered") {
      if (found.event.kind !== kind || found.event.identityEvidence !== identityEvidence) {
        throw new Problem(409, "TASK_LOCATOR_CONFLICT", "该片段定位已登记不同证据或类型。请核对原材料并使用可区分的定位。");
      }
      return rememberReplay(ctx, taskId, found.version);
    }
    assertVersion();
    return save(crypto.randomUUID(), {
      type: "registered", kind, title, locator, identityEvidence,
    });
  }
  const rows = units.get(args.unitId);
  if (!rows) throw notFound();
  if (args.action === "submit") return submit(ctx, args, rows, snapshot.task.rowVersion);
  const last = rows[rows.length - 1];
  if (args.action === "need_evidence") {
    const { missing, gapKind, segmentOrder } = args;
    const event = { type: "needs_evidence" as const, missing, gapKind, segmentOrder };
    const previous = gapKind ? projectGaps(rows).find(({ provided, ...gap }) => !provided
      && gap.missing === missing && gap.gapKind === gapKind && gap.segmentOrder === segmentOrder)
      : last.event.type === "needs_evidence" && sameCheckpoint(last.event, event) ? last : undefined;
    if (previous) return rememberReplay(ctx, taskId, previous.version);
    assertVersion();
    if (segmentOrder !== undefined && !segments.some(({ order }) => order === segmentOrder)) {
      throw new Problem(404, "NOT_FOUND", "缺口引用的分段尚未登记。", { segmentOrder });
    }
    return save(args.unitId, event);
  }
  assertVersion();
  if (args.action === "save_draft") {
    checkDraft(args.draft, segments, args.unitId);
    const review = rows.findLast(isSubmission)?.item ?? undefined;
    const event = { type: "draft" as const, draft: args.draft, reviewVersion: review?.rowVersion ?? null };
    if (sameCheckpoint(last.event, event)) return rememberReplay(ctx, taskId, last.version);
    return save(args.unitId, event, review);
  }
  await checkEvidence(ctx.actorId, args.evidence, rows, segments);
  const gap = projectGaps(rows).find(({ version }) => version === args.evidence.gapVersion)!;
  const previous = gap.supplements.at(-1);
  if (previous && sameCheckpoint(previous.evidence, args.evidence)) return rememberReplay(ctx, taskId, previous.version);
  return save(args.unitId, { type: "evidence", evidence: args.evidence });
}

export async function runImportTask(ownerId: string, args: ImportTaskInput) {
  if (args.action === "resume") return getImportTask(ownerId, args.taskId);
  const change = { ...args };
  delete change.view;
  const ctx = { actorId: ownerId, key: `mcp-import-task:${args.idempotencyKey}`, hash: await importDigest(change), now: new Date().toISOString() };
  let result = await existingResult(ctx);
  if (!result) {
    try {
      result = args.action === "start" ? await store.createImportTask(ctx, args.scope) : await changeTask(ctx, args);
    } catch (error) {
      result = await existingResult(ctx);
      if (!result) {
        await requireWriteAccess(ctx);
        if (args.action !== "start" && errorDetails(error).includes("receipts_precondition")) {
          const { task } = await loadTask(ownerId, args.taskId);
          if (task.rowVersion !== args.expectedVersion) throw conflict(task.rowVersion);
          throw new Problem(409, "REVIEW_CHANGED", "审核状态已有更新，请重新读取整理任务及审核状态后继续。");
        }
        throw error;
      }
    }
  }
  return getImportTask(ownerId, result.id, result.rowVersion);
}
