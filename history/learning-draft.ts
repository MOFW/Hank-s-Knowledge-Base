import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { historyImportNamespace, historySpeaker } from "../domain/history-reference.ts";
import { inspectCandidate, inspectTopicCandidate } from "../domain/import-evidence.ts";
import type { ImportBatch, ImportIssue } from "../domain/imports.ts";
import { digest, readBoundedFile, readMaterialImage, readMaterialSelection, type MaterialSelection } from "./material-reader.ts";
import type { HistoricalMessage, SourceLocation } from "./store.ts";
import { historyErrorCode, HistoryError } from "./types.ts";

const contractNames = ["question-import-v1", "question-import-v1.1", "learning-import-v1.2"];
const importMaxBytes = 900_000;

type Draft = { batchId: string; parts: number[]; readPositions: number[]; batch: ImportBatch };

export function historySourceKey(message: Pick<HistoricalMessage, "conversationId">) {
  return `chat-${digest(message.conversationId)}`;
}

export function materialScope(selection: MaterialSelection) {
  return {
    batchId: selection.batchId, parts: selection.parts, incompletePositions: selection.incompletePositions,
    messages: [...selection.messages].map(([position, { part, record: { message } }]) => ({
      position, part, revisionLocator: message.revisionLocator, role: message.role,
      conversationId: message.conversationId, nodeId: message.nodeId, sourceKey: historySourceKey(message),
    })),
  };
}

function locationKey(location: SourceLocation) {
  return JSON.stringify([location.digest, location.entryPath, location.ordinal, location.conversationPath, location.nodePath, location.messagePath]);
}

function isDraft(value: Draft | null): value is Draft {
  const positions = (list: unknown) => Array.isArray(list) && list.length > 0
    && list.every((part) => Number.isSafeInteger(part) && part > 0) && new Set(list).size === list.length;
  return value !== null && typeof value === "object" && Object.keys(value).length === 4
    && typeof value.batchId === "string" && positions(value.parts) && positions(value.readPositions)
    && value.batch?.schema_version === "1.2" && value.batch.namespace === historyImportNamespace;
}

export async function readLearningDraft(path: string) {
  return JSON.parse((await readBoundedFile(path, importMaxBytes * 2)).toString("utf8")) as Draft;
}

export async function checkLearningDraft(root: string, draft: Draft, selected: number[]) {
  if (!isDraft(draft)) throw new HistoryError("INVALID_HISTORY_LEARNING_DRAFT");
  const selection = await readMaterialSelection(root, selected);
  const scope = materialScope(selection);
  const issues: ImportIssue[] = [];
  const issue = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "blocking" });
  const usedPositions = new Set<number>();
  const images: { path: string; filename: string; part: number }[] = [];
  const result = () => ({
    valid: !issues.some(({ severity }) => severity === "blocking"), scope,
    citedPositions: [...usedPositions].sort((a, b) => a - b), images, issues,
  });
  if (draft.batchId !== selection.batchId || JSON.stringify(draft.parts) !== JSON.stringify(selection.parts)) {
    issue("/parts", "HISTORY_SCOPE_MISMATCH", "草稿批次和分包须与本次确实提供的材料一致。");
  }
  const expectedPositions = [...selection.messages.keys()].sort((a, b) => a - b);
  if (JSON.stringify([...draft.readPositions].sort((a, b) => a - b)) !== JSON.stringify(expectedPositions)) {
    issue("/readPositions", "HISTORY_READ_RANGE_MISMATCH", "草稿须列出所提供分包中完整读到的消息序号。");
  }
  if (Buffer.byteLength(JSON.stringify(draft.batch)) > importMaxBytes) {
    issue("/batch", "BYTE_LIMIT", "候选批次最大 900,000 字节。");
    return result();
  }
  const ajv = addFormats(new Ajv2020({ strictRequired: false }));
  for (const name of contractNames) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(`../contracts/${name}.schema.json`, import.meta.url), "utf8")));
  }
  if (!ajv.validate("urn:hkb:learning-import:1.2", draft.batch)) {
    for (const error of ajv.errors?.slice(0, 24) ?? []) issue("/batch" + error.instancePath, "IMPORT_SCHEMA", error.message ?? error.keyword);
    return result();
  }
  const messages = new Map(scope.messages.map(({ position, revisionLocator }) => {
    const message = selection.messages.get(position)!.record.message;
    return [`${revisionLocator}:${locationKey(message.location)}`, { message, position }];
  }));
  const sourceKeys = new Set(scope.messages.map(({ sourceKey }) => sourceKey));
  const declaredSourceKeys = new Set<string>();
  for (const [index, source] of draft.batch.sources.entries()) {
    if (declaredSourceKeys.has(source.source_key)) issue(`/batch/sources/${index}`, "DUPLICATE_SOURCE", "来源键必须唯一。");
    declaredSourceKeys.add(source.source_key);
    if (source.kind === "chat" && (!sourceKeys.has(source.source_key) || source.external_id !== source.source_key)) {
      issue(`/batch/sources/${index}`, "HISTORY_SOURCE_MISMATCH", "聊天来源键和外部标识须对应已提供的会话。");
    }
  }
  const sources = new Map(draft.batch.sources.map((source) => [source.source_key, source]));
  const findMessage = (locator: string, history: { role: string; location: SourceLocation } | undefined, sourceKey: string, path: string) => {
    const entry = history && messages.get(`${locator}:${locationKey(history.location)}`);
    if (!entry || entry.message.role !== history?.role || historySourceKey(entry.message) !== sourceKey || sources.get(sourceKey)?.kind !== "chat") {
      issue(path, "HISTORY_MESSAGE_MISMATCH", "无法在所提供的完整消息中核对修订、原档位置、角色及会话。");
      return undefined;
    }
    usedPositions.add(entry.position);
    return entry;
  };

  const itemKeys = new Set<string>();
  const externalIds = new Set<string>();
  for (const [index, candidate] of draft.batch.items.entries()) {
    const base = `/batch/items/${index}`;
    const topic = "kind" in candidate;
    const inspection = topic ? inspectTopicCandidate(candidate, draft.batch.sources, draft.batch.namespace)
      : inspectCandidate(candidate, draft.batch.sources, "1.2", draft.batch.namespace);
    for (const problem of inspection.issues) {
      // Unresolved source gaps belong in owner review and may be intentionally submitted.
      issues.push({ ...problem, path: base + problem.path, severity: ["DECLARED_GAP", "STATEMENT_NEEDS_VERIFICATION",
        "SOURCE_NEEDS_VERIFICATION"].includes(problem.code) ? "notice" : problem.severity });
    }
    const externalKey = candidate.external_id;
    if (itemKeys.has(candidate.item_key) || externalIds.has(externalKey)) issue(base, "DUPLICATE_ITEM", "候选标识必须唯一。");
    itemKeys.add(candidate.item_key);
    externalIds.add(externalKey);
    let matchedSource = false;
    for (const group of inspection.groups) {
      for (const [evidenceIndex, entry] of group.evidence.entries()) {
        const path = `${base}${group.path}/evidence/${evidenceIndex}`;
        const match = findMessage(entry.locator, entry.history, entry.source_key, path);
        if (!match) continue;
        matchedSource = true;
        if (entry.speaker !== historySpeaker(match.message.role)) issue(path, "HISTORY_ROLE_MISMATCH", "发言归属与原文角色不一致。");
        if (!match.message.body.includes(entry.quote)) issue(path, "HISTORY_QUOTE_MISMATCH", "引句须逐字出现在对应消息的原文中。");
      }
    }
    if (!topic) {
      if (candidate.original_asset_ids?.length) {
        issue(base + "/original_asset_ids", "USE_HISTORY_IMAGE_REFERENCE", "历史材料图须使用材料包附件引用，以便核对原图。");
      }
      for (const [imageIndex, image] of (candidate.history_images ?? []).entries()) {
        const path = `${base}/history_images/${imageIndex}`;
        const match = findMessage(image.locator, image.history, image.source_key, path);
        if (!match) continue;
        try {
          const file = await readMaterialImage(root, selection, match.position, image.attachment_index);
          if (file.sha256 !== image.sha256 || file.mimeType !== image.mime_type || file.byteLength !== image.byte_size) {
            issue(path, "HISTORY_IMAGE_MISMATCH", "图片摘要、格式或长度与材料包不一致。");
          } else {
            matchedSource = true;
            images.push({ path, filename: file.filename, part: file.part });
          }
        } catch (error) {
          issue(path, historyErrorCode(error), "无法从所提供的材料包核对原图文件。");
        }
      }
      if (candidate.statement?.origin === "quoted" && !candidate.statement.evidence?.some(({ quote }) => quote.includes(candidate.statement!.markdown))) {
        issue(base + "/statement/markdown", "HISTORY_STATEMENT_MISMATCH", "原文题干须完整出现在引句中。");
      }
      for (const [attemptIndex, { original_work }] of (candidate.attempts ?? []).entries()) {
        if (!original_work.evidence.some(({ quote }) => quote.includes(original_work.markdown))) {
          issue(`${base}/attempts/${attemptIndex}/original_work/markdown`, "HISTORY_ATTEMPT_MISMATCH", "请用实际作答消息中的连续原文记录作答。");
        }
      }
    }
    if (!matchedSource) issue(base, "HISTORY_EVIDENCE_REQUIRED", "每个候选至少需要一条匹配的历史引文或原图引用。");
  }
  return result();
}
