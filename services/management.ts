import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { usableCourse, validChapterChain, type WriteContext } from "@/db/queries/catalog";
import { catalogScope, moveCatalogRows, removeCatalogContents } from "@/db/queries/catalog-management";
import { commitManagement, epochIs, ids, randomId, removeAttempts, removeReviewItems, removeRevisions, removeTopics, removeQuestions } from "@/db/queries/content-deletion";
import { batchCleanupOptions, batchItems, cleanImportRecords, noReviewInFlight } from "@/db/queries/import-cleanup";
import type { ManagementInput, ManagementKind } from "@/domain/management";
import { Problem } from "@/domain/problem";
import { existingResult } from "@/services/writes";

const tables = {
  topic: "topics", chapter: "chapters", question: "questions", attempt: "attempts",
  learning: "questions", batch: "import_batches", task: "import_tasks", "course-history": "course_deletions",
} as const;

export async function getManagement(kind: ManagementKind, id: string, ownerId: string) {
  const db = getDb();
  const table = sql.raw(tables[kind]);
  const owned = kind === "batch" || kind === "task" ? sql`AND owner_id = ${ownerId}`
    : kind === "attempt" ? sql`AND user_id = ${ownerId}` : sql.empty();
  const title = kind === "batch" ? sql`coalesce(json_extract(source_json, '$[0].title'), batch_key)`
    : kind === "task" ? sql`json_extract(scope_json, '$.title')`
    : kind === "course-history" ? sql`coalesce(json_extract(snapshot_json, '$.name'), course_id)`
    : kind === "attempt" ? sql`(SELECT title FROM questions WHERE id = question_id)` : sql`title`;
  const course = kind === "topic" || kind === "chapter" ? sql`course_id` : sql`NULL`;
  const question = kind === "attempt" ? sql`question_id` : sql`NULL`;
  const paused = kind === "task" ? sql`cancelled_at` : kind === "question" ? sql`deleted_at` : sql`NULL`;
  const idColumn = kind === "course-history" ? sql`course_id` : sql`id`;
  const result = await db.get<{ id: string; title: string; rowVersion: number; dataEpoch: number;
    courseId: string | null; questionId: string | null; inactiveSince: string | null; }>(sql`
    SELECT ${idColumn} AS id, ${title} AS title, ${kind === "batch" || kind === "course-history" ? sql`1` : sql`row_version`} AS rowVersion,
      ${course} AS courseId, ${question} AS questionId, ${paused} AS inactiveSince,
      (SELECT data_epoch FROM system_state WHERE id = 1) AS dataEpoch
    FROM ${table} WHERE ${idColumn} = ${id} ${owned}
  `);
  if (!result) return null;
  const scope = kind === "chapter" ? await catalogScope(kind, id) : null;
  const items = kind === "batch" ? await batchCleanupOptions(id, ownerId) : [];
  const counts: Record<string, number> = {};
  if (kind === "topic") {
    Object.assign(counts, await db.get(sql`SELECT
      (SELECT count(*) FROM question_topics qt JOIN questions q ON q.id = qt.question_id WHERE qt.topic_id = ${id} AND q.deleted_at IS NULL) AS '关联题目',
      (SELECT count(*) FROM question_topics qt JOIN questions q ON q.id = qt.question_id WHERE qt.topic_id = ${id} AND q.deleted_at IS NOT NULL) AS '回收站题目',
      (SELECT count(*) FROM topic_relations WHERE from_topic_id = ${id} OR to_topic_id = ${id}) AS '相关知识点',
      (SELECT count(*) FROM content_revisions WHERE topic_id = ${id}) AS '历史版本'`));
  }
  if (kind === "question" || kind === "learning") {
    Object.assign(counts, await db.get(sql`SELECT
      (SELECT count(*) FROM attempts WHERE question_id = ${id}) AS '作答',
      (SELECT count(*) FROM review_items WHERE question_id = ${id}) AS '复习队列记录',
      (SELECT count(*) FROM content_revisions WHERE question_id = ${id}) AS '题目版本',
      (SELECT count(*) FROM question_topics WHERE question_id = ${id}) AS '知识点关联'`));
  }
  if (scope) Object.assign(counts, {
    "章节（含子章节）": scope.chapters.length, "笔记": scope.topics.length, "相关主课程题目": scope.questions.length,
    "可删除笔记": scope.topics.filter((row) => !row.kept).length,
    "可删除题目": scope.questions.filter((row) => !row.kept).length,
  });
  if (kind === "batch") Object.assign(counts, { "候选": items.length, "已有正式资料": items.filter((item) => item.status === "committed").length });
  if (kind === "course-history") Object.assign(counts, await db.get(sql`SELECT count(*) AS '历史版本' FROM deleted_course_revisions WHERE course_id = ${id}`));
  if (kind === "task") Object.assign(counts, await db.get(sql`SELECT
    (SELECT count(*) FROM import_task_checkpoints WHERE task_id = ${id}) AS '检查点',
    (SELECT count(*) FROM import_task_checkpoints WHERE task_id = ${id} AND batch_id IS NOT NULL) AS '关联导入批次'`));
  return { ...result, kind, scope, counts, items };
}

function unsupported() {
  return new Problem(422, "INVALID_MANAGEMENT_ACTION", "请选择适用于该条资料的操作。");
}

export function resetLearning(id: string, ctx: WriteContext) {
  const state = sql`(SELECT id FROM learning_states WHERE question_id = ${id} AND user_id = ${ctx.actorId})`;
  return [
    ...removeReviewItems(ids([id]), ctx.now, ctx.actorId),
    ...removeRevisions("learning_state", state),
    sql`INSERT INTO learning_states (id, question_id, user_id, created_by, updated_by, created_at, updated_at)
      VALUES (${randomId}, ${id}, ${ctx.actorId}, ${ctx.actorId}, ${ctx.actorId}, ${ctx.now}, ${ctx.now})
      ON CONFLICT(user_id, question_id) DO UPDATE SET mastery = 'new', is_mistake = 0, next_review_on = NULL,
        last_reviewed_at = NULL, extra_json = '{}', deleted_at = NULL, last_origin = 'manual',
        row_version = row_version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ];
}

export async function manageContent(kind: ManagementKind, id: string, input: ManagementInput, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const plan = await getManagement(kind, id, ctx.actorId);
  if (!plan) throw new Problem(404, "NOT_FOUND", "该资料已不存在。");
  const epochConflict = new Problem(409, "VERSION_CONFLICT", "关联内容已经变化，请刷新后重新确认。");
  if (plan.dataEpoch !== input.dataEpoch || (plan.scope && plan.scope.epoch !== input.dataEpoch)) throw epochConflict;
  const { action } = input;

  let conditions = epochIs(input.dataEpoch);
  const selected = ids([id]);
  let operations: SQL[];
  let rowVersion = plan.rowVersion;
  if (kind === "topic" && action === "delete") operations = removeTopics(selected);
  else if (kind === "attempt" && action === "delete") operations = removeAttempts(selected);
  else if (kind === "course-history" && action === "delete") operations = [
    sql`DELETE FROM deleted_course_revisions WHERE course_id = ${id}`,
    sql`UPDATE course_deletions SET snapshot_json = json_object('id', course_id) WHERE course_id = ${id}`,
  ];
  else if (kind === "question" && action === "purge") operations = removeQuestions(selected, ctx.now);
  else if (kind === "question" && action === "restore" && plan.inactiveSince) {
    rowVersion += 1;
    operations = [sql`UPDATE questions SET deleted_at = NULL, row_version = ${rowVersion},
      updated_at = ${ctx.now}, updated_by = ${ctx.actorId}, last_origin = 'restore' WHERE id = ${id}`];
  } else if (kind === "learning" && action === "attempts") {
    operations = removeAttempts(sql`(SELECT id FROM attempts WHERE question_id = ${id} AND user_id = ${ctx.actorId})`);
  } else if (kind === "learning" && action === "reset") operations = resetLearning(id, ctx);
  else if (kind === "task" && action === "cancel" && !plan.inactiveSince) {
    rowVersion += 1;
    operations = [sql`UPDATE import_tasks SET cancelled_at = ${ctx.now}, updated_at = ${ctx.now},
      row_version = ${rowVersion} WHERE id = ${id}`];
  } else if (kind === "task" && action === "delete") {
    operations = [
      sql`DELETE FROM import_task_checkpoints WHERE task_id = ${id}`,
      sql`DELETE FROM import_tasks WHERE id = ${id}`,
    ];
  } else if (kind === "batch" && (action === "purge" || action === "selected")) {
    const itemIds = action === "selected" ? input.itemIds : undefined;
    if (action === "selected" && (!itemIds?.length || !itemIds.every((item) => plan.items.some(({ id }) => id === item)))) {
      throw unsupported();
    }
    const noReview = noReviewInFlight(itemIds ? ids(itemIds) : batchItems(id), ctx.now);
    const running = await getDb().get<{ clear: number }>(sql`SELECT ${noReview} AS clear`);
    if (!running?.clear) throw new Problem(409, "REVIEW_RUNNING", "DeepSeek 正在审核所选候选。请在审核结束后重试。");
    conditions = sql`${conditions} AND ${noReview}`;
    operations = cleanImportRecords(id, itemIds, ctx);
  } else if (kind === "chapter" && action === "rename" && input.title) {
    rowVersion += 1;
    operations = [sql`UPDATE chapters SET title = ${input.title}, row_version = ${rowVersion},
      updated_at = ${ctx.now}, updated_by = ${ctx.actorId}, last_origin = 'manual' WHERE id = ${id}`];
  } else if (kind === "chapter" && plan.scope && ["keep", "purge", "move"].includes(action)) {
    const scope = plan.scope;
    const courseId = input.courseId === undefined ? plan.courseId : input.courseId;
    const chapterId = input.chapterId ?? null;
    if (chapterId && scope.chapters.includes(chapterId)) {
      throw new Problem(422, "INVALID_DESTINATION", "请选择此章节树以外的目标章节。");
    }
    if (action === "move") {
      if (!courseId) throw new Problem(422, "INVALID_DESTINATION", "移动章节树时请选择目标课程。");
      const height = await getDb().get<{ n: number }>(sql`
        WITH RECURSIVE branch(id, depth) AS (
          SELECT ${id}, 1 UNION ALL SELECT c.id, b.depth + 1
          FROM chapters c JOIN branch b ON c.parent_id = b.id WHERE b.depth < 7
        ) SELECT max(depth) AS n FROM branch`);
      const depth = height?.n ?? 1;
      if (depth > 6 || (chapterId && depth >= 6)) throw new Problem(422, "CHAPTER_DEPTH", "移动后最多支持六层章节。");
      conditions = sql`${conditions} AND ${usableCourse(courseId)} AND ${validChapterChain(courseId, chapterId, 6 - depth)}`;
      rowVersion += 1;
      operations = [
        sql`PRAGMA defer_foreign_keys = ON`,
        ...moveCatalogRows("chapter", ids(scope.chapters), { courseId, chapterId, rootId: id }, ctx),
        ...courseId !== plan.courseId && scope.topics.length
          ? moveCatalogRows("topic", ids(scope.topics.map((row) => row.id)), { courseId }, ctx) : [],
      ];
    } else {
      conditions = sql`${conditions} AND ${usableCourse(courseId)} AND ${validChapterChain(courseId, chapterId, 6)}`;
      operations = removeCatalogContents(scope, action === "purge" ? "purge" : "keep", { courseId, chapterId }, ctx, false);
    }
  } else throw unsupported();

  return commitManagement({ id, rowVersion }, conditions, operations, ctx);
}

export async function emptyQuestionTrash(dataEpoch: number, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const trashed = sql`(SELECT id FROM questions WHERE deleted_at IS NOT NULL)`;
  return commitManagement({ id: "question-trash", rowVersion: 1 }, epochIs(dataEpoch), removeQuestions(trashed, ctx.now), ctx);
}
