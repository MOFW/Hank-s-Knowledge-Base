import { z } from "zod";
import { idSchema } from "@/domain/catalog";
import { api, result, writeInput } from "@/lib/http";
import { assetManagement, removeAssets } from "@/services/asset-cleanup";

const inputSchema = z.object({
  dataEpoch: z.number().int().nonnegative().safe(),
  detach: z.boolean().optional(),
  assetIds: z.array(idSchema).min(1).max(50).refine((ids) => new Set(ids).size === ids.length),
}).strict();

export const GET = api(async (request, { ownerId, requestId }) =>
  result(await assetManagement(ownerId, idSchema.safeParse(new URL(request.url).searchParams.get("before")).data), requestId));

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, inputSchema);
  return result(await removeAssets(input.assetIds, input.dataEpoch, ctx, input.detach), requestId);
});
