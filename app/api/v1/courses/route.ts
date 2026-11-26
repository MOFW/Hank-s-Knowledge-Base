import { newCourse } from "@/domain/catalog";
import { api, result, writeInput } from "@/lib/http";
import { createCourse, listCourses } from "@/services/catalog";

export const GET = api(async (_request, { requestId }) => result(await listCourses(), requestId));

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, newCourse);
  const saved = await createCourse(input, ctx);
  return result(saved, requestId, 201, saved.rowVersion);
});
