import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { atomicBatch } from "@/db/atomic";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import { Problem } from "@/domain/problem";
import { errorDetails, existingResult, requireWriteAccess } from "@/services/writes";

export const randomId = sql`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
  substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

export function ids(values: string[]) {
  return sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

export const epochIs = (epoch: number) => sql`EXISTS (SELECT 1 FROM system_state WHERE id = 1 AND data_epoch = ${epoch})`;

export async function commitManagement(
  result: { id: string; rowVersion: number }, precondition: SQL, operations: SQL[], ctx: WriteContext,
  changes?: { code: string; message: string },
) {
  const db = getDb();
  try {
    await atomicBatch(db, [writeReceipt(db, ctx, result, precondition), ...operations, advanceEpoch(db, ctx)]);
    return result;
  } catch (error) {
    const previous = await existingResult(ctx);
    if (previous) return previous;
    const detail = errorDetails(error);
    if (detail.includes("receipts_precondition")) {
      await requireWriteAccess(ctx);
      throw new Problem(409, changes?.code ?? "VERSION_CONFLICT", changes?.message ?? "关联内容已经变化，请刷新后重新确认。");
    }
    if (/UNIQUE constraint failed: (chapters|topics|courses)\./i.test(detail)) {
      throw new Problem(409, "DUPLICATE_SLUG", "目标已有相同的路径别名，请调整后重试。");
    }
    throw error;
  }
}

type RevisionTarget = "course" | "chapter" | "topic" | "question" | "attempt" | "learning_state";
export function removeRevisions(target: RevisionTarget, selected: SQL) {
  const targetColumn = sql.raw(target + "_id");
  return removeRevisionRows(sql`(SELECT id FROM content_revisions WHERE ${targetColumn} IN ${selected})`);
}

export function removeRevisionRows(selected: SQL, detachAttempts = false) {
  const version = (revisionId: SQL) => sql`(SELECT revision_no FROM content_revisions WHERE id = ${revisionId})`;
  const source = sql`json_extract(snapshot_json, '$.sourceRevisionId')`;
  return [
    ...detachAttempts ? [
      sql`UPDATE attempts SET extra_json = json_set(extra_json, '$.sourceRevisionNo', ${version(sql`source_revision_id`)}),
        source_revision_id = NULL, row_version = row_version + 1 WHERE source_revision_id IN ${selected}`,
      sql`UPDATE content_revisions SET snapshot_json = json_set(snapshot_json,
        '$.sourceRevisionId', NULL, '$.extraJson.sourceRevisionNo', ${version(source)})
        WHERE attempt_id IS NOT NULL AND ${source} IN ${selected}`,
    ] : [],
    sql`DELETE FROM asset_links WHERE revision_id IN ${selected}`,
    sql`DELETE FROM content_revisions WHERE id IN ${selected}`,
  ];
}

export function removeAttempts(selected: SQL) {
  return [
    sql`DELETE FROM import_attempt_refs WHERE attempt_id IN ${selected}`,
    sql`DELETE FROM provenance_links WHERE attempt_id IN ${selected}`,
    sql`DELETE FROM asset_links WHERE attempt_id IN ${selected}`,
    ...removeRevisions("attempt", selected),
    sql`DELETE FROM attempts WHERE id IN ${selected}`,
  ];
}

export function removeLearning(q: SQL, ownerId?: string) {
  const owner = ownerId ? sql`AND user_id = ${ownerId}` : sql.empty();
  const selected = sql`(SELECT id FROM learning_states WHERE question_id IN ${q} ${owner})`;
  return [...removeRevisions("learning_state", selected), sql`DELETE FROM learning_states WHERE id IN ${selected}`];
}

export function removeReviewItems(q: SQL, now: string, ownerId?: string, sessionScope?: SQL) {
  const owners = ownerId ? sql`AND session_id IN (SELECT id FROM review_sessions WHERE user_id = ${ownerId})` : sql.empty();
  const affected = sql`(SELECT session_id FROM review_items WHERE question_id IN ${q} ${owners})`;
  // Move positions outside the current range before reassigning them, so the composite key remains unique.
  // Session queues are bounded to 12 by the review service.
  return [
    sql`WITH kept AS MATERIALIZED (
      SELECT s.id, count(i.position) AS n, count(CASE WHEN i.position < s.position THEN 1 END) AS before
      FROM review_sessions s LEFT JOIN review_items i ON i.session_id = s.id AND i.question_id NOT IN ${q}
      WHERE s.id IN ${affected} GROUP BY s.id
    )
    UPDATE review_sessions AS s SET total = kept.n, position = min(kept.before + 1, kept.n),
      status = CASE WHEN s.status IN ('active', 'paused') AND kept.before = kept.n THEN 'completed' ELSE s.status END,
      row_version = s.row_version + 1, updated_at = ${now}
    FROM kept WHERE s.id = kept.id AND kept.n > 0`,
    sql`UPDATE review_items SET position = position + 100
      WHERE session_id IN ${affected} AND question_id NOT IN ${q}`,
    sql`DELETE FROM review_items WHERE question_id IN ${q} ${owners}`,
    sql`DELETE FROM review_sessions WHERE NOT EXISTS (SELECT 1 FROM review_items WHERE session_id = review_sessions.id)
      ${sessionScope ? sql`AND id IN ${sessionScope}` : sql.empty()}`,
    sql`WITH reordered AS MATERIALIZED (
      SELECT session_id, position, row_number() OVER (PARTITION BY session_id ORDER BY position) AS next
      FROM review_items WHERE position > 100
    )
    UPDATE review_items AS i SET position = reordered.next FROM reordered
    WHERE i.session_id = reordered.session_id AND i.position = reordered.position`,
  ];
}

function detachImportTarget(target: "topic" | "question", selected: SQL) {
  const targetColumn = sql.raw(target + "_id");
  return sql`UPDATE import_items SET status = 'skipped', approved_hash = NULL, committed_version = NULL,
    ${targetColumn} = NULL, row_version = row_version + 1,
    issue_json = json_object('code', 'TARGET_DELETED', 'path', '/target_id', 'severity', 'notice',
      'message', '正式资料已删除，保留原导入和审核记录。')
    WHERE ${targetColumn} IN ${selected}`;
}

export function removeTopics(selected: SQL) {
  return [
    detachImportTarget("topic", selected),
    sql`DELETE FROM retained_import_notes WHERE topic_id IN ${selected}`,
    sql`DELETE FROM import_topic_refs WHERE topic_id IN ${selected}`,
    sql`DELETE FROM question_topics WHERE topic_id IN ${selected}`,
    sql`DELETE FROM topic_relations WHERE from_topic_id IN ${selected} OR to_topic_id IN ${selected}`,
    sql`DELETE FROM provenance_links WHERE topic_id IN ${selected}`,
    sql`DELETE FROM asset_links WHERE topic_id IN ${selected}`,
    ...removeRevisions("topic", selected),
    sql`DELETE FROM topics WHERE id IN ${selected}`,
  ];
}

export function removeQuestions(selected: SQL, now: string, reviewSessionScope?: SQL) {
  return [
    detachImportTarget("question", selected),
    sql`DELETE FROM retained_import_notes WHERE question_id IN ${selected}`,
    sql`UPDATE ai_reviews SET question_id = NULL WHERE question_id IN ${selected}`,
    sql`DELETE FROM import_question_refs WHERE question_id IN ${selected}`,
    ...removeAttempts(sql`(SELECT id FROM attempts WHERE question_id IN ${selected})`),
    ...removeLearning(selected),
    ...removeReviewItems(selected, now, undefined, reviewSessionScope),
    sql`DELETE FROM question_topics WHERE question_id IN ${selected}`,
    sql`DELETE FROM provenance_links WHERE question_id IN ${selected}`,
    sql`DELETE FROM asset_links WHERE question_id IN ${selected}`,
    ...removeRevisions("question", selected),
    sql`DELETE FROM questions WHERE id IN ${selected}`,
  ];
}
