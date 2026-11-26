import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { ids } from "./content-deletion";
import type { WriteContext } from "./catalog";

export function noReviewInFlight(selected: SQL, now: string) {
  return sql`NOT EXISTS (SELECT 1 FROM ai_reviews WHERE item_id IN ${selected}
    AND state = 'running' AND lease_until > ${now})`;
}

export function batchItems(batchId: string) {
  return sql`(SELECT id FROM import_items WHERE batch_id = ${batchId})`;
}

export async function batchCleanupOptions(id: string, ownerId: string) {
  return getDb().all<{ id: string; title: string; status: string }>(sql`
    SELECT i.id, coalesce(json_extract(i.candidate_json, '$.title'), i.item_key) AS title, i.status
    FROM import_items i JOIN import_batches b ON b.id = i.batch_id
    WHERE b.id = ${id} AND b.owner_id = ${ownerId} ORDER BY i.position
  `);
}

export function cleanImportRecords(batchId: string, selectedIds: string[] | undefined, ctx: WriteContext) {
  const selected = selectedIds ? ids(selectedIds) : batchItems(batchId);
  const runs = sql`(SELECT id FROM ai_reviews WHERE item_id IN ${selected})`;
  const emptied = selectedIds ? sql`NOT EXISTS (SELECT 1 FROM import_items WHERE batch_id = ${batchId})` : sql`1`;
  return [
    // Preserve the evidence already shown as part of a formal record before removing the editable candidate.
    sql`INSERT INTO retained_import_notes (id, owner_id, topic_id, question_id, namespace, note_json, source_json, created_at)
      SELECT i.id, b.owner_id, i.topic_id, i.question_id, b.namespace,
        json_object('kind', json_extract(i.candidate_json, '$.kind'),
          'learner_questions', json_extract(i.candidate_json, '$.learner_questions'),
          'evidenced_mistakes', json_extract(i.candidate_json, '$.evidenced_mistakes'),
          'solution_document', json_extract(i.candidate_json, '$.solution_document'),
          'ai_notes_md', json_extract(i.candidate_json, '$.ai_notes_md')),
        (SELECT json_group_array(json(s.value)) FROM json_each(b.source_json) s WHERE
          json_extract(s.value, '$.source_key') IN (
            SELECT atom FROM json_tree(i.candidate_json) WHERE key = 'source_key' AND type = 'text'
            UNION SELECT value FROM json_each(i.candidate_json, '$.source_keys')
          )), b.created_at
      FROM import_items i JOIN import_batches b ON b.id = i.batch_id
      WHERE i.id IN ${selected} AND i.status = 'committed'`,
    sql`UPDATE sources SET extra_json = json_set(extra_json, '$.namespace', (
        SELECT namespace FROM import_batches WHERE id = ${batchId}
      )) WHERE json_extract(extra_json, '$.batchId') = ${batchId} AND created_by = ${ctx.actorId}`,
    sql`INSERT INTO ai_deleted_daily_usage (owner_id, day, cost_micros, approvals)
      SELECT owner_id, day, sum(cost_micros), 0 FROM ai_review_usage WHERE run_id IN ${runs} GROUP BY owner_id, day
      ON CONFLICT(owner_id, day) DO UPDATE SET cost_micros = cost_micros + excluded.cost_micros`,
    sql`INSERT INTO ai_deleted_daily_usage (owner_id, day, cost_micros, approvals)
      SELECT owner_id, approved_day, 0, count(*) FROM ai_reviews WHERE id IN ${runs} AND approved_day IS NOT NULL
      GROUP BY owner_id, approved_day
      ON CONFLICT(owner_id, day) DO UPDATE SET approvals = approvals + excluded.approvals`,
    sql`DELETE FROM ai_review_usage WHERE run_id IN ${runs}`,
    sql`DELETE FROM ai_reviews WHERE id IN ${runs}`,
    sql`DELETE FROM import_reviews WHERE item_id IN ${selected}`,
    sql`DELETE FROM import_attempt_refs WHERE item_id IN ${selected}`,
    sql`DELETE FROM import_question_refs WHERE item_id IN ${selected}`,
    sql`DELETE FROM import_topic_refs WHERE item_id IN ${selected}`,
    ...selectedIds ? [sql`UPDATE import_batches SET raw_json = json_set(raw_json, '$.items', json((
      SELECT json_group_array(json(raw.value)) FROM json_each(import_batches.raw_json, '$.items') raw
      WHERE json_extract(raw.value, '$.item_key') NOT IN (SELECT item_key FROM import_items WHERE id IN ${selected})
    ))) WHERE id = ${batchId}`] : [],
    sql`DELETE FROM import_items WHERE id IN ${selected}`,
    sql`UPDATE import_tasks SET row_version = row_version + 1, updated_at = ${ctx.now}
      WHERE id IN (SELECT task_id FROM import_task_checkpoints WHERE batch_id = ${batchId}) AND ${emptied}`,
    sql`DELETE FROM import_task_checkpoints WHERE batch_id = ${batchId} AND ${emptied}`,
    ...selectedIds ? [] : [
      sql`DELETE FROM import_batch_keys WHERE batch_id = ${batchId}`,
      sql`DELETE FROM import_batches WHERE id = ${batchId}`,
    ],
  ];
}
