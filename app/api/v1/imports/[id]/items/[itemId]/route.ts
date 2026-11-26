import { idSchema } from "@/domain/catalog";
import { importEdit } from "@/domain/imports";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { editImport } from "@/services/imports";

export const PATCH = api(async (request, { ownerId, requestId }, { params }: { params: Promise<{ id: string; itemId: string }> }) => {
  const { id, itemId } = await params;
  const version = expectedVersion(request);
  const { input, ctx } = await writeInput(request, ownerId, importEdit);
  return result(await editImport(idSchema.parse(id), idSchema.parse(itemId), version, input, ctx), requestId);
});
