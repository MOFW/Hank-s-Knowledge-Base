import { z } from "zod";
import { saveSource } from "@/db/queries/ai-review";
import { reviewSettings, sourceWitness } from "@/domain/ai-review";
import { importDigest } from "@/domain/imports";
import { api, result, writeInput } from "@/lib/http";
import { getReviewSettings, updateReviewSettings } from "@/services/ai-review";
import { existingResult } from "@/services/writes";

const update = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), revision: z.number().int().nonnegative(), settings: reviewSettings }).strict(),
  z.object({ action: z.literal("trust_source"), witness: sourceWitness }).strict(),
  z.object({ action: z.literal("remove_source"), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export const GET = api(async (_request, { ownerId, requestId }) => result(await getReviewSettings(ownerId), requestId));

export const POST = api(async (request, { ownerId, requestId }) => {
  const { input, ctx } = await writeInput(request, ownerId, update);
  if (input.action === "settings") return result(await updateReviewSettings(input.settings, input.revision, ctx), requestId);
  if (!await existingResult(ctx)) {
    const witness = input.action === "trust_source" ? input.witness : null;
    const digest = input.action === "trust_source" ? await importDigest(input.witness) : input.digest;
    try {
      await saveSource(digest, witness, ctx);
    } catch (error) {
      if (!await existingResult(ctx)) throw error;
    }
  }
  return result(await getReviewSettings(ownerId), requestId);
});
