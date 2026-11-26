import { and, eq, isNull, sql } from "drizzle-orm";
import { getAssetStore } from "@/adapters/assets";
import { getDb } from "@/db";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import { assets } from "@/db/schema";
import { Problem } from "@/domain/problem";
import { imageSignatures, maxImageBytes, type ImageMime } from "@/lib/image-signatures";
import { existingResult, requireWriteAccess } from "@/services/writes";

export { maxImageBytes, type ImageMime } from "@/lib/image-signatures";

export function imageMime(header: string | null): ImageMime {
  const mime = header?.trim().toLowerCase() ?? "";
  if (!Object.hasOwn(imageSignatures, mime)) {
    throw new Problem(415, "UNSUPPORTED_IMAGE", "请选择 PNG、JPEG、GIF 或 WebP 图片。");
  }
  return mime as ImageMime;
}

export async function readImage(request: Request, mime: ImageMime) {
  if (Number(request.headers.get("Content-Length")) > maxImageBytes) {
    throw new Problem(413, "TOO_LARGE", "图片大小不能超过 8 MiB。");
  }
  if (!request.body) throw new Problem(400, "MISSING_IMAGE", "请选择要上传的图片。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxImageBytes) {
        await reader.cancel();
        throw new Problem(413, "TOO_LARGE", "图片大小不能超过 8 MiB。");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(400, "INVALID_BODY", "无法读取图片，请重新选择文件。");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (!imageSignatures[mime](bytes)) {
    throw new Problem(422, "INVALID_IMAGE", "图片内容与所选格式不符，或文件已损坏。");
  }
  return bytes.buffer;
}

export function imageFilename(header: string | null) {
  let name = "";
  try {
    name = decodeURIComponent(header ?? "").trim();
  } catch {
    throw new Problem(422, "INVALID_FILENAME", "文件名的编码不正确。");
  }
  if (!name || name.length > 240 || /[/\\\x00-\x1f\x7f]/.test(name)) {
    throw new Problem(422, "INVALID_FILENAME", "请输入有效的图片文件名。");
  }
  return name;
}

export const getAsset = (id: string, ownerId: string) => getDb().select().from(assets)
  .where(and(eq(assets.id, id), eq(assets.createdBy, ownerId), eq(assets.status, "ready"), isNull(assets.deletedAt))).get();

function assetSummary(asset: typeof assets.$inferSelect) {
  return {
    id: asset.id, originalFilename: asset.originalFilename,
    mimeType: asset.mimeType, byteSize: asset.byteSize,
  };
}

async function priorUpload(ctx: WriteContext) {
  const previous = await existingResult(ctx);
  if (!previous) return undefined;
  const asset = await getAsset(previous.id, ctx.actorId);
  if (!asset) throw new Problem(404, "NOT_FOUND", "找不到这张图片。");
  return assetSummary(asset);
}

export async function uploadImage(
  body: ArrayBuffer, mimeType: ImageMime, originalFilename: string, digest: string, ctx: WriteContext,
) {
  const previous = await priorUpload(ctx);
  if (previous) return previous;
  await requireWriteAccess(ctx);

  // Register every attempt before writing R2. An interrupted or losing upload remains discoverable for cleanup.
  const id = crypto.randomUUID();
  const storageKey = `images/${ctx.actorId}/${id}`;
  const row = {
    id, storageKey, sha256: digest, byteSize: body.byteLength,
    mimeType, originalFilename, width: null, height: null, status: "ready",
    extraJson: {}, createdAt: ctx.now, createdBy: ctx.actorId, deletedAt: null,
  } as const;
  const db = getDb();
  await db.insert(assets).values({ ...row, status: "pending" });
  const stored = await getAssetStore().put(storageKey, body, { httpMetadata: { contentType: mimeType } });
  if (!stored) throw new Problem(503, "UPLOAD_FAILED", "暂时无法保存图片，请重试。");
  try {
    await db.batch([
      writeReceipt(db, ctx, { id: row.id, rowVersion: 1 }, sql`EXISTS (SELECT 1 FROM assets WHERE id = ${id} AND status = 'pending')`),
      db.update(assets).set({ status: "ready" }).where(eq(assets.id, id)),
      advanceEpoch(db, ctx),
    ]);
  } catch (error) {
    const raced = await priorUpload(ctx);
    if (raced) return raced;
    await requireWriteAccess({ ...ctx, now: new Date().toISOString() });
    throw error;
  }
  return assetSummary(row);
}
