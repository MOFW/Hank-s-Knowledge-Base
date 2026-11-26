import { idSchema } from "@/domain/catalog";
import { api, privateHeaders, result } from "@/lib/http";
import { getImport, importOriginal } from "@/services/imports";

export const GET = api(async (request, { ownerId, requestId }, { params }: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await params).id);
  if (new URL(request.url).searchParams.get("view") === "original") {
    return new Response(await importOriginal(ownerId, id), { headers: {
      ...privateHeaders, "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-${id}.json"`,
    } });
  }
  return result(await getImport(ownerId, id), requestId);
});
