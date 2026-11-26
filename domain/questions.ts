import { z } from "zod";
import { idSchema, markdown } from "@/domain/catalog";
import { solutionDocument, solutionSteps } from "@/domain/solution";
import { solutionLayers } from "@/domain/solution-layers";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期须使用 YYYY-MM-DD 格式").refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "请输入有效日期");

const timestamp = z.string().datetime({ offset: true }).refine(
  (value) => Number.isFinite(Date.parse(value)), "请输入有效时间",
).transform((value) => new Date(value).toISOString());

function distinctIds(maximum: number) {
  return z.array(idSchema).max(maximum).transform((ids) => [...new Set(ids)]);
}

const topicIds = distinctIds(80);
const originalAssetIds = distinctIds(8);

function optionalText(maximum: number) {
  return z.string().trim().max(maximum).nullable().transform((text) => text || null);
}

const questionFields = z.object({
  primaryCourseId: idSchema.nullable(),
  title: z.string().trim().min(1, "请输入题目标题").max(200, "题目标题最多 200 字符"),
  statementMd: markdown(131_072),
  finalAnswerMd: markdown(131_072),
  solutionSteps,
  solutionDocument: solutionDocument.nullable(),
  solutionLayers: solutionLayers.nullable(),
  keyTechniquesMd: markdown(131_072),
  difficulty: z.number().int().min(1).max(5).nullable(),
  sourceDate: date.nullable(),
  sourceTitle: optionalText(200),
  sourceLocator: optionalText(300),
  topicIds,
  originalAssetIds,
}).strict();

export const newQuestion = questionFields.extend({
  statementMd: questionFields.shape.statementMd.default(""),
  finalAnswerMd: questionFields.shape.finalAnswerMd.default(""),
  solutionSteps: solutionSteps.default([]),
  solutionDocument: questionFields.shape.solutionDocument.default(null),
  solutionLayers: questionFields.shape.solutionLayers.default(null),
  keyTechniquesMd: questionFields.shape.keyTechniquesMd.default(""),
  difficulty: questionFields.shape.difficulty.default(null),
  sourceDate: questionFields.shape.sourceDate.default(null),
  sourceTitle: questionFields.shape.sourceTitle.default(null),
  sourceLocator: questionFields.shape.sourceLocator.default(null),
  topicIds: topicIds.default([]),
  originalAssetIds: originalAssetIds.default([]),
});

const hasChanges = (value: object) => Object.keys(value).length > 0;

export const questionPatch = questionFields.partial().refine(hasChanges, "请输入至少一个要修改的字段");
export const questionTopics = z.object({ topicIds }).strict();
export const emptyWrite = z.object({}).strict();

const attemptFields = z.object({
  attemptedAt: timestamp.nullable(),
  originalWorkMd: markdown(131_072).nullable(),
  errorAnalysisMd: markdown(131_072).nullable(),
  correctionMd: markdown(131_072).nullable(),
  insightMd: markdown(131_072).nullable(),
  outcome: z.enum(["unknown", "correct", "partial", "incorrect"]),
  correctionAuthorKind: z.enum(["unknown", "user", "ai", "mixed"]),
}).strict();

export const newAttempt = attemptFields.extend({
  attemptedAt: attemptFields.shape.attemptedAt.default(null),
  originalWorkMd: attemptFields.shape.originalWorkMd.default(null),
  errorAnalysisMd: attemptFields.shape.errorAnalysisMd.default(null),
  correctionMd: attemptFields.shape.correctionMd.default(null),
  insightMd: attemptFields.shape.insightMd.default(null),
  outcome: attemptFields.shape.outcome.default("unknown"),
  correctionAuthorKind: attemptFields.shape.correctionAuthorKind.default("unknown"),
});

export const attemptPatch = attemptFields.partial().refine(hasChanges, "请输入至少一个要修改的字段");

export const learningStatePatch = z.object({
  mastery: z.enum(["new", "learning", "familiar", "mastered"]).optional(),
  isMistake: z.boolean().optional(),
  nextReviewOn: date.nullable().optional(),
}).strict().refine(hasChanges, "请输入至少一个要修改的字段");

export const reviewDateOverride = date.nullable().optional();

export const revisionNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const revisionPath = z.string().regex(/^[1-9]\d{0,15}$/).transform(Number).pipe(revisionNumber);
export const restoreRevision = z.object({ revisionNo: revisionNumber }).strict();

export const questionCursor = z.object({ updatedAt: timestamp, id: idSchema }).strict();

export const questionListInput = z.object({
  courseId: z.union([idSchema, z.literal("unassigned")]).optional(),
  scope: z.enum(["primary", "related"]).optional(),
  chapterId: idSchema.optional(),
  topicId: idSchema.optional(),
  isMistake: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  dueBefore: date.optional(),
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  cursor: z.string().regex(/^[a-zA-Z0-9_-]{1,250}$/).optional(),
}).strict();

export type NewQuestion = z.infer<typeof newQuestion>;
export type QuestionPatch = z.infer<typeof questionPatch>;
export type NewAttempt = z.infer<typeof newAttempt>;
export type AttemptPatch = z.infer<typeof attemptPatch>;
export type LearningStatePatch = z.infer<typeof learningStatePatch>;
export type QuestionListInput = z.infer<typeof questionListInput>;
