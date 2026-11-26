import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { imageSignatures, maxImageBytes, type ImageMime } from "../lib/image-signatures.ts";
import { revisionLocatorPattern } from "../domain/history-reference.ts";
import type { HistoryMaterialPart, HistoryMaterialRecord } from "./material-package.ts";
import { HistoryError } from "./types.ts";

const extensions: Record<ImageMime, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};
const hashPattern = /^[0-9a-f]{64}$/;

export function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readBoundedFile(path: string, maxBytes: number) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new HistoryError("MATERIAL_FILE_LIMIT");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new HistoryError("MATERIAL_FILE_CHANGED");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function partName(part: number) {
  return `part-${String(part).padStart(6, "0")}`;
}

type Located<T extends HistoryMaterialRecord["type"]> = { part: number; record: Extract<HistoryMaterialRecord, { type: T }> };

export async function readMaterialSelection(root: string, selected: number[]) {
  const parts = [...new Set(selected)].sort((a, b) => a - b);
  if (!parts.length || parts.some((part) => !Number.isSafeInteger(part) || part < 1)) throw new HistoryError("MATERIAL_PARTS_REQUIRED");
  let batchId: string | undefined;
  let endPart: number | undefined;
  let previous = 0;
  let fragment: { part: number; offset: number; recordType: string; position: number; data: string[] } | undefined;
  const incomplete = new Set<number>();
  const messages = new Map<number, Located<"message">>();
  const attachments = new Map<string, Located<"attachment">>();

  function recordAt(part: number, record: HistoryMaterialRecord) {
    const { position } = record;
    if (!Number.isSafeInteger(position) || position < 1) throw new HistoryError("INVALID_MATERIAL_RECORD");
    switch (record.type) {
      case "message": {
        const message = record.message;
        if (messages.has(position) || !message || typeof message.role !== "string" || !message.role
          || typeof message.conversationId !== "string" || typeof message.messageId !== "string"
          || typeof message.body !== "string" || !Array.isArray(message.attachments) || !message.location
          || typeof message.revisionLocator !== "string" || !revisionLocatorPattern.test(message.revisionLocator)
          || message.contentHash !== digest(message.body)
          || message.sourceId !== digest(JSON.stringify([message.conversationId, message.messageId]))
          || message.locator !== `chatgpt:message:${message.sourceId}`
          || message.revisionLocator !== `${message.locator}@${message.revisionHash}`
          || message.revisionHash !== digest(JSON.stringify([message.contentHash, message.role, message.contentType,
            JSON.stringify(message.created), JSON.stringify(message.updated), message.attachments.map(
              ({ kind, pointer, name, mimeType, status, sha256 }) => [kind, pointer, name, mimeType, status, sha256],
            )]))) throw new HistoryError("INVALID_MATERIAL_MESSAGE");
        messages.set(position, { part, record });
        break;
      }
      case "attachment": {
        const key = `${position}:${record.attachmentIndex}`;
        if (attachments.has(key) || !Number.isSafeInteger(record.attachmentIndex) || record.attachmentIndex < 0
          || !Number.isSafeInteger(record.messagePart) || record.messagePart < 1 || record.messagePart > part
          || !["exported", "missing", "unavailable"].includes(record.status)) throw new HistoryError("INVALID_MATERIAL_ATTACHMENT");
        attachments.set(key, { part, record });
        break;
      }
      case "observation":
      case "node":
      case "diagnostic":
        break;
      default:
        throw new HistoryError("INVALID_MATERIAL_RECORD");
    }
  }

  for (const part of parts) {
    const name = partName(part);
    const bytes = await readBoundedFile(join(root, name, name + ".json"), 256 * 1024);
    const value = JSON.parse(bytes.toString("utf8")) as HistoryMaterialPart;
    if (value?.schemaVersion !== "history-material-package/v1" || value.part !== part || endPart !== undefined
      || typeof value.batchId !== "string" || !value.batchId || (batchId !== undefined && value.batchId !== batchId)
      || (value.nextPart !== null && value.nextPart !== part + 1) || !Array.isArray(value.records)) {
      throw new HistoryError("INVALID_MATERIAL_PART");
    }
    batchId = value.batchId;
    if (value.nextPart === null) endPart = part;
    if (part !== previous + 1 && fragment) {
      incomplete.add(fragment.position);
      fragment = undefined;
    }
    for (const record of value.records) {
      if (record?.type !== "fragment") {
        if (!record || fragment) throw new HistoryError("INVALID_MATERIAL_FRAGMENT");
        recordAt(part, record);
        continue;
      }
      const { offset, position, recordType, final, data } = record;
      if (typeof data !== "string" || !data.length || typeof final !== "boolean"
        || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(position) || position < 1) {
        throw new HistoryError("INVALID_MATERIAL_FRAGMENT");
      }
      if (offset === 0 && !fragment) fragment = { part, offset: 0, position, recordType, data: [] };
      if (!fragment) {
        incomplete.add(position);
        continue;
      }
      if (fragment.offset !== offset || fragment.position !== position || fragment.recordType !== recordType) {
        throw new HistoryError("INVALID_MATERIAL_FRAGMENT");
      }
      fragment.data.push(data);
      fragment.offset += data.length;
      if (final) {
        const decoded = JSON.parse(fragment.data.join("")) as HistoryMaterialRecord;
        if (decoded?.type !== recordType || decoded.position !== position) throw new HistoryError("INVALID_MATERIAL_FRAGMENT");
        recordAt(fragment.part, decoded);
        fragment = undefined;
      }
    }
    previous = part;
  }
  if (fragment) incomplete.add(fragment.position);
  return { batchId: batchId!, parts, messages, attachments, incompletePositions: [...incomplete].sort((a, b) => a - b) };
}

export type MaterialSelection = Awaited<ReturnType<typeof readMaterialSelection>>;

export async function readMaterialImage(root: string, selection: MaterialSelection, position: number, index: number) {
  const message = selection.messages.get(position);
  const attachment = message?.record.message.attachments[index];
  const delivery = selection.attachments.get(`${position}:${index}`);
  if (!attachment || attachment.kind !== "image" || attachment.status !== "available" || !delivery
    || delivery.record.status !== "exported" || delivery.record.messagePart !== message.part) {
    throw new HistoryError("MATERIAL_IMAGE_UNAVAILABLE");
  }
  const { sha256, mimeType, byteLength } = attachment;
  if (!sha256 || !hashPattern.test(sha256) || !mimeType || !Object.hasOwn(extensions, mimeType)
    || !byteLength || !Number.isInteger(byteLength) || byteLength < 1 || byteLength > maxImageBytes) {
    throw new HistoryError("INVALID_MATERIAL_IMAGE");
  }
  const mime = mimeType as ImageMime;
  const filename = `${sha256}.${extensions[mime]}`;
  if (filename !== delivery.record.file) throw new HistoryError("INVALID_MATERIAL_IMAGE");
  const bytes = await readBoundedFile(join(root, partName(delivery.part), filename), maxImageBytes);
  if (bytes.length !== byteLength || digest(bytes) !== sha256 || !imageSignatures[mime](bytes)) throw new HistoryError("INVALID_MATERIAL_IMAGE");
  return { filename, part: delivery.part, sha256, mimeType: mime, byteLength, bytes };
}
