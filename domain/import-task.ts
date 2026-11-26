import { z } from "zod";
import { idSchema } from "@/domain/catalog";

export const taskImportPrefix = "hkb-resume:";
export const taskCoverage = ["unknown", "partial", "complete_material"] as const;
export const taskUnitKinds = ["question", "topic"] as const;
export const segmentStates = ["planned", "unavailable", "readable", "processed"] as const;
export const segmentRelations = ["origin", "follow_up", "correction", "alternative", "context"] as const;
export const taskSpeakers = ["learner", "assistant", "source", "unknown"] as const;
export const gapKinds = ["statement", "original_image", "follow_up", "speaker", "same_unit", "source", "course", "formula_anchor"] as const;
const description = z.string().trim().min(1).max(2000);
const quote = z.string().trim().min(1).max(600);
const version = z.number().int().safe().min(1);
const order = version.max(10_000);
const position = z.string().trim().min(1).max(300);
const locator = z.string().trim().min(9).max(300).refine((value) => /^context:\s*\S/.test(value), "请填写 context: 加可查找的片段描述。");
const title = z.string().trim().min(1).max(200);
const key = { idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) };
const compact = { view: z.literal("summary").optional() };
const change = { ...key, ...compact, taskId: idSchema, expectedVersion: version };
const forUnit = { ...change, unitId: idSchema };

const scope = z.object({
  title,
  requestedScope: description,
  readableScope: description,
  coverage: z.enum(taskCoverage),
}).strict();

const segmentLink = z.object({
  unitId: idSchema, relation: z.enum(segmentRelations), locator: position, quote, speaker: z.enum(taskSpeakers),
}).strict();
const segment = z.object({
  order, source: title, locator: position, status: z.enum(segmentStates),
  note: description, excerpt: quote.optional(), overlaps: z.array(order).max(12),
  links: z.array(segmentLink).max(24),
}).strict();
const citation = segmentLink.omit({ unitId: true, relation: true }).extend({ segmentOrder: order });
const draft = z.object({
  notes: z.string().trim().min(1).max(4000), nextStep: description, citations: z.array(citation).min(1).max(8),
}).strict();
export const taskEvidence = z.object({
  gapVersion: version, note: description, locator: position,
  quote: quote.optional(), assetId: idSchema.optional(), segmentOrder: order.optional(), complete: z.boolean(),
}).strict();

export const importTaskInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...key, ...compact, scope }).strict(),
  z.object({
    action: z.literal("resume"), taskId: idSchema, view: z.enum(["summary", "unit", "segment"]).optional(),
    unitId: idSchema.optional(), segmentOrder: order.optional(),
  }).strict(),
  z.object({ action: z.literal("register"), ...change, locator, title, kind: z.enum(taskUnitKinds), identityEvidence: description }).strict(),
  z.object({ action: z.literal("need_evidence"), ...forUnit, missing: description, gapKind: z.enum(gapKinds).optional(),
    segmentOrder: order.optional() }).strict(),
  z.object({ action: z.literal("record_segment"), ...change, segment }).strict(),
  z.object({ action: z.literal("save_draft"), ...forUnit, draft }).strict(),
  z.object({ action: z.literal("provide_evidence"), ...forUnit, evidence: taskEvidence }).strict(),
  // The import service validates the unchanged v1.2 contract after attaching server-owned keys.
  z.object({
    action: z.literal("submit"), ...forUnit, materialNote: description,
    sources: z.array(z.unknown()).max(100), candidate: z.record(z.unknown()), draftVersion: version.optional(),
  }).strict(),
]).superRefine((args, ctx) => {
  if (args.action !== "resume") return;
  for (const [view, field] of [["unit", "unitId"], ["segment", "segmentOrder"]] as const) {
    if ((args.view === view) === (args[field] !== undefined)) continue;
    ctx.addIssue({ path: [field], code: "custom", message: args.view === view
      ? `Provide ${field} for view '${view}'.` : `Use ${field} only with view '${view}'.` });
  }
});

export type ImportTaskInput = z.infer<typeof importTaskInput>;
export type ImportTaskScope = z.infer<typeof scope>;
export type TaskSegment = z.infer<typeof segment>;
export type TaskDraft = z.infer<typeof draft>;
export type TaskEvidence = z.infer<typeof taskEvidence>;
export type TaskIssue = { code: string; message: string; fields?: unknown };
export type ImportCheckpoint =
  | { type: "registered"; locator: string; title: string; kind: typeof taskUnitKinds[number]; identityEvidence: string }
  | { type: "needs_evidence"; missing: string; gapKind?: typeof gapKinds[number]; segmentOrder?: number }
  | { type: "segment"; segment: TaskSegment }
  | { type: "draft"; draft: TaskDraft; reviewVersion: number | null }
  | { type: "evidence"; evidence: TaskEvidence }
  | { type: "failed"; error: TaskIssue }
  | { type: "submitted"; materialNote: string; fingerprint: string };
