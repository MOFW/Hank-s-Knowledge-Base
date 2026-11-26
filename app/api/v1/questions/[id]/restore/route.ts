import { idSchema } from "@/domain/catalog";
import { restoreRevision } from "@/domain/questions";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { restoreQuestion } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const POST = api(async (request, { ownerId, requestId }, route: Route) => {
  const version = expectedVersion(request);
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, restoreRevision);
  const saved = await restoreQuestion(id, input.revisionNo, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
