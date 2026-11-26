import {
  HistoryError,
  type HistoryAttachmentRef,
  type HistoryIssue,
  type HistoryMessage,
  type HistoryNode,
  type HistoryTime,
  type NormalizedConversation,
} from "./types.ts";

export { parseConversations } from "./json-stream.ts";

type JsonObject = Record<string, unknown>;
type RecordIssue = (code: string, path: string) => void;

const MAX_NODES = 20_000;
const MAX_ATTACHMENTS = 4_096;
const MAX_ISSUES = 2_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/i;
const ROLES = new Set(["user", "assistant", "system", "tool", "developer", "function"]);
const TEXT_TYPES = new Set([
  "text", "multimodal_text", "code", "execution_output", "audio_transcription",
  "reasoning_recap", "tether_quote", "tether_browsing_display", "system_error",
  "input_text", "output_text",
]);

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value : null;
}

function normalizedText(value: string, path: string, issue: RecordIssue) {
  if (value.isWellFormed()) return value;
  issue("INVALID_UNICODE_TEXT", path);
  return value.toWellFormed();
}

function identifier(value: unknown) {
  const candidate = string(value);
  return candidate && candidate.trim() && candidate.length <= 512 && /^[^\p{Cc}\p{Cs}]+$/u.test(candidate)
    ? candidate : null;
}

function pathPart(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function validDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

function timestamp(value: unknown, path: string, issue: RecordIssue, required: boolean): HistoryTime {
  const raw = typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? value : null;
  if (typeof raw === "number") {
    const milliseconds = Math.abs(raw) >= 1e12;
    const epochMilliseconds = milliseconds ? raw : raw * 1000;
    const date = new Date(epochMilliseconds);
    if (Number.isFinite(date.valueOf()) && date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999) {
      const fraction = raw.toString().match(/\.(\d+)/)?.[1]?.length ?? 0;
      const precision = milliseconds
        ? (fraction ? "submillisecond" : "millisecond")
        : (fraction > 3 ? "submillisecond" : fraction || !Number.isInteger(raw) ? "millisecond" : "second");
      return { iso: date.toISOString(), precision, raw };
    }
  } else if (typeof raw === "string") {
    if (DAY.test(raw) && validDay(raw)) return { iso: raw, precision: "date", raw };
    const match = ZONED_TIME.exec(raw);
    if (match && validDay(match[1]) && !/T24:/i.test(raw)) {
      const date = new Date(raw);
      if (Number.isFinite(date.valueOf()) && date.getUTCFullYear() >= 0 && date.getUTCFullYear() <= 9999) {
        const precision = !match[2] ? "second" : match[2].length <= 3 ? "millisecond" : "submillisecond";
        return { iso: date.toISOString(), precision, raw };
      }
    }
  }
  if (value !== undefined && value !== null) issue("INVALID_TIMESTAMP", path);
  else if (required) issue("MISSING_TIMESTAMP", path);
  return { iso: null, precision: "unknown", raw };
}

function recordTime(fields: JsonObject, path: string, key: "create_time" | "update_time", issue: RecordIssue) {
  const alias = key === "create_time" ? "created_at" : "updated_at";
  const chosen = fields[key] == null && Object.hasOwn(fields, alias) ? alias : key;
  return timestamp(fields[chosen], `${path}/${chosen}`, issue, key === "create_time");
}

function attachmentKind(type: string | null, mimeType: string | null, name: string | null, fallback: HistoryAttachmentRef["kind"]) {
  const hint = type ?? "";
  if (hint.startsWith("image") || mimeType?.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|heic|avif|svg|bmp|tiff?)$/i.test(name ?? "")) return "image";
  if (hint.startsWith("audio") || mimeType?.startsWith("audio/")) return "audio";
  if (hint.startsWith("video") || mimeType?.startsWith("video/")) return "video";
  if (hint.startsWith("file")) return "file";
  return fallback;
}

function attachment(value: unknown, rawPath: string, fallback: HistoryAttachmentRef["kind"], issue: RecordIssue): HistoryAttachmentRef {
  const fields = object(value);
  const pointer = identifier(fields?.asset_pointer) ?? identifier(fields?.audio_asset_pointer)
    ?? identifier(fields?.video_asset_pointer) ?? identifier(fields?.file_id) ?? identifier(fields?.id)
    ?? identifier(fields?.path) ?? identifier(value);
  const name = identifier(fields?.name) ?? identifier(fields?.file_name) ?? identifier(fields?.filename);
  const mimeType = identifier(fields?.mime_type) ?? identifier(fields?.mimeType);
  const type = identifier(fields?.content_type) ?? identifier(fields?.type);
  if (!pointer && !name) issue("UNRESOLVED_ATTACHMENT_REFERENCE", rawPath);
  return { kind: attachmentKind(type, mimeType, name, fallback), pointer, name, mimeType, rawPath };
}

function messageContent(message: JsonObject, rawPath: string, issue: RecordIssue, countAttachment: () => void) {
  const body: string[] = [];
  const attachments: HistoryAttachmentRef[] = [];
  const content = object(message.content);
  const contentPath = `${rawPath}/content`;
  const contentType = identifier(content?.content_type) ?? identifier(content?.type);

  function addAttachment(value: unknown, path: string, fallback: HistoryAttachmentRef["kind"]) {
    countAttachment();
    attachments.push(attachment(value, path, fallback, issue));
  }

  function addText(value: string, path: string) {
    body.push(normalizedText(value, path, issue));
  }

  function contentPart(value: unknown, path: string) {
    if (typeof value === "string") {
      addText(value, path);
      return;
    }
    const part = object(value);
    const type = identifier(part?.content_type) ?? identifier(part?.type);
    if (type === "real_time_user_audio_video_asset_pointer" && part) {
      addAttachment(part.audio_asset_pointer, `${path}/audio_asset_pointer`, "audio");
      if (Array.isArray(part.frames_asset_pointers)) {
        part.frames_asset_pointers.forEach((frame, index) => addAttachment(frame, `${path}/frames_asset_pointers/${index}`, "image"));
      }
      addAttachment(part.video_container_asset_pointer, `${path}/video_container_asset_pointer`, "video");
      issue("PARTIAL_AUDIO_VIDEO_CONTENT", path);
      return;
    }
    if (part && (type?.endsWith("asset_pointer") || part.asset_pointer !== undefined)) {
      addAttachment(part, path, "unknown");
      return;
    }
    const textKey = typeof part?.text === "string" ? "text" : "content";
    const text = string(part?.[textKey]);
    if (text !== null) addText(text, `${path}/${textKey}`);
    if (text === null || type && !TEXT_TYPES.has(type)) {
      issue("UNSUPPORTED_CONTENT_PART", path);
      if (text === null && part && (contentType === "multimodal_text" || type?.startsWith("image")
        || type?.startsWith("audio") || type?.startsWith("video"))) addAttachment(part, path, "unknown");
    }
  }

  if (typeof message.content === "string") {
    addText(message.content, contentPath);
  } else if (Array.isArray(message.content)) {
    message.content.forEach((part, index) => contentPart(part, `${contentPath}/${index}`));
  } else if (content) {
    if (Array.isArray(content.parts)) {
      content.parts.forEach((part, index) => contentPart(part, `${contentPath}/parts/${index}`));
    } else if (content.parts !== undefined) {
      issue("INVALID_CONTENT_PARTS", `${contentPath}/parts`);
    }
    if (!body.length) {
      const textKey = ["text", "content", "result", "summary"].find((key) => typeof content[key] === "string");
      if (textKey) addText(content[textKey] as string, `${contentPath}/${textKey}`);
      else if (contentType?.endsWith("asset_pointer") || content.asset_pointer !== undefined) contentPart(content, contentPath);
    }
    if (contentType && !TEXT_TYPES.has(contentType) && !contentType.endsWith("asset_pointer")) {
      issue("UNSUPPORTED_CONTENT_TYPE", contentPath);
    }
  } else {
    issue(message.content == null ? "MISSING_MESSAGE_CONTENT" : "INVALID_MESSAGE_CONTENT", contentPath);
  }

  const metadata = object(message.metadata);
  for (const [list, path] of [
    [message.attachments, `${rawPath}/attachments`],
    [metadata?.attachments, `${rawPath}/metadata/attachments`],
    [content?.attachments, `${contentPath}/attachments`],
  ] as const) {
    if (Array.isArray(list)) {
      list.forEach((ref, index) => addAttachment(ref, `${path}/${index}`, "file"));
    } else if (list !== undefined && list !== null) {
      issue("INVALID_ATTACHMENTS", path);
      addAttachment(list, path, "file");
    }
  }
  if (content && !body.length && !attachments.length) issue("NO_RECOVERABLE_MESSAGE_CONTENT", contentPath);
  return { contentType, attachments, body: body.join("\n") };
}

function normalizeMessage(value: JsonObject, id: string, path: string, issue: RecordIssue, countAttachment: () => void): HistoryMessage {
  const authorRole = object(value.author)?.role;
  const role = identifier(authorRole) ?? identifier(value.role) ?? "unknown";
  if (!ROLES.has(role)) issue(role === "unknown" ? "MISSING_OR_INVALID_ROLE" : "UNKNOWN_ROLE", `${path}/author/role`);
  return {
    id,
    role,
    created: recordTime(value, path, "create_time", issue),
    updated: recordTime(value, path, "update_time", issue),
    ...messageContent(value, path, issue, countAttachment),
    rawPath: path,
  };
}

type NodeInput = {
  node: HistoryNode;
  index: number;
  parent: unknown;
  children: string[];
  message: JsonObject | null;
  messagePath: string;
};

function collectNodes(conversation: JsonObject, issue: RecordIssue) {
  const mapping = object(conversation.mapping);
  const flat = !mapping && !Array.isArray(conversation.mapping) && Array.isArray(conversation.messages);
  const array = Array.isArray(conversation.mapping) ? conversation.mapping : flat ? conversation.messages as unknown[] : null;
  const nodes = new Map<string, NodeInput>();
  const aliases = new Map<string, string | null>();
  if (!mapping && !array) {
    issue("MISSING_OR_UNSUPPORTED_CONVERSATION_MAPPING", "/mapping");
    return { nodes, aliases, flat };
  }
  if (conversation.mapping != null && flat) issue("INVALID_MAPPING_USING_FLAT_MESSAGES", "/mapping");
  const entries = mapping ? Object.entries(mapping) : Object.entries(array ?? []);
  if (entries.length > MAX_NODES) throw new HistoryError("JSON_CONVERSATION_NODE_LIMIT");
  let previousId: string | null = null;

  entries.forEach(([key, value], index) => {
    const rawPath = `/${flat ? "messages" : "mapping"}/${pathPart(key)}`;
    const raw = object(value);
    if (!raw) {
      issue("INVALID_MAPPING_NODE", rawPath);
      return;
    }
    const embeddedId = identifier(raw.id);
    const nodeId = mapping ? identifier(key) : embeddedId;
    if (!nodeId) {
      issue("MISSING_OR_INVALID_NODE_ID", rawPath);
      return;
    }
    if (nodes.has(nodeId)) {
      issue("DUPLICATE_NODE_ID", rawPath);
      return;
    }
    if (embeddedId && embeddedId !== nodeId) {
      issue("MAPPING_NODE_ID_MISMATCH", `${rawPath}/id`);
      aliases.set(embeddedId, aliases.has(embeddedId) ? null : nodeId);
    }
    const bare = flat && !Object.hasOwn(raw, "message");
    const message = bare ? raw : object(raw.message);
    const messagePath = bare ? rawPath : `${rawPath}/message`;
    if (!message && raw.message !== null) issue(raw.message === undefined ? "MISSING_NODE_MESSAGE" : "INVALID_NODE_MESSAGE", messagePath);
    const children: string[] = [];
    if (Array.isArray(raw.children)) {
      raw.children.forEach((child: unknown, childIndex: number) => {
        const id = identifier(child);
        if (id) children.push(id);
        else issue("INVALID_CHILD_REFERENCE", `${rawPath}/children/${childIndex}`);
      });
    } else if (raw.children !== undefined) {
      issue("INVALID_CHILD_REFERENCES", `${rawPath}/children`);
    }
    nodes.set(nodeId, {
      node: { nodeId, rawPath, parentNodeId: null, childNodeIds: [], message: null, onCurrentBranch: false },
      index,
      parent: flat && !Object.hasOwn(raw, "parent") ? previousId : raw.parent,
      children,
      message,
      messagePath,
    });
    previousId = nodeId;
  });
  if (!entries.length) issue("EMPTY_CONVERSATION", flat ? "/messages" : "/mapping");
  return { nodes, aliases, flat };
}

function linkNodes(nodes: Map<string, NodeInput>, lookup: (id: string) => string | null, issue: RecordIssue) {
  const childClaims = new Map<string, string | null>();
  for (const { node, parent, children } of nodes.values()) {
    const parentId = identifier(parent);
    if (parentId) {
      node.parentNodeId = lookup(parentId);
      if (!node.parentNodeId) issue("UNKNOWN_PARENT_NODE", `${node.rawPath}/parent`);
    } else if (parent !== undefined && parent !== null) {
      issue("INVALID_PARENT_REFERENCE", `${node.rawPath}/parent`);
    }
    const seen = new Set<string>();
    for (const child of children) {
      const id = lookup(child);
      if (!id) {
        issue("UNKNOWN_CHILD_NODE", `${node.rawPath}/children`);
        continue;
      }
      if (seen.has(id)) {
        issue("DUPLICATE_CHILD_REFERENCE", `${node.rawPath}/children`);
        continue;
      }
      seen.add(id);
      childClaims.set(id, childClaims.has(id) ? null : node.nodeId);
    }
  }

  for (const [id, parent] of childClaims) {
    const entry = nodes.get(id)!;
    if (parent && entry.parent === undefined) {
      entry.node.parentNodeId = parent;
    } else if (!parent || parent !== entry.node.parentNodeId) {
      issue("CONFLICTING_PARENT_CHILD_RELATIONSHIP", entry.node.rawPath);
    }
  }

  // Break cycles iteratively so long conversations cannot exhaust the stack.
  const checked = new Set<string>();
  for (const id of [...nodes.keys()].sort()) {
    const chain = new Set<string>();
    let next: string | null = id;
    while (next && !checked.has(next)) {
      const node: HistoryNode = nodes.get(next)!.node;
      if (chain.has(next)) {
        node.parentNodeId = null;
        issue("CYCLIC_PARENT_RELATIONSHIP", `${node.rawPath}/parent`);
        break;
      }
      chain.add(next);
      next = node.parentNodeId;
    }
    for (const visited of chain) checked.add(visited);
  }
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderNodes(nodes: Map<string, NodeInput>, flat: boolean, lookup: (id: string) => string | null) {
  const roots: string[] = [];
  const compare = (left: string, right: string) => {
    const a = nodes.get(left)!;
    const b = nodes.get(right)!;
    if (flat) return a.index - b.index;
    return compareText(a.node.message?.created.iso ?? "~", b.node.message?.created.iso ?? "~") || compareText(left, right);
  };
  for (const { node } of nodes.values()) {
    if (node.parentNodeId) nodes.get(node.parentNodeId)!.node.childNodeIds.push(node.nodeId);
    else roots.push(node.nodeId);
  }
  for (const { node, children } of nodes.values()) {
    const declaredOrder = new Map<string, number>();
    children.forEach((child, index) => {
      const id = lookup(child);
      if (id && !declaredOrder.has(id)) declaredOrder.set(id, index);
    });
    node.childNodeIds.sort((a, b) => (declaredOrder.get(a) ?? Infinity) - (declaredOrder.get(b) ?? Infinity) || compare(a, b));
  }

  const ordered: HistoryNode[] = [];
  const stack = roots.sort(compare).reverse();
  while (stack.length) {
    const node = nodes.get(stack.pop()!)!.node;
    ordered.push(node);
    for (let i = node.childNodeIds.length - 1; i >= 0; i -= 1) stack.push(node.childNodeIds[i]);
  }
  return ordered;
}

export function normalizeConversation(value: unknown): NormalizedConversation {
  const issues: HistoryIssue[] = [];
  const issue = (code: string, path: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ code, path });
    else if (issues.length === MAX_ISSUES) issues.push({ code: "MORE_CONVERSATION_ISSUES", path: "" });
  };
  let attachmentCount = 0;
  const countAttachment = () => {
    attachmentCount += 1;
    if (attachmentCount > MAX_ATTACHMENTS) throw new HistoryError("JSON_CONVERSATION_ATTACHMENT_LIMIT");
  };
  const raw = object(value);
  if (!raw) issue("INVALID_CONVERSATION_RECORD", "");
  const fields = raw ?? {};
  const id = identifier(fields.conversation_id) ?? identifier(fields.id);
  if (!id) issue("MISSING_OR_INVALID_CONVERSATION_ID", "/conversation_id");
  if (identifier(fields.id) && identifier(fields.conversation_id) && fields.id !== fields.conversation_id) {
    issue("CONVERSATION_ID_MISMATCH", "/id");
  }
  const title = typeof fields.title === "string" ? normalizedText(fields.title, "/title", issue) : null;
  if (fields.title != null && title === null) issue("INVALID_CONVERSATION_TITLE", "/title");
  const created = recordTime(fields, "", "create_time", issue);
  const updated = recordTime(fields, "", "update_time", issue);

  const { nodes, aliases, flat } = collectNodes(fields, issue);
  const lookup = (key: string) => nodes.has(key) ? key : aliases.get(key) ?? null;
  linkNodes(nodes, lookup, issue);

  const explicitIds = new Set<string>();
  for (const { message } of nodes.values()) {
    const id = identifier(message?.id);
    if (id) explicitIds.add(id);
  }
  for (const { node, message, messagePath } of nodes.values()) {
    if (!message) continue;
    let messageId = identifier(message.id);
    if (!messageId) {
      issue("MESSAGE_ID_FROM_NODE", `${messagePath}/id`);
      if (explicitIds.has(node.nodeId)) {
        issue("FALLBACK_MESSAGE_ID_COLLISION", `${messagePath}/id`);
        continue;
      }
      messageId = node.nodeId;
    }
    node.message = normalizeMessage(message, messageId, messagePath, issue, countAttachment);
  }

  const current = identifier(fields.current_node);
  const currentNodeId = current ? lookup(current) : flat && fields.current_node == null ? [...nodes.keys()].at(-1) ?? null : null;
  if (fields.current_node != null && !currentNodeId) issue("INVALID_CURRENT_NODE", "/current_node");
  if (fields.current_node == null && !flat && nodes.size) issue("MISSING_CURRENT_NODE", "/current_node");
  for (let next = currentNodeId; next; next = nodes.get(next)!.node.parentNodeId) {
    nodes.get(next)!.node.onCurrentBranch = true;
  }
  const ordered = orderNodes(nodes, flat, lookup);
  const indexed = new Set<string>();
  for (const node of ordered) {
    if (!node.message) continue;
    if (indexed.has(node.message.id)) {
      issue("DUPLICATE_MESSAGE_ID", `${node.message.rawPath}/id`);
      node.message = null;
    } else {
      indexed.add(node.message.id);
    }
  }

  if (flat) {
    const pagination = object(fields.page_info);
    if (pagination?.has_previous_page === true || pagination?.has_next_page === true) issue("PARTIAL_MESSAGES_PAGE", "/page_info");
  }
  return { id, title, created, updated, currentNodeId, nodes: ordered, issues };
}
