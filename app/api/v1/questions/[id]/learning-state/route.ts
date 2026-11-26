import { idSchema } from "@/domain/catalog";
import { z } from "zod";
import { Problem } from "@/domain/problem";
import { learningStatePatch } from "@/domain/questions";
import { questionAssessment } from "@/domain/review";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { getLearningState, updateLearningState } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const state = await getLearningState(idSchema.parse((await route.params).id), ownerId);
  if (!state) throw new Problem(404, "NOT_FOUND", "找不到该学习记录。");
  return result(state, requestId, 200, state.rowVersion);
});

export const PATCH = api(async (request, { ownerId, requestId, timezone }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, z.union([questionAssessment, learningStatePatch]));
  const saved = await updateLearningState(id, input, version, timezone, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
