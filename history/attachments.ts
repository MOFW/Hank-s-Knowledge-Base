import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageSignatures, maxImageBytes, type ImageMime } from "../lib/image-signatures.ts";
import type { HistoryEntry } from "./archive.ts";
import { historyErrorCode, type HistoryAttachment, type HistoryAttachmentRef } from "./types.ts";

const assetId = /^file[-_][0-9a-z]+/i;

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function pointerPath(pointer: string) {
  return pointer.replace(/^(?:file-service|sediment|attachment):\/\//i, "");
}

type ImageResult = Pick<HistoryAttachment, "status" | "reason" | "entryPath" | "sha256" | "byteLength" | "mimeType">;

function absent(status: "missing" | "unavailable", reason: string, entry?: HistoryEntry): ImageResult {
  return { status, reason, entryPath: entry?.path ?? null, sha256: null, byteLength: null, mimeType: null };
}

export function attachmentResolver(entries: HistoryEntry[], dbPath: string) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const byName = new Map<string, HistoryEntry[]>();
  const byAssetId = new Map<string, HistoryEntry[]>();
  const readImages = new Map<string, ImageResult>();
  for (const entry of entries) {
    const name = basename(entry.path);
    const id = assetId.exec(name)?.[0];
    if (id) insert(byAssetId, id, entry);
    insert(byName, name, entry);
  }

  return async (ref: HistoryAttachmentRef): Promise<HistoryAttachment> => {
    const result = await resolve(ref);
    return { ...ref, ...result, kind: result.status === "available" ? "image" : ref.kind,
      mimeType: result.mimeType ?? ref.mimeType };
  };

  async function resolve(ref: HistoryAttachmentRef) {
    const pointer = ref.pointer ? pointerPath(ref.pointer) : null;
    if (pointer !== null && (/^[a-z][a-z0-9+.-]*:/i.test(pointer) || unsafeReference(pointer))) {
      return absent("unavailable", "UNSUPPORTED_ATTACHMENT_POINTER");
    }

    // A pointer takes precedence over a display name. An unmatched pointer cannot be verified by a name alone.
    const reference = pointer ?? ref.name;
    if (!reference) return absent("unavailable", "ATTACHMENT_WITHOUT_REFERENCE");
    if (unsafeReference(reference)) return absent("unavailable", "UNSUPPORTED_ATTACHMENT_POINTER");
    const exact = byPath.get(reference);
    const matches = exact ? [exact] : reference.includes("/") ? []
      : (byName.get(reference) ?? byAssetId.get(reference) ?? []);
    if (!matches.length) return absent("missing", "ATTACHMENT_NOT_IN_EXPORT");
    if (matches.length !== 1) return absent("unavailable", "AMBIGUOUS_ATTACHMENT_MATCH");
    const [entry] = matches;
    if (ref.kind === "audio" || ref.kind === "video") return absent("unavailable", "UNSUPPORTED_ATTACHMENT_TYPE", entry);
    const cached = readImages.get(entry.path);
    if (cached) return cached;
    const result = await saveImage(entry, `${dbPath}.assets`);
    readImages.set(entry.path, result);
    return result;
  }
}

function insert(index: Map<string, HistoryEntry[]>, key: string, entry: HistoryEntry) {
  const existing = index.get(key);
  if (existing) existing.push(entry);
  else index.set(key, [entry]);
}

function unsafeReference(path: string) {
  return /[\\\u0000-\u001f\u007f]/u.test(path) || path.split("/").some((part) => !part || part === "." || part === "..");
}

async function saveImage(entry: HistoryEntry, directory: string): Promise<ImageResult> {
  if (entry.size > maxImageBytes) return absent("unavailable", "ATTACHMENT_TOO_LARGE", entry);
  const bytes = Buffer.alloc(entry.size);
  let offset = 0;
  try {
    for await (const chunk of entry.open()) {
      if (offset + chunk.byteLength > bytes.byteLength) return absent("unavailable", "ATTACHMENT_SIZE_MISMATCH", entry);
      offset += Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(bytes, offset);
    }
  } catch (error) {
    if (historyErrorCode(error).startsWith("ZIP_")) return absent("unavailable", historyErrorCode(error), entry);
    throw error;
  }
  if (offset !== bytes.byteLength) return absent("unavailable", "ATTACHMENT_SIZE_MISMATCH", entry);
  const mimeType = (Object.keys(imageSignatures) as ImageMime[]).find((mime) => imageSignatures[mime](bytes));
  if (!mimeType) return absent("unavailable", "UNSUPPORTED_OR_INVALID_IMAGE", entry);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `${randomUUID()}.tmp`);
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600, flush: true });
    await rename(temp, join(directory, sha256));
  } finally {
    await unlink(temp).catch(() => {});
  }
  return { status: "available", reason: null, entryPath: entry.path, sha256, byteLength: bytes.length, mimeType };
}
