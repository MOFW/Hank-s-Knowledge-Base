import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import { HistoryError, type HistoryIssue } from "./types.ts";

const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_RECORD_SEPARATORS = 500_000;
const whitespace = /[\t\n\r ]/;

export interface ConversationRecord {
  ordinal: number;
  rawJson: string;
  rawPath: string;
  value: unknown;
  issue?: HistoryIssue;
}

async function* decodeUtf8(bytes: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (chunk?: Uint8Array) => {
    try {
      return decoder.decode(chunk, { stream: chunk !== undefined });
    } catch {
      throw new HistoryError("JSON_INVALID_ENCODING");
    }
  };
  for await (const chunk of bytes) yield decode(chunk);
  yield decode();
}

// A second pass over validated JSON catches duplicate object keys before the
// caller sees JSON.parse's last-key-wins view of the original record.
function hasDuplicateKeys(json: string) {
  const scopes: (Set<string> | null)[] = [];
  for (let offset = 0; offset < json.length; offset += 1) {
    switch (json[offset]) {
      case '{': scopes.push(new Set()); break;
      case '[': scopes.push(null); break;
      case '}':
      case ']': scopes.pop(); break;
      case '"': {
        const start = offset;
        offset += 1;
        while (json[offset] !== '"') offset += json[offset] === '\\' ? 2 : 1;
        const keys = scopes.at(-1);
        if (!keys) break;
        let after = offset + 1;
        while (after < json.length && whitespace.test(json[after])) after += 1;
        if (json[after] !== ':') break;
        const key = JSON.parse(json.slice(start, offset + 1)) as string;
        if (keys.has(key)) return true;
        keys.add(key);
        break;
      }
    }
  }
  return false;
}

function parseRecord(rawJson: string, ordinal: number, rawPath: string): ConversationRecord {
  const record = { ordinal, rawJson, rawPath, value: undefined as unknown };
  try {
    const value: unknown = JSON.parse(rawJson);
    if (hasDuplicateKeys(rawJson)) return { ...record, issue: { code: "DUPLICATE_JSON_KEY", path: "" } };
    return { ...record, value };
  } catch {
    return { ...record, issue: { code: "INVALID_CONVERSATION_JSON", path: "" } };
  }
}

/** Frame one array member at a time, or one standalone object. */
export async function* parseConversations(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<ConversationRecord> {
  let state: 'root' | 'first' | 'next' | 'value' | 'boundary' | 'complete' = 'root';
  let array = false;
  let ordinal = 0;
  let quoted = false;
  let escaped = false;
  let endWhenUnnested = false;
  let parts: string[] = [];
  let blocks: string[] = [];
  let storedBytes = 0;
  let separators = 0;
  const closing: string[] = [];

  function append(part: string) {
    if (!part) return;
    storedBytes += Buffer.byteLength(part);
    if (storedBytes > MAX_RECORD_BYTES) throw new HistoryError("JSON_CONVERSATION_TOO_LARGE");
    parts.push(part);
    // Bound the list overhead even if a stream delivers one byte at a time.
    if (parts.length >= 2_048) {
      blocks.push(parts.join(''));
      parts = [];
    }
  }

  for await (const chunk of decodeUtf8(bytes)) {
    let begin = state === 'value' ? 0 : -1;
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (state !== 'value') {
        if (whitespace.test(char)) continue;
        if (state === 'root' && char === '[') {
          array = true;
          state = 'first';
          continue;
        }
        if ((state === 'first' || state === 'boundary') && char === ']') {
          state = 'complete';
          continue;
        }
        if (state === 'boundary' && char === ',') {
          state = 'next';
          continue;
        }
        if (state === 'root' && char !== '{') throw new HistoryError("JSON_UNSUPPORTED_ROOT");
        if (state === 'complete' || state === 'boundary' || char === ',' || char === ']') {
          throw new HistoryError("JSON_INVALID_STRUCTURE");
        }
        state = 'value';
        begin = index;
        endWhenUnnested = char === '{' || char === '[' || char === '"';
      }

      let end = index + 1;
      let scalarEnded = false;
      if (!quoted && (char === ',' || char === ':' || char === '[' || char === '{')) {
        separators += 1;
        if (separators > MAX_RECORD_SEPARATORS) throw new HistoryError("JSON_CONVERSATION_ITEM_LIMIT");
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === '{' || char === '[') {
        closing.push(char === '{' ? '}' : ']');
        if (closing.length > MAX_DEPTH) throw new HistoryError("JSON_CONVERSATION_NESTING_LIMIT");
      } else if (closing.length && (char === '}' || char === ']')) {
        if (closing.pop() !== char) throw new HistoryError("JSON_INVALID_STRUCTURE");
      } else if (!endWhenUnnested && !closing.length && (char === ',' || char === ']' || whitespace.test(char))) {
        end = index;
        index -= 1;
        scalarEnded = true;
      }

      // Scalar values stop before the delimiter so the array grammar sees it.
      if (!quoted && closing.length === 0 && (endWhenUnnested || scalarEnded)) {
        append(chunk.slice(begin, end));
        const rawPath = array ? `/${ordinal}` : '';
        yield parseRecord([...blocks, parts.join('')].join(''), ordinal, rawPath);
        ordinal += 1;
        parts = [];
        blocks = [];
        storedBytes = 0;
        separators = 0;
        begin = -1;
        state = array ? 'boundary' : 'complete';
      }
    }
    if (begin !== -1) append(chunk.slice(begin));
  }
  if (state !== 'complete') throw new HistoryError("JSON_INVALID_STRUCTURE");
}
