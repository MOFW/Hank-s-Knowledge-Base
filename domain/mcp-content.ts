import { z } from "zod";
import { idSchema } from "@/domain/catalog";

const keyPattern = "^[a-zA-Z0-9_-]{16,128}$";
export const directMcpInput = z.object({
  operations: z.array(z.unknown()).min(1).max(20),
  idempotencyKey: z.string().regex(new RegExp(keyPattern)).optional(),
  preview: z.boolean().optional(),
  skipInvalid: z.boolean().optional(),
}).strict();
export const recentMcpInput = z.object({ operationId: idSchema.optional(),
  idempotencyKey: z.string().regex(new RegExp(keyPattern)).optional() }).strict();

type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false });
const array = (items: Schema, maxItems: number) => ({ type: "array", items, maxItems });
const enumOf = (...values: string[]) => ({ type: "string", enum: values });
const maybe = (field: Schema) => ({ anyOf: [field, { type: "null" }] });
const str = { type: "string" };
const id = { type: "string", format: "uuid" };
const int = { type: "integer", minimum: 0 };
const version = { type: "integer", minimum: 1, description: "Use the rowVersion from the current record." };
const flag = { type: "boolean" };
const selection = array(id, 100);
const mathMarkdown = { ...str, description: "Markdown with inline math in $…$. For a display formula, put opening and closing $$ each on its own line, with a blank line before the opening delimiter." };
const local = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,40}$" };
const target = { id, version };
const ordered = { slug: str, sortOrder: int };
const course = { ...ordered, name: str, descriptionMd: str };
const chapter = { ...ordered, courseId: id, parentId: maybe(id), title: str, descriptionMd: str };
const topic = {
  ...ordered, courseId: maybe(id), chapterId: maybe(id), title: str, summaryMd: str, bodyMd: mathMarkdown,
  supplementMd: { ...maybe(mathMarkdown), description: "Optional existing, useful personal questions, context or extra explanations. Readers can expand this Markdown at the end of the note. Omit to preserve it on edit. Use null to clear it explicitly." },
};
const textEdit = { find: { ...str, description: "Exact literal text. Must appear once in the selected body." }, replace: str };
const basicSolution = { type: "object", description: "Existing HKB solution document or layer object as returned by edit context." };
const teachingText = obj({
  markdown: str, speaker: enumOf("learner", "assistant", "source_author", "new_ai", "owner"),
  origin: enumOf("quoted", "transcribed", "source_summary", "ai_generated", "owner"), evidence: array(basicSolution, 16),
}, ["markdown", "speaker", "origin"]);
const turn = obj({ id: str, learner: teachingText, replies: array(teachingText, 12) }, ["id", "learner", "replies"]);
const thread = obj({ anchorId: str, turns: array(turn, 32) }, ["anchorId", "turns"]);
const alternative = obj({ id: str, title: str, body: teachingText, stepAnchorIds: array(str, 32), threads: array(thread, 32) },
  ["id", "title", "body", "threads"]);
const supplement = obj({ id: str, title: str, body: teachingText, kind: enumOf("method_summary", "clarification", "comparison", "extension") },
  ["id", "title", "body", "kind"]);
const question = {
  title: str, statementMd: mathMarkdown, primaryCourseId: maybe(id), finalAnswerMd: mathMarkdown, keyTechniquesMd: str,
  difficulty: maybe({ type: "integer", minimum: 1, maximum: 5 }), sourceTitle: maybe(str), sourceLocator: maybe(str),
  sourceDate: maybe({ type: "string", format: "date" }), topicIds: array(id, 80), originalAssetIds: array(id, 8),
  solutionSteps: array(basicSolution, 32),
  solutionDocument: maybe(obj({ bodyMd: str, annotations: array(basicSolution, 32), stepAnchorIds: array(str, 32) }, ["bodyMd"])),
  solutionLayers: maybe(obj({
    mainThreads: array(thread, 32), alternatives: array(alternative, 12), supplements: array(supplement, 24),
  }, ["mainThreads", "alternatives", "supplements"])),
};
const attempt = {
  originalWorkMd: maybe(str), errorAnalysisMd: maybe(str), correctionMd: maybe(str), insightMd: maybe(str),
  attemptedAt: maybe({ type: "string", format: "date-time" }),
  outcome: enumOf("unknown", "correct", "partial", "incorrect"),
  correctionAuthorKind: enumOf("unknown", "user", "ai", "mixed"),
};
const merge = { ...target, sources: array(obj(target, ["id", "version"]), 10) };
const relation = obj({
  questionId: id, expectedQuestionVersion: version,
  changes: maybe(obj({ displayRole: enumOf("related", "featured"), displayOrder: int, placementAnchor: maybe(str),
    noteMd: str, useQuestionTechniques: flag })),
}, ["questionId", "expectedQuestionVersion", "changes"]);
const sourceQuote = obj({ sourceKey: str, sourceTitle: str, locator: str, quote: str,
  speaker: enumOf("learner", "assistant", "source_author", "unknown"), history: basicSolution },
["sourceKey", "locator", "quote", "speaker"]);
const at = { anyOf: [{ ...str, description: "A unique literal formula or short passage in the selected method. Identify the reasoning being asked about. The reader positions the question button automatically." },
  obj({ anchorId: str }, ["anchorId"])] };
const answer = {
  answer: str,
  answerFrom: { ...enumOf("discussion", "new_ai"), description: "Use discussion when reusing or faithfully adapting an existing explanation, including a learner's retelling. Omit for new explanations (defaults to new_ai)." },
  answerEvidence: { ...array(sourceQuote, 8), description: "Optional verbatim quotes from the original assistant for a discussion answer. A learner’s retelling can be summarized with answerFrom:discussion and no answerEvidence." },
};
const followUp = { at, question: str,
  questionEvidence: { ...array(sourceQuote, 8), description: "Optional verbatim quotes of the learner’s actual question." }, ...answer };
const followUpFields = ["at", "question", "answer"];
const methodOrganization = {
  alternatives: array(obj({ title: str, markdown: mathMarkdown, followUps: array(obj(followUp, followUpFields), 64) }, ["title", "markdown"]), 12),
  summary: { ...str, description: "Optional existing whole-problem comparison, insight or method summary. Leave absent when the discussion had none." },
};
const solution = obj({ main: mathMarkdown, followUps: array(obj(followUp, followUpFields), 64), ...methodOrganization }, ["main"]);
const organize = obj({
  followUps: array(obj({ ...followUp, method: str }, followUpFields), 64),
  corrections: array(obj({ method: str, at, question: str, turnId: str, reply: version, ...answer }, ["at", "answer"]), 32),
  ...methodOrganization,
});
const example = {
  role: enumOf("related", "featured"), at: maybe(str), order: int, note: str,
};
const examples = { ...array({ oneOf: [
  obj({ topicId: id, topicVersion: version, ...example }, ["topicId", "topicVersion"]),
  obj({ topicKey: local, ...example }, ["topicKey"]),
] }, 20), description: "For an existing note, supply its current version even when editing its text in the same batch. Locate any placement in the revised note." };
const materialIssue = obj({ kind: enumOf("missing_statement", "missing_image", "unidentified", "uncertain_math"), detail: str }, ["kind"]);
const part = (name: string, fields: Record<string, Schema>, required: string[]) =>
  obj({ part: { const: name }, ...fields }, ["part", ...required]);
const operation = (name: string, fields: Record<string, Schema>, required = Object.keys(fields)) =>
  obj({ action: { const: name }, ...fields }, ["action", ...required]);
const save = [
  operation("create_course", { input: obj(course, ["name"]), key: local }, ["input"]),
  operation("update_course", { ...target, patch: obj(course) }),
  operation("create_chapter", { input: obj(chapter, ["title"]), key: local, courseKey: local, parentKey: local }, ["input"]),
  operation("update_chapter", { ...target, patch: obj(chapter) }),
  operation("reorder_reading", { courseId: id, input: obj({
    kind: enumOf("chapter", "topic"), chapterId: maybe(id), items: array(obj({ id, rowVersion: version }, ["id", "rowVersion"]), 10_000),
  }, ["kind", "chapterId", "items"]) }),
  operation("create_topic", { input: obj(topic, ["title", "bodyMd"]), key: local, courseKey: local, chapterKey: local }, ["input"]),
  operation("update_topic", { ...target, patch: obj({ ...topic, relatedTopicIds: selection }) }),
  operation("edit_topic_text", { ...target, append: str, replacement: obj(textEdit, ["find", "replace"]) }, ["id", "version"]),
  operation("merge_topics", merge),
  operation("create_question", {
    input: obj(question, ["title"]), courseKey: local, topicKeys: array(local, 20), requiresOriginalImage: flag,
    solution, examples, materialIssue,
  }, ["input"]),
  operation("update_question", { ...target, patch: obj(question), requiresOriginalImage: flag }, ["id", "version", "patch"]),
  operation("edit_solution", { ...target, organize, examples, materialIssue, edits: array({ oneOf: [
    part("text", { field: enumOf("main", "answer", "techniques"), ...textEdit }, ["field", "find", "replace"]),
    part("alternative", { id: str, value: maybe(alternative) }, ["id", "value"]),
    part("supplement", { id: str, value: maybe(supplement) }, ["id", "value"]),
    part("turn", { id: str, anchorId: str, solutionId: str, value: maybe(turn), moveToAnchorId: str }, ["id", "anchorId", "value"]),
  ] }, 32) }, ["id", "version"]),
  operation("merge_questions", { ...merge, keepTargetSolution: { const: true } }, ["id", "version", "sources"]),
  operation("set_question_links", { ...target, links: array(relation, 20) }),
  operation("create_attempt", { questionId: id, input: obj(attempt) }),
  operation("update_attempt", { ...target, patch: obj(attempt) }),
  operation("update_learning", { ...target, patch: obj({ mastery: enumOf("new", "learning", "familiar", "mastered"),
    isMistake: flag, nextReviewOn: maybe({ type: "string", format: "date" }) }) }),
];
const remove = [
  operation("delete_course", { ...target, destinationId: id, deleteExclusiveIds: selection }, ["id", "version"]),
  operation("delete_chapter", { ...target, destinationId: maybe(id), deleteExclusiveIds: selection }, ["id", "version"]),
  operation("delete_topic", target), operation("delete_question", target), operation("delete_attempt", target),
  operation("clear_learning", { ...target, scope: enumOf("attempts", "state", "all") }), operation("delete_asset", { id }),
];
const key = { type: "string", pattern: keyPattern, description: "Reuse this key and arguments for a retry, change it for a new intent." };
const changes = array(obj({
  kind: enumOf("course", "chapter", "topic", "question", "attempt", "learning", "asset"),
  action: enumOf("create", "update", "delete"), id, rowVersion: version, href: maybe({ type: "string", format: "uri" }), title: str,
}, ["kind", "action", "id", "rowVersion", "href"]), 10_000);
export const directResultSchema = obj({ operationId: maybe(id), outcome: enumOf("apply", "undo", "preview", "skipped"),
  changes, canUndo: flag, assetCleanupPending: flag,
  failures: array(obj({ index: int, code: str, message: str }, ["index", "code", "message"]), 20),
}, ["operationId", "outcome", "changes", "canUndo", "assetCleanupPending"]);
const annotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

export const mcpContentTools = [
  {
    name: "save_knowledge_content", title: "Save or edit knowledge content",
    description: [
      "Organize the learning conversation by intent. Save a reusable concept, conditions, or general method as a coherent note, even when an exercise prompted it. Save a complete exercise when useful on its own or as an example in the note. A conversation may need only a note or only an exercise.",
      "Write bodyMd as standalone textbook prose. Integrate useful general questions as explanations in the relevant section. Use the existing featured relation for an exercise and keep its complete solution and problem-specific follow-ups in the question reader. Use optional supplementMd for useful personal questions, extra explanations or context already discussed. Drop contextless remarks and routine labels for raw questions, learner or assistant quotes, learner notes, chat steps and source locators.",
      "Reuse correct wording, formulas, code, images, complete solutions and actual follow-up questions and answers as far as they fit. Apply only the needed deduplication, formatting and structure. Do not generate optional summaries, analyses, proofs, background or supplements to fill fields. Leave numbering, defaults and rendering to the app. For a local edit change only the requested material. When reorganizing a note, preserve images, example links and reading order. Keep existing example anchors when possible, or update affected placements in the same save using the revised text.",
      "Search for matching notes and exercises before writing. Supplement missing coverage or useful example links in existing records. Use a suitable existing course and chapter or leave placement unset. Clarify only when the intended target or scope remains materially ambiguous.",
      "Make one save per user request when possible so the changes can be undone together. Include a new note and its example in the same batch using create_topic.key and examples.topicKey. If essential question material is missing, mention the gap and save the verified knowledge in the same batch.",
      "For each exercise preserve the continuous main solution, complete alternative methods and each method’s own follow-ups. Use edit_solution.organize to add or correct locally. Choose the relevant method and a unique formula or passage for each follow-up. Quote evidence is optional.",
    ].join(" "),
    inputSchema: { ...obj({ operations: { ...array({ oneOf: save }, 20), minItems: 1 }, idempotencyKey: key, preview: flag, skipInvalid: flag }, ["operations"]),
      examples: [
        { operations: [{ action: "create_question", input: { title: "平方函数求导", statementMd: "求 $x^2$ 的导数。" },
          solution: { main: "由幂函数求导法则，$f'(x)=2x$。" } }] },
        { operations: [
          { action: "create_topic", key: "difference-of-squares", input: { title: "平方差公式",
            bodyMd: "两个平方相减，可以写成两项之差与两项之和的乘积。" } },
          { action: "create_question", input: { title: "平方差", statementMd: "分解 $a^2-b^2$。" },
            examples: [{ topicKey: "difference-of-squares", role: "featured" }],
            solution: { main: "利用平方差公式，$a^2-b^2=(a-b)(a+b)$。",
              followUps: [{ at: "(a-b)(a+b)", question: "交叉项去哪了？", answer: "展开后 $ab-ba=0$。" }] } },
        ] },
      ] },
    output: directResultSchema, annotations,
  },
  {
    name: "delete_knowledge_content", title: "Delete specified knowledge content",
    description: "Execute an explicitly requested deletion of identified records. Group related deletions into one operation. Course and chapter deletion retain learning material by default. To delete exclusive material, supply exact IDs after checking the scope in directory context; shared material is protected. Clear only the requested learning records. Detach referenced originals in a question edit before removing unused attachments.",
    inputSchema: obj({ operations: { ...array({ oneOf: remove }, 20), minItems: 1 }, idempotencyKey: key, preview: flag }, ["operations"]),
    output: directResultSchema, annotations,
  },
  {
    name: "recent_knowledge_operation", title: "Check or undo the latest content operation",
    description: "Call with {} to see the latest operation and whether it can be undone. To undo a clear user request, pass the operationId from that lookup or the latest write receipt. Undo restores the entire batch, subject to later changes.",
    inputSchema: obj({ operationId: id, idempotencyKey: key }),
    output: { oneOf: [directResultSchema, obj({ latest: maybe(obj({
      operationId: id, createdAt: str, changes, canUndo: flag,
    }, ["operationId", "createdAt", "changes", "canUndo"])) }, ["latest"])] }, annotations,
  },
];

export const deletionCommand = (action: string) => action.startsWith("delete_") || action === "clear_learning";
