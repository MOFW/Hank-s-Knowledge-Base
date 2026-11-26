import { idSchema, topicPatch } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { getTopic, updateTopic } from "@/services/catalog";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { requestId }, route: Route) => {
  const topic = await getTopic(idSchema.parse((await route.params).id));
  if (!topic) throw new Problem(404, "NOT_FOUND", "找不到该知识点。");
  return result(topic, requestId, 200, topic.rowVersion);
});

export const PATCH = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, topicPatch);
  const saved = await updateTopic(id, input, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
