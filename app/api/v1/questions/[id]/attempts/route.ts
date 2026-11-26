import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { newAttempt } from "@/domain/questions";
import { api, result, writeInput } from "@/lib/http";
import { createAttempt, listAttempts } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const attempts = await listAttempts(idSchema.parse((await route.params).id), ownerId);
  if (!attempts) throw new Problem(404, "NOT_FOUND", "找不到该题目。");
  return result(attempts, requestId);
});

export const POST = api(async (request, { ownerId, requestId }, route: Route) => {
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, newAttempt);
  const saved = await createAttempt(id, input, ctx);
  return result(saved, requestId, 201, saved.rowVersion);
});
