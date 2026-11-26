import { idSchema } from "@/domain/catalog";
import { importCommit } from "@/domain/imports";
import { api, result, writeInput } from "@/lib/http";
import { commitImport } from "@/services/imports";

export const POST = api(async (request, { ownerId, requestId }, { params }: { params: Promise<{ id: string }> }) => {
  const { input, ctx } = await writeInput(request, ownerId, importCommit);
  return result(await commitImport(idSchema.parse((await params).id), input, ctx), requestId);
});
