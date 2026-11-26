import { idSchema, readingOrderInput } from "@/domain/catalog";
import { api, result, writeInput } from "@/lib/http";
import { saveReadingOrder } from "@/services/course-reading";

export const PUT = api(async (request, { ownerId, requestId }, route: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, readingOrderInput);
  return result(await saveReadingOrder(id, input, ctx), requestId);
});
