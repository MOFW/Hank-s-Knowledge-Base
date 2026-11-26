import { reviewListInput } from "@/domain/review";
import { api, result } from "@/lib/http";
import { listReview } from "@/services/review";

export const GET = api(async (request, { ownerId, timezone, requestId }) => {
  const filters = reviewListInput.parse(Object.fromEntries(new URL(request.url).searchParams));
  return result(await listReview(ownerId, timezone, filters), requestId);
});
