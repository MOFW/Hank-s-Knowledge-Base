import { api, idempotencyKey, requireWriteOrigin, result, sha256 } from "@/lib/http";
import { Problem } from "@/domain/problem";
import { imageFilename, imageMime, readImage, uploadImage } from "@/services/assets";

export const POST = api(async (request, { ownerId, requestId }) => {
  requireWriteOrigin(request);
  const key = idempotencyKey(request);
  const mime = imageMime(request.headers.get("Content-Type"));
  const filename = imageFilename(request.headers.get("X-File-Name"));
  const bytes = await readImage(request, mime);
  const digest = await sha256(bytes);
  const expectedDigest = request.headers.get("X-Image-SHA256");
  if (expectedDigest !== null && expectedDigest !== digest) {
    throw new Problem(422, "IMAGE_DIGEST_MISMATCH", "图片与材料包所记录的原件不一致。");
  }
  const signature = JSON.stringify(["POST", new URL(request.url).pathname, key, filename, mime, digest]);
  const hash = await sha256(new TextEncoder().encode(signature));
  const ctx = { actorId: ownerId, key, hash, now: new Date().toISOString() };
  return result(await uploadImage(bytes, mime, filename, digest, ctx), requestId, 201);
});
