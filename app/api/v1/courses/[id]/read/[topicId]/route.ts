import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result } from "@/lib/http";
import { getReadingTopic } from "@/services/course-reading";

export const GET = api(async (_request, { requestId, ownerId }, route: { params: Promise<{ id: string; topicId: string }> }) => {
  const { id, topicId } = await route.params;
  const note = await getReadingTopic(idSchema.parse(id), idSchema.parse(topicId), ownerId);
  if (!note) throw new Problem(404, "NOT_FOUND", "这篇笔记已不在本课程。");
  return result(note, requestId, 200, note.rowVersion);
});
