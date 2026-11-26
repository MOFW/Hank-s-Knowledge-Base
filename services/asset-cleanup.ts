import { sql, type SQL } from "drizzle-orm";
import { getAssetStore } from "@/adapters/assets";
import { getDb } from "@/db";
import type { WriteContext } from "@/db/queries/catalog";
import { commitManagement, epochIs, ids } from "@/db/queries/content-deletion";
import { Problem } from "@/domain/problem";
import { existingResult, requireWriteAccess } from "@/services/writes";

const removableStatus = sql`(a.status IN ('ready', 'deleted') OR
  (a.status = 'pending' AND a.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')))`;

// Markdown can link to the protected original, separately from a managed attachment.
const markdownTargets = [
  { table: "topics", href: "/topics/", title: "title", edit: "/edit", fields: ["summary_md", "body_md", "supplement_md"] },
  { table: "questions", href: "/questions/", title: "title", edit: "/edit",
    fields: ["statement_md", "final_answer_md", "key_techniques_md", "solution_document_json", "solution_steps_json", "solution_layers_json"] },
  { table: "attempts", href: "/attempts/", title: "'作答记录'", edit: "/edit",
    fields: ["original_work_md", "error_analysis_md", "correction_md", "insight_md"] },
  { table: "courses", href: "/courses/", title: "name", edit: "", fields: ["description_md"] },
] as const;

type Reference = { assetId: string; href: string | null; title: string; kind: "attachment" | "text" | "draft" | "statement" | "undo" };
function activeReferences(assetIds: SQL, ownerId: string, bulk = true) {
  const markdown = markdownTargets.map(({ table, href, title, edit, fields }) => {
    const contains = fields.map((field) => sql`instr(c.${sql.raw(field)}, '/api/v1/assets/' || a.id) > 0`);
    const url = table === "questions" ? sql`CASE WHEN c.deleted_at IS NOT NULL THEN '/manage/question/' || c.id
      ELSE ${href} || c.id || ${edit} END` : sql`${href} || c.id || ${edit}`;
    return sql`SELECT a.id, ${url}, ${table === "attempts" ? sql`'作答记录'` : sql`c.${sql.raw(title)}`}, 'text'
      FROM selected_assets a JOIN ${sql.raw(table)} c ON ${sql.join(contains, sql` OR `)}`;
  });
  // An original can be detached unless this would leave a question without a statement.
  return sql`
    WITH selected_assets AS MATERIALIZED (
      SELECT id, sha256 FROM assets WHERE id IN ${assetIds} AND created_by = ${ownerId} AND status = 'ready'
    ), linked(assetId, href, title, kind) AS (
      SELECT a.id, CASE WHEN q.deleted_at IS NULL THEN '/questions/' || q.id || '/edit' ELSE '/manage/question/' || q.id END,
        q.title, CASE WHEN l.role = 'original' AND trim(q.statement_md, char(9, 10, 13, 32)) = '' AND NOT EXISTS (
          SELECT 1 FROM asset_links other WHERE other.question_id = q.id AND other.role = 'original'
          AND ${bulk ? sql`other.asset_id NOT IN ${assetIds}` : sql`other.asset_id <> a.id`}
        ) THEN 'statement' ELSE 'attachment' END
      FROM selected_assets a JOIN asset_links l ON l.asset_id = a.id JOIN questions q ON q.id = l.question_id
      UNION ALL SELECT a.id, '/topics/' || t.id || '/edit', t.title, 'attachment'
        FROM selected_assets a JOIN asset_links l ON l.asset_id = a.id JOIN topics t ON t.id = l.topic_id
      UNION ALL SELECT a.id, '/attempts/' || t.id || '/edit', '作答记录', 'attachment'
        FROM selected_assets a JOIN asset_links l ON l.asset_id = a.id JOIN attempts t ON t.id = l.attempt_id
      UNION ALL SELECT a.id, '/topics/' || t.id || '/examples', t.title, 'text'
        FROM selected_assets a JOIN question_topics r ON instr(r.note_md, '/api/v1/assets/' || a.id) > 0
        JOIN topics t ON t.id = r.topic_id
      UNION ALL SELECT DISTINCT a.id, coalesce('/topics/' || p.topic_id, '/questions/' || p.question_id,
          '/attempts/' || p.attempt_id || '/edit'), s.title, 'attachment'
        FROM selected_assets a JOIN asset_links l ON l.asset_id = a.id JOIN sources s ON s.id = l.source_id
        JOIN provenance_links p ON p.source_id = s.id
    ), in_text AS (${sql.join(markdown, sql` UNION ALL `)}), drafts AS (
      SELECT a.id, '/imports/' || b.id || '#item-' || i.id,
        coalesce(json_extract(i.candidate_json, '$.title'), '导入候选'), 'draft'
        FROM selected_assets a JOIN import_items i ON i.status IN ('pending', 'approved', 'conflict', 'failed')
        JOIN import_batches b ON b.id = i.batch_id AND b.owner_id = ${ownerId}
        WHERE EXISTS (SELECT 1 FROM json_each(i.candidate_json, '$.original_asset_ids') j WHERE j.value = a.id)
           OR EXISTS (SELECT 1 FROM json_each(i.candidate_json, '$.history_images') j WHERE json_extract(j.value, '$.sha256') = a.sha256)
      UNION ALL SELECT DISTINCT a.id, '/imports/tasks/' || t.id, json_extract(t.scope_json, '$.title'), 'draft'
        FROM selected_assets a JOIN import_tasks t ON t.owner_id = ${ownerId} AND t.cancelled_at IS NULL
        JOIN import_task_checkpoints c ON c.task_id = t.id
        WHERE json_extract(c.event_json, '$.evidence.assetId') = a.id
      UNION ALL SELECT a.id, NULL, '最近一轮操作可恢复的附件', 'undo'
        FROM selected_assets a JOIN content_undo_assets p ON p.asset_id = a.id
    )
    SELECT * FROM linked UNION SELECT * FROM in_text UNION SELECT * FROM drafts`;
}

export function releaseUndoAssets(assetIds: string[], ctx: WriteContext) {
  if (!assetIds.length) return [];
  const selected = ids(assetIds);
  const referenced = activeReferences(selected, ctx.actorId);
  return [sql`UPDATE assets AS a SET status = 'deleted', deleted_at = ${ctx.now},
    extra_json = json_set(json_remove(extra_json, '$.undoHeld'), '$.undoRelease', 1)
    WHERE a.id IN ${selected} AND a.created_by = ${ctx.actorId}
      AND (a.status = 'ready' OR (a.status = 'quarantined' AND json_extract(extra_json, '$.undoHeld') = 1))
      AND NOT EXISTS (SELECT 1 FROM content_undo_assets p WHERE p.asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM (${referenced}) r WHERE r.assetId = a.id)
      AND NOT EXISTS (SELECT 1 FROM asset_links l WHERE l.asset_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM content_revisions r WHERE instr(r.snapshot_json, a.id) > 0)
      AND NOT EXISTS (SELECT 1 FROM retained_import_notes r WHERE instr(r.note_json, a.id) > 0)
      AND NOT EXISTS (SELECT 1 FROM provenance_links l WHERE json_extract(l.locator_json, '$.assetId') = a.id)
  `];
}

export function prepareAssetRemoval(id: string, ctx: WriteContext) {
  const selected = ids([id]);
  const condition = sql`EXISTS (SELECT 1 FROM assets a WHERE a.id = ${id} AND a.created_by = ${ctx.actorId} AND a.status = 'ready')
    AND NOT EXISTS (SELECT 1 FROM (${activeReferences(selected, ctx.actorId)}))
    AND NOT EXISTS (SELECT 1 FROM asset_links WHERE asset_id = ${id})
    AND NOT EXISTS (SELECT 1 FROM content_revisions WHERE instr(snapshot_json, ${id}) > 0)
    AND NOT EXISTS (SELECT 1 FROM retained_import_notes WHERE instr(note_json, ${id}) > 0)
    AND NOT EXISTS (SELECT 1 FROM provenance_links WHERE json_extract(locator_json, '$.assetId') = ${id})`;
  return { condition, writes: [sql`UPDATE assets SET status = 'quarantined',
    extra_json = json_set(extra_json, '$.undoHeld', 1) WHERE id = ${id}`] };
}

export async function cleanReleasedUndoAssets(ownerId: string) {
  const db = getDb();
  try {
    const pending = await db.all<{ id: string; storageKey: string }>(sql`
      SELECT id, storage_key AS storageKey FROM assets
      WHERE created_by = ${ownerId} AND status = 'deleted' AND json_extract(extra_json, '$.undoRelease') = 1
      ORDER BY deleted_at, id LIMIT 51`);
    if (!pending.length) return false;
    const batch = pending.slice(0, 50);
    // D1 retirement commits first. R2 deletion by immutable storage key is safe to retry.
    await getAssetStore().delete(batch.map(({ storageKey }) => storageKey));
    await db.run(sql`DELETE FROM assets WHERE status = 'deleted' AND created_by = ${ownerId}
      AND id IN ${ids(batch.map(({ id }) => id))}`);
    return pending.length > batch.length;
  } catch {
    // The retired rows are durable work for a subsequent direct request or the attachment page.
    return true;
  }
}

export async function assetManagement(ownerId: string, before?: string) {
  const db = getDb();
  const [state, rows] = await db.batch([
    db.select({ dataEpoch: sql<number>`data_epoch` }).from(sql`system_state`).where(sql`id = 1`),
    db.select({
      id: sql<string>`a.id`, name: sql<string>`a.original_filename`, status: sql<string>`a.status`,
    }).from(sql`assets a`).where(sql`a.created_by = ${ownerId} AND ${removableStatus}
      ${before ? sql`AND (a.created_at, a.id) < (SELECT created_at, id FROM assets WHERE id = ${before} AND created_by = ${ownerId})` : sql.empty()}`)
      .orderBy(sql`a.created_at DESC, a.id DESC`).limit(51),
  ]);
  const shown = rows.slice(0, 50);
  const references = shown.length ? await db.all<Reference>(activeReferences(ids(shown.map(({ id }) => id)), ownerId, false)) : [];
  return {
    dataEpoch: state[0]?.dataEpoch ?? -1,
    rows: shown.map((row) => {
      const affected = references.filter(({ assetId }) => assetId === row.id);
      return { ...row, references: affected.length, affected };
    }),
    next: rows.length > 50 ? rows[49].id : null,
  };
}

export async function removeAssets(selectedIds: string[], epoch: number, ctx: WriteContext, detach = false) {
  await requireWriteAccess(ctx);
  const db = getDb();
  const selected = ids(selectedIds);
  const previous = await existingResult(ctx);
  const affected = activeReferences(selected, ctx.actorId);
  const result = previous ?? await commitManagement({ id: selectedIds[0], rowVersion: 1 },
    sql`${epochIs(epoch)} AND (SELECT count(*) FROM assets a WHERE a.created_by = ${ctx.actorId}
      AND a.id IN ${selected} AND ${removableStatus}) = ${selectedIds.length}
      AND NOT EXISTS (SELECT 1 FROM (${affected}) WHERE kind <> 'attachment' OR NOT ${detach})`,
    [
      // Invalidate stale editors and import plans before removing shared current links.
      ...(["question", "topic", "attempt"] as const).map((target) => {
        const column = sql.raw(target + "_id");
        const table = sql.raw(target === "question" ? "questions" : target === "topic" ? "topics" : "attempts");
        return sql`UPDATE ${table} SET row_version = row_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.actorId},
          last_origin = 'manual' WHERE id IN (SELECT ${column} FROM asset_links WHERE asset_id IN ${selected})`;
      }),
      sql`UPDATE content_revisions SET snapshot_json = json_set(snapshot_json, '$.originalAssetIds', json((
        SELECT json_group_array(j.value) FROM json_each(snapshot_json, '$.originalAssetIds') j WHERE j.value NOT IN ${selected}
      ))) WHERE EXISTS (SELECT 1 FROM json_each(snapshot_json, '$.originalAssetIds') j WHERE j.value IN ${selected})`,
      sql`UPDATE provenance_links SET locator_json = json_remove(locator_json, '$.assetId')
        WHERE json_extract(locator_json, '$.assetId') IN ${selected}`,
      sql`UPDATE import_task_checkpoints SET event_json = json_remove(event_json, '$.evidence.assetId')
        WHERE json_extract(event_json, '$.evidence.assetId') IN ${selected}`,
      sql`DELETE FROM asset_links WHERE asset_id IN ${selected}`,
      sql`UPDATE assets SET status = 'deleted', deleted_at = ${ctx.now}
        WHERE id IN ${selected} AND status IN ('ready', 'pending') AND created_by = ${ctx.actorId}`,
    ], ctx, {
      code: "ASSET_REFERENCED_OR_CHANGED",
      message: "附件或引用已有变化。请刷新并查看受影响资料。如果只剩原题图，请先补充题干或另一张图。",
    });
  const pending = await db.all<{ key: string }>(sql`SELECT storage_key AS key FROM assets
    WHERE created_by = ${ctx.actorId} AND status = 'deleted' AND id IN ${selected}`);
  try {
    if (pending.length) {
      await getAssetStore().delete(pending.map(({ key }) => key));
      await db.run(sql`DELETE FROM assets WHERE created_by = ${ctx.actorId} AND status = 'deleted' AND id IN ${selected}`);
    }
  } catch {
    throw new Problem(503, "ASSET_DELETE_PENDING", "附件已停止展示，文件清理尚未完成。请重试，或在附件列表继续清理。");
  }
  return result;
}
