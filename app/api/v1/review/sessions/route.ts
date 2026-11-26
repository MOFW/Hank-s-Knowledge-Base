import { startReviewInput } from "@/domain/review";
import { api, result, writeInput } from "@/lib/http";
import { startReview } from "@/services/review";

export const POST = api(async (request, { ownerId, timezone, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, startReviewInput);
  return result(await startReview(timezone, input, ctx), requestId, 201);
});
