import { z } from "zod";
import { idSchema } from "@/domain/catalog";
import { contextImportNamespace } from "@/domain/context-reference";
import { zodInputDetails } from "@/domain/input-details";
import { taskCoverage } from "@/domain/import-task";
import { importDigest, pointer, type AnyImportCandidate, type Evidence, type ImportBatch, type ImportCandidate, type ImportText } from "@/domain/imports";
import { Problem } from "@/domain/problem";
import { canonicalAnnotationIds, solutionAnnotationPositions } from "@/lib/solution-anchors";

const text = (max: number) => z.string().max(max).regex(/\S/);
const short = text(2000);
const quote = z.object({ locator: text(291), quote: text(16384) }).strict();
const evidence = quote.extend({ speaker: z.enum(["learner", "assistant", "source_author", "unknown"]) });
const anchor = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const followUp = quote.extend({
  question: text(16384).optional(), anchor: anchor.optional(),
  assistant: quote.optional(), aiExplanation: text(16384).optional(),
});
const sectionKinds = ["definition", "formula", "theorem", "proof", "intuition", "derivation", "method"] as const;
const common = {
  title: text(120), courseId: idSchema.optional(), topicIds: z.array(idSchema).max(8).optional(),
  courseNote: short.optional(), evidence: z.array(evidence).min(1).max(8).optional(),
};
const question = z.object({
  ...common, kind: z.literal("question").optional(), statement: text(131072).optional(),
  statementOrigin: z.enum(["quoted", "transcribed", "source_summary"]).optional(),
  solution: text(131072).optional(), techniques: text(131072).optional(),
  followUps: z.array(followUp).max(16).optional(),
  originalAssetIds: z.array(idSchema).max(8).optional(),
  missingOriginalImage: short.optional(), missingStatement: short.optional(),
}).strict();
const topic = z.object({
  ...common, kind: z.literal("topic"), note: text(32768), sectionKind: z.enum(sectionKinds),
  evidence: z.array(evidence).min(1).max(8),
}).strict();

export const quickImportInput = z.object({
  sourceTitle: text(200), readableScope: short, coverage: z.enum(taskCoverage).default("unknown"),
  unprocessed: z.array(short).max(8).default([]),
  items: z.array(z.unknown()).min(1).max(5),
}).strict();

const schemaText = (maxLength: number, description?: string) => ({ type: "string", maxLength, pattern: "\\S", description });
const schemaList = (items: object, maxItems: number, minItems = 0) => ({ type: "array", items, minItems, maxItems });
const schemaObject = (properties: Record<string, object>, required: string[]) =>
  ({ type: "object", additionalProperties: false, properties, required });
const uuid = { type: "string", format: "uuid" };
const evidenceFields = {
  locator: schemaText(291, "Findable description of the visible message, e.g. 'exercise prompt'. No invented message IDs."),
  quote: schemaText(16384, "Verbatim visible wording. Preserve original math delimiters in quotes."),
};
const sharedFields = {
  title: schemaText(120), courseId: { ...uuid, description: "Only a verified knowledge-base course ID." },
  topicIds: schemaList(uuid, 8), courseNote: schemaText(2000, "Describe unresolved course options using actual search results."),
  evidence: schemaList(schemaObject({
    ...evidenceFields, speaker: { enum: ["learner", "assistant", "source_author", "unknown"] },
  }, ["locator", "quote", "speaker"]), 8, 1),
};
export const quickImportSchema = schemaObject({
  sourceTitle: schemaText(200, "Title or recognizable label of the visible discussion."),
  readableScope: schemaText(2000, "Describe only the visible material used."),
  coverage: { enum: taskCoverage, default: "unknown", description: "Use complete_material only for an explicitly bounded, fully read source." },
  unprocessed: schemaList(schemaText(2000, "Known material that was left out."), 8),
  items: schemaList({ oneOf: [
    schemaObject({
      ...sharedFields, kind: { const: "question" },
      statement: schemaText(131072, "Actual prompt. Provide its evidence. Omit if missing."),
      statementOrigin: { enum: ["quoted", "transcribed", "source_summary"], default: "quoted" },
      solution: schemaText(131072, "Newly written, checked Markdown solution."),
      techniques: schemaText(131072, "Newly written Markdown strategies and whole-problem clarifications."),
      followUps: schemaList(schemaObject({
        ...evidenceFields,
        question: schemaText(16384, "Optional rendered Markdown for the learner quote."),
        anchor: { type: "string", maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", description: "Use weights for [^hkb-weights] placed at the exact step. Omit for a whole-problem question." },
        assistant: schemaObject(evidenceFields, ["locator", "quote"]),
        aiExplanation: schemaText(16384, "New explanation for the anchored step."),
      }, ["locator", "quote"]), 16),
      originalAssetIds: schemaList(uuid, 8),
      missingOriginalImage: schemaText(2000, "State which required original image is missing. Saves a blocking gap."),
      missingStatement: schemaText(2000, "Explain any missing or incomplete prompt."),
    }, ["title"]),
    schemaObject({ ...sharedFields, kind: { const: "topic" }, note: schemaText(32768, "Faithful Markdown summary of the cited material."),
      sectionKind: { enum: sectionKinds } }, ["kind", "title", "note", "sectionKind", "evidence"]),
  ] }, 5, 1),
}, ["sourceTitle", "readableScope", "items"]);

function inputIssue(path: (number | string)[], expected: string, actual: string, suggestion: string): never {
  throw new Problem(422, "QUICK_IMPORT_INPUT", "请修正短聊提案的指定字段。", [
    { path: pointer(path), expected, actual, suggestion, message: suggestion },
  ]);
}

function invalidQuickInput(error: z.ZodError, input: unknown, path: (number | string)[] = []): never {
  throw new Problem(422, "QUICK_IMPORT_INPUT", "请修正短聊提案的指定字段。", zodInputDetails(
    error.issues.map((issue) => ({ ...issue, path: [...path, ...issue.path] })), input,
  ));
}

const sourceKey = "discussion";
function cite(value: z.infer<typeof quote>, speaker: Evidence["speaker"]): Evidence {
  const locator = value.locator.trim();
  return { source_key: sourceKey, locator: locator.startsWith("context:") ? locator : "context:" + locator, speaker, quote: value.quote };
}

const aiText = (markdown: string): ImportText => ({ origin: "ai_generated", markdown });

function prepareQuestion(item: z.infer<typeof question>, path: (string | number)[], citations: Evidence[]) {
  if (item.statement !== undefined && !citations.length) {
    inputIssue([...path, "evidence"], "题面原话证据数组", "missing", "添加题面原话、发言角色和可查找定位，或省略无法核实的题面并写明缺口。");
  }
  if (item.statementOrigin && !item.statement) {
    inputIssue([...path, "statement"], "提供 statementOrigin 时须有题面字符串", "missing", "提供原题面或省略 statementOrigin。");
  }
  if (citations.length && !item.statement) {
    inputIssue([...path, "evidence"], "仅对应已提供的题面", "array", "提供这些引句所支持的题面，或把实际学习者追问放入 followUps。");
  }
  const annotations = new Map<string, NonNullable<NonNullable<ImportCandidate["solution_document"]>["annotations"]>[number]>();
  const ids = [...new Set(item.followUps?.flatMap(({ anchor }) => anchor ? [anchor] : []))];
  const positions = ids.length && item.solution ? solutionAnnotationPositions(item.solution) : undefined;
  const prefixed = ids.filter((id) => id.startsWith("hkb-"));
  const renamed = item.solution && prefixed.length ? canonicalAnnotationIds(item.solution, prefixed) : undefined;
  const learnerQuestions = item.followUps?.map((entry, index) => {
    const pathToAnchor = [...path, "followUps", index, "anchor"];
    const anchorId = entry.anchor ? renamed?.get(entry.anchor) ?? entry.anchor : undefined;
    if ((entry.assistant || entry.aiExplanation) && !anchorId) {
      inputIssue(pathToAnchor, "解释所对应的公式锚点", "missing", "在解答正文定位对应步骤，填写其标记后缀。整题 AI 补充可放入 techniques。");
    }
    if (anchorId) {
      if (!positions?.has(anchorId)) {
        inputIssue(pathToAnchor, "正文中唯一且放在对应步骤的 [^hkb-ID] 标记", "string", "核对对应步骤，并修订正文标记或 anchor 后缀。");
      }
      const annotation = annotations.get(anchorId) ?? { id: anchorId };
      if (entry.assistant) {
        const explanation = { origin: "quoted" as const, markdown: entry.assistant.quote, evidence: [cite(entry.assistant, "assistant")] };
        if (annotation.explanation && JSON.stringify(annotation.explanation) !== JSON.stringify(explanation)) {
          inputIssue([...path, "followUps", index, "assistant"], "每处锚点共用的一段助手原话", "object", "同一步骤复用同一段原话。需要多段独立注解时使用完整 v1.2 批次。");
        }
        annotation.explanation = explanation;
      }
      if (entry.aiExplanation && annotation.ai_explanation_md !== entry.aiExplanation) {
        annotation.ai_explanation_md = [annotation.ai_explanation_md, entry.aiExplanation].filter(Boolean).join("\n\n");
      }
      annotations.set(anchorId, annotation);
    }
    return { id: "follow-up-" + (index + 1), annotation_id: anchorId, question_md: entry.question ?? entry.quote, evidence: [cite(entry, "learner")] };
  });
  const hasAssets = Boolean(item.originalAssetIds?.length);
  const gaps: ImportCandidate["gaps"] = [];
  if (item.missingOriginalImage) gaps.push({ field_path: "/original_asset_ids", status: "missing", note: item.missingOriginalImage });
  if (item.missingStatement || !item.statement && !hasAssets) {
    gaps.push({ field_path: "/statement", status: item.statement ? "needs_verification" : "missing",
      note: item.missingStatement ?? "提案未提供题干或已登记的原图。" });
  }
  return {
    statement: item.statement ? { origin: item.statementOrigin ?? "quoted", markdown: item.statement, evidence: citations } : undefined,
    solution_document: item.solution ? { body: aiText(item.solution), annotations: annotations.size ? [...annotations.values()] : undefined } : undefined,
    key_techniques: item.techniques ? aiText(item.techniques) : undefined,
    learner_questions: learnerQuestions, original_asset_ids: item.originalAssetIds ? [...new Set(item.originalAssetIds)] : undefined,
    gaps: gaps.length ? gaps : undefined,
  };
}

export async function prepareQuickImport(value: unknown) {
  const parsed = quickImportInput.safeParse(value);
  if (!parsed.success) invalidQuickInput(parsed.error, value);
  const quick = parsed.data;
  const distinct = new Set<string>();
  const items: AnyImportCandidate[] = [];
  for (const [index, raw] of quick.items.entries()) {
    const path = ["items", index];
    const result = (raw && typeof raw === "object" && "kind" in raw && raw.kind === "topic" ? topic : question).safeParse(raw);
    if (!result.success) invalidQuickInput(result.error, value, path);
    const item = result.data;
    const citations = (item.evidence ?? []).map((entry) => cite(entry, entry.speaker));
    const detail = item.kind === "topic" ? undefined : prepareQuestion(item, path, citations);
    const identity = item.kind === "topic" ? item.title : item.statement ?? item.title;
    const key = "quick-" + await importDigest([quick.sourceTitle, item.kind ?? "question", identity]);
    if (distinct.has(key)) {
      inputIssue(path, "每道题或同名知识点一个候选", "duplicate", "将同题追问或知识点材料合并到同一候选。");
    }
    distinct.add(key);
    const course = item.courseId ? { id: item.courseId } : undefined;
    const topics = item.topicIds?.map((id) => ({ id }));
    const shared = {
      operation: "create" as const, item_key: key, external_id: key, title: item.title,
      source_keys: citations.length || detail?.learner_questions?.length ? [sourceKey] : [],
      ai_notes_md: item.courseNote,
    };
    items.push(item.kind === "topic" ? {
      ...shared, kind: "topic", course_ref: course, related_topic_refs: topics, sections: [{
        id: "note", kind: item.sectionKind, content: { origin: "source_summary", markdown: item.note, evidence: citations },
      }],
    } : { ...shared, primary_course_ref: course, topic_refs: topics, ...detail });
  }
  const content = {
    schema_version: "1.2", namespace: contextImportNamespace, items,
    sources: [{ source_key: sourceKey, kind: "chat", title: quick.sourceTitle, occurred_on: null, acquisition_status: "partial" }],
  } satisfies Omit<ImportBatch, "batch_key">;
  return {
    batch: { ...content, batch_key: "quick-" + await importDigest(content) },
    scope: { readable: quick.readableScope, coverage: quick.coverage, unprocessed: quick.unprocessed },
  };
}
