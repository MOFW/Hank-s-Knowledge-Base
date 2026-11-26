import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { attemptPatch } from "@/domain/questions";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { getAttempt, updateAttempt } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const attempt = await getAttempt(idSchema.parse((await route.params).id), ownerId);
  if (!attempt) throw new Problem(404, "NOT_FOUND", "找不到该作答记录。");
  return result(attempt, requestId, 200, attempt.rowVersion);
});

export const PATCH = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, attemptPatch);
  const saved = await updateAttempt(id, input, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
