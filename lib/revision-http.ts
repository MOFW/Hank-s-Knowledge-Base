import type { RevisionTarget } from "@/db/queries/questions";
import { idSchema } from "@/domain/catalog";
import { revisionAction } from "@/domain/revisions";
import { api, result, writeInput } from "@/lib/http";
import { manageRevisions } from "@/services/revisions";

export function revisionPost(target: RevisionTarget) {
  return api<{ params: Promise<{ id: string }> }>(async (request, { ownerId, requestId }, { params }) => {
    const id = idSchema.parse((await params).id);
    const { input, ctx } = await writeInput(request, ownerId, revisionAction);
    return result(await manageRevisions(target, id, input, ctx), requestId);
  });
}
