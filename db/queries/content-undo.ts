import { eq, getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { atomicBatch, type AtomicStatement } from "@/db/atomic";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import {
  aiReviews, assets, assetLinks, attempts, chapters, contentRevisions, contentUndoSlots, courseDeletions, courses, importAttemptRefs, importItems,
  importQuestionRefs, importTopicRefs, learningStates, provenanceLinks, questions, questionTopics,
  retainedImportNotes, reviewItems, reviewSessions, sources, topicRelations, topics,
} from "@/db/schema";
import type { ContentChange, ContentOperationReceipt } from "@/domain/content-operations";

export type OperationReceipt = { id: string; rowVersion: number; contentOperation: ContentOperationReceipt };
export type PlannedChange = {
  change: ContentChange; relatedChanges?: ContentChange[]; reportPrimary?: boolean;
  condition: SQL; additionalChecks?: SQL[]; writes: AtomicStatement[];
};

// Attempts can depend on question revisions, and attempt revisions depend on attempts.
// Defer foreign-key checks while the ordered restore rebuilds both sides.
const trackedTables: [SQLiteTable, ...string[]][] = [
  [courses, "id"], [chapters, "id"], [courseDeletions, "course_id"], [assets, "id"],
  [topics, "id"], [questions, "id"], [sources, "id"], [reviewSessions, "id"],
  [learningStates, "id"], [attempts, "id"], [contentRevisions, "id"], [importItems, "id"],
  [reviewItems, "session_id", "question_id"], [topicRelations, "from_topic_id", "to_topic_id"],
  [questionTopics, "question_id", "topic_id"], [provenanceLinks, "id"], [assetLinks, "id"],
  [importQuestionRefs, "owner_id", "namespace", "external_id"],
  [importTopicRefs, "owner_id", "namespace", "external_id"],
  [importAttemptRefs, "owner_id", "namespace", "external_id"], [retainedImportNotes, "id"], [aiReviews, "id"],
];

export function currentUndoSlot(ownerId: string) {
  return getDb().select().from(contentUndoSlots).where(eq(contentUndoSlots.ownerId, ownerId)).get();
}

export function undoAssetIds(ownerId: string) {
  return getDb().all<{ id: string }>(sql`SELECT asset_id AS id FROM content_undo_assets WHERE owner_id = ${ownerId}`);
}

function finishCapture(ctx: WriteContext) {
  const owner = ctx.actorId;
  return [
    sql`DELETE FROM content_undo_changes WHERE owner_id = ${owner} AND before_json IS after_json`,
    // Pin registered attachments, source images and protected image URLs that restoration can reintroduce.
    sql`INSERT INTO content_undo_assets (owner_id, asset_id)
      SELECT ${owner}, a.id FROM assets a WHERE a.created_by = ${owner}
        AND (a.status = 'ready' OR (a.status = 'quarantined' AND json_extract(a.extra_json, '$.undoHeld') = 1)) AND (
        EXISTS (SELECT 1 FROM content_undo_changes c WHERE c.owner_id = ${owner} AND (
          (c.table_name = 'asset_links' AND json_extract(c.before_json, '$.asset_id') = a.id)
          OR (c.table_name = 'assets' AND c.row_key = json_array(a.id))
          OR instr(c.before_json, '/api/v1/assets/' || a.id) > 0
          OR (c.table_name = 'provenance_links' AND json_extract(json_extract(c.before_json, '$.locator_json'), '$.assetId') = a.id)
          OR (c.table_name = 'content_revisions' AND EXISTS (
            SELECT 1 FROM json_each(json_extract(c.before_json, '$.snapshot_json'), '$.originalAssetIds') image WHERE image.value = a.id
          ))
        )) OR EXISTS (
          SELECT 1 FROM asset_links l JOIN content_undo_changes c
            ON c.table_name = 'provenance_links' AND l.source_id = json_extract(c.before_json, '$.source_id')
          WHERE l.asset_id = a.id AND c.owner_id = ${owner}
        )
      )`,
    // Review positions are unique per session. Restore affected queue entries together.
    sql`UPDATE content_undo_changes SET
      before_json = CASE WHEN before_json IS NULL OR after_json IS NULL OR table_name = 'review_items' THEN before_json
        ELSE (SELECT json_group_object(b.key, b.value) FROM json_each(before_json) b
          JOIN json_each(after_json) a ON a.key = b.key WHERE a.value IS NOT b.value) END,
      after_exists = after_json IS NOT NULL, after_json = NULL WHERE owner_id = ${owner}`,
    sql`UPDATE content_undo_slots SET phase = CASE WHEN (
      SELECT coalesce(sum(length(CAST(before_json AS BLOB))), 0) FROM content_undo_changes WHERE owner_id = ${owner}
    ) <= 4000000 THEN 0 ELSE -1 END WHERE owner_id = ${owner}`,
  ];
}

export async function applyContentBatch(
  plan: PlannedChange[], condition: SQL, receipt: OperationReceipt, ctx: WriteContext, release: AtomicStatement[],
) {
  const db = getDb();
  const slot = {
    ownerId: ctx.actorId, operationId: receipt.id, changes: receipt.contentOperation.changes, phase: 1, createdAt: ctx.now,
  };
  await atomicBatch(db, [
    writeReceipt(db, ctx, receipt, condition),
    db.delete(contentUndoSlots).where(eq(contentUndoSlots.ownerId, ctx.actorId)),
    db.insert(contentUndoSlots).values(slot),
    ...plan.flatMap(({ condition, additionalChecks = [], writes }) => [
      ...[condition, ...additionalChecks].map((check) => sql`UPDATE write_receipts
        SET precondition_ok = CASE WHEN ${check} THEN 1 ELSE 0 END
        WHERE actor_id = ${ctx.actorId} AND idempotency_key = ${ctx.key}`),
      ...writes,
    ]),
    ...finishCapture(ctx),
    ...release,
    advanceEpoch(db, ctx),
  ]);
}
function restoreStatements(table: SQLiteTable, keys: string[], ctx: WriteContext) {
  const name = getTableName(table);
  const columns = Object.values(getTableColumns(table)).map(({ name }) => name);
  const tableSql = sql.identifier(name);
  const key = sql`json_array(${sql.join(keys.map((column) => sql`t.${sql.identifier(column)}`), sql`, `)})`;
  const scope = sql`owner_id = ${ctx.actorId} AND table_name = ${name}`;
  const queue = name === "review_items";
  const remove = sql`DELETE FROM ${tableSql} AS t WHERE ${key} IN (
    SELECT row_key FROM content_undo_changes WHERE ${scope} AND after_exists = 1
      ${queue ? sql.empty() : sql`AND before_json IS NULL`}
  )`;
  const path = (column: string) => sql.raw("'$." + column + "'");
  const before = (column: string) => sql`json_extract(c.before_json, ${path(column)})`;
  const restore = (column: string, updating: boolean) => {
    const saved = before(column);
    if (column === "row_version") return updating ? sql`t.row_version + 1` : sql`${saved} + 1`;
    if (column === "updated_at") return sql`${ctx.now}`;
    if (column === "updated_by") return sql`${ctx.actorId}`;
    if (column === "last_origin") return sql`'restore'`;
    return updating
      ? sql`CASE WHEN json_type(c.before_json, ${path(column)}) IS NOT NULL THEN ${saved} ELSE t.${sql.identifier(column)} END`
      : saved;
  };
  const insert = sql`INSERT INTO ${tableSql} (${sql.join(columns.map(sql.identifier), sql`, `)})
    SELECT ${sql.join(columns.map((column) => restore(column, false)), sql`, `)}
    FROM content_undo_changes c WHERE ${scope} AND before_json IS NOT NULL
      ${queue ? sql.empty() : sql`AND after_exists = 0`}`;
  const assignments = columns.filter((column) => !keys.includes(column))
    .map((column) => sql`${sql.identifier(column)} = ${restore(column, true)}`);
  const update = assignments.length && !queue ? sql`UPDATE ${tableSql} AS t
    SET ${sql.join(assignments, sql`, `)} FROM content_undo_changes c
    WHERE ${scope} AND before_json IS NOT NULL AND after_exists = 1 AND c.row_key = ${key}` : undefined;
  return { remove, restore: update ? [update, insert] : [insert] };
}

export async function restoreContentBatch(receipt: OperationReceipt, ctx: WriteContext) {
  const db = getDb();
  const owner = eq(contentUndoSlots.ownerId, ctx.actorId);
  const tracked = await db.all<{ name: string }>(sql`
    SELECT DISTINCT table_name AS name FROM content_undo_changes WHERE owner_id = ${ctx.actorId}`);
  const names = new Set(tracked.map(({ name }) => name));
  const undo = trackedTables.filter(([table]) => names.has(getTableName(table)))
    .map(([table, ...keys]) => restoreStatements(table, keys, ctx));
  await atomicBatch(db, [
    writeReceipt(db, ctx, receipt, sql`EXISTS (
      SELECT 1 FROM content_undo_slots WHERE owner_id = ${ctx.actorId} AND operation_id = ${receipt.id}
        AND phase = 0 AND conflicted = 0
    ) AND NOT EXISTS (
      SELECT 1 FROM content_undo_assets p JOIN assets a ON a.id = p.asset_id
      WHERE p.owner_id = ${ctx.actorId} AND a.status <> 'ready'
        AND NOT (a.status = 'quarantined' AND json_extract(a.extra_json, '$.undoHeld') = 1)
    )`),
    sql`PRAGMA defer_foreign_keys = ON`,
    db.update(contentUndoSlots).set({ phase: 2 }).where(owner),
    ...undo.toReversed().map(({ remove }) => remove),
    ...undo.flatMap((entry) => entry.restore),
    db.delete(contentUndoSlots).where(owner),
    advanceEpoch(db, ctx),
  ]);
}
