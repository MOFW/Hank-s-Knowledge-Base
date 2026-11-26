import { revisionPost } from "@/lib/revision-http";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result } from "@/lib/http";
import { listAttemptRevisions } from "@/services/questions";

type Route = { params: Promise<{ id: string }> };

export const GET = api(async (_request, { ownerId, requestId }, route: Route) => {
  const revisions = await listAttemptRevisions(idSchema.parse((await route.params).id), ownerId);
  if (!revisions) throw new Problem(404, "NOT_FOUND", "找不到该作答记录。");
  return result(revisions, requestId);
});

export const POST = revisionPost("attempt");
