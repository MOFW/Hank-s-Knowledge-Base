import { idSchema } from "@/domain/catalog";
import { questionTopics } from "@/domain/questions";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { updateQuestion } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const PUT = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, questionTopics);
  const saved = await updateQuestion(id, input, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
