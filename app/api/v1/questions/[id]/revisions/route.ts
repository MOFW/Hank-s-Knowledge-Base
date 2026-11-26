import { revisionPost } from "@/lib/revision-http";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result } from "@/lib/http";
import { listQuestionRevisions } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { requestId }, route: Route) => {
  const revisions = await listQuestionRevisions(idSchema.parse((await route.params).id));
  if (!revisions) throw new Problem(404, "NOT_FOUND", "找不到该题目。");
  return result(revisions, requestId);
});

export const POST = revisionPost("question");
