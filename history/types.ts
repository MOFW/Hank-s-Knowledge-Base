export type HistoryIssue = { code: string; path: string };

export type HistoryTime = {
  iso: string | null;
  precision: "unknown" | "date" | "second" | "millisecond" | "submillisecond";
  raw: string | number | null;
};

export type HistoryAttachmentRef = {
  kind: "image" | "file" | "audio" | "video" | "unknown";
  pointer: string | null;
  name: string | null;
  mimeType: string | null;
  rawPath: string;
};

export type HistoryAttachment = HistoryAttachmentRef & {
  status: "available" | "missing" | "unavailable";
  reason: string | null;
  entryPath: string | null;
  sha256: string | null;
  byteLength: number | null;
};

export type HistoryMessage = {
  id: string;
  role: string;
  created: HistoryTime;
  updated: HistoryTime;
  body: string;
  attachments: HistoryAttachmentRef[];
  contentType: string | null;
  rawPath: string;
};

export type HistoryNode = {
  nodeId: string;
  parentNodeId: string | null;
  childNodeIds: string[];
  message: HistoryMessage | null;
  onCurrentBranch: boolean;
  rawPath: string;
};

export type NormalizedConversation = {
  id: string | null;
  title: string | null;
  created: HistoryTime;
  updated: HistoryTime;
  currentNodeId: string | null;
  nodes: HistoryNode[];
  issues: HistoryIssue[];
};

export class HistoryError extends Error {
  readonly code: string;
  readonly exportDigest?: string;

  constructor(code: string, exportDigest?: string) {
    super(code);
    this.code = code;
    this.exportDigest = exportDigest;
  }
}

export function historyErrorCode(error: unknown) {
  if (error instanceof Error && "code" in error && typeof error.code === "string"
    && /^[A-Z][A-Z_0-9]{1,79}$/.test(error.code)) return error.code;
  return "HISTORY_OPERATION_FAILED";
}
