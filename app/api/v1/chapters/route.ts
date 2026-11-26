import { idSchema, newChapter } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, result, writeInput } from "@/lib/http";
import { createChapter, getDirectory } from "@/services/catalog";

export const GET = api(async (request, { requestId }) => {
  const directory = await getDirectory(idSchema.parse(new URL(request.url).searchParams.get("courseId")));
  if (!directory) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  return result(directory.chapters, requestId);
});

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, newChapter);
  const saved = await createChapter(input, ctx);
  return result(saved, requestId, 201, saved.rowVersion);
});
