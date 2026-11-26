import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { reviewCommand } from "@/domain/review";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { getReview, updateReview } from "@/services/review";

type Route = { params: Promise<{ id: string }> };

export const GET = api<Route>(async (_, { ownerId, requestId }, { params }) => {
  const { id } = await params;
  const review = await getReview(idSchema.parse(id), ownerId);
  if (!review) throw new Problem(404, "REVIEW_NOT_FOUND", "找不到这轮复习。");
  return result(review, requestId, 200, review.session.rowVersion);
});

export const PATCH = api<Route>(async (request, { ownerId, requestId, timezone }, { params }) => {
  const { id } = await params;
  const version = expectedVersion(request);
  const { input, ctx } = await writeInput(request, ownerId, reviewCommand);
  await updateReview(idSchema.parse(id), version, input, timezone, ctx);
  const review = await getReview(id, ownerId);
  return result(review, requestId, 200, review?.session.rowVersion);
});
