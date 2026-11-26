import { sql } from "drizzle-orm";
import { prepareReading } from "@/components/markdown-reading";
import { usableCourse, type WriteContext } from "@/db/queries/catalog";
import { commitManagement } from "@/db/queries/content-deletion";
import { questionForRelation, upsertQuestionTopic } from "@/db/queries/question-topics";
import { liveQuestion } from "@/db/queries/questions";
import { Problem } from "@/domain/problem";
import type { QuestionTopicChanges } from "@/domain/question-topic";
import { getTopic } from "./catalog";
import { conflict, existingResult } from "./writes";

type RelationInput = {
  topicId: string; questionId: string; expectedTopicVersion: number; expectedQuestionVersion: number;
  changes: QuestionTopicChanges | null;
};
export async function saveQuestionTopic(input: RelationInput, ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (previous) return previous;
  try {
    const { condition, write } = await prepareQuestionTopic(input, ctx);
    return commitManagement({ id: input.topicId, rowVersion: input.expectedTopicVersion + 1 }, condition, [
      write, ...advanceRelationVersions(input.topicId, [input.questionId]),
    ], ctx);
  } catch (error) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    throw error;
  }
}

export async function prepareQuestionTopic({ topicId, questionId, expectedTopicVersion, expectedQuestionVersion, changes }: RelationInput, ctx: WriteContext) {
  const [topic, question] = await Promise.all([getTopic(topicId), questionForRelation(questionId)]);
  if (!topic || !question) throw new Problem(404, "NOT_FOUND", "找不到可用的笔记或题目。");
  if (topic.rowVersion !== expectedTopicVersion) throw conflict(topic.rowVersion);
  if (question.rowVersion !== expectedQuestionVersion) throw conflict(question.rowVersion);
  const anchor = changes?.placementAnchor;
  if (anchor && !prepareReading(topic.bodyMd).placements.some(({ id }) => id === anchor)) {
    throw new Problem(422, "INVALID_REFERENCE", "所选位置已不在这篇笔记中。");
  }
  if (changes?.useQuestionTechniques && !question.techniquesMd.trim()) {
    throw new Problem(422, "INVALID_REFERENCE", "这道题还没有可用的正式技巧。");
  }

  const pair = sql`topic_id = ${topicId} AND question_id = ${questionId}`;
  const precondition = sql`${usableCourse(topic.courseId)} AND ${liveQuestion(questionId, expectedQuestionVersion)}
    AND EXISTS (SELECT 1 FROM topics WHERE id = ${topicId} AND deleted_at IS NULL AND row_version = ${expectedTopicVersion})
    AND ${changes ? sql`1` : sql`EXISTS (SELECT 1 FROM question_topics WHERE ${pair})`}`;
  return { condition: precondition, write: changes ? upsertQuestionTopic(topicId, questionId, changes, ctx)
    : sql`DELETE FROM question_topics WHERE ${pair}` };
}

export function advanceRelationVersions(topicId: string, questionIds: string[]) {
  return [
    sql`UPDATE topics SET row_version = row_version + 1 WHERE id = ${topicId}`,
    sql`UPDATE questions SET row_version = row_version + 1 WHERE id IN (SELECT value FROM json_each(${JSON.stringify(questionIds)}))`,
  ];
}
