import { z } from "zod";
import { api, result, writeInput } from "@/lib/http";
import { emptyQuestionTrash } from "@/services/management";

const inputSchema = z.object({ dataEpoch: z.number().int().nonnegative().safe() }).strict();

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, inputSchema);
  return result(await emptyQuestionTrash(input.dataEpoch, ctx), requestId);
});
