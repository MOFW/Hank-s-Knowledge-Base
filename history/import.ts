import { attachmentResolver } from "./attachments.ts";
import { isConversationEntry, openHistoryInput } from "./archive.ts";
import { normalizeConversation, parseConversations } from "./parse.ts";
import { HistoryStore } from "./store.ts";
import { HistoryError, historyErrorCode, type HistoryAttachment } from "./types.ts";

type ImportOptions = {
  signal?: AbortSignal;
  onCheckpoint?: (count: number) => void;
};

export async function importHistory(inputPath: string, store: HistoryStore, options: ImportOptions = {}) {
  const input = await openHistoryInput(inputPath, options.signal);
  const { digest } = input;
  try {
    const previous = store.beginExport(digest, input.kind);
    if (previous.status === "complete") return { ...previous, duplicate: true };

    let entryPath: string | undefined;
    let count = 0;
    try {
      const entries = input.kind === "json" ? input.entries : input.entries.filter(({ path }) => isConversationEntry(path));
      if (!entries.length) throw new HistoryError(input.entries.some(({ path }) => /\.zip$/i.test(path))
        ? "NESTED_ZIP_UNSUPPORTED" : "CONVERSATION_JSON_NOT_FOUND");
      const resolveAttachment = attachmentResolver(input.kind === "zip" ? input.entries : [], store.path);
      for (const entry of entries) {
        entryPath = entry.path;
        const checkpoint = store.checkpoint(digest, entry.path);
        for await (const record of parseConversations(entry.open())) {
          if (options.signal?.aborted) throw new HistoryError("IMPORT_INTERRUPTED");
          if (record.ordinal < checkpoint) continue;
          const conversation = normalizeConversation(record.value);
          if (record.issue) conversation.issues.unshift(record.issue);
          const attachments = new Map<string, HistoryAttachment[]>();
          for (const node of conversation.nodes) {
            if (!node.message?.attachments.length) continue;
            const resolved: HistoryAttachment[] = [];
            for (const ref of node.message.attachments) {
              if (options.signal?.aborted) throw new HistoryError("IMPORT_INTERRUPTED");
              resolved.push(await resolveAttachment(ref));
            }
            attachments.set(node.nodeId, resolved);
          }
          await input.assertUnchanged();
          store.saveConversation({ digest, entryPath: entry.path, ordinal: record.ordinal,
            rawPath: record.rawPath, rawJson: record.rawJson, conversation, attachments });
          options.onCheckpoint?.(++count);
        }
      }
      if (options.signal?.aborted) throw new HistoryError("IMPORT_INTERRUPTED");
      await input.assertUnchanged();
      return { ...store.finishExport(digest), duplicate: false };
    } catch (error) {
      let code = historyErrorCode(error);
      if (code !== "INPUT_CHANGED") {
        try {
          await input.assertUnchanged();
        } catch (stateError) {
          if (historyErrorCode(stateError) === "INPUT_CHANGED") code = "INPUT_CHANGED";
        }
      }
      if (code !== "IMPORT_INTERRUPTED") store.failExport(digest, code, entryPath);
      throw new HistoryError(code, digest);
    }
  } finally {
    await input.close();
  }
}
