import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { WriteContext } from "@/db/queries/catalog";
import { ids, removeAttempts, removeQuestions, removeTopics } from "@/db/queries/content-deletion";
import type { PlannedChange } from "@/db/queries/content-undo";
import { attemptMutation, learningStateMutations, learningStateVersion, liveQuestion } from "@/db/queries/questions";
import { markdown, topicSupplement } from "@/domain/catalog";
import type { ContentOperation } from "@/domain/content-operations";
import { Problem } from "@/domain/problem";
import type { QuestionPatch } from "@/domain/questions";
import type { SolutionLayers, SolutionThread } from "@/domain/solution-layers";
import { getTopic } from "@/services/catalog";
import { contentChange, replaceUnique, versioned } from "@/services/content-plan";
import { resetLearning } from "@/services/management";
import { advanceRelationVersions, prepareQuestionTopic } from "@/services/question-topics";
import { getAttempt, getLearningState, getQuestion, prepareAttemptCreate, prepareAttemptUpdate, prepareLearningUpdate } from "@/services/questions";

type ManagedEdit = Extract<ContentOperation, { action:
  "create_attempt" | "update_attempt" | "delete_attempt" | "update_learning" | "clear_learning" | "set_question_links"
}>;
export async function prepareManagedEdit(op: ManagedEdit, ctx: WriteContext): Promise<PlannedChange> {
  const db = getDb();
  if (op.action === "set_question_links") {
    const questionIds = op.links.map(({ questionId }) => questionId);
    if (new Set(questionIds).size !== questionIds.length) throw new Problem(422, "INVALID_INPUT", "每组关系只能指定一次同一道题。");
    const plans = await Promise.all(op.links.map((link) => prepareQuestionTopic({
      topicId: op.id, expectedTopicVersion: op.version, ...link, changes: link.changes,
    }, ctx)));
    return {
      change: contentChange("topic", "update", op.id, op.version + 1),
      relatedChanges: op.links.map(({ questionId, expectedQuestionVersion }) =>
        contentChange("question", "update", questionId, expectedQuestionVersion + 1)),
      condition: sql`1`, additionalChecks: plans.map(({ condition }) => condition),
      writes: [...plans.map(({ write }) => write), ...advanceRelationVersions(op.id, questionIds)],
    };
  }
  if (op.action === "create_attempt" || op.action === "update_attempt") {
    if (op.action === "create_attempt" && !op.input.originalWorkMd?.trim() && op.input.outcome === "unknown") {
      throw new Problem(422, "ATTEMPT_REQUIRED", "请提供学习者的作答原文或明确报告的结果。");
    }
    const write = op.action === "create_attempt" ? prepareAttemptCreate(op.questionId, op.input, ctx)
      : prepareAttemptUpdate(versioned(await getAttempt(op.id, ctx.actorId), op.version), op.patch, ctx);
    const { condition, mutation } = attemptMutation(db, write, ctx);
    return { change: contentChange("attempt", op.action === "create_attempt" ? "create" : "update", write.row.id, write.row.rowVersion),
      condition, writes: [mutation] };
  }
  if (op.action === "delete_attempt") {
    const row = versioned(await getAttempt(op.id, ctx.actorId), op.version);
    return { change: contentChange("attempt", "delete", row.id, row.rowVersion),
      condition: sql`EXISTS (SELECT 1 FROM attempts WHERE id = ${row.id} AND user_id = ${ctx.actorId} AND row_version = ${op.version})`,
      writes: removeAttempts(ids([row.id])) };
  }
  const state = versioned(await getLearningState(op.id, ctx.actorId), op.version);
  const write = prepareLearningUpdate(state, op.action === "update_learning" ? op.patch : {}, ctx);
  const scoped = sql`(SELECT id FROM attempts WHERE question_id = ${op.id} AND user_id = ${ctx.actorId})`;
  return {
    change: contentChange("learning", "update", op.id, state.rowVersion + 1),
    condition: sql`${liveQuestion(op.id)} AND ${learningStateVersion(write, ctx)}`,
    writes: op.action === "update_learning" ? [...learningStateMutations(db, write)] : [
      ...op.scope === "state" ? [] : removeAttempts(scoped),
      ...op.scope === "attempts" ? learningStateMutations(db, write) : resetLearning(op.id, ctx),
    ],
  };
}

type SolutionOperation = Extract<ContentOperation, { action: "edit_solution" }>;
type Question = NonNullable<Awaited<ReturnType<typeof getQuestion>>>;
export function editSolution(current: Question, edits: NonNullable<SolutionOperation["edits"]>): QuestionPatch {
  const layers: SolutionLayers = structuredClone(current.solutionLayers ?? { mainThreads: [], alternatives: [], supplements: [] });
  let document = current.solutionDocument;
  let answer = current.finalAnswerMd;
  let techniques = current.keyTechniquesMd;
  let layersChanged = false;
  for (const edit of edits) {
    if (edit.part === "text") {
      if (edit.field === "answer" || (edit.field === "main" && !document && !current.solutionSteps.length)) {
        answer = replaceUnique(answer, edit.find, edit.replace);
      } else if (edit.field === "techniques") {
        techniques = replaceUnique(techniques, edit.find, edit.replace);
      } else if (document) {
        document = { ...document, bodyMd: replaceUnique(document.bodyMd, edit.find, edit.replace) };
      } else {
        throw new Problem(422, "UNSUPPORTED_SOLUTION_LAYOUT", "旧分步解答请通过明确指定的 solutionSteps 字段编辑。");
      }
      continue;
    }
    layersChanged = true;
    if (edit.part === "alternative") editById(layers.alternatives, edit.id, edit.value);
    else if (edit.part === "supplement") editById(layers.supplements, edit.id, edit.value);
    else {
      const alternative = edit.solutionId && layers.alternatives.find(({ id }) => id === edit.solutionId);
      if (edit.solutionId && !alternative) throw new Problem(404, "NOT_FOUND", "找不到该替代解法。");
      const threads = alternative ? alternative.threads : layers.mainThreads;
      const original = threads.find(({ anchorId }) => anchorId === edit.anchorId);
      const targetId = edit.moveToAnchorId ?? edit.anchorId;
      if (edit.moveToAnchorId && !original?.turns.some(({ id }) => id === edit.id)) {
        throw new Problem(404, "NOT_FOUND", "找不到要移动的追问。");
      }
      if (targetId !== edit.anchorId) {
        if (!edit.value) throw new Problem(422, "INVALID_INPUT", "移动追问时请提供要保留的问答。");
        editById(original!.turns, edit.id, null);
      }
      const target = getOrAddThread(threads, targetId, edit.value !== null);
      editById(target.turns, edit.id, edit.value);
      for (let index = threads.length - 1; index >= 0; index--) if (!threads[index].turns.length) threads.splice(index, 1);
    }
  }
  return { solutionDocument: document, finalAnswerMd: answer, keyTechniquesMd: techniques,
    ...(layersChanged ? { solutionLayers: layers } : {}) };
}

function editById<T extends { id: string }>(items: T[], id: string, value: T | null) {
  const index = items.findIndex((item) => item.id === id);
  if (value === null) {
    if (index < 0) throw new Problem(404, "NOT_FOUND", "找不到要删除的解答条目。");
    items.splice(index, 1);
  } else if (value.id !== id) {
    throw new Problem(422, "INVALID_INPUT", "目标与提交的解答条目标识不一致。");
  } else if (index < 0) items.push(value);
  else items[index] = value;
}

function getOrAddThread(threads: SolutionThread[], anchorId: string, create: boolean) {
  const target = threads.find((thread) => thread.anchorId === anchorId);
  if (target) return target;
  if (!create) throw new Problem(404, "NOT_FOUND", "找不到该位置的追问。");
  const fresh = { anchorId, turns: [] };
  threads.push(fresh);
  return fresh;
}

type Merge = Extract<ContentOperation, { action: "merge_topics" | "merge_questions" }>;
export async function prepareMerge(op: Merge, ctx: WriteContext): Promise<PlannedChange> {
  const isTopic = op.action === "merge_topics";
  const read = (id: string) => isTopic ? getTopic(id) : getQuestion(id, ctx.actorId);
  const [target, ...sources] = await Promise.all([versionedAsync(op.id, op.version),
    ...op.sources.map(({ id, version }) => versionedAsync(id, version))]);
  async function versionedAsync(id: string, version: number) {
    return versioned(await read(id), version);
  }
  const db = getDb();
  const kind = isTopic ? "topic" : "question";
  const table = sql.identifier(isTopic ? "topics" : "questions");
  const column = sql.identifier(kind + "_id");
  const selected = ids(sources.map(({ id }) => id));
  const versionChecks = sql.join([target, ...sources].map(({ id, rowVersion }) =>
    sql`EXISTS (SELECT 1 FROM ${table} WHERE id = ${id} AND row_version = ${rowVersion} AND deleted_at IS NULL)`), sql` AND `);
  const updates = isTopic ? [
    sql`UPDATE topics SET body_md = ${mergedNote(target, sources)},
      supplement_md = ${mergedSupplement([target, ...sources])} WHERE id = ${target.id}`,
    sql`INSERT OR IGNORE INTO question_topics (question_id, topic_id, relation_role, note_md, created_at, created_by,
      display_role, display_order, placement_anchor, use_question_techniques)
      SELECT question_id, ${target.id}, relation_role, note_md, created_at, created_by, display_role, display_order, NULL, use_question_techniques
      FROM question_topics WHERE topic_id IN ${selected} ORDER BY topic_id`,
    sql`WITH neighbors AS MATERIALIZED (
      SELECT CASE WHEN from_topic_id IN ${selected} THEN to_topic_id ELSE from_topic_id END AS other, created_at, created_by
      FROM topic_relations WHERE
        (from_topic_id IN ${selected} AND to_topic_id NOT IN ${selected} AND to_topic_id <> ${target.id})
        OR (to_topic_id IN ${selected} AND from_topic_id NOT IN ${selected} AND from_topic_id <> ${target.id})
      ) INSERT OR IGNORE INTO topic_relations
      SELECT ${target.id}, other, created_at, created_by FROM neighbors WHERE NOT EXISTS (
        SELECT 1 FROM topic_relations r WHERE (r.from_topic_id = ${target.id} AND r.to_topic_id = other)
          OR (r.to_topic_id = ${target.id} AND r.from_topic_id = other)
      ) ORDER BY other, created_at`,
    sql`UPDATE questions SET row_version = row_version + 1 WHERE id IN (
      SELECT question_id FROM question_topics WHERE topic_id IN ${selected})`,
  ] : [
    sql`INSERT OR IGNORE INTO question_topics (question_id, topic_id, relation_role, note_md, created_at, created_by,
      display_role, display_order, placement_anchor, use_question_techniques)
      SELECT ${target.id}, topic_id, relation_role, note_md, created_at, created_by, display_role, display_order, placement_anchor,
        CASE WHEN trim((SELECT key_techniques_md FROM questions WHERE id = ${target.id})) <> '' THEN use_question_techniques ELSE 0 END
      FROM question_topics WHERE question_id IN ${selected} ORDER BY question_id`,
    sql`UPDATE attempts SET question_id = ${target.id}, row_version = row_version + 1 WHERE question_id IN ${selected}`,
    sql`UPDATE ai_reviews SET question_id = ${target.id} WHERE question_id IN ${selected}`,
  ];
  if (op.action === "merge_questions" && !op.keepTargetSolution && sources.some((row) => questionSolution(row) !== questionSolution(target))) {
    throw new Problem(409, "MERGE_SOLUTION_CHOICE", "题目的解答不同。请先整理要保留的解答，或明确保留目标题的当前解答。");
  }
  const ref = sql.identifier(isTopic ? "import_topic_refs" : "import_question_refs");
  const links = await db.all<{ id: string }>(sql`SELECT id FROM asset_links WHERE ${column} IN ${selected}`);
  return {
    change: contentChange(kind, "update", target.id, target.rowVersion + 1, undefined, target.title),
    relatedChanges: sources.map(({ id, rowVersion, title }) => contentChange(kind, "delete", id, rowVersion, undefined, title)),
    condition: versionChecks,
    writes: [
      sql`PRAGMA defer_foreign_keys = ON`,
      ...updates,
      sql`UPDATE ${table} SET row_version = row_version + 1, updated_by = ${ctx.actorId}, updated_at = ${ctx.now} WHERE id = ${target.id}`,
      sql`UPDATE provenance_links SET ${column} = ${target.id}
        ${isTopic ? sql.empty() : sql`, field_path = CASE WHEN field_path = 'statementMd' AND EXISTS (
          SELECT 1 FROM provenance_links original WHERE original.question_id = ${target.id} AND original.field_path = 'statementMd'
        ) THEN 'merged.statementMd' ELSE field_path END`} WHERE ${column} IN ${selected}`,
      sql`UPDATE retained_import_notes SET ${column} = ${target.id} WHERE ${column} IN ${selected}`,
      sql`UPDATE ${ref} SET ${column} = ${target.id} WHERE ${column} IN ${selected}`,
      sql`UPDATE import_items SET ${column} = ${target.id}, row_version = row_version + 1 WHERE ${column} IN ${selected}`,
      sql`UPDATE OR IGNORE asset_links SET ${column} = ${target.id} WHERE id IN ${ids(links.map(({ id }) => id))}`,
      sql`WITH copies AS MATERIALIZED (
        SELECT id, row_number() OVER (ORDER BY ${column}, revision_no) + (
          SELECT coalesce(max(revision_no), 0) FROM content_revisions WHERE ${column} = ${target.id}) AS version
        FROM content_revisions WHERE ${column} IN ${selected}
      ) UPDATE content_revisions AS r SET ${column} = ${target.id}, revision_no = copies.version FROM copies WHERE r.id = copies.id`,
      ...isTopic ? removeTopics(selected) : removeQuestions(selected, ctx.now),
    ],
  };
}

function mergedNote(target: object, sources: object[]) {
  const body = (row: object) => "bodyMd" in row && typeof row.bodyMd === "string" ? row.bodyMd : "";
  const combined = [body(target), ...sources.map((row) => {
    const title = "title" in row && typeof row.title === "string" ? row.title.replace(/[\r\n]+/g, " ") : "";
    const summary = "summaryMd" in row && typeof row.summaryMd === "string" ? row.summaryMd : "";
    return [`## ${title}`, summary, body(row)].filter(Boolean).join("\n\n");
  })].join("\n\n");
  return markdown(131_072).parse(combined);
}

function mergedSupplement(rows: object[]) {
  const parts = rows.flatMap((row) =>
    "supplementMd" in row && typeof row.supplementMd === "string" && row.supplementMd.trim() ? [row.supplementMd] : []);
  return topicSupplement.parse(parts.join("\n\n") || null);
}

function questionSolution(row: object) {
  if (!("finalAnswerMd" in row)) return "";
  const question = row as Question;
  return JSON.stringify([question.solutionDocument, question.solutionSteps, question.finalAnswerMd, question.keyTechniquesMd, question.solutionLayers]);
}
