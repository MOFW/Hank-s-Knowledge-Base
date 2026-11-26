import { z } from "zod";
import { api, result, writeInput } from "@/lib/http";
import { listImports } from "@/services/imports";
import { receiveAndReview } from "@/services/ai-review";

export const GET = api(async (_request, { ownerId, requestId }) => result(await listImports(ownerId), requestId));

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, raw, ctx } = await writeInput(request, ownerId, z.unknown());
  return result(await receiveAndReview(input, raw, ctx), requestId, 201);
});
