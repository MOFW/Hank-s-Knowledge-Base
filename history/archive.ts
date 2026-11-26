import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const readSize = 64 * 1024;
const maxInputBytes = 8 * GiB;
const maxEntryBytes = 2 * GiB;
const maxExpandedBytes = 16 * GiB;
const maxDirectoryBytes = 16 * MiB;
const maxEntries = 40_000;
const maxPathBytes = 1024;
const maxCompressionRatio = 500;

// Headers and offsets follow PKWARE APPNOTE, sections 4.3 and 4.5.
const endSignature = 0x06054b50;
const zip64EndSignature = 0x06064b50;
const zip64LocatorSignature = 0x07064b50;
const centralSignature = 0x02014b50;
const localSignature = 0x04034b50;
const descriptorSignature = 0x08074b50;
const classicMax = 0xffffffff;
const shortMax = 0xffff;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const archiveErrors = {
  INPUT_KIND: "Provide a ChatGPT export ZIP or a conversation JSON file.",
  INPUT_OPEN: "Could not open or read the input file.",
  INPUT_SIZE: "Input is not a regular file or exceeds the import size limit.",
  INPUT_CHANGED: "Input changed while it was being read.",
  IMPORT_INTERRUPTED: "History import was interrupted.",
  ZIP_FORMAT: "ZIP structure or entry metadata is invalid.",
  ZIP_UNSUPPORTED: "Unsupported ZIP layout, compression, encryption or entry type.",
  ZIP_LIMIT: "ZIP exceeds the import limits for entry count, size or compression ratio.",
  ZIP_PATH: "ZIP entry name is unsafe or duplicated.",
  ZIP_ENCODING: "ZIP entry name is not valid UTF-8.",
  ZIP_INTEGRITY: "ZIP entry failed its decompression, size or CRC check.",
};

export class HistoryArchiveError extends Error {
  readonly code: keyof typeof archiveErrors;

  constructor(code: keyof typeof archiveErrors) {
    super(archiveErrors[code]);
    this.name = "HistoryArchiveError";
    this.code = code;
  }
}

export interface HistoryEntry {
  path: string;
  size: number;
  open(): AsyncIterable<Uint8Array>;
}

export interface HistoryInput {
  digest: string;
  kind: "zip" | "json";
  entries: HistoryEntry[];
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
}

interface ZipEntry {
  path: string;
  directory: boolean;
  method: number;
  flags: number;
  checksum: number;
  compressedSize: number;
  size: number;
  offset: number;
  zip64Size: boolean;
}

function number64(bytes: Buffer, offset: number) {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new HistoryArchiveError("ZIP_LIMIT");
  return Number(value);
}

async function readExact(file: FileHandle, offset: number, size: number) {
  const bytes = Buffer.allocUnsafe(size);
  let cursor = 0;
  while (cursor < size) {
    const { bytesRead } = await file.read(bytes, cursor, size - cursor, offset + cursor).catch(() => {
      throw new HistoryArchiveError("INPUT_OPEN");
    });
    if (!bytesRead) throw new HistoryArchiveError("INPUT_CHANGED");
    cursor += bytesRead;
  }
  return bytes;
}

async function* readRange(file: FileHandle, offset: number, size: number) {
  for (let cursor = 0; cursor < size; cursor += readSize) {
    yield await readExact(file, offset + cursor, Math.min(readSize, size - cursor));
  }
}

function extraField(extra: Buffer, id: number): Buffer | undefined {
  for (let cursor = 0; cursor < extra.length;) {
    if (cursor + 4 > extra.length) throw new HistoryArchiveError("ZIP_FORMAT");
    const fieldId = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + size > extra.length) throw new HistoryArchiveError("ZIP_FORMAT");
    if (fieldId === id) return extra.subarray(cursor, cursor + size);
    cursor += size;
  }
}

function safePath(path: string) {
  const parts = path.replace(/\/$/, "").split("/");
  if (parts.some(part =>
    !part || part.length > 255 || /[\\:<>?"*|\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(part) ||
    /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
  )) throw new HistoryArchiveError("ZIP_PATH");
  return path;
}

function zipPath(bytes: Buffer) {
  if (bytes.length > maxPathBytes) throw new HistoryArchiveError("ZIP_LIMIT");
  let path: string;
  try {
    path = decoder.decode(bytes);
  } catch {
    throw new HistoryArchiveError("ZIP_ENCODING");
  }
  return safePath(path);
}

async function directoryLocation(file: FileHandle, fileSize: number) {
  const tailLength = Math.min(22 + shortMax, fileSize);
  const tailStart = fileSize - tailLength;
  const tail = await readExact(file, tailStart, tailLength);
  let end = tailLength - 22;
  while (end >= 0 && !(tail.readUInt32LE(end) === endSignature &&
    end + 22 + tail.readUInt16LE(end + 20) === tailLength)) end--;
  if (end < 0) throw new HistoryArchiveError("ZIP_FORMAT");

  const disk = tail.readUInt16LE(end + 4);
  const directoryDisk = tail.readUInt16LE(end + 6);
  const diskEntries = tail.readUInt16LE(end + 8);
  let count = tail.readUInt16LE(end + 10);
  let size = tail.readUInt32LE(end + 12);
  let offset = tail.readUInt32LE(end + 16);
  let boundary = tailStart + end;
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== count) {
    throw new HistoryArchiveError("ZIP_UNSUPPORTED");
  }

  // Prefer a classic EOCD when it accounts for the whole directory.
  if (count === shortMax || size === classicMax || offset === classicMax || offset + size !== boundary) {
    const locatorOffset = boundary - 20;
    if (locatorOffset < 0) throw new HistoryArchiveError("ZIP_FORMAT");
    const locator = await readExact(file, locatorOffset, 20);
    if (locator.readUInt32LE(0) !== zip64LocatorSignature) throw new HistoryArchiveError("ZIP_FORMAT");
    if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
      throw new HistoryArchiveError("ZIP_UNSUPPORTED");
    }
    boundary = number64(locator, 8);
    if (boundary + 56 > locatorOffset) throw new HistoryArchiveError("ZIP_FORMAT");
    const record = await readExact(file, boundary, 56);
    if (record.readUInt32LE(0) !== zip64EndSignature ||
        boundary + 12 + number64(record, 4) !== locatorOffset) {
      throw new HistoryArchiveError("ZIP_FORMAT");
    }
    count = number64(record, 32);
    if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 ||
        number64(record, 24) !== count) throw new HistoryArchiveError("ZIP_UNSUPPORTED");
    size = number64(record, 40);
    offset = number64(record, 48);
  }

  if (count > maxEntries || size > maxDirectoryBytes) throw new HistoryArchiveError("ZIP_LIMIT");
  if (offset + size !== boundary) throw new HistoryArchiveError("ZIP_FORMAT");
  return { count, size, offset };
}

function entrySizes(header: Buffer, extra: Buffer, central: boolean) {
  let size = header.readUInt32LE(central ? 24 : 22);
  let compressedSize = header.readUInt32LE(central ? 20 : 18);
  let offset = central ? header.readUInt32LE(42) : 0;
  let disk = central ? header.readUInt16LE(34) : 0;
  const zip64Size = size === classicMax || compressedSize === classicMax;
  if (zip64Size || offset === classicMax || disk === shortMax) {
    const field = extraField(extra, 1);
    if (!field) throw new HistoryArchiveError("ZIP_FORMAT");
    let cursor = 0;
    const readSize64 = () => {
      if (cursor + 8 > field.length) throw new HistoryArchiveError("ZIP_FORMAT");
      const value = number64(field, cursor);
      cursor += 8;
      return value;
    };
    if (size === classicMax) size = readSize64();
    if (compressedSize === classicMax) compressedSize = readSize64();
    if (offset === classicMax) offset = readSize64();
    if (disk === shortMax) {
      if (cursor + 4 > field.length) throw new HistoryArchiveError("ZIP_FORMAT");
      disk = field.readUInt32LE(cursor);
    }
  }
  if (disk !== 0) throw new HistoryArchiveError("ZIP_UNSUPPORTED");
  if (size > maxEntryBytes || compressedSize > maxEntryBytes ||
      size > compressedSize * maxCompressionRatio) throw new HistoryArchiveError("ZIP_LIMIT");
  return { size, compressedSize, offset, zip64Size };
}

function centralEntry(header: Buffer, name: Buffer, extra: Buffer): ZipEntry {
  const path = zipPath(name);
  const directory = path.endsWith("/");
  const method = header.readUInt16LE(10);
  const flags = header.readUInt16LE(8);
  const host = header[5];
  const mode = header.readUInt16LE(40) & 0xf000;
  const allowedFlags = 0x0808 | (method === 8 ? 0x0006 : 0);
  if ((flags & ~allowedFlags) || (method !== 0 && method !== 8) ||
      ((host === 3 || host === 19) && mode && mode !== (directory ? 0x4000 : 0x8000))) {
    throw new HistoryArchiveError("ZIP_UNSUPPORTED");
  }
  const sizes = entrySizes(header, extra, true);
  if ((directory && sizes.size !== 0) || (method === 0 && sizes.size !== sizes.compressedSize)) {
    throw new HistoryArchiveError("ZIP_FORMAT");
  }
  return { path, directory, method, flags, checksum: header.readUInt32LE(16), ...sizes };
}

async function zipDirectory(file: FileHandle, fileSize: number) {
  const location = await directoryLocation(file, fileSize);
  const bytes = await readExact(file, location.offset, location.size);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let expandedBytes = 0;
  let cursor = 0;
  for (let i = 0; i < location.count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== centralSignature) {
      throw new HistoryArchiveError("ZIP_FORMAT");
    }
    const header = bytes.subarray(cursor, cursor + 46);
    const nameStart = cursor + 46;
    const extraStart = nameStart + header.readUInt16LE(28);
    const extraEnd = extraStart + header.readUInt16LE(30);
    cursor = extraEnd + header.readUInt16LE(32);
    if (cursor > bytes.length) throw new HistoryArchiveError("ZIP_FORMAT");
    const entry = centralEntry(header, bytes.subarray(nameStart, extraStart), bytes.subarray(extraStart, extraEnd));
    const key = entry.path.replace(/\/$/, "").normalize("NFC").toLowerCase();
    if (names.has(key)) throw new HistoryArchiveError("ZIP_PATH");
    names.add(key);
    expandedBytes += entry.size;
    if (expandedBytes > maxExpandedBytes) throw new HistoryArchiveError("ZIP_LIMIT");
    entries.push(entry);
  }
  if (cursor !== bytes.length) throw new HistoryArchiveError("ZIP_FORMAT");
  entries.sort((a, b) => a.offset - b.offset);
  const ranges = entries.map((entry, i) => {
    const boundary = entries[i + 1]?.offset ?? location.offset;
    if (entry.offset + 30 + Buffer.byteLength(entry.path) + entry.compressedSize > boundary) {
      throw new HistoryArchiveError("ZIP_FORMAT");
    }
    return { entry, boundary };
  });
  return ranges.filter(({ entry }) => !entry.directory);
}

async function checkDescriptor(
  file: FileHandle, entry: ZipEntry, offset: number, boundary: number, zip64: boolean,
) {
  const width = zip64 ? 8 : 4;
  const size = 4 + 2 * width;
  const available = Math.min(size + 4, boundary - offset);
  if (available < size) throw new HistoryArchiveError("ZIP_FORMAT");
  const bytes = await readExact(file, offset, available);
  const matches = (start: number) => {
    if (bytes.readUInt32LE(start) !== entry.checksum) return false;
    if (zip64) {
      return bytes.readBigUInt64LE(start + 4) === BigInt(entry.compressedSize) &&
        bytes.readBigUInt64LE(start + 12) === BigInt(entry.size);
    }
    return bytes.readUInt32LE(start + 4) === entry.compressedSize &&
      bytes.readUInt32LE(start + 8) === entry.size;
  };
  if (!matches(0) && !(available === size + 4 && bytes.readUInt32LE(0) === descriptorSignature && matches(4))) {
    throw new HistoryArchiveError("ZIP_FORMAT");
  }
}

async function localDataStart(file: FileHandle, entry: ZipEntry, boundary: number) {
  const header = await readExact(file, entry.offset, 30);
  if (header.readUInt32LE(0) !== localSignature || header.readUInt16LE(6) !== entry.flags ||
      header.readUInt16LE(8) !== entry.method) throw new HistoryArchiveError("ZIP_FORMAT");
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const start = entry.offset + 30 + nameLength + extraLength;
  if (nameLength !== Buffer.byteLength(entry.path) || start + entry.compressedSize > boundary) {
    throw new HistoryArchiveError("ZIP_FORMAT");
  }
  const variable = await readExact(file, entry.offset + 30, nameLength + extraLength);
  if (!variable.subarray(0, nameLength).equals(Buffer.from(entry.path))) {
    throw new HistoryArchiveError("ZIP_FORMAT");
  }
  if (entry.flags & 8) {
    const localZip64 = header.readUInt32LE(18) === classicMax || header.readUInt32LE(22) === classicMax ||
      !!extraField(variable.subarray(nameLength), 1);
    await checkDescriptor(file, entry, start + entry.compressedSize, boundary, entry.zip64Size || localZip64);
  } else {
    const sizes = entrySizes(header, variable.subarray(nameLength), false);
    if (header.readUInt32LE(14) !== entry.checksum || sizes.size !== entry.size ||
        sizes.compressedSize !== entry.compressedSize) throw new HistoryArchiveError("ZIP_FORMAT");
  }
  return start;
}

async function* readZipEntry(file: FileHandle, entry: ZipEntry, boundary: number) {
  const start = await localDataStart(file, entry, boundary);
  const input = readRange(file, start, entry.compressedSize);
  const inflate = entry.method === 8 ? createInflateRaw() : null;
  const completion = inflate && pipeline(Readable.from(input, { objectMode: false }), inflate)
    .then(() => undefined, (error: unknown) => error);
  let size = 0;
  let checksum = 0;
  try {
    for await (const chunk of inflate ?? input) {
      size += chunk.length;
      if (size > entry.size) throw new HistoryArchiveError("ZIP_INTEGRITY");
      checksum = crc32(chunk, checksum);
      yield chunk;
    }
    const error = await completion;
    if (error) throw error;
  } catch (error) {
    if (error instanceof HistoryArchiveError) throw error;
    throw new HistoryArchiveError("ZIP_INTEGRITY");
  } finally {
    inflate?.destroy();
    await completion;
  }
  if (size !== entry.size || checksum !== entry.checksum ||
      (inflate && inflate.bytesWritten !== entry.compressedSize)) {
    throw new HistoryArchiveError("ZIP_INTEGRITY");
  }
}

export function isConversationEntry(path: string) {
  return /(?:^|\/)conversations(?:[-_][^/]+)?\.json$/i.test(path);
}

export async function openHistoryInput(path: string, signal?: AbortSignal): Promise<HistoryInput> {
  const extension = extname(path).toLowerCase();
  const kind = extension === ".zip" ? "zip" : extension === ".json" ? "json" : null;
  if (!kind) throw new HistoryArchiveError("INPUT_KIND");

  function assertNotInterrupted() {
    if (signal?.aborted) throw new HistoryArchiveError("IMPORT_INTERRUPTED");
  }

  let file: FileHandle | undefined;
  try {
    assertNotInterrupted();
    const opened = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    file = opened;
    const original = await opened.stat({ bigint: true });
    if (!original.isFile() || original.size > BigInt(kind === "json" ? maxEntryBytes : maxInputBytes)) {
      throw new HistoryArchiveError("INPUT_SIZE");
    }
    const size = Number(original.size);
    async function assertUnchanged() {
      const current = await opened.stat({ bigint: true }).catch(() => {
        throw new HistoryArchiveError("INPUT_OPEN");
      });
      if (original.size !== current.size || original.mtimeNs !== current.mtimeNs || original.ctimeNs !== current.ctimeNs) {
        throw new HistoryArchiveError("INPUT_CHANGED");
      }
    }
    function guarded(path: string, size: number, bytes: () => AsyncIterable<Uint8Array>): HistoryEntry {
      return {
        path, size,
        async *open() {
          try {
            assertNotInterrupted();
            await assertUnchanged();
            for await (const chunk of bytes()) {
              assertNotInterrupted();
              yield chunk;
            }
            assertNotInterrupted();
            await assertUnchanged();
          } catch (error) {
            if (error instanceof HistoryArchiveError) throw error;
            throw new HistoryArchiveError("INPUT_OPEN");
          }
        },
      };
    }
    const entries = kind === "zip"
      ? (await zipDirectory(opened, size)).map(({ entry, boundary }) =>
        guarded(entry.path, entry.size, () => readZipEntry(opened, entry, boundary)))
      : [guarded(safePath(basename(path)), size, () => readRange(opened, 0, size))];
    const hash = createHash("sha256");
    for await (const bytes of readRange(opened, 0, size)) {
      assertNotInterrupted();
      hash.update(bytes);
    }
    assertNotInterrupted();
    await assertUnchanged();
    return { digest: hash.digest("hex"), kind, entries, assertUnchanged, close: () => opened.close() };
  } catch (error) {
    await file?.close().catch(() => {});
    if (error instanceof HistoryArchiveError) throw error;
    throw new HistoryArchiveError("INPUT_OPEN");
  }
}
