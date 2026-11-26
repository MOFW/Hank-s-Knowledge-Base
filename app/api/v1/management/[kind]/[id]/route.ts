import { idSchema } from "@/domain/catalog";
import { managementInput, managementKind } from "@/domain/management";
import { Problem } from "@/domain/problem";
import { api, result, writeInput } from "@/lib/http";
import { getManagement, manageContent } from "@/services/management";

type Route = { params: Promise<{ kind: string; id: string }> };

export const GET = api<Route>(async (_request, { ownerId, requestId }, { params }) => {
  const { kind, id } = await params;
  const plan = await getManagement(managementKind.parse(kind), idSchema.parse(id), ownerId);
  if (!plan) throw new Problem(404, "NOT_FOUND", "该资料已不存在。");
  return result(plan, requestId);
});

export const POST = api<Route>(async (request, { ownerId, requestId }, { params }) => {
  const { kind, id } = await params;
  const { input, ctx } = await writeInput(request, ownerId, managementInput);
  return result(await manageContent(managementKind.parse(kind), idSchema.parse(id), input, ctx), requestId);
});
