import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { revisionPath } from "@/domain/questions";
import { api, result } from "@/lib/http";
import { getQuestionRevision } from "@/services/questions";

type Route = { params: Promise<{ id: string; revisionNo: string }> };

export const GET = api(async (_request, { requestId }, route: Route) => {
  const params = await route.params;
  const revision = await getQuestionRevision(idSchema.parse(params.id), revisionPath.parse(params.revisionNo));
  if (!revision) throw new Problem(404, "NOT_FOUND", "找不到该题目的历史版本。");
  return result(revision, requestId);
});
