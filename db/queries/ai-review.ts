import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aiReviews, aiReviewSettings, aiReviewSources, aiReviewUsage, importBatches, importItems } from "@/db/schema";
import { initialReviewSettings, type AiReport, type ReviewSettings, type SourceWitness } from "@/domain/ai-review";
import { writeReceipt, type WriteContext } from "./catalog";

export type AiRun = typeof aiReviews.$inferSelect;
export const reviewDay = (at: number) => new Date(at + 8 * 3_600_000).toISOString().slice(0, 10);

const ownerWritable = (ownerId: string, now: string) => sql`EXISTS (
  SELECT 1 FROM users WHERE id = ${ownerId} AND role = 'owner' AND disabled_at IS NULL
) AND EXISTS (SELECT 1 FROM system_state WHERE id = 1 AND
  (maintenance_expires_at IS NULL OR maintenance_expires_at <= ${now}))`;

const enabledRevision = (ownerId: string, revision: number) => sql`EXISTS (
  SELECT 1 FROM ai_review_settings WHERE owner_id = ${ownerId} AND revision = ${revision}
    AND json_extract(settings, '$.consent') = 1 AND json_extract(settings, '$.mode') <> 'off'
)`;

export async function getSettings(ownerId: string) {
  return await getDb().select().from(aiReviewSettings).where(eq(aiReviewSettings.ownerId, ownerId)).get()
    ?? { settings: initialReviewSettings, revision: 0, conditionalSince: null };
}

export async function saveSettings(settings: ReviewSettings, revision: number, ctx: WriteContext) {
  const db = getDb();
  await db.batch([
    writeReceipt(db, ctx, { id: ctx.actorId, rowVersion: revision + 1 },
      sql`coalesce((SELECT revision FROM ai_review_settings WHERE owner_id = ${ctx.actorId}), 0) = ${revision}`),
    db.insert(aiReviewSettings).values({
      ownerId: ctx.actorId, settings, revision: 1,
      conditionalSince: settings.mode === "conditional" ? ctx.now : null, updatedAt: ctx.now,
    }).onConflictDoUpdate({
      target: aiReviewSettings.ownerId,
      set: { settings, revision: revision + 1, updatedAt: ctx.now,
        conditionalSince: settings.mode === "conditional" ? sql`coalesce(conditional_since, ${ctx.now})` : null },
    }),
  ]);
}

export function trustedSources(ownerId: string) {
  return getDb().select().from(aiReviewSources).where(eq(aiReviewSources.ownerId, ownerId))
    .orderBy(desc(aiReviewSources.verifiedAt)).limit(100).all();
}
export function hasSource(ownerId: string, digest: string) {
  return getDb().select({ digest: aiReviewSources.digest }).from(aiReviewSources)
    .where(and(eq(aiReviewSources.ownerId, ownerId), eq(aiReviewSources.digest, digest))).get();
}

export async function saveSource(digest: string, witness: SourceWitness | null, ctx: WriteContext) {
  const db = getDb();
  await db.batch([
    writeReceipt(db, ctx, { id: digest, rowVersion: 1 }, sql`1`),
    witness ? db.insert(aiReviewSources).values({ ownerId: ctx.actorId, digest, witness, verifiedAt: ctx.now }).onConflictDoNothing()
      : db.delete(aiReviewSources).where(and(eq(aiReviewSources.ownerId, ctx.actorId), eq(aiReviewSources.digest, digest))),
  ]);
}

export const queueReviews = (batch: typeof importBatches.$inferSelect, items: (typeof importItems.$inferInsert)[]) => {
  const entries = items.map(({ id }) => ({ id, run: crypto.randomUUID() }));
  return getDb().insert(aiReviews).select(sql`
    SELECT json_extract(j.value, '$.run'), s.owner_id, json_extract(j.value, '$.id'), 1, 'automatic', 'queued', s.revision,
      NULL, ${batch.createdAt}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
    FROM ai_review_settings s, json_each(${JSON.stringify(entries)}) j
    WHERE s.owner_id = ${batch.ownerId} AND json_extract(s.settings, '$.consent') = 1 AND json_extract(s.settings, '$.mode') <> 'off'`);
};

const currentPending = (ownerId: string, itemId: string, version: number) => sql`EXISTS (
  SELECT 1 FROM import_items i JOIN import_batches b ON b.id = i.batch_id
  WHERE i.id = ${itemId} AND i.row_version = ${version} AND i.status = 'pending' AND b.owner_id = ${ownerId}
)`;

export async function claimRun(run: AiRun, now: string, leaseUntil: string, manual: boolean) {
  const db = getDb();
  const match = sql`${ownerWritable(run.ownerId, now)} AND ${enabledRevision(run.ownerId, run.settingsRevision)}
    AND ${currentPending(run.ownerId, run.itemId, run.itemVersion)} AND NOT EXISTS (
      SELECT 1 FROM ai_reviews WHERE owner_id = ${run.ownerId} AND state = 'running' AND lease_until > ${now}
    )`;
  await db.update(aiReviews).set({ state: "failed", failure: "interrupted", finishedAt: now, leaseUntil: null })
    .where(sql`${aiReviews.ownerId} = ${run.ownerId} AND ${aiReviews.state} = 'running' AND ${aiReviews.leaseUntil} <= ${now}`);
  const claim = manual ? await db.run(sql`INSERT INTO ai_reviews (id, owner_id, item_id, item_version, request_key, state, settings_revision, created_at, model, lease_until)
      SELECT ${run.id}, ${run.ownerId}, ${run.itemId}, ${run.itemVersion}, ${run.requestKey}, 'running',
        ${run.settingsRevision}, ${run.createdAt}, ${run.model}, ${leaseUntil} WHERE ${match}
      ON CONFLICT DO NOTHING`)
    : await db.update(aiReviews).set({ state: "running", leaseUntil, model: run.model })
      .where(sql`${aiReviews.id} = ${run.id} AND ${aiReviews.state} = 'queued' AND ${match}`).run();
  if (manual && claim.meta.changes) {
    await db.update(aiReviews).set({ state: "failed", failure: "superseded", finishedAt: now }).where(and(
      eq(aiReviews.ownerId, run.ownerId), eq(aiReviews.itemId, run.itemId), eq(aiReviews.itemVersion, run.itemVersion), eq(aiReviews.state, "queued"),
    ));
  }
  return claim.meta.changes === 1;
}

export function currentRun(ownerId: string, itemId: string, itemVersion: number, requestKey: string) {
  return getDb().select().from(aiReviews).where(and(eq(aiReviews.ownerId, ownerId), eq(aiReviews.itemId, itemId),
    eq(aiReviews.itemVersion, itemVersion), eq(aiReviews.requestKey, requestKey))).get();
}

export function firstQueued(batchId: string, ownerId: string) {
  return getDb().select({ run: aiReviews }).from(aiReviews).innerJoin(importItems, eq(importItems.id, aiReviews.itemId))
    .where(and(eq(aiReviews.ownerId, ownerId), eq(importItems.batchId, batchId), eq(importItems.position, 0), eq(aiReviews.state, "queued")))
    .orderBy(importItems.position).limit(1).get().then((row) => row?.run);
}

export async function batchAtCheckpoint(ownerId: string, taskId: string, version: number) {
  return getDb().get<{ batchId: string | null }>(sql`SELECT c.batch_id AS batchId FROM import_task_checkpoints c
    JOIN import_tasks t ON t.id = c.task_id WHERE t.owner_id = ${ownerId} AND c.task_id = ${taskId} AND c.version = ${version}`);
}

export async function history(ownerId: string, batchId: string) {
  const rows = await getDb().all<Pick<AiRun, "id" | "itemId" | "itemVersion" | "requestKey" | "state" | "createdAt" | "finishedAt" |
    "model" | "providerModel" | "durationMs" | "leaseUntil" | "failure" | "questionId"> & {
    report: string | null; reasons: string | null; inputTokens: number | null; outputTokens: number | null; costMicros: number;
  }>(sql`
    WITH ranked AS (
      SELECT r.*, row_number() OVER (PARTITION BY r.item_id ORDER BY r.created_at DESC, r.id DESC) AS n
      FROM ai_reviews r JOIN import_items i ON i.id = r.item_id WHERE r.owner_id = ${ownerId} AND i.batch_id = ${batchId}
    )
    SELECT r.id, r.item_id AS itemId, r.item_version AS itemVersion, r.request_key AS requestKey, r.state,
      r.created_at AS createdAt, r.finished_at AS finishedAt, r.model, r.provider_model AS providerModel,
      r.duration_ms AS durationMs, r.lease_until AS leaseUntil,
      r.report, r.reasons, r.failure, r.question_id AS questionId,
      (SELECT sum(input_tokens) FROM ai_review_usage u WHERE u.run_id = r.id) AS inputTokens,
      (SELECT sum(output_tokens) FROM ai_review_usage u WHERE u.run_id = r.id) AS outputTokens,
      coalesce((SELECT sum(cost_micros) FROM ai_review_usage u WHERE u.run_id = r.id), 0) AS costMicros
    FROM ranked r WHERE r.n <= 5 ORDER BY r.created_at DESC, r.id DESC`);
  return rows.map(({ report, reasons, requestKey, leaseUntil, state, ...row }) => ({
    ...row, report: report ? JSON.parse(report) as AiReport : null,
    reasons: reasons ? JSON.parse(reasons) as string[] : null, automatic: requestKey === "automatic",
    state: state === "running" && leaseUntil && new Date(leaseUntil).getTime() <= Date.now() ? "interrupted" as const : state,
  }));
}

export async function reserveAttempt(run: AiRun, attempt: number, cost: number, day: string, now: string) {
  const row = await getDb().run(sql`INSERT INTO ai_review_usage (run_id, attempt, owner_id, day, cost_micros)
    SELECT ${run.id}, ${attempt}, ${run.ownerId}, ${day}, ${cost}
    FROM ai_review_settings s WHERE s.owner_id = ${run.ownerId} AND ${enabledRevision(run.ownerId, run.settingsRevision)}
      AND ${ownerWritable(run.ownerId, now)} AND ${currentPending(run.ownerId, run.itemId, run.itemVersion)}
      AND EXISTS (SELECT 1 FROM ai_reviews WHERE id = ${run.id} AND state = 'running' AND lease_until > ${now})
      AND ${cost} + coalesce((SELECT sum(cost_micros) FROM ai_review_usage WHERE owner_id = s.owner_id AND day = ${day}), 0)
        + coalesce((SELECT cost_micros FROM ai_deleted_daily_usage WHERE owner_id = s.owner_id AND day = ${day}), 0)
        <= json_extract(s.settings, '$.dailyBudgetMicros')
    ON CONFLICT DO NOTHING`);
  return row.meta.changes === 1;
}

export async function recordUsage(runId: string, attempt: number, costMicros: number, inputTokens: number, outputTokens: number) {
  await getDb().update(aiReviewUsage).set({ costMicros, inputTokens, outputTokens })
    .where(and(eq(aiReviewUsage.runId, runId), eq(aiReviewUsage.attempt, attempt)));
}

export function finishRun(run: AiRun, result: Partial<AiRun>) {
  return getDb().update(aiReviews).set(result).where(and(eq(aiReviews.id, run.id), eq(aiReviews.state, "running"))).run();
}

export function setRunReasons(runId: string, reasons: string[]) {
  return getDb().update(aiReviews).set({ reasons }).where(and(eq(aiReviews.id, runId), eq(aiReviews.state, "complete"))).run();
}

export type AiApproval = { runId: string; settingsRevision: number; digest: string; epoch: number; planHash: string; day: string };
export function approvalGuard(item: typeof importItems.$inferSelect, batch: typeof importBatches.$inferSelect, permit: AiApproval, ctx: WriteContext) {
  return sql`EXISTS (
    SELECT 1 FROM ai_reviews r JOIN ai_review_settings s ON s.owner_id = r.owner_id
    WHERE r.id = ${permit.runId} AND r.owner_id = ${ctx.actorId} AND r.item_id = ${item.id}
      AND r.item_version = ${item.rowVersion} AND r.settings_revision = ${permit.settingsRevision} AND r.state = 'complete'
      AND json_extract(r.report, '$.decision') = 'pass' AND json_extract(r.report, '$.risk_level') = 'low'
      AND s.revision = r.settings_revision AND s.conditional_since <= ${batch.createdAt}
      AND json_extract(s.settings, '$.consent') = 1 AND json_extract(s.settings, '$.mode') = 'conditional'
      AND json_extract(s.settings, '$.allowIntegerArithmetic') = 1
      AND (SELECT count(*) FROM ai_reviews WHERE owner_id = s.owner_id AND approved_day = ${permit.day})
        + coalesce((SELECT approvals FROM ai_deleted_daily_usage WHERE owner_id = s.owner_id AND day = ${permit.day}), 0)
        < json_extract(s.settings, '$.dailyApprovalLimit')
      AND coalesce((SELECT sum(cost_micros) FROM ai_review_usage WHERE owner_id = s.owner_id AND day = ${permit.day}), 0)
        + coalesce((SELECT cost_micros FROM ai_deleted_daily_usage WHERE owner_id = s.owner_id AND day = ${permit.day}), 0)
        <= json_extract(s.settings, '$.dailyBudgetMicros')
      AND EXISTS (SELECT 1 FROM ai_review_sources WHERE owner_id = s.owner_id AND digest = ${permit.digest})
      AND EXISTS (SELECT 1 FROM system_state WHERE id = 1 AND data_epoch = ${permit.epoch})
  )`;
}
