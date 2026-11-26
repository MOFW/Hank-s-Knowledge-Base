import { contentOperations, undoContentOperation } from "@/domain/content-operations";
import { api, result, writeInput } from "@/lib/http";
import { executeContentOperations, getLatestContentOperation, undoLatestContentOperation } from "@/services/content-operations";

export const GET = api(async (_request, { ownerId, requestId }) =>
  result(await getLatestContentOperation(ownerId), requestId));

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, contentOperations);
  return result(await executeContentOperations(input, ctx), requestId);
});

export const DELETE = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, undoContentOperation);
  return result(await undoLatestContentOperation(input.operationId, ctx), requestId);
});
