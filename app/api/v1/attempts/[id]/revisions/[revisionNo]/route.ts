import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { revisionPath } from "@/domain/questions";
import { api, result } from "@/lib/http";
import { getAttemptRevision } from "@/services/questions";

type Route = { params: Promise<{ id: string; revisionNo: string }> };

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const params = await route.params;
  const revision = await getAttemptRevision(idSchema.parse(params.id), ownerId, revisionPath.parse(params.revisionNo));
  if (!revision) throw new Problem(404, "NOT_FOUND", "找不到该作答记录的历史版本。");
  return result(revision, requestId);
});
