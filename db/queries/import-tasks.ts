import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import { importBatches, importItems, importTaskCheckpoints, importTasks, questions } from "@/db/schema";
import type { ImportCheckpoint, ImportTaskScope } from "@/domain/import-task";

export function listImportTasks(ownerId: string) {
  return getDb().select().from(importTasks).where(eq(importTasks.ownerId, ownerId))
    .orderBy(desc(importTasks.updatedAt), desc(importTasks.id)).limit(20).all();
}

export function findImportTaskForBatch(ownerId: string, batchId: string) {
  return getDb().select({ taskId: importTasks.id, unitId: importTaskCheckpoints.unitId }).from(importTaskCheckpoints)
    .innerJoin(importTasks, eq(importTasks.id, importTaskCheckpoints.taskId))
    .where(and(eq(importTasks.ownerId, ownerId), eq(importTaskCheckpoints.batchId, batchId))).get();
}

export async function readImportTask(ownerId: string, id: string) {
  const db = getDb();
  const [tasks, checkpoints] = await db.batch([
    db.select().from(importTasks).where(and(eq(importTasks.ownerId, ownerId), eq(importTasks.id, id))),
    db.select({
      unitId: importTaskCheckpoints.unitId, version: importTaskCheckpoints.version, event: importTaskCheckpoints.event,
      batchId: sql<string | null>`${importBatches.id}`.as("candidate_batch_id"), createdAt: importTaskCheckpoints.createdAt,
      item: {
        id: importItems.id, rowVersion: importItems.rowVersion,
        status: sql<typeof importItems.$inferSelect.status>`CASE WHEN ${questions.deletedAt} IS NOT NULL THEN 'skipped' ELSE ${importItems.status} END`.as("task_item_status"),
        issue: importItems.issueJson, questionId: importItems.questionId,
        topicId: importItems.topicId, committedVersion: importItems.committedVersion,
      },
    }).from(importTaskCheckpoints)
      .innerJoin(importTasks, eq(importTaskCheckpoints.taskId, importTasks.id))
      .leftJoin(importBatches, and(eq(importTaskCheckpoints.batchId, importBatches.id), eq(importBatches.ownerId, ownerId)))
      .leftJoin(importItems, eq(importItems.batchId, importBatches.id))
      .leftJoin(questions, eq(importItems.questionId, questions.id))
      .where(and(eq(importTasks.ownerId, ownerId), eq(importTasks.id, id))).orderBy(importTaskCheckpoints.version),
  ]);
  return tasks[0] ? { task: tasks[0], checkpoints } : undefined;
}

export async function createImportTask(ctx: WriteContext, scope: ImportTaskScope) {
  const db = getDb();
  const result = { id: crypto.randomUUID(), rowVersion: 1 };
  await db.batch([
    writeReceipt(db, ctx, result, sql`1`),
    db.insert(importTasks).values({ ...result, ownerId: ctx.actorId, scope, createdAt: ctx.now, updatedAt: ctx.now }),
    advanceEpoch(db, ctx),
  ]);
  return result;
}

export function taskCheckpoint(ctx: WriteContext, id: string, expectedVersion: number, unitId: string, event: ImportCheckpoint,
  previous?: { id: string; rowVersion: number }) {
  const result = { id, rowVersion: expectedVersion + 1 };
  const assetId = event.type === "evidence" ? event.evidence.assetId : undefined;
  const precondition = sql`EXISTS (SELECT 1 FROM import_tasks WHERE id = ${id} AND owner_id = ${ctx.actorId}
    AND row_version = ${expectedVersion} AND cancelled_at IS NULL)
    AND ${assetId ? sql`EXISTS (SELECT 1 FROM assets WHERE id = ${assetId} AND created_by = ${ctx.actorId} AND status = 'ready')` : sql`1`}
    AND ${previous ? sql`EXISTS (SELECT 1 FROM import_items WHERE id = ${previous.id} AND row_version = ${previous.rowVersion})` : sql`1`}`;
  function append(db: ReturnType<typeof getDb>, batchId: string | null) {
    return [
      db.update(importTasks).set({ rowVersion: result.rowVersion, updatedAt: ctx.now }).where(eq(importTasks.id, id)),
      db.insert(importTaskCheckpoints).values({ taskId: id, version: result.rowVersion, unitId, event, batchId, createdAt: ctx.now }),
    ] as const;
  }
  return { result, precondition, append };
}

export async function saveTaskCheckpoint(ctx: WriteContext, checkpoint: ReturnType<typeof taskCheckpoint>) {
  const db = getDb();
  await db.batch([
    writeReceipt(db, ctx, checkpoint.result, checkpoint.precondition),
    ...checkpoint.append(db, null),
    advanceEpoch(db, ctx),
  ]);
  return checkpoint.result;
}
