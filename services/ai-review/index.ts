import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import * as store from "@/db/queries/ai-review";
import { batchDetail, isQuestionItem, type BatchAttachment } from "@/db/queries/imports";
import { systemState } from "@/db/schema";
import { writeReceipt, type WriteContext } from "@/db/queries/catalog";
import type { ReviewSettings } from "@/domain/ai-review";
import { importDigest } from "@/domain/imports";
import { taskImportPrefix } from "@/domain/import-task";
import { Problem } from "@/domain/problem";
import { planImports } from "@/services/import-plan";
import { commitAiReviewedQuestion, receiveImport } from "@/services/imports";
import { existingResult, errorDetails, requireWriteAccess } from "@/services/writes";
import { callDeepSeek, deepSeekConfig, documentedModel, estimatedCost, maximumCost, requestMaterial } from "./deepseek";
import { arithmeticKey, hasVisual, independentlySolved, modelReasons, reviewMaterial, witnessFor } from "./material";

type Selection = { itemId: string; rowVersion: number };
const enabled = ({ consent, mode }: ReviewSettings) => consent && mode !== "off";
const pending = (status: string) => status === "pending";
const now = () => new Date().toISOString();

export async function getReviewSettings(ownerId: string) {
  const [{ settings, revision, conditionalSince }, sources] = await Promise.all([store.getSettings(ownerId), store.trustedSources(ownerId)]);
  const config = deepSeekConfig();
  return {
    settings, revision, conditionalSince, sources, keyConfigured: Boolean(config.key), model: config.model ?? null,
    conditionalReady: env.HKB_AI_REVIEW_CONDITIONAL_READY === "1",
  };
}

export async function updateReviewSettings(settings: ReviewSettings, revision: number, ctx: WriteContext) {
  if (!await existingResult(ctx)) {
    try {
      await store.saveSettings(settings, revision, ctx);
    } catch (error) {
      if (!await existingResult(ctx)) {
        await requireWriteAccess(ctx);
        if (errorDetails(error).includes("receipts_precondition")) throw new Problem(409, "VERSION_CONFLICT", "设置已变更，请刷新。");
        throw error;
      }
    }
  }
  return getReviewSettings(ctx.actorId);
}

async function snapshot(ownerId: string, batchId: string) {
  const data = await batchDetail(ownerId, batchId);
  if (!data) throw new Problem(404, "NOT_FOUND", "找不到此导入批次。");
  return data;
}

export async function reviewHistory(ownerId: string, batchId: string) {
  const [{ settings }, runs] = await Promise.all([store.getSettings(ownerId), store.history(ownerId, batchId)]);
  return { enabled: enabled(settings), runs };
}

async function arithmeticDuplicate(ownerId: string, itemId: string, key: string) {
  const rows = await getDb().all<{ markdown: string }>(sql`
    SELECT statement_md AS markdown FROM questions WHERE deleted_at IS NULL AND ltrim(statement_md) LIKE '计算%'
    UNION ALL
    SELECT json_extract(i.candidate_json, '$.statement.markdown') AS markdown
    FROM import_items i JOIN import_batches b ON b.id = i.batch_id
    WHERE b.owner_id = ${ownerId} AND i.id <> ${itemId} AND i.status IN ('pending','approved','failed','conflict')
      AND ltrim(json_extract(i.candidate_json, '$.statement.markdown')) LIKE '计算%'
    LIMIT 501`);
  return rows.length > 500 || rows.some(({ markdown }) =>
    arithmeticKey(markdown.trim())?.key === key);
}

async function runReview(ownerId: string, batchId: string, selection: Selection, ctx: WriteContext, queued?: store.AiRun) {
  const requestKey = queued ? queued.requestKey : "manual:" + ctx.key;
  const previous = queued ? undefined : await store.currentRun(ownerId, selection.itemId, selection.rowVersion, requestKey);
  if (previous) {
    return { itemId: selection.itemId, runId: previous.id, status: previous.state };
  }
  const [configRow, current] = await Promise.all([store.getSettings(ownerId), snapshot(ownerId, batchId)]);
  const { settings, revision, conditionalSince } = configRow;
  const item = current.items.find(({ id }) => id === selection.itemId);
  const outcome = (status: string, runId?: string) => ({ itemId: selection.itemId, status, runId });
  if (!item || !pending(item.status) || item.rowVersion !== selection.rowVersion) return outcome("version_changed");
  if (!enabled(settings) || (queued && queued.settingsRevision !== revision)) return outcome("off");
  const config = deepSeekConfig();
  const createdAt = now();
  const run: store.AiRun = {
    id: queued?.id ?? crypto.randomUUID(), ownerId, itemId: item.id, itemVersion: item.rowVersion, requestKey,
    state: "running", settingsRevision: revision, leaseUntil: null, createdAt, finishedAt: null, model: config.model ?? null,
    providerModel: null, durationMs: null, report: null, reasons: null, failure: null, approvedDay: null, questionId: null,
  };
  if (!await store.claimRun(run, createdAt, new Date(Date.now() + 120_000).toISOString(), !queued)) {
    const raced = await store.currentRun(ownerId, item.id, item.rowVersion, requestKey);
    return outcome(raced && raced.state !== "queued" ? raced.state : "busy", raced?.id);
  }

  const start = Date.now();
  let providerModel: string | null = null;
  const finish = (fields: Partial<store.AiRun>) =>
    store.finishRun(run, { ...fields, providerModel, finishedAt: now(), durationMs: Date.now() - start, leaseUntil: null });
  const fail = async (failure: string) => {
    await finish({ state: "failed", failure });
    return outcome("failed", run.id);
  };
  try {
    if (!config.key) return await fail("missing_key");
    if (!config.model) return await fail("invalid_model");
    const witness = witnessFor(current.batch, item);
    const digest = witness ? await importDigest(witness) : undefined;
    const trusted = Boolean(digest && await store.hasSource(ownerId, digest));
    const planned = await planImports(current.batch, current.items.filter((sibling) => sibling.status !== "committed"), current.items);
    const plan = planned.plans.find(({ item: candidate }) => candidate.id === item.id)!;
    const course = planned.courses.find(({ id }) => id === plan.courseId);
    const classifications = plan.topicMappings.map(({ path, selected }) => {
      const topic = planned.topics.find(({ id }) => id === selected);
      return { path, topic: topic?.title, chapter: planned.chapters.find(({ id }) => id === topic?.chapterId)?.title };
    });
    const material = requestMaterial(reviewMaterial(current.batch, item, plan, trusted, {
      course: course?.name, matched_topics: classifications,
    }));
    if (!material) return await fail("input_too_large");

    const simpleArithmetic = isQuestionItem(item) && arithmeticKey(item.candidateJson.statement?.markdown) && !hasVisual(item.candidateJson);
    let response: Awaited<ReturnType<typeof callDeepSeek>>;
    for (let attempt = 0; ; attempt++) {
      const reservedAt = Date.now();
      if (!await store.reserveAttempt(run, attempt, maximumCost(config.model, material.inputBytes),
        store.reviewDay(reservedAt), new Date(reservedAt).toISOString())) return await fail("budget_or_state_changed");
      response = await callDeepSeek(config, material.messages, simpleArithmetic ? "disabled" : "enabled");
      if (response.usage) {
        const { input, output, providerModel: actual } = response.usage;
        providerModel = actual === config.model ? documentedModel(config.model) : actual;
        await store.recordUsage(run.id, attempt, estimatedCost(config.model, input, output), input, output);
      }
      if (!("failure" in response) || !response.retry || attempt >= config.retries) break;
    }
    if ("failure" in response) return await fail(response.failure);
    const { report } = response;
    const visual = hasVisual(item.candidateJson);
    if (visual) report.checks.visual = "unknown";
    const reasons = modelReasons(report, visual);
    if (response.usage.providerModel !== config.model && response.usage.providerModel !== documentedModel(config.model)) reasons.push("MODEL_VERSION");
    if (settings.mode !== "conditional") reasons.push("ASSIST_ONLY");
    if (env.HKB_AI_REVIEW_CONDITIONAL_READY !== "1") reasons.push("DEPLOYMENT_GATE");
    if (!conditionalSince || current.batch.createdAt < conditionalSince) reasons.push("PREEXISTING_CANDIDATE");
    if (!trusted) reasons.push("UNVERIFIED_SOURCE");
    if (visual || item.candidateJson.gaps?.length || current.batch.batchKey.startsWith(taskImportPrefix)) reasons.push("MATERIAL_GAP_OR_SCOPE");
    if (plan.issues.length || !plan.input) reasons.push("IMPORT_VALIDATION");
    if (plan.duplicates.length) reasons.push("DUPLICATE_RISK");
    if (!isQuestionItem(item) || !settings.allowIntegerArithmetic || item.candidateJson.operation !== "create" ||
      !independentlySolved(item.candidateJson)) reasons.push("OUTSIDE_ARITHMETIC_POLICY");

    // Start the final validation at the current data epoch. Every normal catalog/import write advances it.
    const db = getDb();
    const epoch = await db.select({ value: systemState.dataEpoch }).from(systemState).where(eq(systemState.id, 1)).get();
    const latest = await snapshot(ownerId, batchId);
    const candidate = latest.items.find(({ id }) => id === item.id);
    if (!candidate || candidate.rowVersion !== item.rowVersion || !pending(candidate.status)) reasons.push("VERSION_CHANGED");
    if (!await finish({ state: "complete", report, reasons: reasons.length ? reasons : ["RECHECKING"] }).then((r) => r.meta.changes)) {
      return outcome("interrupted", run.id);
    }
    if (reasons.length) return outcome("complete", run.id);
    if (!epoch || !digest || !isQuestionItem(item)) return outcome("complete", run.id);
    try {
      const { plans } = await planImports(latest.batch, latest.items.filter(({ status }) => status !== "committed"), latest.items);
      const fresh = plans.find(({ item: currentItem }) => currentItem.id === item.id);
      const arithmetic = arithmeticKey(item.candidateJson.statement?.markdown)!;
      const duplicate = await arithmeticDuplicate(ownerId, item.id, arithmetic.key);
      if (duplicate || fresh?.duplicates.length) reasons.push("DUPLICATE_RISK");
      if (fresh?.kind !== "question" || fresh.planHash !== plan.planHash || fresh.issues.length) reasons.push("PLAN_CHANGED");
      const day = store.reviewDay(Date.now());
      if (!reasons.length && fresh?.kind === "question" && await commitAiReviewedQuestion(latest.batch, fresh, {
        runId: run.id, planHash: fresh.planHash, digest, epoch: epoch.value, day, settingsRevision: revision,
      })) return outcome("auto_committed", run.id);
      await store.setRunReasons(run.id, reasons.length ? reasons : ["LIMIT_OR_CONCURRENT_CHANGE"]);
    } catch {
      await store.setRunReasons(run.id, ["COMMIT_RETRY_MANUALLY"]);
    }
    return outcome("complete", run.id);
  } catch {
    return fail("review_unavailable");
  }
}

export async function manualReviews(batchId: string, selections: Selection[], ctx: WriteContext) {
  await requireWriteAccess(ctx);
  if (!await existingResult(ctx)) {
    try {
      await writeReceipt(getDb(), ctx, { id: batchId, rowVersion: 1 }, sql`1`).run();
    } catch (error) {
      if (!await existingResult(ctx)) throw error;
    }
  }
  const results = [];
  for (const selection of selections) {
    results.push(await runReview(ctx.actorId, batchId, selection, ctx));
  }
  return results;
}

export async function receiveAndReview(value: unknown, raw: string, ctx: WriteContext, attachment?: BatchAttachment) {
  const saved = await receiveImport(value, raw, ctx, attachment);
  try {
    const batchId = attachment ? (await store.batchAtCheckpoint(ctx.actorId, saved.id, saved.rowVersion))?.batchId : saved.id;
    if (typeof batchId === "string") {
      const queued = await store.firstQueued(batchId, ctx.actorId);
      if (queued) await runReview(ctx.actorId, batchId, { itemId: queued.itemId, rowVersion: queued.itemVersion }, ctx, queued);
    }
  } catch {
    // The queued job and candidate are already durable. Owners can retry from the batch.
  }
  return saved;
}
