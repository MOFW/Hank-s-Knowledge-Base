import { sql } from "drizzle-orm";
import { commitManagement, epochIs, ids, removeRevisions } from "@/db/queries/content-deletion";
import { catalogScope, removeCatalogContents } from "@/db/queries/catalog-management";
import * as catalog from "@/db/queries/catalog";
import type { CatalogWrite, WriteContext } from "@/db/queries/catalog";
import * as deletion from "@/db/queries/course-deletion";
import type { CoursePatch, DeleteCourseInput, NewChapter, NewCourse, NewTopic, TopicPatch } from "@/domain/catalog";
import { chapterOptions } from "@/lib/directory";
import { Problem } from "@/domain/problem";
import { conflict, errorDetails, existingResult, newRow, requireWriteAccess } from "@/services/writes";

export const listCourses = catalog.courseList;
export const getCourse = catalog.courseDetail;
export const getTopic = catalog.topicDetail;
export const listUnassignedTopics = () => catalog.topicList(null);
export async function getCourseDeletionPlan(id: string, ownerId: string) {
  const [plan, scope] = await Promise.all([deletion.courseDeletionPlan(id, ownerId), catalogScope("course", id)]);
  if (!plan || plan.dataEpoch !== scope.epoch) return null;
  const exclusiveTopics = scope.topics.filter((row) => !row.kept).length;
  const exclusiveQuestions = scope.questions.filter((row) => !row.kept).length;
  return { ...plan, exclusiveTopics, exclusiveQuestions };
}

export async function deleteCourse(id: string, input: DeleteCourseInput, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const plan = await getCourseDeletionPlan(id, ctx.actorId);
  if (!plan) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  }
  const changed = new Problem(409, "COURSE_DELETE_CONFLICT", "知识库内容已有更新。请刷新页面，核对最新数量后再确认。");
  if (plan.dataEpoch !== input.dataEpoch) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw changed;
  }
  if (input.mode) {
    if (input.destinationId) throw new Problem(422, "INVALID_DESTINATION", "请选择一种课程处理方式。");
    const scope = await catalogScope("course", id);
    if (scope.epoch !== input.dataEpoch) throw changed;
    const result = { id, rowVersion: plan.course.rowVersion };
    return commitManagement(result, epochIs(input.dataEpoch),
      removeScopedCourse(id, scope, input.mode, ctx), ctx, { code: changed.code, message: changed.message });
  }
  const needsDestination = plan.chapters + plan.topics + plan.questions > 0;
  if (needsDestination) {
    if (!plan.destinations.some(({ id }) => id === input.destinationId)) {
      throw new Problem(422, "DESTINATION_REQUIRED", "请选择另一门可用课程来接收关联内容。");
    }
    if (input.confirmation !== plan.course.name) {
      throw new Problem(422, "CONFIRMATION_REQUIRED", "请输入要删除的课程全名。");
    }
  } else if (input.destinationId) {
    throw new Problem(422, "INVALID_DESTINATION", "这个课程没有需要迁移的章节、知识点或题目。");
  }
  try {
    return await deletion.commitCourseDeletion(plan.course, input, ctx);
  } catch (error) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    if (errorDetails(error).includes("receipts_precondition")) {
      await requireWriteAccess(ctx);
      throw changed;
    }
    if (/UNIQUE constraint failed: (chapters|topics)\.course_id/i.test(errorDetails(error))) {
      throw new Problem(409, "COURSE_SLUG_CONFLICT", "目标课程有冲突的章节或知识点别名。请选择另一门课程。");
    }
    throw error;
  }
}

export function removeScopedCourse(
  id: string, scope: Awaited<ReturnType<typeof catalogScope>>, mode: "keep" | "purge", ctx: WriteContext,
) {
  return [
    ...removeCatalogContents(scope, mode, { courseId: null, chapterId: null }, ctx, true),
    ...removeRevisions("course", ids([id])),
    sql`INSERT INTO course_deletions (course_id, snapshot_json, actor_id, deleted_at)
      VALUES (${id}, json_object('id', ${id}), ${ctx.actorId}, ${ctx.now})`,
    sql`DELETE FROM courses WHERE id = ${id}`,
  ];
}

export async function getDirectory(courseId: string) {
  const course = await catalog.courseDetail(courseId);
  if (!course) return null;
  const [chapters, topics] = await Promise.all([catalog.chapterList(courseId), catalog.topicList(courseId)]);
  return { course, chapters, topics };
}

async function save(write: CatalogWrite, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  try {
    return await catalog.commitCatalog(write, ctx);
  } catch (error) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    const details = errorDetails(error);
    if (/UNIQUE constraint failed: (courses|chapters|topics)\./i.test(details)) {
      throw new Problem(409, "DUPLICATE_SLUG", "这个路径别名已被使用。");
    }
    if (details.includes("receipts_precondition")) {
      if (write.kind !== "chapter" && write.expectedVersion !== undefined) {
        const current = write.kind === "topic" ? await getTopic(write.row.id) : await getCourse(write.row.id);
        if (!current) throw new Problem(404, "NOT_FOUND", "找不到该知识点。");
        if (current.rowVersion !== write.expectedVersion) throw conflict(current.rowVersion);
      }
      await requireWriteAccess(ctx);
      throw new Problem(422, "INVALID_PARENT", "请选择可用的同课程章节和有效的关联知识点。章节最多六层。");
    }
    throw error;
  }
}

export function createCourse(input: NewCourse, ctx: WriteContext) {
  return save(prepareCourseCreate(input, ctx), ctx);
}

export function prepareCourseCreate(input: NewCourse, ctx: WriteContext): Extract<CatalogWrite, { kind: "course" }> {
  const audit = newRow(ctx);
  return {
    kind: "course",
    row: { ...audit, ...input, slug: input.slug ?? audit.id, archivedAt: null },
  };
}

export function createChapter(input: NewChapter, ctx: WriteContext) {
  return save(prepareChapterCreate(input, ctx), ctx);
}

export function prepareChapterCreate(input: NewChapter, ctx: WriteContext): Extract<CatalogWrite, { kind: "chapter" }> {
  const audit = newRow(ctx);
  return { kind: "chapter", row: { ...audit, ...input, slug: input.slug ?? audit.id } };
}

export function createTopic(input: NewTopic, ctx: WriteContext) {
  return save(prepareTopicCreate(input, ctx), ctx);
}

export function prepareTopicCreate(input: NewTopic, ctx: WriteContext): Extract<CatalogWrite, { kind: "topic" }> {
  const audit = newRow(ctx);
  return { kind: "topic", row: { ...audit, ...input, supplementMd: input.supplementMd ?? null, slug: input.slug ?? audit.id } };
}

export function prepareTopicUpdate(
  current: NonNullable<Awaited<ReturnType<typeof getTopic>>>, patch: TopicPatch, ctx: WriteContext,
): Extract<CatalogWrite, { kind: "topic" }> {
  const expectedVersion = current.rowVersion;
  const { relatedTopicIds, ...fields } = patch;
  return {
    kind: "topic", expectedVersion, relatedTopicIds,
    row: {
      ...current, ...fields,
      chapterId: patch.chapterId !== undefined ? patch.chapterId
        : patch.courseId !== undefined && patch.courseId !== current.courseId ? null : current.chapterId,
      rowVersion: expectedVersion + 1,
      updatedAt: ctx.now, updatedBy: ctx.actorId, lastOrigin: "manual",
    },
  };
}

export async function updateTopic(id: string, patch: TopicPatch, expectedVersion: number, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const current = await getTopic(id);
  if (!current) throw new Problem(404, "NOT_FOUND", "找不到该知识点。");
  if (current.rowVersion !== expectedVersion) {
    // A retry may have raced the first commit between the receipt and row reads.
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw conflict(current.rowVersion);
  }
  return save(prepareTopicUpdate(current, patch, ctx), ctx);
}

export async function updateCourse(id: string, patch: CoursePatch, expectedVersion: number, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  const current = await getCourse(id);
  if (!current) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  if (current.rowVersion !== expectedVersion) throw conflict(current.rowVersion);
  return save(prepareCourseUpdate(current, patch, ctx), ctx);
}

export function prepareCourseUpdate(current: NonNullable<Awaited<ReturnType<typeof getCourse>>>, patch: CoursePatch, ctx: WriteContext) {
  return { kind: "course" as const, expectedVersion: current.rowVersion,
    row: { ...current, ...patch, rowVersion: current.rowVersion + 1, updatedAt: ctx.now, updatedBy: ctx.actorId, lastOrigin: "manual" } };
}

export async function topicCourseChoices() {
  const courses = await listCourses();
  return Promise.all(courses.map(async ({ id, name }) => ({
    id, name, chapters: chapterOptions(await catalog.chapterList(id)),
  })));
}
