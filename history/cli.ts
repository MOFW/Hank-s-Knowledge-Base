import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { importHistory } from "./import.ts";
import { exportMaterialBatch } from "./material-package.ts";
import { HistoryStore } from "./store.ts";
import { HistoryError, historyErrorCode } from "./types.ts";

const textOption = { type: "string" } as const;
const booleanOption = { type: "boolean" } as const;
const pageOptions = { limit: textOption, after: textOption };
const filterOptions = {
  q: textOption, title: textOption, from: textOption, to: textOption,
  course: textOption, topic: textOption, conversation: { type: "string", multiple: true },
  "has-image": booleanOption, "has-missing": booleanOption,
} as const;
const occurrenceOptions = { digest: textOption, entry: textOption, ordinal: textOption, revision: textOption };
const optionsByCommand = {
  import: {},
  status: {},
  diagnostics: pageOptions,
  search: { ...filterOptions, ...pageOptions },
  context: { ...occurrenceOptions, ...pageOptions, "current-branch": booleanOption, "branch-node": textOption },
  source: occurrenceOptions,
  occurrences: pageOptions,
  raw: {},
  tag: {},
  "create-batch": { ...filterOptions, label: textOption, "matching-messages": booleanOption },
  batch: pageOptions,
  "export-batch": { out: textOption, "max-json-kib": textOption },
  "material-scope": { part: { type: "string", multiple: true } },
  "check-learning-draft": { part: { type: "string", multiple: true }, out: textOption },
} satisfies Record<string, ParseArgsOptionsConfig>;

const usage = `本地 ChatGPT 历史资料库

npm run history -- <命令> [--db <SQLite 路径>]

  import <ZIP 或 JSON 路径>
  status <导出 SHA-256>
  diagnostics <导出 SHA-256> [--limit N] [--after CURSOR]
  search [筛选] [--limit N] [--after CURSOR]
  context <会话 ID 或消息来源 ID> [--current-branch | --branch-node ID] [--limit N] [--after CURSOR]
  source <消息来源 ID 或带版本的定位> [--revision HASH]
  occurrences <消息来源 ID> [--limit N] [--after CURSOR]
  raw <导出 SHA-256> <ZIP 内路径> <会话序号>
  tag <会话 ID> <course|topic> <名称>
  create-batch [筛选] [--label NAME] [--matching-messages]
  batch <批次 ID> [--limit N] [--after CURSOR]
  export-batch <批次 ID> --out <新目录> [--max-json-kib 16..256]
  material-scope <材料包目录> --part N [--part N ...]
  check-learning-draft <材料包目录> <草稿 JSON> --part N [--part N ...] [--out <新候选文件>]

筛选：--q 关键词 --title 标题 --from YYYY-MM-DD --to YYYY-MM-DD
      --course 课程 --topic 主题 --conversation ID（可重复） --has-image --has-missing
source/context 可加 --digest SHA256 [--entry PATH --ordinal N] 读取指定导出中的记录。
默认数据库为仓库内 .wrangler/history/index.sqlite。显式查询会在本地终端输出私人内容。`;

function integer(value: string | undefined) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new HistoryError("INVALID_INTEGER");
  return number;
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["help", "--help", "-h"].includes(command) || args.includes("--help")) {
    process.stdout.write(usage + "\n");
    return;
  }
  if (!Object.hasOwn(optionsByCommand, command)) throw new HistoryError("UNKNOWN_HISTORY_COMMAND");
  const name = command as keyof typeof optionsByCommand;
  const options: ParseArgsOptionsConfig = { db: textOption, ...optionsByCommand[name] };
  const { positionals, values } = parseArgs({ args, options, allowPositionals: true });
  const positionCount = name === "raw" || name === "tag" ? 3 : name === "search" || name === "create-batch" ? 0
    : name === "check-learning-draft" ? 2 : 1;
  if (positionals.length !== positionCount) throw new HistoryError("INVALID_HISTORY_ARGUMENTS");
  const [id, second, third] = positionals;
  if (name === "material-scope" || name === "check-learning-draft") {
    const { checkLearningDraft, materialScope, readLearningDraft } = await import("./learning-draft.ts");
    const { readMaterialSelection } = await import("./material-reader.ts");
    const parts = ((values.part ?? []) as string[]).map((value) => integer(value)!);
    if (name === "material-scope") return materialScope(await readMaterialSelection(id, parts));
    const draft = await readLearningDraft(second);
    const result = await checkLearningDraft(id, draft, parts);
    if (!result.valid) process.exitCode = 1;
    else if (typeof values.out === "string") {
      await writeFile(values.out, JSON.stringify(draft.batch), { flag: "wx", mode: 0o600 });
    }
    return result;
  }
  const dbPath = typeof values.db === "string" ? resolve(values.db)
    : fileURLToPath(new URL("../.wrangler/history/index.sqlite", import.meta.url));
  function string(key: string) {
    const value = values[key];
    return typeof value === "string" ? value : undefined;
  }
  const page = { limit: integer(string("limit")), after: string("after") };
  const digest = string("digest");
  const entryPath = string("entry");
  const ordinal = integer(string("ordinal"));
  const revisionHash = string("revision");
  const occurrence = digest ? { digest, entryPath, ordinal } : undefined;
  const filter = {
    query: string("q"), title: string("title"), from: string("from"), to: string("to"),
    course: string("course"), topic: string("topic"), conversationIds: values.conversation as string[] | undefined,
    hasImage: values["has-image"] === true ? true : undefined,
    hasMissing: values["has-missing"] === true ? true : undefined,
  };
  if ((entryPath !== undefined || ordinal !== undefined) && !digest) throw new HistoryError("OCCURRENCE_DIGEST_REQUIRED");
  const store = new HistoryStore(dbPath);
  try {
    switch (name) {
      case "import": {
        const controller = new AbortController();
        const interrupt = () => controller.abort();
        process.once("SIGINT", interrupt);
        try {
          return await importHistory(id, store, { signal: controller.signal });
        } finally {
          process.off("SIGINT", interrupt);
        }
      }
      case "status": return store.exportStatus(id);
      case "diagnostics": return store.diagnostics(id, page);
      case "search": return store.search({ ...filter, ...page });
      case "context": {
        const branchNodeId = string("branch-node");
        const currentBranchOnly = values["current-branch"] === true;
        if (branchNodeId && currentBranchOnly) throw new HistoryError("INVALID_BRANCH_SELECTION");
        const target = id.startsWith("chatgpt:message:") ? { sourceId: id } : { conversationId: id };
        return store.context({ ...target, ...occurrence, ...page, revisionHash, currentBranchOnly, branchNodeId });
      }
      case "source": return store.getSource(id, revisionHash, occurrence);
      case "occurrences": return store.sourceOccurrences(id, page);
      case "raw": return store.getRawConversation({ digest: id, entryPath: second, ordinal: integer(third)! });
      case "tag": {
        if (second !== "course" && second !== "topic") throw new HistoryError("INVALID_TAG_KIND");
        store.tagConversation(id, second, third);
        return { conversationId: id, kind: second, label: third };
      }
      case "create-batch": return store.createBatch({ ...filter, matchConversations: values["matching-messages"] !== true }, string("label"));
      case "batch": return store.readBatch(id, page);
      case "export-batch": {
        const output = string("out");
        if (!output?.trim()) throw new HistoryError("MATERIAL_OUTPUT_REQUIRED");
        const controller = new AbortController();
        const interrupt = () => controller.abort();
        process.once("SIGINT", interrupt);
        try {
          return await exportMaterialBatch(store, id, output, {
            maxJsonKiB: integer(string("max-json-kib")), signal: controller.signal,
          });
        } finally {
          process.off("SIGINT", interrupt);
        }
      }
    }
  } finally {
    store.close();
  }
}

try {
  const result = await run();
  if (result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  const code = historyErrorCode(error);
  const digest = error instanceof HistoryError ? error.exportDigest : undefined;
  process.stderr.write(JSON.stringify({ error: { code, digest } }) + "\n");
  process.exitCode = code === "IMPORT_INTERRUPTED" || code === "MATERIAL_EXPORT_INTERRUPTED" ? 130 : 1;
}
