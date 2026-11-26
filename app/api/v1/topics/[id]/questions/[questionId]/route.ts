import { idSchema } from "@/domain/catalog";
import { questionTopicVersion, questionTopicPatch } from "@/domain/question-topic";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { saveQuestionTopic } from "@/services/question-topics";

type Route = { params: Promise<{ id: string; questionId: string }> };

const write = (remove: boolean) => api<Route>(async (request, { ownerId, requestId }, route) => {
  const { id, questionId } = await route.params;
  const { input, ctx } = await writeInput(request, ownerId, remove ? questionTopicVersion : questionTopicPatch);
  const { expectedQuestionVersion, ...changes } = input;
  const saved = await saveQuestionTopic({
    topicId: idSchema.parse(id), questionId: idSchema.parse(questionId),
    expectedTopicVersion: expectedVersion(request), expectedQuestionVersion, changes: remove ? null : changes,
  }, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});

export const PATCH = write(false);
export const DELETE = write(true);
