import { coursePatch, deleteCourseInput, idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { deleteCourse, getDirectory, updateCourse } from "@/services/catalog";

export const GET = api(async (_request, { requestId }, route: { params: Promise<{ id: string }> }) => {
  const directory = await getDirectory(idSchema.parse((await route.params).id));
  if (!directory) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  return result(directory, requestId);
});

export const DELETE = api(async (request, { ownerId, requestId }, route: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await route.params).id);
  const { input, ctx } = await writeInput(request, ownerId, deleteCourseInput);
  return result(await deleteCourse(id, input, ctx), requestId);
});

export const PATCH = api(async (request, { ownerId, requestId }, route: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await route.params).id);
  const version = expectedVersion(request);
  const { input, ctx } = await writeInput(request, ownerId, coursePatch);
  const saved = await updateCourse(id, input, version, ctx);
  return result(saved, requestId, 200, saved.rowVersion);
});
