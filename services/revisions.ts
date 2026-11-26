import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { WriteContext } from "@/db/queries/catalog";
import { commitManagement, epochIs, randomId, removeRevisionRows } from "@/db/queries/content-deletion";
import { revisionDetail, type RevisionTarget } from "@/db/queries/questions";
import { topicPatch } from "@/domain/catalog";
import type { RevisionAction } from "@/domain/revisions";
import { Problem } from "@/domain/problem";
import { getTopic } from "@/services/catalog";
import { getAttempt, getQuestion } from "@/services/questions";
import { conflict, existingResult } from "@/services/writes";

const tableNames = { topic: "topics", question: "questions", attempt: "attempts" } as const;

async function currentContent(target: RevisionTarget, id: string, ownerId: string, includeDeleted: boolean) {
  if (target === "topic") return getTopic(id);
  if (target === "attempt") return getAttempt(id, ownerId);
  const question = await getQuestion(id, ownerId, { includeDeleted });
  if (!question) return undefined;
  const { topics, courseName, learningState, ...snapshot } = question;
  void topics;
  void courseName;
  void learningState;
  return snapshot;
}

export async function manageRevisions(target: RevisionTarget, id: string, input: RevisionAction, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const table = sql.raw(tableNames[target]);
  const targetColumn = sql.raw(target + "_id");
  const owned = target === "attempt" ? sql`AND user_id = ${ctx.actorId}` : sql.empty();
  const exists = sql`EXISTS (SELECT 1 FROM ${table} WHERE id = ${id} ${owned})`;

  if (input.action === "delete" || input.action === "clear") {
    const current = await currentContent(target, id, ctx.actorId, true);
    if (!current) throw new Problem(404, "NOT_FOUND", "找不到这条资料。");
    const selected = sql`(SELECT id FROM content_revisions WHERE ${targetColumn} = ${id}
      ${input.action === "delete" ? sql`AND revision_no = ${input.revisionNo}` : sql.empty()})`;
    return commitManagement({ id, rowVersion: current.rowVersion }, exists,
      removeRevisionRows(selected, target === "question"), ctx);
  }

  const state = await getDb().get<{ epoch: number }>(sql`SELECT data_epoch AS epoch FROM system_state WHERE id = 1`);
  const current = await currentContent(target, id, ctx.actorId, false);
  if (!current) throw new Problem(404, "NOT_FOUND", "找不到这条资料。");
  if (current.rowVersion !== input.rowVersion) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw conflict(current.rowVersion);
  }
  const unchanged = sql`${exists} AND ${epochIs(state?.epoch ?? -1)}`;
  if (input.action === "restore") {
    if (target !== "topic") throw new Problem(422, "INVALID_INPUT", "请从版本详情恢复。");
    const revision = await revisionDetail(target, id, input.revisionNo);
    if (!revision || revision.snapshotSchemaVersion !== 1) throw new Problem(404, "NOT_FOUND", "找不到可恢复的历史版本。");
    const { title, summaryMd, bodyMd, supplementMd } = topicPatch.parse({
      title: revision.snapshotJson.title, summaryMd: revision.snapshotJson.summaryMd, bodyMd: revision.snapshotJson.bodyMd,
      supplementMd: revision.snapshotJson.supplementMd,
    });
    return commitManagement({ id, rowVersion: current.rowVersion + 1 }, unchanged, [
      sql`UPDATE topics SET title = ${title}, summary_md = ${summaryMd}, body_md = ${bodyMd},
        ${supplementMd === undefined ? sql.empty() : sql`supplement_md = ${supplementMd},`}
        row_version = row_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.actorId},
        last_origin = 'restore' WHERE id = ${id}`,
    ], ctx);
  }

  const revisionId = crypto.randomUUID();
  return commitManagement({ id, rowVersion: current.rowVersion }, unchanged, [
    sql`INSERT INTO content_revisions (id, ${targetColumn}, revision_no, snapshot_json, actor_id, origin, reason, created_at)
      VALUES (${revisionId}, ${id}, ${current.rowVersion}, ${JSON.stringify(current)}, ${ctx.actorId}, 'manual', '手动保存', ${ctx.now})
      ON CONFLICT DO NOTHING`,
    sql`INSERT INTO asset_links (id, asset_id, revision_id, role, sort_order, caption)
      SELECT ${randomId}, asset_id, ${revisionId}, role, sort_order, caption FROM asset_links
      WHERE ${targetColumn} = ${id} AND EXISTS (SELECT 1 FROM content_revisions WHERE id = ${revisionId})`,
  ], ctx);
}
