import { z } from "zod";
import { idSchema } from "@/domain/catalog";
import { contextCandidateIssues, contextImportNamespace, contextSourceIssues } from "@/domain/context-reference";
import { fieldValue, valueType } from "@/domain/input-details";
import { Problem } from "@/domain/problem";
import { revisionNumber } from "@/domain/questions";
import { sha256 } from "@/lib/hash";
import { validateV1, validateV11, validateV12 } from "virtual:question-import-validators";
import type { SourceLocation } from "@/history/store";
import type { ImageMime } from "@/lib/image-signatures";

export type CourseRef = { id: string } | { name: string };
export type TopicRef = { id: string } | { course_ref: CourseRef; title: string; chapter_path?: string[] };
export type HistoryMessageReference = { role: string; location: SourceLocation };
export type Evidence = {
  source_key: string; locator: string; quote: string;
  speaker: "learner" | "assistant" | "source_author" | "unknown";
  history?: HistoryMessageReference;
};
export type HistoryImageReference = {
  source_key: string; locator: string; history: HistoryMessageReference;
  attachment_index: number; sha256: string; mime_type: ImageMime; byte_size: number;
};
type Origin = "quoted" | "transcribed" | "source_summary" | "ai_generated";
export type ImportText = { markdown: string; origin: Origin; evidence?: Evidence[] };
export type ImportSource = {
  source_key: string; external_id?: string; kind: "chat" | "textbook" | "ppt" | "pdf" | "photo" | "manual" | "other";
  title: string; occurred_on: string | null; external_url?: string | null;
  acquisition_status: "available" | "partial" | "unavailable";
};
type Notes = {
  id: string; basis?: ImportText; strategy?: ImportText; explanation?: ImportText;
  ai_explanation_md?: string; topic_refs?: TopicRef[];
};
export type ImportAttempt = {
  external_id: string; original_work: { markdown: string; evidence: Evidence[] };
  attempted_on?: string | null; attempted_at?: string | null; outcome?: "unknown" | "correct" | "partial" | "incorrect";
  outcome_evidence?: Evidence[]; error_analysis?: ImportText; correction?: ImportText; insight?: ImportText;
};
type ImportGap = { field_path: string; status: "missing" | "unavailable" | "needs_verification"; note: string };
export type ImportCandidate = {
  item_key: string; external_id: string;
  title?: string; source_keys?: string[]; source_date?: string | null;
  statement?: ImportText; primary_course_ref?: CourseRef | null; topic_refs?: TopicRef[];
  difficulty?: number | null; final_answer?: ImportText; key_techniques?: ImportText;
  solution_steps?: (Notes & { title: string; body: ImportText })[];
  solution_document?: {
    body: ImportText; annotations?: (Notes & { label?: string; common_mistakes?: ImportText })[]; step_anchor_ids?: string[];
  };
  evidenced_mistakes?: {
    id: string; step_id?: string; kind: "observed_learner_error" | "documented_pitfall";
    description_md: string; evidence: Evidence[];
  }[];
  learner_questions?: { id: string; annotation_id?: string; question_md: string; evidence: Evidence[] }[];
  ai_notes_md?: string;
  gaps?: ImportGap[];
  original_asset_ids?: string[];
  history_images?: HistoryImageReference[];
} & (
  | { operation: "create"; attempts?: ImportAttempt[] }
  | { operation: "propose_update"; target_id: string; expected_version: number; attempts?: never }
);

type LearnerEvidence = Evidence & { speaker: "learner" };
export type TopicSection = {
  id: string;
  kind: "definition" | "formula" | "theorem" | "proof" | "intuition" | "derivation" | "method";
  title?: string;
  content: ImportText;
};
export type TopicImportCandidate = {
  kind: "topic";
  item_key: string; external_id: string;
  title?: string;
  course_ref?: CourseRef | null;
  chapter_path?: string[];
  summary?: ImportText;
  sections?: TopicSection[];
  learner_questions?: { id: string; question_md: string; evidence: LearnerEvidence[] }[];
  evidenced_mistakes?: { id: string; description_md: string; evidence: LearnerEvidence[] }[];
  related_topic_refs?: TopicRef[];
  related_question_refs?: ({ id: string } | { item_key: string })[];
  source_keys?: string[];
  ai_notes_md?: string;
  gaps?: ImportGap[];
} & (
  | { operation: "create" }
  | { operation: "propose_update"; target_id: string; expected_version: number }
);

export type AnyImportCandidate = ImportCandidate | TopicImportCandidate;

export function isTopicCandidate(candidate: AnyImportCandidate): candidate is TopicImportCandidate {
  return "kind" in candidate && candidate.kind === "topic";
}

export type ImportBatch = {
  schema_version: "1.0" | "1.1" | "1.2"; namespace: string; batch_key: string;
  sources: ImportSource[]; items: AnyImportCandidate[];
};
export type ImportIssue = { path: string; code: string; message: string; severity: "blocking" | "notice" };

const topicPath = /^\/(?:topic_refs|related_topic_refs|solution_steps\/[a-z0-9-]+\/topic_refs|solution_document\/annotations\/[a-z0-9-]+\/topic_refs)\/(?:0|[1-9]\d?)$/;
const mapping = z.object({
  courseId: idSchema.optional(),
  chapterId: idSchema.nullable().optional(),
  topicIdsByPath: z.record(z.string().regex(topicPath), idSchema.nullable()).refine(
    (entries) => Object.keys(entries).length <= 1104, "知识点映射过多。",
  ).optional(),
  target: z.object({ questionId: idSchema, expectedVersion: revisionNumber }).strict().optional(),
  topicTarget: z.object({ topicId: idSchema, expectedVersion: revisionNumber }).strict().optional(),
}).strict();
export type ImportMapping = z.infer<typeof mapping>;

export const importEdit = z.object({
  mapping: mapping.optional(),
  candidate: z.unknown().optional(),
}).strict().refine((value) => value.mapping !== undefined || value.candidate !== undefined, "请输入映射或候选修订。");

const itemVersion = z.object({ itemId: idSchema, rowVersion: revisionNumber }).strict();
const approval = itemVersion.extend({
  action: z.literal("approve"),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeDuplicates: z.boolean().optional(),
}).strict();
export const importReview = z.object({
  decisions: z.array(z.union([
    approval,
    itemVersion.extend({ action: z.enum(["reject", "skip"]) }).strict(),
  ])).min(1).max(50),
}).strict().refine(({ decisions }) => distinctItems(decisions), "同一项只能有一个决定。");

export const importCommit = z.object({ items: z.array(itemVersion).min(1).max(8) }).strict()
  .refine(({ items }) => distinctItems(items), "同一项只能提交一次。");

function distinctItems(items: { itemId: string }[]) {
  return new Set(items.map(({ itemId }) => itemId)).size === items.length;
}

export function pointer(parts: (string | number)[]) {
  return parts.map((part) => "/" + String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

function validateContextImport(batch: ImportBatch) {
  if (batch.schema_version !== "1.2") {
    throw new Problem(422, "IMPORT_SCHEMA", "对话可见片段须使用 v1.2。", [
      { path: "/schema_version", message: "chatgpt-context 须使用 v1.2。" },
    ]);
  }
  const issues = [
    ...contextSourceIssues(batch.sources),
    ...batch.items.flatMap((item, index) => contextCandidateIssues(item)
      .map((issue) => ({ ...issue, path: `/items/${index}` + issue.path }))),
  ];
  if (issues.length) {
    throw new Problem(422, "CONTEXT_EVIDENCE_INVALID", "请检查对话可见片段的证据格式。",
      issues.slice(0, 20).map(({ path, code, message }) => ({ path, code, message, suggestion: message })));
  }
}

export function validateImport(value: unknown): ImportBatch {
  const version = (value as Partial<ImportBatch> | null)?.schema_version;
  if (version !== "1.0" && version !== "1.1" && version !== "1.2") {
    throw new Problem(422, "IMPORT_SCHEMA", "请选择受支持的导入批次。", [
      { path: "/schema_version", expected: "1.0 | 1.1 | 1.2", actual: valueType(version), message: "支持 v1.0、v1.1 和 v1.2。", suggestion: "填写对应契约的版本字符串。" },
    ]);
  }
  const validate = version === "1.0" ? validateV1 : version === "1.1" ? validateV11 : validateV12;
  if (!validate(value)) {
    const errors = (validate.errors ?? []).filter(({ keyword }) => keyword !== "if");
    const specific = errors.filter(({ keyword }) => keyword !== "anyOf" && keyword !== "oneOf");
    const fields = [...new Map((specific.length ? specific : errors).map((error) => {
      const path = error.instancePath + pointer(error.keyword === "required" ? [error.params.missingProperty]
        : error.keyword === "additionalProperties" ? [error.params.additionalProperty] : []);
      const parts = path.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
      const expected = error.keyword === "type" ? error.params.type as string
        : error.keyword === "required" ? "required field"
        : error.keyword === "additionalProperties" || error.keyword === "false schema" ? "omitted"
        : error.keyword === "enum" ? (error.params.allowedValues as unknown[]).join(" | ")
        : error.keyword === "const" ? String(error.params.allowedValue)
        : error.message ?? error.keyword;
      const suggestion = expected === "omitted" ? "Remove this field."
        : error.keyword === "type" ? `Use a value of type ${expected}.`
        : error.keyword === "required" ? "Supply this required field."
        : error.message ?? error.keyword;
      return [path + "\n" + expected, { path, expected, actual: valueType(fieldValue(value, parts)), suggestion,
        message: `不符合导入契约（${error.message ?? error.keyword}）。` }] as const;
    })).values()].slice(0, 20);
    const items = (value as { items?: { kind?: unknown }[] }).items;
    const invalidTopic = version === "1.2" && Array.isArray(items) && fields.some(({ path }) => {
      const match = /^\/items\/(\d+)(?:\/|$)/.exec(path);
      return match && items[Number(match[1])]?.kind === "topic";
    });
    throw new Problem(422, "IMPORT_SCHEMA", invalidTopic
      ? "知识点候选不符合 v1.2 契约。请按字段错误修正并保留知识点类型。"
      : "JSON 不符合导入契约。", fields);
  }
  const batch = value as ImportBatch;
  if (batch.namespace === contextImportNamespace) validateContextImport(batch);
  return batch;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function importDigest(value: unknown) {
  return sha256(new TextEncoder().encode(canonicalJson(value)));
}
