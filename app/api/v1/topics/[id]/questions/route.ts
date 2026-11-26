import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { questionListInput } from "@/domain/questions";
import { api, result } from "@/lib/http";
import { listTopicQuestions } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (request, { ownerId, requestId }, route: Route) => {
  const id = idSchema.parse((await route.params).id);
  const filters = questionListInput.parse(Object.fromEntries(new URL(request.url).searchParams));
  const questions = await listTopicQuestions(id, ownerId, filters);
  if (!questions) throw new Problem(404, "NOT_FOUND", "找不到该知识点。");
  return result(questions, requestId);
});
