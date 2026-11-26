import { z } from "zod";
import importV1 from "@/contracts/question-import-v1.schema.json";
import importV11 from "@/contracts/question-import-v1.1.schema.json";
import importV12 from "@/contracts/learning-import-v1.2.schema.json";
import { idSchema } from "@/domain/catalog";
import { gapKinds, segmentRelations, segmentStates, taskCoverage, taskSpeakers, taskUnitKinds } from "@/domain/import-task";
import { quickImportSchema } from "@/domain/quick-learning-import";
import { searchInput } from "@/domain/search";
import { mcpContentTools } from "@/domain/mcp-content";

const limit = z.number().int().min(1).max(100);
export const mcpSearchInput = searchInput.pick({
  q: true, kind: true, courseId: true, scope: true, chapterId: true,
  topicIds: true, topicMode: true, cursor: true, mastery: true, dueBefore: true,
}).extend({
  limit: limit.optional(), difficulty: z.number().int().min(1).max(5).optional(), isMistake: z.boolean().optional(),
}).strict();
export const mcpContextInput = z.union([
  z.object({ topicId: idSchema, limit: limit.optional(), cursor: searchInput.shape.cursor,
    view: z.enum(["edit", "summary"]).optional() }).strict(),
  z.object({ questionId: idSchema, view: z.enum(["edit", "summary", "attempts", "solution_index"]).optional(),
    limit: limit.optional(), before: idSchema.optional() }).strict(),
  z.object({ courseId: idSchema, view: z.enum(["directory", "delete_scope"]).optional() }).strict(),
  z.object({ courses: z.literal(true) }).strict(),
  z.object({ chapterId: idSchema, view: z.literal("delete_scope").optional() }).strict(),
  z.object({ assetId: idSchema }).strict(),
  z.object({ assets: z.literal(true), before: idSchema.optional() }).strict(),
  z.object({ attemptId: idSchema }).strict(),
]);
export const mcpBatchInput = z.object({ batchId: idSchema }).strict();
const idempotencyKeyPattern = "^[a-zA-Z0-9_-]{16,128}$";
export const mcpProposalInput = z.object({
  batch: z.custom<Record<string, unknown>>((value) =>
    value !== null && typeof value === "object" && !Array.isArray(value), "请提供候选批次对象。").optional(),
  quick: z.unknown().optional(),
  idempotencyKey: z.string().regex(new RegExp(idempotencyKeyPattern)).optional(),
}).strict().refine(({ batch, quick }) => (batch === undefined) !== (quick === undefined), {
  path: ["quick"], message: "Provide exactly one of quick (short discussion) or batch (full import).",
});

type JsonSchema = Record<string, unknown>;

function object(properties: Record<string, JsonSchema>, required = Object.keys(properties)) {
  return { type: "object", additionalProperties: false, properties, required };
}

const array = (items: JsonSchema) => ({ type: "array", items });
const nullable = (schema: JsonSchema) => ({ anyOf: [schema, { type: "null" }] });
const strings = (values: string[]) => ({ type: "string", enum: values });
const string = { type: "string" };
const integer = { type: "integer" };
const boolean = { type: "boolean" };
const id = { type: "string", format: "uuid" };
const href = { type: "string", format: "uri" };
const pageLimit = { type: "integer", minimum: 1, maximum: 100, default: 20 };
const pageCursor = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,250}$" };
const paged = (item: JsonSchema) => object({ items: array(item), nextCursor: nullable(pageCursor) });
const version = { type: "integer", minimum: 1 };
const course = object({ id, name: string, descriptionMd: string, rowVersion: version, sortOrder: integer, href }, ["id", "name", "rowVersion", "href"]);
const chapter = object({ id, parentId: nullable(id), title: string, sortOrder: integer, rowVersion: version }, ["id", "parentId", "title"]);
const questionSummary = {
  id, title: string, primaryCourseId: nullable(id), courseName: string, difficulty: nullable(integer), rowVersion: version, href,
};
const questionTopic = object({
  id, title: string, courseId: nullable(id), courseName: string, chapterId: nullable(id), chapterTitle: nullable(string), href,
});
const topic = object({
  id, title: string, courseId: nullable(id), chapterId: nullable(id), summaryMd: string, bodyMd: string, supplementMd: nullable(string), rowVersion: version,
  href, sortOrder: integer,
}, ["id", "title", "courseId", "chapterId", "summaryMd", "rowVersion", "href"]);
const solutionNotes = {
  id: string, basisMd: string, strategyMd: string, explanationMd: string, aiExplanationMd: string,
  commonMistakesMd: string, topicIds: array(id),
};
const noteOrigin = strings(["assistant", "source", "ai_generated"]);
const annotation = object({
  ...solutionNotes, label: string, learnerQuestionsMd: array(string),
  noteOrigins: object({
    basisMd: noteOrigin, strategyMd: noteOrigin, explanationMd: noteOrigin, commonMistakesMd: noteOrigin,
  }, []),
}, Object.keys(solutionNotes));
const solutionDocument = object({
  bodyMd: string, annotations: array(annotation), stepAnchorIds: array(string),
}, ["bodyMd", "annotations"]);
const questionContentFields = {
  finalAnswerMd: string, keyTechniquesMd: string, solutionDocument: nullable(solutionDocument),
  solutionSteps: array(object({ ...solutionNotes, title: string, bodyMd: string })),
};
const question = object({
  ...questionSummary, statementMd: string, sourceTitle: nullable(string), sourceLocator: nullable(string),
  sourceDate: nullable(string), originalAssetIds: array(id), ...questionContentFields, solutionLayers: nullable({ type: "object" }),
}, [...Object.keys(questionSummary), "statementMd", "sourceTitle", "sourceLocator", "sourceDate", "originalAssetIds"]);

const importStatus = strings(["pending", "approved", "rejected", "skipped", "conflict", "failed", "committed"]);
const issue = object({ path: string, code: string, message: string, severity: strings(["blocking", "notice"]) });
const importLink = { batchId: id, reviewUrl: href };
const importItem = {
  itemId: id, itemKey: string, status: importStatus, rowVersion: version, questionId: nullable(id),
  committedVersion: nullable(version), issue: nullable(issue),
};
const topicItem = { kind: { const: "topic" }, topicId: nullable(id), topicUrl: nullable(href) };
const duplicate = object({
  id, title: string, version: nullable(version), excerpt: string,
  reason: strings(["statement", "image", "title", "external_id", "batch", "topic_title", "topic_similar"]), href, courseId: nullable(id),
}, ["id", "title", "version", "excerpt", "reason", "href"]);
const courseRef = { oneOf: [object({ id }), object({ name: string })] };
const topicRef = {
  oneOf: [object({ id }), object({ course_ref: courseRef, title: string, chapter_path: array(string) }, ["course_ref", "title"])],
};
const topicMapping = object({
  path: string, ref: topicRef, candidates: array(id), selected: nullable(id),
}, ["path", "ref", "candidates"]);
const reviewFields = {
  ...importItem, externalId: string, title: nullable(string), needsVerification: boolean, issues: array(issue),
  duplicates: array(duplicate), courseCandidates: array(id), courseId: nullable(id), topicMappings: array(topicMapping),
  target: object({ questionId: id, expectedVersion: version }), currentTargetVersion: version, currentTargetTitle: string,
};
const requiredReviewFields = [
  ...Object.keys(importItem), "externalId", "title", "needsVerification", "issues", "duplicates", "courseCandidates", "topicMappings",
];
const topicPlan = object({
  chapterId: nullable(id), target: object({ topicId: id, expectedVersion: version }),
  current: object({ id, title: string, rowVersion: version }),
  relatedTopics: array(object({ id, title: string })),
  relatedQuestions: array(object({ id: nullable(id), title: string, itemKey: string }, ["id", "title"])),
}, ["relatedTopics", "relatedQuestions"]);
const reviewItem = { oneOf: [
  object(reviewFields, requiredReviewFields),
  object({ ...reviewFields, ...topicItem, topicPlan }, [...requiredReviewFields, ...Object.keys(topicItem)]),
] };
const resultItem = { oneOf: [
  object({ ...importItem, questionUrl: nullable(href) }),
  object({ ...importItem, questionUrl: nullable(href), ...topicItem }),
] };
const reviewHistory = object({
  itemId: id, itemVersion: version, createdAt: string,
  action: strings(["edit", "approve", "reject", "skip", "conflict", "failed", "commit"]),
});
const toolError = object({
  error: object({ code: string, message: string, retryable: boolean, fields: {} }, ["code", "message", "retryable"]),
  requestId: id,
});

const result = (success: JsonSchema) => ({ type: "object", anyOf: [success, toolError] });

const contractDefinitions = { importV1, importV11, importV12 };
const contractPrefixes = Object.entries(contractDefinitions).map(([name, { $id }]) => [$id + "#", "#/$defs/" + name] as const);

function bundledImportSchema(schema: typeof importV1 | typeof importV11 | typeof importV12, definition: string) {
  const root = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$id" && key !== "$schema"));
  function rewrite(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== "$ref" || typeof child !== "string") return [key, rewrite(child)];
      if (child.startsWith("#")) return [key, "#/$defs/" + definition + child.slice(1)];
      const prefix = contractPrefixes.find(([source]) => child.startsWith(source));
      return [key, prefix ? prefix[1] + child.slice(prefix[0].length) : child];
    }));
  }
  return rewrite(root);
}

const exampleSource = { source_key: "discussion", kind: "chat", title: "Example discussion", acquisition_status: "partial", occurred_on: null };
const exampleBatch = { schema_version: "1.2", namespace: "chatgpt-context", sources: [exampleSource] };
const exampleItem = { operation: "create", source_keys: [exampleSource.source_key] };
const questionExample = { batch: {
  ...exampleBatch, batch_key: "example-question", items: [{
    ...exampleItem, item_key: "q1", external_id: "example-q1", title: "A derivative",
    statement: { origin: "quoted", markdown: "Find the derivative of $x^2$.", evidence: [{
      source_key: "discussion", locator: "context:exercise prompt", speaker: "learner", quote: "Find the derivative of $x^2$.",
    }] },
  }],
} };
const topicExample = { batch: {
  ...exampleBatch, batch_key: "example-topic", items: [{
    ...exampleItem, kind: "topic", item_key: "t1", external_id: "example-t1", title: "The power rule",
    sections: [{ id: "rule", kind: "formula", content: {
      origin: "source_summary", markdown: "For positive integers $n$, the derivative of $x^n$ is $nx^{n-1}$.", evidence: [{
        source_key: "discussion", locator: "context:power rule explanation", speaker: "assistant",
        quote: "Bring down the positive integer power and reduce the exponent by one.",
      }],
    } }],
  }],
} };

const proposalSchema = {
  ...object({
    batch: {
      ...object({
        schema_version: { type: "string", enum: ["1.1", "1.2"] },
        namespace: { $ref: "#/$defs/importV1/properties/namespace" },
        batch_key: { $ref: "#/$defs/importV1/properties/batch_key" },
        sources: { $ref: "#/$defs/importV1/properties/sources" },
        items: { type: "array", description: "Candidate objects for the selected schema_version." },
      }),
      // Versions are disjoint. Validate the selected contract instead of reporting a batch-level union failure.
      if: { required: ["schema_version"], properties: { schema_version: { const: "1.2" } } },
      then: { $ref: "#/$defs/importV12" },
      else: { $ref: "#/$defs/importV11" },
      description: "v1.1 accepts question-only batches. v1.2 accepts questions, topics, or both. For visible ChatGPT discussion, use schema_version '1.2' and namespace 'chatgpt-context' inside batch.",
    },
    quick: quickImportSchema,
    idempotencyKey: {
      type: "string", pattern: idempotencyKeyPattern, description: "Optional retry key. Reuse with the same batch.",
    },
  }, []),
  oneOf: [{ required: ["quick"] }, { required: ["batch"] }],
  $schema: importV12.$schema,
  $defs: Object.fromEntries(Object.entries(contractDefinitions).map(([name, schema]) => [name, bundledImportSchema(schema, name)])),
  examples: [questionExample, topicExample],
};

const boundedText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const taskScope = object({
  title: boundedText(200), requestedScope: boundedText(2000), readableScope: boundedText(2000),
  coverage: { ...strings([...taskCoverage]), description: "complete_material means only the explicitly provided material is fully readable. Use unknown when chat coverage is unknown." },
});
const segmentOrder = { ...version, maximum: 10_000 };
const gapKind = strings([...gapKinds]);
const position = boundedText(300);
const quote = boundedText(600);
const speaker = strings([...taskSpeakers]);
const taskSegment = object({
  order: segmentOrder, source: boundedText(200), locator: position, status: strings([...segmentStates]),
  note: boundedText(2000), excerpt: quote, overlaps: { ...array(segmentOrder), maxItems: 12 },
  links: { ...array(object({ unitId: id, relation: strings([...segmentRelations]), locator: position, quote, speaker })), maxItems: 24 },
}, ["order", "source", "locator", "status", "note", "overlaps", "links"]);
const taskDraft = object({
  notes: boundedText(4000), nextStep: boundedText(2000),
  citations: { ...array(object({ segmentOrder, locator: position, quote, speaker })), minItems: 1, maxItems: 8 },
});
const taskEvidence = object({
  gapVersion: version, note: boundedText(2000), locator: position, quote, assetId: id, segmentOrder, complete: boolean,
}, ["gapVersion", "note", "locator", "complete"]);
const taskActions: Record<string, { required: string[]; optional?: string[] }> = {
  start: { required: ["idempotencyKey", "scope"] },
  resume: { required: ["taskId"], optional: ["unitId", "segmentOrder"] },
  register: { required: ["taskId", "expectedVersion", "idempotencyKey", "locator", "title", "kind", "identityEvidence"] },
  need_evidence: { required: ["taskId", "expectedVersion", "idempotencyKey", "unitId", "missing"], optional: ["gapKind", "segmentOrder"] },
  record_segment: { required: ["taskId", "expectedVersion", "idempotencyKey", "segment"] },
  save_draft: { required: ["taskId", "expectedVersion", "idempotencyKey", "unitId", "draft"] },
  provide_evidence: { required: ["taskId", "expectedVersion", "idempotencyKey", "unitId", "evidence"] },
  submit: { required: ["taskId", "expectedVersion", "idempotencyKey", "unitId", "materialNote", "sources", "candidate"], optional: ["draftVersion"] },
};
const taskChangeFields = new Set(Object.values(taskActions).flatMap(({ required, optional = [] }) => [...required, ...optional]));
const taskInput = {
  ...object({
    action: strings(Object.keys(taskActions)), taskId: id, unitId: id, expectedVersion: version,
    view: { ...strings(["summary", "unit", "segment"]), description: "Use summary for routine calls. On resume, view unit reads unitId; view segment reads segmentOrder. Omit for the legacy full response." },
    idempotencyKey: { type: "string", pattern: idempotencyKeyPattern }, scope: taskScope,
    locator: { ...boundedText(300), pattern: "^context:\\s*\\S", description: "Stable, findable location of this particular problem within the task material." },
    title: boundedText(200), kind: strings([...taskUnitKinds]), identityEvidence: boundedText(2000), missing: boundedText(2000),
    materialNote: boundedText(2000), gapKind, segmentOrder, draftVersion: version,
    segment: taskSegment, draft: taskDraft, evidence: taskEvidence,
    sources: {
      type: "array", maxItems: 100, items: { type: "object" },
      description: "Unchanged v1.2 chatgpt-context source objects. Supply only available sources.",
    },
    candidate: {
      type: "object",
      description: "One v1.2 candidate without item_key or external_id. Use the same evidence and solution rules as propose_learning_import.",
    },
  }, ["action"]),
  allOf: [...Object.entries(taskActions).map(([action, { required, optional = [] }]) => ({
    if: { properties: { action: { const: action } } },
    then: { required, properties: Object.fromEntries([...taskChangeFields]
      .filter((field) => !required.includes(field) && !optional.includes(field))
      .map((field) => [field, false])) },
  })), {
    if: { properties: { action: { const: "resume" } } },
    then: {
      allOf: [["unit", "unitId"], ["segment", "segmentOrder"]].map(([view, field]) => ({
        if: { required: ["view"], properties: { view: { const: view } } },
        then: { required: [field] }, else: { properties: { [field]: false } },
      })),
    },
    else: { properties: { view: { const: "summary" } } },
  }],
};
const checkpointEvent = {
  oneOf: [
    object({ type: { const: "registered" }, locator: string, title: string, kind: strings([...taskUnitKinds]), identityEvidence: string }),
    object({ type: { const: "needs_evidence" }, missing: string, gapKind, segmentOrder }, ["type", "missing"]),
    object({ type: { const: "segment" }, segment: taskSegment }),
    object({ type: { const: "draft" }, draft: taskDraft, reviewVersion: nullable(version) }),
    object({ type: { const: "evidence" }, evidence: taskEvidence }),
    object({ type: { const: "failed" }, error: object({ code: string, message: string, fields: {} }, ["code", "message"]) }),
    object({ type: { const: "submitted" }, materialNote: string, fingerprint: string }),
  ],
};
const checkpointItem = nullable(object({
  id, status: importStatus, rowVersion: version, issue: nullable(issue),
  questionId: nullable(id), topicId: nullable(id), committedVersion: nullable(version),
}));
const checkpoint = { version, event: checkpointEvent, batchId: nullable(id) };
const preparation = strings(["unprocessed", "drafting", "needs_evidence", "retry", "submitted", "owner_action", "unknown"]);
const unitKind = strings([...taskUnitKinds]);
const taskUnit = object({
  unitId: id, externalId: string, title: string, locator: string, identityEvidence: string, kind: strings([...taskUnitKinds]),
  preparation,
  currentReview: nullable(object({ batchId: nullable(id), item: checkpointItem, issues: nullable(array(issue)) })),
  formalResult: checkpointItem,
  draft: nullable(object({ version, active: boolean, draft: taskDraft })),
  gaps: array(object({
    type: { const: "needs_evidence" }, version, missing: string, gapKind, segmentOrder, provided: boolean,
    supplements: array(object({ version, evidence: taskEvidence })),
  }, ["type", "version", "missing", "provided", "supplements"])),
  checkpoints: array(object({ ...checkpoint, item: checkpointItem, savedAt: string })),
});
const taskHeader = {
  taskId: id, rowVersion: version, scope: taskScope, updatedAt: string, cancelledAt: nullable(string), taskPath: string, taskUrl: href,
  counts: object({
    units: integer, proposed: integer, waitingReview: integer, readyToCommit: integer, committed: integer,
    needsEvidence: integer, retry: integer, unprocessed: integer, ownerAction: integer, unknown: integer, drafting: integer,
  }),
  preparationComplete: boolean, nextUnitId: nullable(id), coverage: object({
    readable: integer, processed: integer, nextOrder: nullable(segmentOrder),
    unregisteredRanges: array(object({ first: segmentOrder, last: segmentOrder })),
  }),
};
const segmentOrders = array(segmentOrder);
const taskOutput = { anyOf: [
  object({ ...taskHeader, units: array(taskUnit), segments: array(taskSegment), saved: nullable(object({ ...checkpoint, unitId: id })) }),
  object({
    ...taskHeader, view: { const: "summary" }, segmentOrders,
    units: array(object({
      unitId: id, title: string, kind: unitKind, preparation, draftVersion: nullable(version),
      batchId: nullable(id), status: nullable(importStatus), reviewUrl: nullable(href),
      committed: boolean, openGapVersions: array(version),
    })),
    nextSegment: nullable(object({ order: segmentOrder, source: string, locator: string, status: strings([...segmentStates]) })),
    nextUnit: nullable(object({
      unitId: id, locator: string, identityEvidence: string,
      gaps: array(object({ version, missing: string, gapKind, segmentOrder }, ["version", "missing"])),
    })),
    saved: nullable(object({
      version, unitId: id, batchId: nullable(id),
      type: strings(["registered", "needs_evidence", "segment", "draft", "evidence", "failed", "submitted"]),
      error: object({ code: string, message: string, fields: {} }, ["code", "message"]),
    }, ["version", "unitId", "batchId", "type"])),
  }),
  object({ ...taskHeader, view: { const: "unit" }, unit: taskUnit, segmentOrders }),
  object({ ...taskHeader, view: { const: "segment" }, segment: taskSegment }),
] };
const quickProposal = object({
  ...importLink, scope: object({ readable: string, coverage: strings([...taskCoverage]), unprocessed: array(string) }),
  counts: object({ questions: integer, topics: integer, waitingReview: integer, readyToCommit: integer, committed: integer, needsVerification: integer }),
  items: array(object({
    itemId: id, kind: unitKind, status: importStatus, title: nullable(string), followUps: integer,
    needsVerification: boolean, possibleDuplicate: boolean, issues: array(issue), reviewUrl: href,
  })),
});

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const solutionCandidateShape = [
  'For newly written content, solution_document.body and optional key_techniques each take one {"origin":"ai_generated","markdown":"..."} object. Do not send an array or add evidence to these ai_generated objects.',
  'learner_questions[].question_md is a Markdown string. Put verbatim learner quotes in the sibling evidence array.',
  'With the Markdown marker [^hkb-weights], use "weights" for both solution_document.annotations[].id and learner_questions[].annotation_id. The hkb- prefix belongs only to the Markdown marker.',
  'For a verbatim explanation from the original assistant, use annotations[].explanation with origin "quoted", markdown, and evidence entries with speaker "assistant". Put newly written explanations in annotations[].ai_explanation_md as a Markdown string.',
  'If a required original image is unavailable, add {"field_path":"/original_asset_ids","status":"missing","note":"..."} to the candidate gaps array.',
].join(" ");

export const knowledgeMcpInstructions = [
  "Use the direct tools to organize what the learner discussed. Identify reusable concepts and complete exercises separately. A matching exercise does not cover a reusable explanation that belongs in a note. Check likely matches for missing content and meaningful example links before deciding nothing needs saving. Add only what is missing, grouping related changes in one save. Use a suitable existing course and chapter or leave placement unset. Create directory entries when the learner requests them.",
  "Reuse existing correct teaching material with minimal changes. Write notes as independently readable knowledge. Integrate useful general questions into the explanation, keep exercise-specific questions with the exercise and link it as a featured example, and put useful non-core discussion in optional supplementMd. Drop conversational filler and routine attribution labels. Preserve actual wording for meaningful exercise follow-ups. Leave optional material absent unless the discussion supplies it. Never expand beyond the discussion unless requested.",
  "One distinctive search is usually enough per target. For a local follow-up edit, start with solution_index. Preserve the main derivation, local questions in their methods, complete alternatives and whole-problem insights. Report official links and gaps. Use recent_knowledge_operation for undo.",
  "Use propose_learning_import with quick or batch for explicitly requested legacy review, and manage_learning_import_task for saved multipart tasks. QuickPath groups follow-ups, actual speakers, quotes and missing originals. Use get_import_result to check the final state of a legacy proposal.",
].join(" ");

export const knowledgeMcpTools = [
  {
    name: "search_knowledge_base",
    title: "Search Hank’s Knowledge Base",
    description: "Locate existing notes, questions or courses with distinctive wording or formulas. Each space-separated term is required. For mixed discussions, check both the reusable concept and the exercise. A match identifies a record to reuse. Read its context as needed to check missing coverage or relationships and get its current version.",
    inputSchema: object({
      q: { type: "string", maxLength: 120, description: "Up to eight required, space-separated keywords." },
      kind: strings(["course", "topic", "question"]),
      courseId: id,
      scope: strings(["primary", "related"]),
      chapterId: id,
      topicIds: { ...array(id), maxItems: 20 },
      topicMode: strings(["any", "all"]),
      limit: pageLimit,
      cursor: pageCursor,
      difficulty: { type: "integer", minimum: 1, maximum: 5 },
      mastery: strings(["new", "learning", "familiar", "mastered"]), isMistake: boolean,
      dueBefore: { type: "string", format: "date" },
    }, []),
    outputSchema: result(paged(object({
      id, kind: strings(["course", "topic", "question"]), title: string, courseId: nullable(id), courseName: string,
      chapterId: nullable(id), chapterTitle: nullable(string), difficulty: nullable(integer), excerpt: string,
      matchSource: nullable(strings(["attempt", "solution"])), href,
    }))),
    annotations: readOnly,
  },
  {
    name: "get_knowledge_context",
    title: "Read knowledge context",
    description: "Read only the context needed. Use courses:true for the ordered course list, courseId with view:'directory' for headings and note versions, and view:'delete_scope' for exclusive material. For notes and questions use view:'summary' to omit long solutions or body, or view:'edit' for complete content and versions. Use questionId with view:'solution_index' for method titles and existing follow-up positions; view:'attempts' lists learner work. Use attemptId for one attempt and assetId or assets:true for originals.",
    inputSchema: {
      type: "object",
      oneOf: [
        object({ topicId: id, limit: pageLimit, cursor: pageCursor, view: strings(["edit", "summary"]) }, ["topicId"]),
        object({ questionId: id, view: strings(["edit", "summary", "attempts", "solution_index"]), limit: pageLimit, before: id }, ["questionId"]),
        object({ courseId: id, view: strings(["directory", "delete_scope"]) }, ["courseId"]),
        object({ courses: { const: true } }),
        object({ chapterId: id, view: { const: "delete_scope" } }, ["chapterId"]),
        object({ assetId: id }), object({ assets: { const: true }, before: id }, ["assets"]), object({ attemptId: id }),
      ],
    },
    outputSchema: result({
      type: "object",
      oneOf: [
        object({ topic, course: nullable(course), relatedQuestions: paged(object(questionSummary)),
          relatedTopics: array({ type: "object" }), relationships: array({ type: "object" }), placements: array({ type: "object" }) },
        ["topic", "course", "relatedQuestions"]),
        object({ question, course: nullable(course), topics: array(questionTopic), learningState: nullable({ type: "object" }),
          originals: array({ type: "object" }), sourceReferences: array({ type: "object" }), solutionLocations: array({ type: "object" }) },
        ["question", "course", "topics"]),
        object({ course, chapters: array(chapter), notes: array({ type: "object" }), deletionScope: { type: "object" } }, ["course", "chapters"]),
        object({ courses: array(course) }),
        object({ chapter, deletionScope: { type: "object" } }),
        object({ questionId: id, attempts: array({ type: "object" }), nextBefore: nullable(id) }),
        object({ questionId: id, rowVersion: version, methods: array(object({
          id: nullable(string), title: string, placements: array(object({
            anchorId: string, line: integer, text: string,
            turns: array(object({ id: string, question: string, replies: integer })),
          }, ["anchorId", "turns"])),
        })) }),
        object({ attempt: { type: "object" } }), object({ asset: { type: "object" } }),
        object({ assets: array({ type: "object" }), nextBefore: nullable(id) }),
      ],
    }),
    annotations: readOnly,
  },
  {
    name: "propose_learning_import",
    title: "Submit a learning import for review",
    description: [
      "Legacy proposal for explicitly requested review: pass quick with sourceTitle, readableScope and 1–5 items for a short discussion. Use actual verbatim quotes and speakers, merge same-question follow-ups, and mark missing images in missingOriginalImage. The server supplies source and retry identifiers. Report the returned reviewUrl, counts, statuses, issues and known/unknown coverage directly. You may leave courseId unset for owner review. Use batch for legacy updates, attempts, archives or more complex evidence.",
      "For full batches that need placement or duplicate lookup, use search_knowledge_base and get_knowledge_context. Set primary_course_ref for exercises or course_ref for notes and use topic_refs or related_topic_refs with returned IDs only for confirmed matches. When course placement is ambiguous, omit the reference and describe the plausible courses and reasons in ai_notes_md.",
      "v1.1 accepts question-only batches; prefer v1.2 for new proposals. In v1.2 a concept or note is kind:'topic', with sections:[{id,kind,content:{origin,markdown,...}}]; a question is an exercise with no kind field. Real learner work can be an evidenced attempt nested in a new question, never a standalone item or assistant answer. To supplement a note use propose_update, target_id and expected_version, the existing title or no title, and only new material. For a new note use create and a confirmed course_ref and chapter_path if known. On Topic validation failure, report the returned code and field paths; fix and retry as Topic or report it unsubmitted. Do not convert to Question without explicit user agreement.",
      "For a full batch of visible discussion, set batch.schema_version to '1.2' and batch.namespace to 'chatgpt-context'. Use only excerpts you can actually read in this turn. Report when the full reading scope is unknown. Use kind 'chat' in sources, acquisition_status 'partial' for excerpts, and occurred_on null for an unknown source date. Include verbatim quotes with the actual speaker (learner, assistant or source_author), a declared source_key, and a locator starting with 'context:' followed by a findable description. List every evidence.source_key in that item's source_keys and declare each key in batch.sources. Each item needs a usable quote to pass review. Use quoted only when the full field markdown appears verbatim in one of that field's evidence quotes. Use source_summary with evidence for faithful paraphrases and ai_generated without evidence for new content where allowed. Keep the original assistant's words, the learner's words and new AI explanations distinguishable.",
      "Omit unknown source IDs and URLs. Never invent chat IDs, message IDs, or images, or present memories, guesses, or summaries as original evidence. Do not use evidence.history, archive locators, or history_images in chatgpt-context. In original_asset_ids, use only confirmed, already registered originals.",
      "Use $…$ for inline math and $$ fences on their own lines for display math. The site does not render backslash-parenthesis or backslash-bracket delimiters. Preserve evidence.quote verbatim even if the original uses different delimiters. For a faithful reformatted statement use transcribed with its evidence. If a required original image cannot be read or registered, leave /original_asset_ids as a gap. An image placeholder or a recollection is not a complete image or statement.",
      "Merge follow-ups by original problem. Check the math; put the correct continuous solution in solution_document.body and keep error analysis separate. Include the method, required conditions where used, essential derivation and conclusion with every note closed. Put overall strategy, complete alternative solutions, reusable methods and whole-problem clarifications in key_techniques; retain global questions in learner_questions without annotation_id. Keep provenance, editorial notes and unverified hypotheses separate from teaching content.",
      solutionCandidateShape,
      "For each local follow-up, attach a unique [^hkb-ID] immediately after the relevant prose or inline formula, or in its own paragraph directly after the display formula. Use solution_document.annotations[].id and a short label naming the step. Group closely related questions at that step; different steps need different anchors. Put the learner's question in learner_questions with annotation_id and verbatim learner evidence. Use explanation with source-backed assistant evidence for original explanations, ai_explanation_md for new AI additions, and ai_generated for new solution text. Add a reason or intuition; do not hide necessary steps in a note. If placement is uncertain, omit annotation_id, keep the evidenced question and add a needs_verification gap at /learner_questions/<id>/annotation_id. Do not guess a location or leave a meaningful follow-up only in ai_notes_md. A learner's original_work.markdown requires a verbatim learner quote in chatgpt-context.",
      "Leave unknown content absent and record gaps. When the problem statement is missing, omit it and record a /statement gap. Record a missing required image under /original_asset_ids. When the question source is unknown, use empty source_keys. Retry the same payload with the same identifiers and reuse idempotencyKey if supplied.",
      "For batch, use get_import_review with the returned batchId. Summarize distinct problems, merged follow-ups, submitted candidates and statuses, missing evidence, failures and discussions left out. Describe the excerpts actually used and unknown coverage. If review lookup fails, give the proposal's reviewUrl and report that item statuses could not be checked.",
      "The signed-in owner can approve and commit on the review page. If the owner has enabled conditional approval, HKB can commit eligible items after independent review and server validation. Report formal import only after get_import_result confirms the item's status is committed. Use review and record URLs returned by the tools.",
      "Minimal v1.2 examples with synthetic quotes and unresolved courses. Replace the identifiers and evidence with real material. For a corrected request after a batch already exists, edit that candidate in review or use a new batch_key and retry key for changed content.",
      `Question: ${JSON.stringify(questionExample)}\nTopic: ${JSON.stringify(topicExample)}`,
    ].join("\n\n"),
    inputSchema: proposalSchema,
    outputSchema: result({ anyOf: [object(importLink), quickProposal] }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_import_review",
    title: "Check learning import review",
    description: "After proposing, read each candidate's status, verification issues (including unresolved placement or missing evidence), duplicate matches, course and topic mappings, and review history. Use needsVerification and issues to explain what is missing. Possible duplicates need owner review. Return reviewUrl to the owner to check the rendered solution and its annotations, approve and commit. An approved item still awaits commit. Use get_import_result to confirm formal import.",
    inputSchema: object({ batchId: id }),
    outputSchema: result(object({
      ...importLink, namespace: string, batchKey: string, schemaVersion: strings(["1.0", "1.1", "1.2"]),
      createdAt: string, items: array(reviewItem), history: array(reviewHistory),
    })),
    annotations: readOnly,
  },
  {
    name: "get_import_result",
    title: "Check learning import results",
    description: "Use batchId to check each candidate's current status. Report a question or topic as formally imported only when that item's status is committed. Use its questionUrl or topicUrl and committedVersion for the saved record. Report pending, approved, rejected, skipped, conflict, or failed items according to their returned status.",
    inputSchema: object({ batchId: id }),
    outputSchema: result(object({
      ...importLink, items: array(resultItem),
    })),
    annotations: readOnly,
  },
  {
    name: "manage_learning_import_task",
    title: "Save or resume long discussion imports",
    description: [
      "Use for staged legacy processing or an existing task. Direct short saves use save_knowledge_content. Resume the existing taskId or task URL; avoid starting it again. Pass view:'summary' for routine reads and writes. Use view:'unit' for one draft or view:'segment' for one source segment. The omitted view returns the legacy full response.",
      "Start with scope: title, requestedScope, readableScope, coverage (unknown, partial, complete_material). Complete refers only to explicitly provided material. Never invent message ranges.",
      "Resume by taskId from the owner or the saved task URL. Use returned rowVersion as expectedVersion for changes. Register each distinct exercise or topic with kind, title, a findable context: locator and distinguishing verbatim identityEvidence from readable material. Reuse that locator and quote in the evidence for a replacement. Reuse the saved unitId only when its evidence matches this exact problem; a title or chat link alone is insufficient. Record a missing prompt, image, or source with need_evidence and missing. Ask the user for the specifically missing material.",
      "Use record_segment with stable source, order and locator. Planned or unavailable segments have no excerpt or links. Readable and processed segments require a short actual excerpt. Link known unitIds with verbatim quotes, locating the precise passage and distinguishing origin, follow_up, correction, alternative and context. List known overlapping orders. Preserve existing links when updating a segment. Processed means the supplied segment was inventoried, with remaining work visible on its units.",
      "Use save_draft for bounded notes, nextStep and citations matching recorded segment links. A saved draft is work in progress. Read the active draft in the unit view and supply its draftVersion on submit. Classify gaps with gapKind. Use provide_evidence for the original gapVersion with a real quote or an owner-registered assetId for an original_image. Use complete:false if material is still missing. Ask the owner to upload actual image bytes on the task page.",
      "Submit one unit at a time with its unitId, sources, one v1.2 chatgpt-context candidate (omit item_key and external_id), and materialNote. Resolve open evidence gaps first. Check saved.type in summary or saved.event in full and the actual review status. A failed checkpoint carries repair details; pending requires review and approved awaits commit.",
      solutionCandidateShape,
      "For a later follow-up to the same question, use the same unit and preserve all evidence and learning layers. Ask the owner to revise, skip, or reject an outstanding candidate before proposing a replacement. After commit only propose_update to that unit's committed target, with a freshly checked expected_version. Owner approval and commit use the existing review page.",
      "Use a fresh idempotencyKey for changes and reuse the exact request and key after a transport failure. On a version conflict resume and reconcile. Report the task link, preparation and review counts, known coverage and any missing material. Use get_import_result to check a linked batch.",
    ].join("\n\n"),
    inputSchema: taskInput,
    outputSchema: result(taskOutput),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ...mcpContentTools.map(({ output, ...tool }) => ({ ...tool, outputSchema: result(output) })),
];
