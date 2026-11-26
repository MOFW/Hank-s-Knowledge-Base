import { z } from "zod";
import { coursePatch, idSchema, markdown, newChapter, newCourse, newTopic, readingOrderInput, topicPatch } from "@/domain/catalog";
import { attemptPatch, learningStatePatch, newAttempt, newQuestion, questionPatch, revisionNumber } from "@/domain/questions";
import { questionTopicPatch } from "@/domain/question-topic";
import { exampleLink, learningMaterialIssue, organizedSolution, solutionOrganization } from "@/domain/learning-organization";
import { anchorId } from "@/domain/solution";
import { solutionAlternative, solutionSupplement, solutionTurn } from "@/domain/solution-layers";

const target = { id: idSchema, version: revisionNumber };
const localKey = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const selection = z.array(idSchema).min(1).max(100);
const deleteScope = { deleteExclusiveIds: selection.optional() };
const sourceRows = z.array(z.object(target).strict()).min(1).max(10);
const replacement = z.object({ find: markdown(131_072).refine((text) => text.length > 0), replace: markdown(131_072) }).strict();
const solutionEdit = z.discriminatedUnion("part", [
  z.object({ part: z.literal("text"), field: z.enum(["main", "answer", "techniques"]), ...replacement.shape }).strict(),
  z.object({ part: z.literal("alternative"), id: anchorId, value: solutionAlternative.nullable() }).strict(),
  z.object({ part: z.literal("supplement"), id: anchorId, value: solutionSupplement.nullable() }).strict(),
  z.object({
    part: z.literal("turn"), solutionId: anchorId.optional(), anchorId, id: anchorId, value: solutionTurn.nullable(),
    moveToAnchorId: anchorId.optional(),
  }).strict(),
]);
export const contentOperation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_course"), input: newCourse, key: localKey.optional() }).strict(),
  z.object({ action: z.literal("update_course"), ...target, patch: coursePatch }).strict(),
  z.object({ action: z.literal("delete_course"), ...target, destinationId: idSchema.optional(), ...deleteScope }).strict(),
  z.object({
    action: z.literal("create_chapter"), input: newChapter.extend({ courseId: idSchema.optional() }),
    key: localKey.optional(), courseKey: localKey.optional(), parentKey: localKey.optional(),
  }).strict(),
  z.object({ action: z.literal("update_chapter"), ...target, patch: newChapter.partial().strict()
    .refine((patch) => Object.keys(patch).length > 0) }).strict(),
  z.object({ action: z.literal("delete_chapter"), ...target, destinationId: idSchema.nullable().optional(), ...deleteScope }).strict(),
  z.object({ action: z.literal("reorder_reading"), courseId: idSchema, input: readingOrderInput }).strict(),
  z.object({
    action: z.literal("create_topic"), input: newTopic, key: localKey.optional(),
    courseKey: localKey.optional(), chapterKey: localKey.optional(),
  }).strict(),
  z.object({ action: z.literal("update_topic"), ...target, patch: topicPatch }).strict(),
  z.object({ action: z.literal("edit_topic_text"), ...target, append: markdown(131_072).optional(),
    replacement: replacement.optional() }).strict(),
  z.object({ action: z.literal("merge_topics"), ...target, sources: sourceRows }).strict(),
  z.object({ action: z.literal("delete_topic"), ...target }).strict(),
  z.object({
    action: z.literal("create_question"),
    input: newQuestion.extend({ primaryCourseId: newQuestion.shape.primaryCourseId.default(null) }),
    courseKey: localKey.optional(), topicKeys: z.array(localKey).max(20).default([]), requiresOriginalImage: z.boolean().default(false),
    solution: organizedSolution.optional(), examples: z.array(exampleLink).min(1).max(20).optional(),
    materialIssue: learningMaterialIssue.optional(),
  }).strict(),
  z.object({
    action: z.literal("update_question"), ...target, patch: questionPatch,
    requiresOriginalImage: z.boolean().default(false),
  }).strict(),
  z.object({
    action: z.literal("edit_solution"), ...target, edits: z.array(solutionEdit).min(1).max(32).optional(),
    organize: solutionOrganization.optional(), examples: z.array(exampleLink).min(1).max(20).optional(),
    materialIssue: learningMaterialIssue.optional(),
  }).strict(),
  z.object({ action: z.literal("merge_questions"), ...target, sources: sourceRows,
    keepTargetSolution: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("delete_question"), ...target }).strict(),
  z.object({ action: z.literal("set_question_links"), ...target, links: z.array(z.object({
    questionId: idSchema, expectedQuestionVersion: revisionNumber,
    changes: questionTopicPatch.omit({ expectedQuestionVersion: true }).nullable(),
  }).strict()).min(1).max(20) }).strict(),
  z.object({ action: z.literal("create_attempt"), questionId: idSchema, input: newAttempt }).strict(),
  z.object({ action: z.literal("update_attempt"), ...target, patch: attemptPatch }).strict(),
  z.object({ action: z.literal("delete_attempt"), ...target }).strict(),
  z.object({ action: z.literal("update_learning"), ...target, patch: learningStatePatch }).strict(),
  z.object({ action: z.literal("clear_learning"), ...target, scope: z.enum(["attempts", "state", "all"]) }).strict(),
  z.object({ action: z.literal("delete_asset"), id: idSchema }).strict(),
]);

export const contentOperations = z.object({ operations: z.array(contentOperation).min(1).max(20),
  preview: z.boolean().optional() }).strict()
  .superRefine(({ operations }, ctx) => {
    const targets = new Set<string>();
    const keys = new Set<string>();
    for (const [index, entry] of operations.entries()) {
      const identities = "id" in entry ? [entry.id, ...("sources" in entry ? entry.sources.map(({ id }) => id) : [])]
        : "key" in entry && entry.key ? [entry.key] : [];
      const seen = "id" in entry ? targets : keys;
      for (const identity of identities) {
        if (seen.has(identity)) ctx.addIssue({
          code: "custom", path: ["operations", index], message: "同一个目标或批次内标识只能出现一次。",
        });
        seen.add(identity);
      }
    }
  });

export const undoContentOperation = z.object({ operationId: idSchema }).strict();

export type ContentOperations = z.infer<typeof contentOperations>;
export type ContentOperation = z.infer<typeof contentOperation>;
export type ContentChange = {
  action: "create" | "update" | "delete";
  kind: "course" | "chapter" | "topic" | "question" | "attempt" | "learning" | "asset";
  id: string;
  rowVersion: number;
  href: string | null;
  title?: string;
};
export type ContentFailure = { index: number; code: string; message: string };
export type ContentOperationReceipt = { action: "apply" | "undo"; changes: ContentChange[]; failures?: ContentFailure[] };
