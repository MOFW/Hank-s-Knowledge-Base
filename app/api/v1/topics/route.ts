import { idSchema, newTopic } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result, writeInput } from "@/lib/http";
import { createTopic, getDirectory, listUnassignedTopics } from "@/services/catalog";

export const GET = api(async (request, { requestId }) => {
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (courseId === "unassigned") return result(await listUnassignedTopics(), requestId);
  const directory = await getDirectory(idSchema.parse(courseId));
  if (!directory) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  return result(directory.topics, requestId);
});

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, newTopic);
  const saved = await createTopic(input, ctx);
  return result(saved, requestId, 201, saved.rowVersion);
});
