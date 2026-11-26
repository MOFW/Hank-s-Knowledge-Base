import { newQuestion, questionListInput } from "@/domain/questions";
import { api, result, writeInput } from "@/lib/http";
import { createQuestion, listQuestions } from "@/services/questions";

export const GET = api(async (request, { ownerId, requestId }) => {
  const filters = questionListInput.parse(Object.fromEntries(new URL(request.url).searchParams));
  return result(await listQuestions(ownerId, filters), requestId);
});

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, newQuestion);
  const saved = await createQuestion(input, ctx);
  return result(saved, requestId, 201, saved.rowVersion);
});
