import { idSchema } from "@/domain/catalog";
import { importReview } from "@/domain/imports";
import { api, result, writeInput } from "@/lib/http";
import { reviewImport } from "@/services/imports";

export const POST = api(async (request, { ownerId, requestId }, { params }: { params: Promise<{ id: string }> }) => {
  const { input, ctx } = await writeInput(request, ownerId, importReview);
  return result(await reviewImport(idSchema.parse((await params).id), input, ctx), requestId);
});
