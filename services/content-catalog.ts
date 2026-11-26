import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogMutations, catalogPrecondition, usableCourse, validChapterChain, type WriteContext } from "@/db/queries/catalog";
import { catalogScope, moveCatalogRows, removeCatalogContents } from "@/db/queries/catalog-management";
import { epochIs, ids, removeRevisions } from "@/db/queries/content-deletion";
import type { PlannedChange } from "@/db/queries/content-undo";
import { chapters } from "@/db/schema";
import type { ContentOperation } from "@/domain/content-operations";
import { Problem } from "@/domain/problem";
import { getCourse, prepareCourseUpdate, removeScopedCourse } from "@/services/catalog";
import { contentChange, versioned } from "@/services/content-plan";
import { prepareReadingOrder } from "@/services/course-reading";

export const readChapter = (id: string) => getDb().select().from(chapters)
  .where(and(eq(chapters.id, id), isNull(chapters.deletedAt))).get();

type CatalogOperation = Extract<ContentOperation, {
  action: "update_course" | "delete_course" | "reorder_reading" | "update_chapter" | "delete_chapter";
}>;

export async function prepareCatalogOperation(op: CatalogOperation, ctx: WriteContext): Promise<PlannedChange> {
  const db = getDb();
  if (op.action === "reorder_reading") {
    const course = await getCourse(op.courseId);
    if (!course) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
    // Only rows whose order changes are bumped by the shared web planner.
    const table = sql.identifier(op.input.kind === "chapter" ? "chapters" : "topics");
    const rows = await db.all<{ id: string; position: number }>(sql`SELECT id, sort_order AS position FROM ${table}
      WHERE id IN ${ids(op.input.items.map(({ id }) => id))}`);
    const positions = new Map(rows.map(({ id, position }) => [id, position]));
    return {
      change: contentChange("course", "update", course.id, course.rowVersion),
      reportPrimary: false,
      relatedChanges: op.input.items.flatMap(({ id, rowVersion }, index) => positions.get(id) !== index ? [
        contentChange(op.input.kind, "update", id, rowVersion + 1, op.input.kind === "chapter" ? `/courses/${course.id}` : undefined),
      ] : []),
      ...prepareReadingOrder(course.id, op.input),
    };
  }
  if (op.action === "update_course") {
    const row = versioned(await getCourse(op.id), op.version);
    const write = prepareCourseUpdate(row, op.patch, ctx);
    return { change: contentChange("course", "update", row.id, write.row.rowVersion, undefined, write.row.name),
      condition: catalogPrecondition(write), writes: [...catalogMutations(db, write, ctx)] };
  }
  if (op.action === "delete_course") {
    const row = versioned(await getCourse(op.id), op.version);
    const scope = await catalogScope("course", row.id);
    if (op.destinationId) {
      const destinationId = op.destinationId;
      if (destinationId === row.id || op.deleteExclusiveIds) {
        throw new Problem(422, "INVALID_DESTINATION", "请选择另一门课程，或单独指定要删除的专属资料。");
      }
      return { change: contentChange("course", "delete", row.id, row.rowVersion, undefined, row.name),
        relatedChanges: await scopeChanges(scope, { movedCourse: destinationId }),
        condition: sql`${epochIs(scope.epoch)} AND ${usableCourse(destinationId)}`,
        writes: [
          sql`PRAGMA defer_foreign_keys = ON`,
          ...moveCatalogRows("chapter", ids(scope.chapters), { courseId: destinationId }, ctx),
          ...moveCatalogRows("topic", ids(scope.topics.map(({ id }) => id)), { courseId: destinationId }, ctx),
          ...moveCatalogRows("question", ids(scope.questions.map(({ id }) => id)), { courseId: destinationId }, ctx),
          ...removeRevisions("course", ids([row.id])),
          sql`INSERT INTO course_deletions (course_id, destination_id, snapshot_json, actor_id, deleted_at)
            VALUES (${row.id}, ${destinationId}, json_object('id', ${row.id}), ${ctx.actorId}, ${ctx.now})`,
          sql`DELETE FROM courses WHERE id = ${row.id}`,
        ] };
    }
    const selected = exactExclusive(scope, op.deleteExclusiveIds);
    return {
      change: contentChange("course", "delete", row.id, row.rowVersion, undefined, row.name), condition: epochIs(scope.epoch),
      relatedChanges: await scopeChanges(scope, { courseRemoval: true, removed: op.deleteExclusiveIds }),
      writes: removeScopedCourse(row.id, selected, op.deleteExclusiveIds ? "purge" : "keep", ctx),
    };
  }
  const row = versioned(await readChapter(op.id), op.version);
  const scope = await catalogScope("chapter", row.id);
  const tableVersion = sql`EXISTS (SELECT 1 FROM chapters WHERE id = ${row.id} AND row_version = ${row.rowVersion} AND deleted_at IS NULL)`;
  if (op.action === "delete_chapter") {
    const chapterId = op.destinationId === undefined ? row.parentId : op.destinationId;
    if (chapterId && scope.chapters.includes(chapterId)) {
      throw new Problem(422, "INVALID_DESTINATION", "请选择要删除的章节树以外的目标。");
    }
    return {
      change: contentChange("chapter", "delete", row.id, row.rowVersion, undefined, row.title),
      relatedChanges: await scopeChanges(scope, { omittedChapter: row.id, removed: op.deleteExclusiveIds }),
      condition: sql`${tableVersion} AND ${epochIs(scope.epoch)} AND ${validChapterChain(row.courseId, chapterId, 6)}`,
      writes: removeCatalogContents(exactExclusive(scope, op.deleteExclusiveIds), op.deleteExclusiveIds ? "purge" : "keep",
        { courseId: row.courseId, chapterId }, ctx, false),
    };
  }
  const courseId = op.patch.courseId ?? row.courseId;
  const parentId = op.patch.parentId === undefined ? (courseId === row.courseId ? row.parentId : null) : op.patch.parentId;
  if (parentId && scope.chapters.includes(parentId)) {
    throw new Problem(422, "CHAPTER_CYCLE", "章节不能移到自己或自己的子章节下。");
  }
  const { height } = (await db.get<{ height: number }>(sql`
    WITH RECURSIVE branch(id, depth) AS (
      SELECT ${row.id}, 1 UNION ALL SELECT c.id, b.depth + 1
      FROM chapters c JOIN branch b ON c.parent_id = b.id WHERE b.depth < 7
    ) SELECT max(depth) AS height FROM branch`))!;
  if (height > 6 || (parentId && height >= 6)) throw new Problem(422, "CHAPTER_DEPTH", "章节最多六层。");
  const { title, slug, descriptionMd, sortOrder } = op.patch;
  const movedCourse = courseId !== row.courseId;
  const writes = movedCourse ? [
    sql`PRAGMA defer_foreign_keys = ON`,
    ...moveCatalogRows("chapter", ids(scope.chapters), { courseId, chapterId: parentId, rootId: row.id }, ctx),
    ...moveCatalogRows("topic", ids(scope.topics.map(({ id }) => id)), { courseId }, ctx),
  ] : [];
  return {
    change: contentChange("chapter", "update", row.id, row.rowVersion + 1, `/courses/${courseId}`, title ?? row.title),
    relatedChanges: movedCourse ? await scopeChanges({ ...scope, questions: [] }, { movedCourse: courseId, omittedChapter: row.id }) : undefined,
    condition: sql`${tableVersion} AND ${epochIs(scope.epoch)} AND ${usableCourse(courseId)}
      AND ${validChapterChain(courseId, parentId, 6 - height)}
      AND NOT EXISTS (WITH RECURSIVE chain(id) AS (
        SELECT ${parentId} UNION SELECT c.parent_id FROM chapters c JOIN chain p ON c.id = p.id
      ) SELECT 1 FROM chain WHERE id = ${row.id})`,
    writes: [...writes, sql`UPDATE chapters SET parent_id = ${parentId}, title = coalesce(${title ?? null}, title),
      slug = coalesce(${slug ?? null}, slug), description_md = coalesce(${descriptionMd ?? null}, description_md),
      sort_order = coalesce(${sortOrder ?? null}, sort_order), row_version = ${row.rowVersion + 1},
      updated_at = ${ctx.now}, updated_by = ${ctx.actorId}, last_origin = 'manual' WHERE id = ${row.id}`],
  };
}

async function scopeChanges(scope: Awaited<ReturnType<typeof catalogScope>>, {
  omittedChapter, movedCourse, removed = [], courseRemoval,
}: { omittedChapter?: string; movedCourse?: string; removed?: string[]; courseRemoval?: boolean }) {
  type Row = { id: string; title: string; rowVersion: number; kind: "chapter" | "topic" | "question" };
  const deletedIds = new Set(removed);
  const affectedQuestions = scope.questions.filter(({ id }) => movedCourse || courseRemoval || deletedIds.has(id));
  const rows = await getDb().all<Row>(sql`
    SELECT id, title, row_version AS rowVersion, 'chapter' AS kind FROM chapters
      WHERE id IN ${ids(scope.chapters.filter((id) => id !== omittedChapter))}
    UNION ALL SELECT id, title, row_version, 'topic' FROM topics WHERE id IN ${ids(scope.topics.map(({ id }) => id))}
    UNION ALL SELECT id, title, row_version, 'question' FROM questions WHERE id IN ${ids(affectedQuestions.map(({ id }) => id))}`);
  return rows.map(({ id, kind, title, rowVersion }) => {
    const removed = deletedIds.has(id) || (kind === "chapter" && !movedCourse);
    return contentChange(kind, removed ? "delete" : "update", id, rowVersion + Number(!removed),
      kind === "chapter" && movedCourse ? `/courses/${movedCourse}` : undefined, title);
  });
}

function exactExclusive(scope: Awaited<ReturnType<typeof catalogScope>>, selected: string[] = []) {
  const available = new Set([...scope.topics, ...scope.questions].filter(({ kept }) => !kept).map(({ id }) => id));
  if (new Set(selected).size !== selected.length || selected.some((id) => !available.has(id))) {
    throw new Problem(422, "SHARED_OR_OUT_OF_SCOPE", "所选资料中含共享内容或不在待删除范围内的对象。");
  }
  const keepUnselected = <T extends { id: string; kept: number }>(row: T) =>
    ({ ...row, kept: row.kept || Number(!selected.includes(row.id)) });
  return { ...scope, topics: scope.topics.map(keepUnselected), questions: scope.questions.map(keepUnselected) };
}
