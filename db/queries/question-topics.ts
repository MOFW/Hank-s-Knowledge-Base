import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, questions, questionTopics, topics } from "@/db/schema";
import type { FeaturedExample, QuestionTopicChanges } from "@/domain/question-topic";
import type { WriteContext } from "./catalog";
import { activeQuestion } from "./questions";

const joinedQuestions = () => getDb().select({
  questionId: questions.id, title: questions.title, rowVersion: questions.rowVersion,
  displayRole: questionTopics.displayRole, displayOrder: questionTopics.displayOrder,
  placementAnchor: questionTopics.placementAnchor, noteMd: questionTopics.noteMd,
  useQuestionTechniques: questionTopics.useQuestionTechniques,
  hasTechniques: sql<boolean>`trim(${questions.keyTechniquesMd}) <> ''`.mapWith(Boolean),
}).from(questionTopics)
  .innerJoin(questions, eq(questionTopics.questionId, questions.id))
  .leftJoin(courses, eq(questions.primaryCourseId, courses.id));

export const topicQuestionRelations = (topicId: string, questionIds?: string[]) => joinedQuestions()
  .where(and(eq(questionTopics.topicId, topicId), activeQuestion, questionIds ? sql`
    ${questions.id} IN (SELECT value FROM json_each(${JSON.stringify(questionIds)}))` : undefined))
  .orderBy(questionTopics.displayRole, questionTopics.displayOrder, questions.title, questions.id).all();

export type TopicQuestionRelation = Awaited<ReturnType<typeof topicQuestionRelations>>[number];

export function questionForRelation(id: string) {
  return getDb().select({ rowVersion: questions.rowVersion, techniquesMd: questions.keyTechniquesMd })
    .from(questions).leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(questions.id, id), activeQuestion)).get();
}

export function featuredExamplesQuery(topicId: string, ownerId: string) {
  // Only the example projection crosses the reading boundary. Original bytes still use the asset endpoint.
  return getDb().select({
    questionId: questions.id, title: questions.title, statementMd: questions.statementMd,
    placementAnchor: questionTopics.placementAnchor, displayOrder: questionTopics.displayOrder, noteMd: questionTopics.noteMd,
    techniquesMd: sql<string | null>`CASE WHEN ${questionTopics.useQuestionTechniques} THEN ${questions.keyTechniquesMd} END`.as("techniques_md"),
    images: sql<FeaturedExample["images"]>`(
      SELECT json_group_array(json_object('id', id, 'width', width, 'height', height, 'caption', caption))
      FROM (
        SELECT a.id, a.width, a.height, link.caption FROM asset_links AS link
        JOIN assets AS a ON a.id = link.asset_id
        WHERE link.question_id = ${questions.id} AND link.role = 'original'
          AND a.status = 'ready' AND a.deleted_at IS NULL AND a.created_by = ${ownerId}
        ORDER BY link.sort_order, a.id
      )
    )`.mapWith((value: string) => JSON.parse(value) as FeaturedExample["images"]).as("images"),
  }).from(questionTopics)
    .innerJoin(questions, eq(questionTopics.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(questionTopics.topicId, topicId), eq(questionTopics.displayRole, "featured"), activeQuestion))
    .orderBy(questionTopics.displayOrder, questions.id);
}

export function featuredSource(topicId: string, questionId: string) {
  return getDb().select({ id: topics.id, courseId: topics.courseId }).from(questionTopics)
    .innerJoin(topics, eq(questionTopics.topicId, topics.id))
    .leftJoin(courses, eq(topics.courseId, courses.id))
    .where(and(eq(topics.id, topicId), eq(questionTopics.questionId, questionId), eq(questionTopics.displayRole, "featured"),
      isNull(topics.deletedAt), isNull(courses.deletedAt), isNull(courses.archivedAt))).get();
}

export function upsertQuestionTopic(topicId: string, questionId: string, changes: QuestionTopicChanges, ctx: WriteContext) {
  const { displayRole, displayOrder, placementAnchor, noteMd, useQuestionTechniques } = changes;
  return sql`INSERT INTO question_topics (topic_id, question_id, created_at, created_by,
    display_role, display_order, placement_anchor, note_md, use_question_techniques)
    VALUES (${topicId}, ${questionId}, ${ctx.now}, ${ctx.actorId}, ${displayRole ?? "related"},
      ${displayOrder ?? 0}, ${placementAnchor ?? null}, ${noteMd ?? ""}, ${Number(useQuestionTechniques ?? false)})
    ON CONFLICT (question_id, topic_id) DO UPDATE SET
      display_role = coalesce(${displayRole ?? null}, display_role),
      display_order = coalesce(${displayOrder ?? null}, display_order),
      placement_anchor = ${placementAnchor === undefined ? sql`placement_anchor` : sql`${placementAnchor}`},
      note_md = coalesce(${noteMd ?? null}, note_md),
      use_question_techniques = coalesce(${useQuestionTechniques === undefined ? null : Number(useQuestionTechniques)}, use_question_techniques)`;
}
