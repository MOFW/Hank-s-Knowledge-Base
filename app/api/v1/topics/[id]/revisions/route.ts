import { revisionList } from "@/db/queries/questions";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result } from "@/lib/http";
import { revisionPost } from "@/lib/revision-http";
import { getTopic } from "@/services/catalog";

export const GET = api<{ params: Promise<{ id: string }> }>(async (_request, { requestId }, { params }) => {
  const id = idSchema.parse((await params).id);
  if (!await getTopic(id)) throw new Problem(404, "NOT_FOUND", "找不到这篇笔记。");
  return result(await revisionList("topic", id), requestId);
});

export const POST = revisionPost("topic");
