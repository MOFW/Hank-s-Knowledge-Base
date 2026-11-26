import { findReceipt, writeBlock, type WriteContext } from "@/db/queries/catalog";
import { Problem } from "@/domain/problem";

export function newRow(ctx: WriteContext) {
  return {
    id: crypto.randomUUID(), rowVersion: 1,
    createdBy: ctx.actorId, updatedBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now,
    lastOrigin: "manual", deletedAt: null, extraJson: {},
  };
}

export async function existingResult(ctx: WriteContext) {
  const receipt = await findReceipt(ctx.actorId, ctx.key);
  if (!receipt) return undefined;
  if (receipt.requestHash !== ctx.hash) {
    throw new Problem(409, "IDEMPOTENCY_CONFLICT", "这个保存标识已用于另一项修改。");
  }
  return receipt.resultJson;
}

export function conflict(version: number) {
  return new Problem(409, "VERSION_CONFLICT", "内容已有更新，请重新加载后合并修改。", {
    currentVersion: version,
  });
}

export function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return [error.message, error.cause instanceof Error ? error.cause.message : ""].join(" ");
}

export async function requireWriteAccess(ctx: WriteContext) {
  const block = await writeBlock(ctx);
  if (block === "maintenance") throw new Problem(503, "MAINTENANCE", "知识库暂时处于维护状态，请稍后保存。");
  if (block === "owner") throw new Problem(403, "FORBIDDEN", "当前账户没有操作权限。");
}
