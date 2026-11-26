export const maxImageBytes = 8 * 1024 * 1024;

function ascii(bytes: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...bytes.subarray(from, to));
}

function jpegEndAt(bytes: Uint8Array, offset: number) {
  return bytes[offset] === 0xff && bytes[offset + 1] === 0xd9;
}

function jpegHasEnd(bytes: Uint8Array) {
  if (jpegEndAt(bytes, bytes.length - 2)) return true;

  // Some original JPEGs in ChatGPT exports have a 24-byte trailer after EOI.
  // Match its observed 8-byte prefix and preserve all original bytes for hashing.
  const trailerStart = bytes.length - 24;
  return trailerStart >= 12 && jpegEndAt(bytes, trailerStart - 2)
    && [0xc2, 0x8b, 0xfc, 0x05, 0, 0, 0, 0].every((byte, index) => bytes[trailerStart + index] === byte);
}

export const imageSignatures = {
  "image/png": (bytes: Uint8Array) => bytes.length >= 33
    && [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((byte, index) => bytes[index] === byte),
  "image/jpeg": (bytes: Uint8Array) => bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216
    && bytes[2] === 255 && jpegHasEnd(bytes),
  "image/gif": (bytes: Uint8Array) => bytes.length >= 14 && bytes.at(-1) === 59
    && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)),
  "image/webp": (bytes: Uint8Array) => bytes.length >= 20 && ascii(bytes, 0, 4) === "RIFF"
    && ascii(bytes, 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(bytes, 12, 16))
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) === bytes.length - 8,
};

export type ImageMime = keyof typeof imageSignatures;
