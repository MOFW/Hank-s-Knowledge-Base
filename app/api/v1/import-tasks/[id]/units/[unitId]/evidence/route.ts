import { idSchema } from "@/domain/catalog";
import { taskEvidence } from "@/domain/import-task";
import { api, expectedVersion, result, writeInput } from "@/lib/http";
import { runImportTask } from "@/services/import-tasks";

export const POST = api(async (request, { ownerId, requestId }, { params }: {
  params: Promise<{ id: string; unitId: string }>;
}) => {
  const { id, unitId } = await params;
  const version = expectedVersion(request);
  const { input, ctx } = await writeInput(request, ownerId, taskEvidence);
  const task = await runImportTask(ownerId, {
    action: "provide_evidence", taskId: idSchema.parse(id), unitId: idSchema.parse(unitId),
    idempotencyKey: ctx.key, expectedVersion: version, evidence: input,
  });
  return result({ rowVersion: task.rowVersion, saved: task.saved }, requestId, 200, task.rowVersion);
});
