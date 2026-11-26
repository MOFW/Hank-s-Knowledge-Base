import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { courseDetail, readingChapters, readingTopic, readingTopics, usableCourse, validChapterChain, type WriteContext } from "@/db/queries/catalog";
import { commitManagement } from "@/db/queries/content-deletion";
import { featuredExamplesQuery } from "@/db/queries/question-topics";
import type { ReadingOrderInput } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { existingResult } from "./writes";

export async function getReadingTopic(courseId: string, topicId: string, ownerId: string) {
  const [[note], examples] = await getDb().batch([readingTopic(courseId, topicId), featuredExamplesQuery(topicId, ownerId)]);
  return note ? { ...note, examples } : undefined;
}

export async function getReadingIndex(courseId: string) {
  const course = await courseDetail(courseId);
  if (!course) return null;
  const [chapters, topics] = await Promise.all([readingChapters(courseId), readingTopics(courseId)]);
  return { name: course.name, chapters, topics };
}

export async function saveReadingOrder(courseId: string, { kind, chapterId, items }: ReadingOrderInput, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const course = await courseDetail(courseId);
  if (!course) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  }
  const { condition, writes } = prepareReadingOrder(courseId, { kind, chapterId, items });
  return commitManagement({ id: courseId, rowVersion: course.rowVersion }, condition, writes,
    ctx, { code: "VERSION_CONFLICT", message: "这一组的笔记或章节已有变动，请重新载入后调整顺序。" });
}

export function prepareReadingOrder(courseId: string, { kind, chapterId, items }: ReadingOrderInput) {
  const table = sql.raw(kind === "chapter" ? "chapters" : "topics");
  const parent = sql.raw(kind === "chapter" ? "parent_id" : "chapter_id");
  const group = sql`course_id = ${courseId} AND ${parent} IS ${chapterId} AND deleted_at IS NULL`;
  const wanted = sql`SELECT key AS position, value ->> 'id' AS id, value ->> 'rowVersion' AS version
    FROM json_each(${JSON.stringify(items)})`;
  const precondition = sql`${usableCourse(courseId)} AND ${validChapterChain(courseId, chapterId, 6)}
    AND (SELECT count(*) FROM ${table} WHERE ${group}) = ${items.length}
    AND NOT EXISTS (SELECT 1 FROM (${wanted}) AS wanted
      WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${group} AND id = wanted.id AND row_version = wanted.version))`;
  return { condition: precondition, writes: [
    sql`WITH wanted AS (${wanted})
      UPDATE ${table} AS ordered
      SET sort_order = wanted.position, row_version = ordered.row_version + 1
      FROM wanted WHERE ordered.id = wanted.id AND ordered.sort_order <> wanted.position`,
  ] };
}
