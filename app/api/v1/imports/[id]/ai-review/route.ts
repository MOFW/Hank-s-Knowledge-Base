import { z } from "zod";
import { batchDetail } from "@/db/queries/imports";
import { batchReviewLimit } from "@/domain/ai-review";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result, writeInput } from "@/lib/http";
import { manualReviews, reviewHistory } from "@/services/ai-review";

type Route = { params: Promise<{ id: string }> };
const selection = z.object({ items: z.array(z.object({
  itemId: idSchema, rowVersion: z.number().int().positive().safe(),
}).strict()).min(1).max(batchReviewLimit) }).strict().refine(
  ({ items }) => new Set(items.map(({ itemId }) => itemId)).size === items.length, "候选项重复。",
);

async function batch(ownerId: string, route: Route) {
  const id = idSchema.parse((await route.params).id);
  const data = await batchDetail(ownerId, id);
  if (!data) throw new Problem(404, "NOT_FOUND", "找不到此导入批次。");
  return data;
}

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const { batch: { id } } = await batch(ownerId, route);
  return result(await reviewHistory(ownerId, id), requestId);
});

export const POST = api(async (request, { ownerId, requestId }, route: Route) => {
  const { input, ctx } = await writeInput(request, ownerId, selection);
  const data = await batch(ownerId, route);
  if (input.items.some(({ itemId }) => !data.items.some(({ id }) => id === itemId))) {
    throw new Problem(404, "NOT_FOUND", "找不到此导入候选。");
  }
  return result(await manualReviews(data.batch.id, input.items, ctx), requestId);
});
