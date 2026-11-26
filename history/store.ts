import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { HISTORY_APPLICATION_ID, HISTORY_SCHEMA_VERSION, historySchema } from "./store-schema.ts";
import { HistoryError } from "./types.ts";
import type { HistoryAttachment, HistoryIssue, HistoryNode, HistoryTime, NormalizedConversation } from "./types.ts";

type PageOptions = { limit?: number; after?: string };
type Page<T> = { items: T[]; nextCursor: string | null };

export type HistorySelection = {
  query?: string;
  title?: string;
  from?: string;
  to?: string;
  course?: string;
  topic?: string;
  conversationIds?: string[];
  hasImage?: boolean;
  hasMissing?: boolean;
  matchConversations?: boolean;
};

export type SourceLocation = {
  digest: string;
  entryPath: string;
  ordinal: number;
  conversationPath: string;
  nodePath: string;
  messagePath: string;
};

type OccurrenceFilter = Pick<SourceLocation, "digest"> & Partial<Pick<SourceLocation, "entryPath" | "ordinal">>;

export type HistoricalMessage = {
  sourceId: string;
  locator: string;
  revisionLocator: string;
  revisionHash: string;
  contentHash: string;
  conversationId: string;
  title: string | null;
  messageId: string;
  role: string;
  created: HistoryTime;
  updated: HistoryTime;
  body: string;
  contentType: string | null;
  attachments: HistoryAttachment[];
  nodeId: string;
  parentNodeId: string | null;
  childNodeIds: string[];
  order: number;
  onCurrentBranch: boolean;
  location: SourceLocation;
};

export type HistoryExportStatus = {
  digest: string;
  kind: "zip" | "json";
  status: "pending" | "complete" | "failed";
  counts: { conversations: number; messages: number; newMessages: number; reusedMessages: number; changedMessages: number; issues: number };
  errorCode: string | null;
  errorEntryPath: string | null;
};

export type HistoryMaterialBatch = {
  schemaVersion: "history-material-batch/v1";
  id: string;
  createdAt: string;
  label: string | null;
  selection: HistorySelection;
  count: number;
};

type ConversationInput = {
  digest: string;
  entryPath: string;
  ordinal: number;
  rawPath: string;
  rawJson: string;
  conversation: NormalizedConversation;
  attachments: ReadonlyMap<string, HistoryAttachment[]>;
};

type ContextOptions = PageOptions & Partial<OccurrenceFilter> & {
  conversationId?: string;
  sourceId?: string;
  revisionHash?: string;
  currentBranchOnly?: boolean;
  branchNodeId?: string;
};

type ConversationRow = {
  id: number;
  conversationId: string;
  title: string | null;
  created: string;
  updated: string;
  currentNodeId: string | null;
  digest: string;
  entryPath: string;
  ordinal: number;
  conversationPath: string;
};

export type MaterialStructuralNode = Pick<HistoricalMessage, "nodeId" | "parentNodeId" | "childNodeIds" | "order" | "onCurrentBranch">
  & { path: string };

type MessageRow = Omit<HistoricalMessage, "locator" | "revisionLocator" | "location" | "created" | "updated" | "childNodeIds" | "onCurrentBranch" | "attachments">
  & { key: number; created: string; updated: string; childNodeIds: string; onCurrentBranch: number; attachments: string }
  & SourceLocation;

type SqlFilter = { clauses: string[]; values: SQLInputValue[] };

const conversationColumns = `o.id, o.conversation_id AS conversationId, o.title, o.created, o.updated,
  o.current_node_id AS currentNodeId, o.digest, o.entry_path AS entryPath, o.ordinal, o.raw_path AS conversationPath`;

const messageColumns = `s.id AS sourceId, s.conversation_id AS conversationId, s.message_id AS messageId,
  r.hash AS revisionHash, r.content_hash AS contentHash, r.role, r.created, r.updated,
  r.body, r.content_type AS contentType, o.title, n.attachments,
  n.node_id AS nodeId, n.parent_node_id AS parentNodeId, n.child_node_ids AS childNodeIds,
  n.node_ordinal AS "order", n.on_current_branch AS onCurrentBranch, n.raw_path AS nodePath,
  n.message_path AS messagePath, o.digest, o.entry_path AS entryPath, o.ordinal, o.raw_path AS conversationPath`;

const joinMessage = `JOIN history_conversation_observations o ON o.id = n.observation_id
  JOIN history_sources s ON s.id = n.source_id
  JOIN history_revisions r ON r.source_id = n.source_id AND r.hash = n.revision_hash`;

const currentMessages = `history_current_sources current
  JOIN history_nodes n ON n.id = current.node_row_id ${joinMessage}`;

const exportColumns = `digest, kind, status, conversations, messages, issues,
  new_messages AS newMessages, reused_messages AS reusedMessages, changed_messages AS changedMessages,
  error_code AS errorCode, error_entry_path AS errorEntryPath`;

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fold(text: string) {
  return text.normalize("NFC").toLowerCase();
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function toConversation({ id, title, created, updated, ...conversation }: ConversationRow) {
  void id;
  return {
    ...conversation, title: title === null ? null : parseJson<string>(title),
    created: parseJson<HistoryTime>(created), updated: parseJson<HistoryTime>(updated),
  };
}

function sourceReference(input: string, revisionHash?: string) {
  const match = /^(?:chatgpt:message:)?([0-9a-f]{64})(?:@([0-9a-f]{64}))?$/.exec(input);
  if (!match || (revisionHash && !/^[0-9a-f]{64}$/.test(revisionHash))
    || (match[2] && revisionHash && match[2] !== revisionHash)) {
    throw new HistoryError("INVALID_SOURCE_LOCATOR");
  }
  return { id: match[1], hash: match[2] ?? revisionHash };
}

function toMessage(row: MessageRow): HistoricalMessage {
  const { sourceId, revisionHash, created, updated, childNodeIds, onCurrentBranch, attachments,
    digest, entryPath, ordinal, conversationPath, nodePath, messagePath, title, body, ...message } = row;
  const locator = `chatgpt:message:${sourceId}`;
  return {
    ...message,
    sourceId,
    revisionHash,
    locator,
    revisionLocator: `${locator}@${revisionHash}`,
    title: title === null ? null : parseJson(title),
    body: parseJson(body),
    created: parseJson(created),
    updated: parseJson(updated),
    attachments: parseJson(attachments),
    childNodeIds: parseJson(childNodeIds),
    onCurrentBranch: onCurrentBranch === 1,
    location: { digest, entryPath, ordinal, conversationPath, nodePath: conversationPath + nodePath, messagePath: conversationPath + messagePath },
  };
}

function pageBounds({ limit = 20, after }: PageOptions) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new HistoryError("INVALID_HISTORY_LIMIT");
  const cursor = after === undefined ? -1 : Number(after);
  if (after !== undefined && (!/^\d+$/.test(after) || !Number.isSafeInteger(cursor))) {
    throw new HistoryError("INVALID_HISTORY_CURSOR");
  }
  return { limit, cursor };
}

function page<T extends object>(rows: Iterable<Record<string, unknown>>, limit: number, decode: (row: Record<string, unknown>) => T): Page<T> {
  const items: T[] = [];
  let lastKey = -1;
  let bytes = 0;
  for (const { key, ...row } of rows) {
    if (items.length === limit) return { items, nextCursor: String(lastKey) };
    const item = decode(row);
    bytes += Buffer.byteLength(JSON.stringify(item));
    // Include at least one message even if the parser accepts a larger single record.
    if (items.length && bytes > 8 * 1024 * 1024) return { items, nextCursor: String(lastKey) };
    items.push(item);
    lastKey = key as number;
  }
  return { items, nextCursor: null };
}

function occurrenceClauses(occurrence: Partial<OccurrenceFilter> = {}): SqlFilter {
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [column, value] of [
    ["o.digest", occurrence.digest],
    ["o.entry_path", occurrence.entryPath],
    ["o.ordinal", occurrence.ordinal],
  ] as const) {
    if (value === undefined) continue;
    clauses.push(`${column} = ?`);
    values.push(value);
  }
  return { clauses, values };
}

function selectionFilter(selection: HistorySelection): SqlFilter {
  const { query, title, from, to, course, topic, conversationIds, hasImage, hasMissing, matchConversations } = selection;
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  const terms = fold(query?.trim() ?? "").split(/\s+/u).filter(Boolean);
  if ((query?.length ?? 0) > 2048 || terms.length > 20 || (title?.length ?? 0) > 512) {
    throw new HistoryError("HISTORY_SEARCH_TOO_LONG");
  }
  if (terms.length) {
    const word = matchConversations
      ? "(instr(hit_revision.search_body, ?) > 0 OR instr(hit_observation.search_title, ?) > 0)"
      : "(instr(r.search_body, ?) > 0 OR instr(o.search_title, ?) > 0)";
    const matches = terms.map(() => word).join(" AND ");
    clauses.push(matchConversations
      ? `s.conversation_id IN (SELECT hit.conversation_id FROM history_current_sources hit_current
        JOIN history_sources hit ON hit.id = hit_current.source_id
        JOIN history_nodes hit_node ON hit_node.id = hit_current.node_row_id
        JOIN history_revisions hit_revision ON hit_revision.source_id = hit.id AND hit_revision.hash = hit_node.revision_hash
        JOIN history_conversation_observations hit_observation ON hit_observation.id = hit_node.observation_id
        WHERE ${matches})`
      : matches);
    for (const term of terms) values.push(term, term);
  }
  if (title?.trim()) {
    clauses.push("instr(o.search_title, ?) > 0");
    values.push(fold(title.trim()));
  }
  for (const [day, condition] of [[from, "r.message_date >= ?"], [to, "r.message_date <= ?"]] as const) {
    if (day === undefined) continue;
    const parsed = new Date(day + "T00:00:00.000Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      throw new HistoryError("INVALID_HISTORY_DATE");
    }
    clauses.push(condition);
    values.push(day);
  }
  if (from && to && from > to) throw new HistoryError("INVALID_HISTORY_DATE_RANGE");
  for (const [kind, label] of [["course", course], ["topic", topic]] as const) {
    if (label === undefined) continue;
    clauses.push(`EXISTS (SELECT 1 FROM history_tags tag WHERE tag.conversation_id = s.conversation_id
      AND tag.kind = ? AND tag.search_label = ?)`);
    values.push(kind, fold(label.trim()));
  }
  if (conversationIds !== undefined) {
    if (conversationIds.length > 1000 || conversationIds.some((id) => !id || id.length > 512)) {
      throw new HistoryError("INVALID_HISTORY_CONVERSATION_SELECTION");
    }
    clauses.push("s.conversation_id IN (SELECT value FROM json_each(?))");
    values.push(JSON.stringify(conversationIds));
  }
  for (const [flag, column] of [[hasImage, "has_image"], [hasMissing, "has_missing"]] as const) {
    if (flag === undefined) continue;
    clauses.push(`s.conversation_id ${flag ? "IN" : "NOT IN"} (SELECT match_source.conversation_id
      FROM history_current_sources match_current JOIN history_sources match_source ON match_current.source_id = match_source.id
      JOIN history_nodes match_node ON match_node.id = match_current.node_row_id
      WHERE match_node.${column} = 1)`);
  }
  return { clauses, values };
}

function where(clauses: string[]) {
  return clauses.length ? "WHERE " + clauses.join(" AND ") : "";
}

export class HistoryStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.path = path === ":memory:" ? path : resolve(path);
    if (this.path !== ":memory:") {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      try {
        closeSync(openSync(this.path, "wx", 0o600));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    }
    this.db = new DatabaseSync(this.path);
    try {
      this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF");
      this.transaction(() => {
        const appId = this.db.prepare("PRAGMA application_id").get()?.application_id;
        const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
        if (appId === HISTORY_APPLICATION_ID) {
          if (version !== HISTORY_SCHEMA_VERSION) throw new HistoryError("UNSUPPORTED_HISTORY_SCHEMA");
          return;
        }
        if (appId !== 0 || version !== 0 || this.db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get()) {
          throw new HistoryError("NOT_A_HISTORY_DATABASE");
        }
        this.db.exec(historySchema);
        this.db.exec(`PRAGMA application_id = ${HISTORY_APPLICATION_ID}; PRAGMA user_version = ${HISTORY_SCHEMA_VERSION}`);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // SQLite may already have rolled back a transaction after an I/O failure.
      }
      throw error;
    }
  }

  beginExport(digest: string, kind: HistoryExportStatus["kind"]) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new HistoryError("INVALID_EXPORT_DIGEST");
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO history_exports(digest, kind) VALUES (?, ?)
        ON CONFLICT(digest) DO UPDATE SET status = 'pending', error_code = NULL, error_entry_path = NULL
        WHERE history_exports.status = 'failed'`).run(digest, kind);
      return this.requireExport(digest);
    });
  }

  exportStatus(digest: string): HistoryExportStatus | null {
    const row = this.db.prepare(`SELECT ${exportColumns} FROM history_exports WHERE digest = ?`).get(digest) as
      | (Omit<HistoryExportStatus, "counts"> & HistoryExportStatus["counts"])
      | undefined;
    if (!row) return null;
    const { conversations, messages, issues, newMessages, reusedMessages, changedMessages, ...rest } = row;
    return { ...rest, counts: { conversations, messages, newMessages, reusedMessages, changedMessages, issues } };
  }

  private requireExport(digest: string) {
    const result = this.exportStatus(digest);
    if (!result) throw new HistoryError("HISTORY_EXPORT_NOT_FOUND");
    return result;
  }

  checkpoint(digest: string, entryPath: string) {
    const row = this.db.prepare("SELECT next_ordinal FROM history_checkpoints WHERE digest = ? AND entry_path = ?").get(digest, entryPath);
    return Number(row?.next_ordinal ?? 0);
  }

  saveConversation({ digest, entryPath, ordinal, rawPath, rawJson, conversation, attachments }: ConversationInput) {
    this.transaction(() => {
      const checkpoint = this.checkpoint(digest, entryPath);
      if (ordinal < checkpoint) return;
      const { status } = this.requireExport(digest);
      if (status !== "pending") throw new HistoryError("HISTORY_EXPORT_NOT_PENDING");
      if (ordinal !== checkpoint) throw new HistoryError("HISTORY_CHECKPOINT_GAP");
      const inserted = this.db.prepare(`INSERT INTO history_conversation_observations
        (digest, entry_path, ordinal, raw_path, raw_json, conversation_id, title, search_title, created, updated, current_node_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(digest, entryPath, ordinal, rawPath, rawJson, conversation.id,
        conversation.title === null ? null : JSON.stringify(conversation.title),
        fold(conversation.title ?? ""), JSON.stringify(conversation.created),
        JSON.stringify(conversation.updated), conversation.currentNodeId);

      const observationId = Number(inserted.lastInsertRowid);
      const issues = [...conversation.issues];
      const saveNode = this.db.prepare(`INSERT INTO history_nodes
        (observation_id, node_id, parent_node_id, child_node_ids, node_ordinal, on_current_branch, raw_path,
          message_path, source_id, revision_hash, attachments, has_image, has_missing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const saveSource = this.db.prepare(`INSERT INTO history_sources(id, conversation_id, message_id) VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING`);
      const saveRevision = this.db.prepare(`INSERT INTO history_revisions
        (source_id, hash, content_hash, role, created, updated, message_date, body, search_body, content_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_id, hash) DO NOTHING`);
      const saveExportSource = this.db.prepare(`INSERT INTO history_export_sources(digest, source_id, node_row_id)
        VALUES (?, ?, ?) ON CONFLICT(digest, source_id) DO NOTHING`);
      const previousExportRevision = this.db.prepare(`SELECT n.revision_hash FROM history_export_sources x
        JOIN history_nodes n ON n.id = x.node_row_id WHERE x.digest = ? AND x.source_id = ?`);
      let messageCount = 0;

      function getMessage(node: HistoryNode) {
        const message = node.message;
        if (!message || !conversation.id) return null;
        const sourceId = sha256(JSON.stringify([conversation.id, message.id]));
        const files = attachments.get(node.nodeId) ?? message.attachments.map((ref): HistoryAttachment => ({
          ...ref, status: "unavailable", reason: "ATTACHMENT_NOT_RESOLVED", entryPath: null, sha256: null, byteLength: null,
        }));
        for (const file of files) {
          if (file.reason) issues.push({ code: file.reason, path: file.rawPath });
        }
        const contentHash = sha256(message.body);
        const created = JSON.stringify(message.created);
        const updated = JSON.stringify(message.updated);
        const revisionHash = sha256(JSON.stringify([contentHash, message.role, message.contentType, created, updated,
          files.map(({ kind, pointer, name, mimeType, status, sha256 }) => [kind, pointer, name, mimeType, status, sha256])]));
        saveSource.run(sourceId, conversation.id, message.id);
        saveRevision.run(sourceId, revisionHash, contentHash, message.role, created, updated,
          message.created.iso?.slice(0, 10) ?? null, JSON.stringify(message.body), fold(message.body), message.contentType);
        return { sourceId, revisionHash, files };
      }

      for (const [order, node] of conversation.nodes.entries()) {
        const message = getMessage(node);
        const files = message?.files ?? [];
        const insertedNode = saveNode.run(observationId, node.nodeId, node.parentNodeId, JSON.stringify(node.childNodeIds),
          order, Number(node.onCurrentBranch), node.rawPath, node.message?.rawPath ?? null,
          message?.sourceId ?? null, message?.revisionHash ?? null, JSON.stringify(files),
          Number(files.some((file) => file.kind === "image")), Number(files.some((file) => file.status !== "available")));
        if (!message) continue;
        const source = saveExportSource.run(digest, message.sourceId, insertedNode.lastInsertRowid);
        if (Number(source.changes)) {
          messageCount++;
        } else {
          const previous = previousExportRevision.get(digest, message.sourceId);
          issues.push({
            code: previous?.revision_hash === message.revisionHash ? "DUPLICATE_MESSAGE_IN_EXPORT" : "CONFLICTING_MESSAGE_IN_EXPORT",
            path: node.message?.rawPath ?? node.rawPath,
          });
        }
      }
      if (conversation.id && conversation.nodes.some(({ message }) => message !== null)) {
        const observation = this.db.prepare(`INSERT INTO history_export_conversations(digest, conversation_id, observation_id)
          VALUES (?, ?, ?) ON CONFLICT(digest, conversation_id) DO NOTHING`).run(digest, conversation.id, observationId);
        if (!Number(observation.changes)) issues.push({ code: "DUPLICATE_CONVERSATION_IN_EXPORT", path: "" });
      }

      const saveIssue = this.db.prepare("INSERT INTO history_issues(observation_id, digest, code, raw_path) VALUES (?, ?, ?, ?)");
      for (const issue of issues) saveIssue.run(observationId, digest, issue.code, rawPath + issue.path);
      this.db.prepare(`UPDATE history_exports SET conversations = conversations + 1, messages = messages + ?, issues = issues + ?
        WHERE digest = ?`).run(messageCount, issues.length, digest);
      this.db.prepare(`INSERT INTO history_checkpoints(digest, entry_path, next_ordinal) VALUES (?, ?, ?)
        ON CONFLICT(digest, entry_path) DO UPDATE SET next_ordinal = excluded.next_ordinal`).run(digest, entryPath, ordinal + 1);
    });
  }

  finishExport(digest: string) {
    return this.transaction(() => {
      const stored = this.requireExport(digest);
      if (stored.status === "complete") return stored;
      if (stored.status !== "pending") throw new HistoryError("HISTORY_EXPORT_NOT_PENDING");
      const counts = this.db.prepare(`SELECT
        count(*) FILTER (WHERE current.source_id IS NULL) AS newMessages,
        count(*) FILTER (WHERE current.source_id IS NOT NULL AND previous.revision_hash = staged.revision_hash) AS reusedMessages,
        count(*) FILTER (WHERE current.source_id IS NOT NULL AND previous.revision_hash <> staged.revision_hash) AS changedMessages
        FROM history_export_sources x
        JOIN history_nodes staged ON staged.id = x.node_row_id
        LEFT JOIN history_current_sources current ON current.source_id = x.source_id
        LEFT JOIN history_nodes previous ON previous.id = current.node_row_id WHERE x.digest = ?`).get(digest);
      if (!counts) throw new HistoryError("HISTORY_EXPORT_COUNT_FAILED");
      this.db.prepare(`INSERT INTO history_current_sources(source_id, node_row_id)
        SELECT source_id, node_row_id FROM history_export_sources WHERE digest = ?
        ON CONFLICT(source_id) DO UPDATE SET node_row_id = excluded.node_row_id`).run(digest);
      this.db.prepare(`INSERT INTO history_current_conversations(conversation_id, observation_id)
        SELECT conversation_id, observation_id FROM history_export_conversations WHERE digest = ?
        ON CONFLICT(conversation_id) DO UPDATE SET observation_id = excluded.observation_id`).run(digest);
      this.db.prepare(`UPDATE history_exports SET status = 'complete', new_messages = ?, reused_messages = ?, changed_messages = ?,
        completed_seq = (SELECT coalesce(max(completed_seq), 0) + 1 FROM history_exports)
        WHERE digest = ?`).run(counts.newMessages, counts.reusedMessages, counts.changedMessages, digest);
      return this.requireExport(digest);
    });
  }

  failExport(digest: string, code: string, entryPath?: string) {
    return this.transaction(() => {
      const stored = this.requireExport(digest);
      if (stored.status === "complete") return stored;
      if (code === "INPUT_CHANGED") {
        // Discard all staged rows for a digest if the bytes no longer agree with it.
        this.db.prepare("DELETE FROM history_export_sources WHERE digest = ?").run(digest);
        this.db.prepare("DELETE FROM history_export_conversations WHERE digest = ?").run(digest);
        this.db.prepare("DELETE FROM history_issues WHERE digest = ?").run(digest);
        this.db.prepare(`DELETE FROM history_nodes WHERE observation_id IN
          (SELECT id FROM history_conversation_observations WHERE digest = ?)`).run(digest);
        this.db.prepare("DELETE FROM history_conversation_observations WHERE digest = ?").run(digest);
        this.db.prepare("DELETE FROM history_checkpoints WHERE digest = ?").run(digest);
        this.db.exec(`DELETE FROM history_revisions AS r WHERE NOT EXISTS
          (SELECT 1 FROM history_nodes n WHERE n.source_id = r.source_id AND n.revision_hash = r.hash);
          DELETE FROM history_sources AS s WHERE NOT EXISTS
          (SELECT 1 FROM history_revisions r WHERE r.source_id = s.id)`);
        this.db.prepare(`UPDATE history_exports SET conversations = 0, messages = 0, issues = 0 WHERE digest = ?`).run(digest);
      }
      this.db.prepare(`UPDATE history_exports SET status = 'failed', error_code = ?, error_entry_path = ?
        WHERE digest = ?`).run(code, entryPath ?? null, digest);
      return this.requireExport(digest);
    });
  }

  diagnostics(digest: string, options: PageOptions = {}) {
    this.requireExport(digest);
    const { limit, cursor } = pageBounds(options);
    const rows = this.db.prepare(`SELECT i.id AS key, o.entry_path AS entryPath, o.ordinal,
      o.conversation_id AS conversationId, i.code, i.raw_path AS path
      FROM history_issues i JOIN history_conversation_observations o ON o.id = i.observation_id
      WHERE i.digest = ? AND i.id > ? ORDER BY i.id LIMIT ?`).iterate(digest, cursor, limit + 1);
    return page(rows, limit, (row) => row as { entryPath: string; ordinal: number; conversationId: string | null; code: string; path: string });
  }

  getRawConversation({ digest, entryPath, ordinal }: Pick<SourceLocation, "digest" | "entryPath" | "ordinal">) {
    const row = this.db.prepare(`SELECT digest, entry_path AS entryPath, ordinal, raw_path AS conversationPath, raw_json AS rawJson
      FROM history_conversation_observations WHERE digest = ? AND entry_path = ? AND ordinal = ?`).get(digest, entryPath, ordinal);
    return row as (Pick<SourceLocation, "digest" | "entryPath" | "ordinal" | "conversationPath"> & { rawJson: string } | undefined) ?? null;
  }

  getMaterialObservation({ digest, entryPath, ordinal }: Pick<SourceLocation, "digest" | "entryPath" | "ordinal">) {
    const row = this.db.prepare(`SELECT ${conversationColumns} FROM history_conversation_observations o
      JOIN history_exports x ON x.digest = o.digest
      WHERE o.digest = ? AND o.entry_path = ? AND o.ordinal = ? AND x.status = 'complete' AND o.conversation_id IS NOT NULL`)
      .get(digest, entryPath, ordinal) as ConversationRow | undefined;
    if (!row) return null;
    const issues = this.db.prepare(`SELECT code, raw_path AS path FROM history_issues
      WHERE digest = ? AND observation_id = ? ORDER BY id`).iterate(digest, row.id) as Iterable<HistoryIssue>;
    const nodes = this.db.prepare(`SELECT node_id AS nodeId, parent_node_id AS parentNodeId, child_node_ids AS childNodeIds,
      node_ordinal AS "order", on_current_branch AS onCurrentBranch, raw_path AS path
      FROM history_nodes WHERE observation_id = ? AND source_id IS NULL ORDER BY node_ordinal`);
    const { id, conversationPath } = row;
    function* structuralNodes(): Iterable<MaterialStructuralNode> {
      for (const entry of nodes.iterate(id)) {
        const { childNodeIds, onCurrentBranch, path, ...node } = entry as Omit<MaterialStructuralNode, "childNodeIds" | "onCurrentBranch">
          & { childNodeIds: string; onCurrentBranch: number };
        yield { ...node, childNodeIds: parseJson(childNodeIds), onCurrentBranch: onCurrentBranch === 1, path: conversationPath + path };
      }
    }
    return { conversation: toConversation(row), structuralNodes: structuralNodes(), issues };
  }

  search(options: HistorySelection & PageOptions = {}) {
    const { limit, cursor } = pageBounds(options);
    const { clauses, values } = selectionFilter(options);
    const rows = this.db.prepare(`SELECT n.id AS key, ${messageColumns} FROM ${currentMessages}
      ${where(["n.id > ?", ...clauses])} ORDER BY n.id LIMIT ?`).iterate(cursor, ...values, limit + 1);
    return page(rows, limit, (row) => toMessage(row as MessageRow));
  }

  getSource(sourceId: string, revisionHash?: string, occurrence?: OccurrenceFilter) {
    const { id, hash } = sourceReference(sourceId, revisionHash);
    if (!hash && !occurrence) {
      const row = this.db.prepare(`SELECT ${messageColumns} FROM ${currentMessages} WHERE s.id = ?`).get(id);
      return row ? toMessage(row as MessageRow) : null;
    }
    const { clauses, values } = occurrenceClauses(occurrence);
    if (hash) {
      clauses.push("n.revision_hash = ?");
      values.push(hash);
    }
    const row = this.db.prepare(`SELECT ${messageColumns} FROM history_nodes n ${joinMessage}
      JOIN history_exports x ON x.digest = o.digest
      ${where(["s.id = ?", "x.status = 'complete'", ...clauses])}
      ORDER BY x.completed_seq DESC, n.id ASC LIMIT 1`).get(id, ...values);
    return row ? toMessage(row as MessageRow) : null;
  }

  sourceOccurrences(sourceId: string, options: PageOptions = {}) {
    const { id, hash } = sourceReference(sourceId);
    const { limit, cursor } = pageBounds(options);
    const terms = hash ? ["AND n.revision_hash = ?", hash] : ["", null];
    const rows = this.db.prepare(`SELECT n.id AS key, ${messageColumns} FROM history_nodes n ${joinMessage}
      JOIN history_exports x ON x.digest = o.digest WHERE s.id = ? AND x.status = 'complete' AND n.id > ?
      ${terms[0]} ORDER BY n.id LIMIT ?`).iterate(id, cursor, ...(terms[1] ? [terms[1]] : []), limit + 1);
    return page(rows, limit, (row) => toMessage(row as MessageRow));
  }

  context(options: ContextOptions) {
    const { conversationId, sourceId, revisionHash, digest, currentBranchOnly, branchNodeId } = options;
    if ((!conversationId && !sourceId) || (conversationId && sourceId) || (currentBranchOnly && branchNodeId)
      || (!digest && (options.ordinal !== undefined || options.entryPath !== undefined)) || (!sourceId && revisionHash)) {
      throw new HistoryError("INVALID_HISTORY_CONTEXT");
    }
    const { limit, cursor } = pageBounds(options);
    const source = sourceId ? this.getSource(sourceId, revisionHash, digest ? { ...options, digest } : undefined) : null;
    if (sourceId && !source) return null;
    const location = source?.location ?? options;
    const { clauses, values } = occurrenceClauses(location);
    const effectiveId = source?.conversationId ?? conversationId ?? null;
    const observation = (location.digest
      ? this.db.prepare(`SELECT ${conversationColumns} FROM history_conversation_observations o
        JOIN history_exports x ON x.digest = o.digest
        ${where(["o.conversation_id = ?", "x.status = 'complete'", ...clauses])} ORDER BY o.id LIMIT 1`).get(effectiveId, ...values)
      : this.db.prepare(`SELECT ${conversationColumns} FROM history_current_conversations current
        JOIN history_conversation_observations o ON o.id = current.observation_id
        WHERE current.conversation_id = ?`).get(effectiveId)) as ConversationRow | undefined;
    if (!observation) return null;
    const filters = ["n.observation_id = ?", "n.node_ordinal > ?"];
    if (currentBranchOnly) filters.push("n.on_current_branch = 1");
    if (branchNodeId !== undefined) {
      const node = this.db.prepare("SELECT 1 FROM history_nodes WHERE observation_id = ? AND node_id = ?").get(observation.id, branchNodeId);
      if (!node) throw new HistoryError("HISTORY_BRANCH_NOT_FOUND");
      filters.push(`n.node_id IN (WITH RECURSIVE branch(node_id, parent_node_id) AS (
        SELECT node_id, parent_node_id FROM history_nodes WHERE observation_id = ? AND node_id = ?
        UNION
        SELECT parent.node_id, parent.parent_node_id FROM history_nodes parent JOIN branch ON branch.parent_node_id = parent.node_id
        WHERE parent.observation_id = ?) SELECT node_id FROM branch)`);
    }
    const params = branchNodeId === undefined ? [] : [observation.id, branchNodeId, observation.id];
    const rows = this.db.prepare(`SELECT n.node_ordinal AS key, ${messageColumns} FROM history_nodes n ${joinMessage}
      ${where(filters)} ORDER BY n.node_ordinal LIMIT ?`).iterate(observation.id, cursor, ...params, limit + 1);
    return {
      conversation: toConversation(observation),
      ...page(rows, limit, (row) => toMessage(row as MessageRow)),
    };
  }

  tagConversation(conversationId: string, kind: "course" | "topic", label: string) {
    const tag = label.trim();
    if (!tag || tag.length > 160 || (kind !== "course" && kind !== "topic")) throw new HistoryError("INVALID_HISTORY_TAG");
    return this.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM history_current_conversations WHERE conversation_id = ?").get(conversationId)) {
        throw new HistoryError("HISTORY_CONVERSATION_NOT_FOUND");
      }
      this.db.prepare(`INSERT INTO history_tags(conversation_id, kind, label, search_label)
        VALUES (?, ?, ?, ?) ON CONFLICT(conversation_id, kind, search_label) DO NOTHING`).run(conversationId, kind, tag, fold(tag));
      return { conversationId, kind, label: tag };
    });
  }

  createBatch(selection: HistorySelection, label?: string): HistoryMaterialBatch {
    const normalizedLabel = label?.trim() || null;
    if (normalizedLabel && normalizedLabel.length > 160) throw new HistoryError("INVALID_HISTORY_BATCH_LABEL");
    const { clauses, values } = selectionFilter(selection);
    return this.transaction(() => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      this.db.prepare("INSERT INTO history_batches(id, created_at, label, selection) VALUES (?, ?, ?, ?)")
        .run(id, createdAt, normalizedLabel, JSON.stringify(selection));
      const inserted = this.db.prepare(`INSERT INTO history_batch_items(batch_id, position, node_row_id)
        SELECT ?, row_number() OVER (ORDER BY s.conversation_id, o.id, n.node_ordinal), n.id
        FROM ${currentMessages} ${where(clauses)}`).run(id, ...values);
      const count = Number(inserted.changes);
      this.db.prepare("UPDATE history_batches SET count = ? WHERE id = ?").run(count, id);
      return { schemaVersion: "history-material-batch/v1", id, createdAt, label: normalizedLabel, selection, count };
    });
  }

  readBatch(id: string, options: PageOptions = {}) {
    const { limit, cursor } = pageBounds(options);
    const row = this.db.prepare("SELECT id, created_at AS createdAt, label, selection, count FROM history_batches WHERE id = ?").get(id) as
      | (Omit<HistoryMaterialBatch, "schemaVersion" | "selection"> & { selection: string })
      | undefined;
    if (!row) return null;
    const batch: HistoryMaterialBatch = { ...row, schemaVersion: "history-material-batch/v1", selection: parseJson(row.selection) };
    const rows = this.db.prepare(`SELECT i.position AS key, ${messageColumns} FROM history_batch_items i
      JOIN history_nodes n ON n.id = i.node_row_id ${joinMessage}
      WHERE i.batch_id = ? AND i.position > ? ORDER BY i.position LIMIT ?`).iterate(id, cursor, limit + 1);
    return { batch, ...page(rows, limit, (row) => toMessage(row as MessageRow)) };
  }
}
