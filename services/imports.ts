import { env } from "cloudflare:workers";
import type { AiApproval } from "@/db/queries/ai-review";
import type { z } from "zod";
import type { CatalogWrite, WriteContext } from "@/db/queries/catalog";
import * as store from "@/db/queries/imports";
import { questionImportTargets, type AttemptRow } from "@/db/queries/questions";
import { contextImportNamespace } from "@/domain/context-reference";
import { taskImportPrefix } from "@/domain/import-task";
import { importCommitStatuses } from "@/domain/import-status";
import { importDigest, isTopicCandidate, validateImport, type ImportIssue, type ImportSource, type importEdit, type importReview, type importCommit } from "@/domain/imports";
import { Problem } from "@/domain/problem";
import { sha256 } from "@/lib/hash";
import { planImports, type ImportPlan } from "@/services/import-plan";
import type { TopicImportPlan } from "@/services/topic-import-plan";
import { prepareQuestionCreate, prepareQuestionUpdate } from "@/services/questions";
import { conflict, errorDetails, existingResult, newRow, requireWriteAccess } from "@/services/writes";

const encoder = new TextEncoder();
const notFound = () => new Problem(404, "NOT_FOUND", "找不到此导入批次或候选项。");
const batchKeyConflict = () => new Problem(409, "BATCH_KEY_CONFLICT", "同一批次标识已用于不同内容。");
export const listImports = store.batchList;

async function getBatch(ownerId: string, id: string) {
  const found = await store.batchDetail(ownerId, id);
  if (!found) throw notFound();
  return found;
}

export async function importOriginal(ownerId: string, id: string) {
  return (await getBatch(ownerId, id)).batch.rawJson;
}

export async function receiveImport(value: unknown, raw: string, ctx: WriteContext, attachment?: store.BatchAttachment) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const input = validateImport(value);
  const { batch_key, ...content } = input;
  if (!attachment && input.namespace === contextImportNamespace && (
    batch_key.startsWith(taskImportPrefix) || input.items.some(({ external_id }) => external_id.startsWith(taskImportPrefix))
  )) {
    throw new Problem(422, "RESERVED_IMPORT_KEY", "整理任务的标识须通过整理任务接口提交。");
  }
  const fields: { path: string; message: string }[] = [];
  function unique(keys: string[], path: string, field: string) {
    const seen = new Set<string>();
    keys.forEach((key, index) => {
      if (seen.has(key)) fields.push({ path: `/${path}/${index}/${field}`, message: `标识「${key}」重复。` });
      seen.add(key);
    });
  }
  unique(input.sources.map(({ source_key }) => source_key), "sources", "source_key");
  unique(input.items.map(({ item_key }) => item_key), "items", "item_key");
  unique(input.items.map(({ external_id }) => external_id), "items", "external_id");
  input.sources.forEach((source, index) => {
    if (!source.title.trim()) fields.push({ path: `/sources/${index}/title`, message: "请输入来源名称。" });
  });
  if (fields.length) throw new Problem(422, "IMPORT_KEYS", "请检查批次标识和来源字段。", fields);
  const [contentHash, rawHash] = await Promise.all([importDigest(content), sha256(encoder.encode(raw))]);
  const batch: store.BatchRow = {
    id: crypto.randomUUID(), ownerId: ctx.actorId, namespace: input.namespace, batchKey: batch_key,
    schemaVersion: input.schema_version, rawJson: raw, rawHash, contentHash, createdAt: ctx.now,
    sourceJson: input.sources.map((source) => ({ ...source, id: crypto.randomUUID() })),
  };
  const items = input.items.map((candidateJson, position) => ({
    id: crypto.randomUUID(), batchId: batch.id, itemKey: candidateJson.item_key, externalId: candidateJson.external_id,
    position, status: "pending" as const, candidateJson,
  }));
  const lookup = () => store.previousBatch(ctx.actorId, batch.namespace, batch.batchKey, contentHash);
  for (let retry = 0; retry < 2; retry++) {
    const { named, identical } = await lookup();
    if (named && named.contentHash !== contentHash) throw batchKeyConflict();
    try {
      return await store.insertBatch(batch, items, named?.id ?? identical?.id, ctx, attachment);
    } catch (error) {
      const raced = await existingResult(ctx);
      if (raced) return raced;
      await requireWriteAccess(ctx);
      const details = errorDetails(error);
      if (retry || (!details.includes("import_batches") && (attachment || !details.includes("receipts_precondition")))) throw error;
    }
  }
  throw batchKeyConflict();
}

export async function getImport(ownerId: string, id: string) {
  const { batch, items } = await getBatch(ownerId, id);
  const [{ plans, courses, topics, chapters }, history] = await Promise.all([
    planImports(batch, items.filter(({ status }) => status !== "committed"), items),
    store.itemHistory(id, ownerId),
  ]);
  const byId = new Map(plans.map((plan) => [plan.item.id, plan]));
  return {
    id, namespace: batch.namespace, batchKey: batch.batchKey, schemaVersion: batch.schemaVersion,
    createdAt: batch.createdAt, rawHash: batch.rawHash, sources: batch.sourceJson, courses, topics, chapters, history,
    items: items.map((stored) => {
      const item = activeImportTarget(stored);
      const plan = byId.get(item.id);
      const question = plan?.kind === "question" ? plan : undefined;
      const issues = plan?.issues ?? [];
      const needsVerification = issues.some(({ severity }) => severity === "blocking");
      return {
        id: item.id, rowVersion: item.rowVersion, status: item.status, candidate: item.candidateJson, mapping: item.mappingJson,
        kind: isTopicCandidate(item.candidateJson) ? "topic" as const : "question" as const,
        issue: item.issueJson, questionId: item.questionId, topicId: item.topicId, committedVersion: item.committedVersion,
        issues, needsVerification, canApprove: Boolean(plan?.input) && !needsVerification,
        approvalCurrent: item.approvedHash !== null && item.approvedHash === plan?.planHash,
        historyImages: question?.historyImages ?? [],
        planHash: plan?.planHash, duplicates: plan?.duplicates ?? [], changes: question?.changes ?? [],
        courseCandidates: plan?.courseCandidates ?? [], courseId: plan?.courseId, topicMappings: plan?.topicMappings ?? [],
        target: question?.target, currentTargetVersion: question?.previous?.rowVersion,
        currentTargetTitle: question?.previous?.title, topicPlan: plan?.kind === "topic" ? plan.topicPlan : undefined,
      };
    }),
  };
}
export type ImportDetail = Awaited<ReturnType<typeof getImport>>;

function reviewable(items: store.ItemRow[], id: string, version: number) {
  const item = items.find((item) => item.id === id);
  if (!item) throw notFound();
  if (item.rowVersion !== version) throw conflict(item.rowVersion);
  if (item.status === "committed") throw new Problem(409, "ITEM_COMMITTED", "此项已经提交。");
  return item;
}

async function saveReviews(id: string, reviews: Parameters<typeof store.saveReviews>[1], ctx: WriteContext, checkedItems?: store.ItemRow[]) {
  try {
    return await store.saveReviews(id, reviews, ctx, checkedItems);
  } catch (error) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    if (!errorDetails(error).includes("receipts_precondition")) throw error;
    await requireWriteAccess(ctx);
    throw new Problem(409, "VERSION_CONFLICT", "审核项已变更，请刷新后重试。");
  }
}

export async function editImport(
  id: string, itemId: string, version: number, input: z.infer<typeof importEdit>, ctx: WriteContext,
) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const { batch, items } = await getBatch(ctx.actorId, id);
  const item = reviewable(items, itemId, version);
  const candidate = input.candidate === undefined ? item.candidateJson : validateImport({
    schema_version: batch.schemaVersion, namespace: batch.namespace, batch_key: batch.batchKey,
    sources: batch.sourceJson.map((source) => {
      const fields: Partial<typeof source> = { ...source };
      delete fields.id;
      return fields;
    }), items: [input.candidate],
  }).items[0];
  if (candidate.item_key !== item.itemKey || candidate.external_id !== item.externalId
    || isTopicCandidate(candidate) !== isTopicCandidate(item.candidateJson)) {
    throw new Problem(422, "IMMUTABLE_IMPORT_KEYS", "候选类型、候选项标识和外部标识须与原批次一致。");
  }
  // Candidate revisions can reorder references. Clear old mappings unless the reviewer supplied replacements.
  const mapping = input.mapping ?? (input.candidate === undefined ? item.mappingJson : {});
  return saveReviews(id, [{
    item, action: "edit", change: {
      candidateJson: candidate, mappingJson: mapping, status: "pending", approvedHash: null, issueJson: null,
    },
    detail: { mapping, candidateHash: await importDigest(candidate), previousPlanHash: item.approvedHash },
  }], ctx);
}

export async function reviewImport(id: string, input: z.infer<typeof importReview>, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const { batch, items } = await getBatch(ctx.actorId, id);
  const chosen = input.decisions.map((decision) => ({ decision, item: reviewable(items, decision.itemId, decision.rowVersion) }));
  const hasApprovals = chosen.some(({ decision }) => decision.action === "approve");
  const plans = hasApprovals ? (await planImports(batch, items.filter(({ status }) => status !== "committed"), items)).plans : [];
  const changes = chosen.flatMap<Parameters<typeof store.saveReviews>[1][number]>(({ item, decision }) => {
    if (decision.action !== "approve") return [{
      item, action: decision.action, change: {
        status: decision.action === "skip" ? "skipped" as const : "rejected" as const, approvedHash: null, issueJson: null,
      }, detail: {},
    }];
    const plan = plans.find((plan) => plan.item.id === item.id)!;
    if (plan.planHash !== decision.planHash) throw new Problem(409, "PLAN_CHANGED", "审核计划已变更，请刷新后核对。");
    const blocked = plan.issues.filter(({ severity }) => severity === "blocking");
    if (!plan.input || blocked.length) {
      throw new Problem(422, "IMPORT_NEEDS_VERIFICATION", `请先核实「${item.itemKey}」的待处理字段。`, blocked);
    }
    if (plan.duplicates.length && !decision.acknowledgeDuplicates) {
      throw new Problem(422, "DUPLICATE_REVIEW_REQUIRED", `请先核对「${item.itemKey}」的重复候选。`);
    }
    if (importCommitStatuses.includes(item.status) && item.approvedHash === plan.planHash) return [];
    return [{
      item, action: "approve" as const, change: { status: "approved" as const, approvedHash: plan.planHash, issueJson: null },
      detail: { planHash: plan.planHash, target: (plan.kind === "topic" ? plan.topicPlan.target : plan.target) ?? null,
        duplicates: plan.duplicates.map(({ id, reason }) => ({ id, reason })) },
    }];
  });
  return saveReviews(id, changes, ctx, chosen.map(({ item }) => item));
}

function activeImportTarget<T extends store.ItemRow & { targetInTrash: number }>(item: T): T {
  if (!item.targetInTrash) return item;
  return { ...item, status: "skipped", questionId: null, committedVersion: null, approvedHash: null,
    issueJson: { code: "TARGET_IN_TRASH", path: "/target_id", severity: "notice",
      message: "正式题目已移入回收站。恢复后可重新打开此入库链接。" } };
}

function commitResult(item: store.ItemRow) {
  return { itemId: item.id, status: item.status, rowVersion: item.rowVersion,
    kind: isTopicCandidate(item.candidateJson) ? "topic" as const : "question" as const,
    questionId: item.questionId, topicId: item.topicId, committedVersion: item.committedVersion, issue: item.issueJson };
}

export async function getImportResult(ownerId: string, id: string) {
  const { items } = await getBatch(ownerId, id);
  return items.map((item) => ({ ...commitResult(activeImportTarget(item)), itemKey: item.itemKey }));
}

function importSources(batch: store.BatchRow, plan: ImportPlan, ctx: WriteContext) {
  const byKey = new Map(batch.sourceJson.map((source) => [source.source_key, source]));
  const sourceKeys = new Set([
    ...plan.item.candidateJson.source_keys ?? [],
    ...plan.groups.flatMap(({ evidence }) => evidence.map(({ source_key }) => source_key)),
  ]);
  const sources = [...sourceKeys].map((key) => {
    const source = byKey.get(key)!;
    return {
      id: source.id, kind: source.kind, title: source.title, externalUrl: source.external_url,
      acquisitionStatus: source.acquisition_status, occurredOn: source.occurred_on, capturedAt: batch.createdAt,
      createdBy: ctx.actorId, extraJson: {
        batchId: batch.id, sourceKey: key, externalId: source.external_id,
        ...(batch.namespace === contextImportNamespace ? { namespace: batch.namespace } : {}),
      },
    };
  });
  return { byKey, sources };
}

function sourceVerification(batch: store.BatchRow, source: ImportSource, cited: boolean) {
  if (batch.namespace === contextImportNamespace) return "unverified";
  if (cited) return "verified";
  return source.acquisition_status === "unavailable" ? "unavailable" : "unverified";
}

async function prepareCommit(batch: store.BatchRow, plan: Extract<ImportPlan, { kind: "question" }>, ctx: WriteContext, trustedStatement = false): Promise<store.CommitData> {
  const input = plan.input!;
  const write = plan.previous
    ? await prepareQuestionUpdate(plan.previous, input, ctx, "import")
    : await prepareQuestionCreate(input, ctx, "import");
  const attempts = plan.plannedAttempts.map(({ externalId, attemptedOn, input }) => {
    const row: AttemptRow = {
      ...newRow(ctx), ...input, lastOrigin: "import", userId: ctx.actorId, questionId: write.row.id,
      sourceRevisionId: null, originalEvidenceStatus: "user_confirmed",
      extraJson: { attemptedOn, sourceRevisionNo: write.row.rowVersion },
    };
    return { externalId, row };
  });
  const attemptIds = new Map(attempts.map(({ externalId, row }) => [externalId, row.id]));
  const { byKey, sources } = importSources(batch, plan, ctx);
  const provenance: store.CommitData["provenance"] = plan.groups.flatMap(({ path, evidence, origin }) => {
    const externalId = /^\/attempts\/([^/]+)/.exec(path)?.[1];
    const attemptId = externalId ? attemptIds.get(externalId) : undefined;
    return evidence.map((entry) => {
      const anchoredQuestion = plan.item.candidateJson.learner_questions?.some(({ id, annotation_id }) =>
        annotation_id && path === `/learner_questions/${id}`);
      const candidateOnly = plan.changes.some(({ field, preserved }) => preserved && (
        (field === "statementMd" && path === "/statement") || (field === "finalAnswerMd" && path === "/final_answer")
        || (field === "keyTechniquesMd" && path === "/key_techniques")
        || (field === "solutionDocument" && (path.startsWith("/solution_document/") || anchoredQuestion))
        || (field === "solutionSteps" && path.startsWith("/solution_steps/"))
      ));
      const locator = { reference: entry.locator, speaker: entry.speaker, history: entry.history, batchId: batch.id, itemId: plan.item.id };
      return {
        id: crypto.randomUUID(), sourceId: byKey.get(entry.source_key)!.id, fieldPath: candidateOnly ? "/candidate" + path : path,
        questionId: attemptId ? null : write.row.id, attemptId, locatorJson: locator,
        evidenceKind: origin === "transcribed" ? "transcription" : origin === "source_summary" ? "ai_synthesis" : "direct",
        verification: trustedStatement && path === "/statement" ? "verified" : sourceVerification(batch, byKey.get(entry.source_key)!, true),
        createdAt: ctx.now,
      };
    });
  });
  for (const [index, image] of plan.historyImages.entries()) {
    provenance.push({
      id: crypto.randomUUID(), sourceId: byKey.get(image.source_key)!.id, questionId: write.row.id, fieldPath: `/history_images/${index}`,
      locatorJson: { reference: image.locator, history: image.history, attachmentIndex: image.attachment_index,
        sha256: image.sha256, assetId: image.assetId, batchId: batch.id, itemId: plan.item.id },
      evidenceKind: "direct", verification: "verified", createdAt: ctx.now,
    });
  }
  if (!plan.previous?.sourceTitle && input.sourceTitle) {
    const citation = plan.item.candidateJson.statement?.evidence?.[0];
    const sourceKey = batch.namespace === contextImportNamespace ? plan.statementSourceKey : citation?.source_key ?? plan.item.candidateJson.source_keys?.[0];
    if (sourceKey) provenance.push({
      id: crypto.randomUUID(), sourceId: byKey.get(sourceKey)!.id, questionId: write.row.id, fieldPath: "statementMd",
      locatorJson: input.sourceLocator ? { reference: input.sourceLocator } : {},
      evidenceKind: citation ? plan.item.candidateJson.statement?.origin === "transcribed" ? "transcription" : "direct" : "user_confirmation",
      verification: trustedStatement ? "verified" : sourceVerification(batch, byKey.get(sourceKey)!, Boolean(citation)), createdAt: ctx.now,
    });
  }
  for (const key of plan.item.candidateJson.source_keys ?? []) {
    const source = byKey.get(key)!;
    provenance.push({
      id: crypto.randomUUID(), sourceId: source.id, questionId: write.row.id, fieldPath: "/source_keys",
      locatorJson: {}, evidenceKind: "user_confirmation",
      verification: sourceVerification(batch, source, false), createdAt: ctx.now,
    });
  }
  return { write, fingerprint: plan.fingerprint, duplicateIds: plan.duplicates.map(({ id }) => id), attempts, sources, provenance };
}

// The system grant is scoped to a completed run, the exact pending version and the current owner settings.
export async function commitAiReviewedQuestion(
  batch: store.BatchRow, plan: Extract<ImportPlan, { kind: "question" }>, permit: AiApproval,
) {
  if (env.HKB_AI_REVIEW_CONDITIONAL_READY !== "1" || plan.item.status !== "pending" ||
      plan.item.candidateJson.operation !== "create" || !plan.input || plan.previous || plan.issues.length ||
      plan.duplicates.length || plan.planHash !== permit.planHash) return false;
  const ctx = { actorId: batch.ownerId, key: "ai-import:" + permit.runId, hash: permit.planHash, now: new Date().toISOString() };
  try {
    await store.commitItem(batch, plan.item, await prepareCommit(batch, plan, ctx, true), ctx, permit);
    return true;
  } catch (error) {
    if (await existingResult(ctx)) return true;
    if (errorDetails(error).includes("receipts_precondition")) return false;
    throw error;
  }
}

async function prepareTopicCommit(batch: store.BatchRow, plan: TopicImportPlan, ctx: WriteContext): Promise<Parameters<typeof store.commitTopicItem>[2]> {
  const input = plan.input!;
  const previous = plan.previous;
  const row = previous ? {
    ...previous, summaryMd: input.summaryMd, bodyMd: input.bodyMd,
    updatedAt: ctx.now, updatedBy: ctx.actorId, rowVersion: previous.rowVersion + 1, lastOrigin: "import",
  } : (() => {
    const audit = newRow(ctx);
    return { ...audit, ...input, supplementMd: null, slug: input.slug ?? audit.id, lastOrigin: "import" };
  })();
  const write: Extract<CatalogWrite, { kind: "topic" }> = { kind: "topic", row, expectedVersion: previous?.rowVersion };
  const ids = [...new Set(plan.topicPlan.relatedQuestions.flatMap(({ id }) => id ?? []))];
  const questions = await questionImportTargets(ids);
  const questionWrites = ids.flatMap((id) => {
    const current = questions.get(id);
    if (!current) throw new Problem(409, "ASSOCIATION_CONFLICT", "关联题目已不可用，请重新核对。");
    if (current.topicIds.includes(row.id)) return [];
    const { courseName, topics, topicIds, sourceTitle, sourceLocator, originalAssetIds, ...questionRow } = current;
    void courseName;
    void topics;
    return [{
      kind: "question" as const, row: { ...questionRow, updatedAt: ctx.now, updatedBy: ctx.actorId,
        rowVersion: current.rowVersion + 1, lastOrigin: "import" },
      topicIds: [...topicIds, row.id], sourceTitle, sourceLocator, originalAssetIds,
    }];
  });
  const { byKey, sources } = importSources(batch, plan, ctx);
  const provenance: store.CommitData["provenance"] = plan.groups.flatMap(({ path, evidence, origin }) => evidence.map((entry) => {
    const locator = { reference: entry.locator, speaker: entry.speaker, history: entry.history, batchId: batch.id, itemId: plan.item.id };
    const preserved = path === "/summary" && previous?.summaryMd.trim() && previous.summaryMd !== plan.item.candidateJson.summary?.markdown;
    return {
      id: crypto.randomUUID(), sourceId: byKey.get(entry.source_key)!.id, topicId: row.id, locatorJson: locator,
      fieldPath: preserved ? "/candidate" + path : path,
      evidenceKind: origin === "transcribed" ? "transcription" : origin === "source_summary" ? "ai_synthesis" : "direct",
      verification: sourceVerification(batch, byKey.get(entry.source_key)!, true), createdAt: ctx.now,
    };
  }));
  for (const key of plan.item.candidateJson.source_keys ?? []) {
    const source = byKey.get(key)!;
    const locator = { batchId: batch.id, itemId: plan.item.id };
    provenance.push({
      id: crypto.randomUUID(), sourceId: source.id, topicId: row.id, fieldPath: "/source_keys",
      locatorJson: locator, evidenceKind: "user_confirmation",
      verification: sourceVerification(batch, source, false), createdAt: ctx.now,
    });
  }
  return { write, sources, provenance, questionWrites, relatedTopicIds: plan.topicPlan.relatedTopics.map(({ id }) => id),
    dataEpoch: plan.dataEpoch };
}

async function applyApprovedItem(batch: store.BatchRow, item: store.ItemRow, ctx: WriteContext) {
  const siblings = store.isTopicItem(item) ? (await getBatch(ctx.actorId, batch.id)).items : [item];
  const { plans: [plan] } = await planImports(batch, [item], siblings);
  const blocked = plan.issues.find(({ severity }) => severity === "blocking");
  if (blocked) return { issue: blocked, retryable: false };
  if (!plan.input || plan.planHash !== item.approvedHash) {
    return { issue: { path: "", code: "PLAN_CHANGED", message: "内容、映射或重复候选已变更，请重新审核。", severity: "blocking" as const }, retryable: false };
  }
  if (plan.kind === "topic" && plan.pendingQuestions) {
    return { issue: { path: "/related_question_refs", code: "QUESTION_NOT_COMMITTED", message: "请先提交同批关联题目，再重试此项。", severity: "blocking" as const },
      retryable: true };
  }
  if (plan.kind === "topic") {
    await store.commitTopicItem(batch, plan.item, await prepareTopicCommit(batch, plan, ctx), ctx);
  } else {
    await store.commitItem(batch, item, await prepareCommit(batch, plan, ctx), ctx);
  }
  return { issue: undefined, retryable: false };
}

async function commitOne(batch: store.BatchRow, item: store.ItemRow, ctx: WriteContext) {
  const itemKey = await importDigest([batch.id, item.id, item.rowVersion]);
  // The separator reserves these receipt keys for the server.
  const itemContext = { ...ctx, key: "import-item:" + itemKey, hash: item.approvedHash! };
  let issue: ImportIssue | undefined;
  let retryable = false;
  try {
    let outcome;
    try {
      outcome = await applyApprovedItem(batch, item, itemContext);
    } catch (error) {
      if (!store.isTopicItem(item) || !errorDetails(error).includes("receipts_precondition")) throw error;
      // An unrelated concurrent write can advance the directory epoch. Recompute the exact approved plan once.
      await requireWriteAccess(ctx);
      outcome = await applyApprovedItem(batch, item, itemContext);
    }
    ({ issue, retryable } = outcome);
  } catch (error) {
    await requireWriteAccess(ctx);
    const details = errorDetails(error);
    retryable = !/receipts_precondition|import_attempt_refs\.owner_id/.test(details) && !(error instanceof Problem);
    issue = {
      path: "", code: retryable ? "COMMIT_FAILED" : "COMMIT_CONFLICT", severity: "blocking",
      message: retryable ? "此项写入未完成，可以重试。" : "目标或关联已变更，请重新核对。",
    };
  }
  if (issue) {
    // The write may have succeeded before a connection failure, or another request may have moved the item.
    const { items } = await getBatch(ctx.actorId, batch.id);
    const current = items.find(({ id }) => id === item.id)!;
    if (current.rowVersion !== item.rowVersion) return commitResult(current);
    const failureContext = { ...itemContext, key: "import-result:" + itemKey };
    try {
      await saveReviews(batch.id, [{
        item, action: retryable ? "failed" : "conflict",
        change: { status: retryable ? "failed" : "conflict", approvedHash: retryable ? item.approvedHash : null, issueJson: issue },
        detail: { issue, planHash: item.approvedHash },
      }], failureContext);
    } catch (error) {
      if (!(error instanceof Problem) || error.code !== "VERSION_CONFLICT") throw error;
    }
  }
  const { items } = await getBatch(ctx.actorId, batch.id);
  return commitResult(items.find(({ id }) => id === item.id)!);
}

export async function commitImport(id: string, input: z.infer<typeof importCommit>, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  const { batch, items } = await getBatch(ctx.actorId, id);
  const selection = input.items.map((entry) => {
    const item = items.find(({ id }) => id === entry.itemId);
    if (!item) throw notFound();
    return { entry, item };
  });
  if (!previous) await saveReviews(id, [], ctx);
  const results = new Map<string, ReturnType<typeof commitResult>>();
  const ordered = [...selection.filter(({ item }) => store.isQuestionItem(item)), ...selection.filter(({ item }) => store.isTopicItem(item))];
  for (const { entry, item } of ordered) {
    if (item.rowVersion === entry.rowVersion && importCommitStatuses.includes(item.status)) {
      results.set(item.id, await commitOne(batch, item, ctx));
    } else {
      results.set(item.id, commitResult(item));
    }
  }
  return { id, rowVersion: 1, items: selection.map(({ item }) => results.get(item.id)!) };
}
