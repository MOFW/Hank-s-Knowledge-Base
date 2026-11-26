import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { maxImageBytes, type ImageMime } from "../lib/image-signatures.ts";
import type { HistoricalMessage, HistoryMaterialBatch, HistoryStore, MaterialStructuralNode, SourceLocation } from "./store.ts";
import { HistoryError, historyErrorCode, type HistoryAttachment, type HistoryIssue } from "./types.ts";

const schemaVersion = "history-material-package/v1";
const maxPartImageBytes = 16 * 1024 * 1024;
const maxPartImages = 4;
const extensions: Record<ImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

type Observation = NonNullable<ReturnType<HistoryStore["getMaterialObservation"]>>;
type AttachmentDelivery =
  | { status: "exported"; file: string; reason: null }
  | { status: "missing" | "unavailable"; file: null; reason: string | null };
type Image = { file: string; bytes: Buffer };

export type HistoryMaterialRecord =
  | { type: "observation"; position: number; conversation: Observation["conversation"] }
  | { type: "message"; position: number; observationPosition: number; message: HistoricalMessage }
  | { type: "node"; position: number; node: MaterialStructuralNode }
  | ({ type: "attachment"; position: number; messagePart: number; attachmentIndex: number } & AttachmentDelivery)
  | ({ type: "diagnostic"; position: number } & HistoryIssue);

type RecordFragment = {
  type: "fragment";
  recordType: HistoryMaterialRecord["type"];
  position: number;
  offset: number;
  final: boolean;
  data: string;
};

export type HistoryMaterialPart = {
  schemaVersion: typeof schemaVersion;
  batchId: string;
  part: number;
  nextPart: number | null;
  records: (HistoryMaterialRecord | RecordFragment)[];
};

export type HistoryMaterialManifest = {
  schemaVersion: typeof schemaVersion;
  batch: Pick<HistoryMaterialBatch, "schemaVersion" | "id" | "createdAt" | "label" | "count">;
  partCount: number;
  attachmentCounts: Record<AttachmentDelivery["status"], number>;
  diagnosticCount: number;
  limits: { jsonBytesPerPart: number; imageBytesPerPart: number; imagesPerPart: number };
};

function partName(part: number) {
  return `part-${String(part).padStart(6, "0")}`;
}

function checked(signal?: AbortSignal) {
  if (signal?.aborted) throw new HistoryError("MATERIAL_EXPORT_INTERRUPTED");
}

async function requireNewDirectory(path: string) {
  try {
    await lstat(path);
  } catch (error) {
    if (historyErrorCode(error) === "ENOENT") return;
    throw error;
  }
  throw new HistoryError("MATERIAL_OUTPUT_EXISTS");
}

async function publishDirectory(staging: string, output: string, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    checked(signal);
    await requireNewDirectory(output);
    try {
      await rename(staging, output);
      return;
    } catch (error) {
      // A transient sharing violation can leave a finished staging directory locked.
      const code = historyErrorCode(error);
      if (attempt === 5 || (code !== "EPERM" && code !== "EBUSY")) throw error;
      await delay(40 * 2 ** attempt);
    }
  }
}

async function readAttachment(store: HistoryStore, attachment: HistoryAttachment): Promise<{
  delivery: AttachmentDelivery;
  image?: Image;
}> {
  if (attachment.status !== "available") {
    return { delivery: { status: attachment.status, reason: attachment.reason, file: null } };
  }
  const { sha256, byteLength, mimeType } = attachment;
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256) || !byteLength || !Number.isInteger(byteLength)
    || byteLength < 1 || byteLength > maxImageBytes || !mimeType || !Object.hasOwn(extensions, mimeType)) {
    return { delivery: { status: "unavailable", reason: "INVALID_LOCAL_IMAGE_REFERENCE", file: null } };
  }
  const path = join(`${store.path}.assets`, sha256);
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== byteLength) {
      return { delivery: { status: "unavailable", reason: "LOCAL_IMAGE_INTEGRITY_FAILED", file: null } };
    }
    // Read at most the recorded length plus one byte, even if the file changes after stat.
    const bytes = Buffer.alloc(byteLength + 1);
    const handle = await open(path, "r");
    let length = 0;
    try {
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
    } finally {
      await handle.close();
    }
    const original = bytes.subarray(0, length);
    if (length !== byteLength || createHash("sha256").update(original).digest("hex") !== sha256) {
      return { delivery: { status: "unavailable", reason: "LOCAL_IMAGE_INTEGRITY_FAILED", file: null } };
    }
    const file = `${sha256}.${extensions[mimeType as ImageMime]}`;
    return { image: { file, bytes: original }, delivery: { status: "exported", file, reason: null } };
  } catch (error) {
    if (historyErrorCode(error) === "ENOENT") {
      return { delivery: { status: "missing", reason: "LOCAL_IMAGE_MISSING", file: null } };
    }
    return { delivery: { status: "unavailable", reason: "LOCAL_IMAGE_UNREADABLE", file: null } };
  }
}

// Split a single unusually large record losslessly. Each fragment is itself valid JSON.
function* fragments(record: HistoryMaterialRecord, json: string, budget: number) {
  let offset = 0;
  while (offset < json.length) {
    let lower = 1;
    let upper = Math.min(budget, json.length - offset);
    let best = "";
    let size = 0;
    while (lower <= upper) {
      const length = Math.floor((lower + upper) / 2);
      let end = offset + length;
      const next = json.charCodeAt(end);
      // Keep surrogate pairs together for readers that decode each JSON string independently.
      if (next >= 0xdc00 && next <= 0xdfff) end--;
      const encoded = JSON.stringify({
        type: "fragment", recordType: record.type, position: record.position,
        offset, final: end === json.length, data: json.slice(offset, end),
      } satisfies RecordFragment);
      if (Buffer.byteLength(encoded) <= budget) {
        best = encoded;
        size = end - offset;
        lower = length + 1;
      } else {
        upper = length - 1;
      }
    }
    if (!size) throw new HistoryError("MATERIAL_RECORD_TOO_LARGE");
    yield best;
    offset += size;
  }
}

function partWriter(directory: string, batchId: string, maxJsonBytes: number, signal?: AbortSignal) {
  let part = 1;
  let records: string[] = [];
  let jsonBytes = 0;
  let imageBytes = 0;
  const imageFiles = new Set<string>();
  const prefix = (part: number, nextPart: number | null) =>
    JSON.stringify({ schemaVersion, batchId, part, nextPart }).slice(0, -1) + ',"records":[\n';
  const suffix = "\n]}\n";
  // Allow the part numbers to grow without changing the space available for fragments.
  const recordBudget = maxJsonBytes - Buffer.byteLength(prefix(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) + suffix);

  async function flush(nextPart: number | null) {
    checked(signal);
    const name = partName(part);
    const folder = join(directory, name);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(join(folder, name + ".json"), prefix(part, nextPart) + records.join(",\n") + suffix,
      { flag: "wx", mode: 0o600 });
    records = [];
    jsonBytes = 0;
    imageBytes = 0;
    imageFiles.clear();
  }

  async function appendJson(json: string, image?: Image) {
    const bytes = Buffer.byteLength(json);
    const newImage = image && !imageFiles.has(image.file);
    if (records.length && (jsonBytes + 2 + bytes > recordBudget
      || newImage && (imageFiles.size === maxPartImages || imageBytes + image.bytes.length > maxPartImageBytes))) {
      await flush(part + 1);
      part++;
    }
    checked(signal);
    if (image && !imageFiles.has(image.file)) {
      const folder = join(directory, partName(part));
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await writeFile(join(folder, image.file), image.bytes, { flag: "wx", mode: 0o600 });
      imageFiles.add(image.file);
      imageBytes += image.bytes.length;
    }
    jsonBytes += bytes + (records.length ? 2 : 0);
    records.push(json);
    return part;
  }

  return {
    async append(record: HistoryMaterialRecord, image?: Image) {
      const json = JSON.stringify(record);
      if (Buffer.byteLength(json) <= recordBudget) return appendJson(json, image);
      let firstPart: number | undefined;
      for (const fragment of fragments(record, json, recordBudget)) {
        const fragmentPart = await appendJson(fragment);
        firstPart ??= fragmentPart;
      }
      return firstPart!;
    },
    async finish() {
      await flush(null);
      return part;
    },
  };
}

function sameObservation(a: Pick<SourceLocation, "digest" | "entryPath" | "ordinal">, b: SourceLocation) {
  return a.digest === b.digest && a.entryPath === b.entryPath && a.ordinal === b.ordinal;
}

export async function exportMaterialBatch(store: HistoryStore, batchId: string, output: string,
  { maxJsonKiB = 64, signal }: { maxJsonKiB?: number; signal?: AbortSignal } = {}) {
  if (!Number.isInteger(maxJsonKiB) || maxJsonKiB < 16 || maxJsonKiB > 256) {
    throw new HistoryError("INVALID_MATERIAL_JSON_LIMIT");
  }
  checked(signal);
  let page = store.readBatch(batchId, { limit: 50 });
  if (!page) throw new HistoryError("HISTORY_BATCH_NOT_FOUND");
  if (!page.batch.count) throw new HistoryError("HISTORY_BATCH_EMPTY");
  const { id, createdAt, label, count, schemaVersion: batchSchemaVersion } = page.batch;
  const path = resolve(output);
  await requireNewDirectory(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(dirname(path), ".hkb-material-"));
  let published = false;
  try {
    const jsonBytesPerPart = maxJsonKiB * 1024;
    const writer = partWriter(staging, id, jsonBytesPerPart, signal);
    const attachmentCounts = { exported: 0, missing: 0, unavailable: 0 };
    let diagnosticCount = 0;
    let position = 0;
    let observation: Observation | null = null;
    let observationPosition = 0;

    async function finishObservation() {
      if (!observation) return;
      for (const node of observation.structuralNodes) {
        await writer.append({ type: "node", position: observationPosition, node });
      }
      for (const { code, path } of observation.issues) {
        await writer.append({ type: "diagnostic", position: observationPosition, code, path });
        diagnosticCount++;
      }
    }

    while (page) {
      for (const message of page.items) {
        checked(signal);
        position++;
        if (!observation || !sameObservation(observation.conversation, message.location)) {
          await finishObservation();
          observation = store.getMaterialObservation(message.location);
          if (!observation) throw new HistoryError("MATERIAL_OBSERVATION_NOT_FOUND");
          observationPosition = position;
          await writer.append({ type: "observation", position, conversation: observation.conversation });
        }
        const messagePart = await writer.append({ type: "message", position, observationPosition, message });
        for (const [attachmentIndex, attachment] of message.attachments.entries()) {
          checked(signal);
          const { image, delivery } = await readAttachment(store, attachment);
          await writer.append({ type: "attachment", position, messagePart, attachmentIndex, ...delivery }, image);
          attachmentCounts[delivery.status]++;
        }
      }
      page = page.nextCursor ? store.readBatch(batchId, { limit: 50, after: page.nextCursor }) : null;
    }
    await finishObservation();
    if (position !== count) throw new HistoryError("MATERIAL_BATCH_COUNT_MISMATCH");
    const partCount = await writer.finish();
    const manifest: HistoryMaterialManifest = {
      schemaVersion,
      batch: { schemaVersion: batchSchemaVersion, id, createdAt, label, count },
      partCount,
      attachmentCounts,
      diagnosticCount,
      limits: { jsonBytesPerPart, imageBytesPerPart: maxPartImageBytes, imagesPerPart: maxPartImages },
    };
    await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(join(staging, "CHATGPT.md"), await readFile(new URL("./material-task.md", import.meta.url)),
      { flag: "wx", mode: 0o600 });
    for (const name of ["question-import-v1", "question-import-v1.1", "learning-import-v1.2"]) {
      const file = name + ".schema.json";
      await writeFile(join(staging, file), await readFile(new URL(`../contracts/${file}`, import.meta.url)),
        { flag: "wx", mode: 0o600 });
    }
    await publishDirectory(staging, path, signal);
    published = true;
    return { schemaVersion, batchId: id, output: path, messageCount: count, partCount, attachmentCounts, diagnosticCount };
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true, maxRetries: 4 });
  }
}
