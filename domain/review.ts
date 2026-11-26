import { z } from "zod";
import { idSchema, markdown } from "@/domain/catalog";
import { questionListInput, reviewDateOverride, revisionNumber } from "@/domain/questions";

export const reviewCategory = z.enum(["due", "mistakes", "mastered"]);
export const reviewListInput = questionListInput.extend({ category: reviewCategory.optional() });

export type ReviewCategory = z.infer<typeof reviewCategory>;
export type ReviewListInput = z.infer<typeof reviewListInput>;

export const startReviewInput = z.discriminatedUnion("kind", [
  reviewListInput.pick({ courseId: true, topicId: true, dueBefore: true }).extend({ kind: z.literal("due") }),
  z.object({ kind: z.literal("practice"), sessionId: idSchema }).strict(),
  z.object({ kind: z.literal("question"), questionId: idSchema }).strict(),
]);

const current = z.object({ position: z.number().int().positive(), draftMd: markdown(131_072) }).strict();
export const reviewAssessment = z.enum(["independent", "assisted", "practice"]);
export const assessmentLabels = {
  independent: "独立做对",
  assisted: "借助提示做对",
  practice: "还需练习",
} satisfies Record<z.infer<typeof reviewAssessment>, string>;

export const questionAssessment = z.object({ assessment: reviewAssessment, nextReviewOn: reviewDateOverride }).strict();

export const reviewCommand = z.discriminatedUnion("action", [
  current.extend({ action: z.enum(["draft", "hint", "skip", "pause", "end"]) }),
  current.extend({ action: z.literal("answer"), mode: z.enum(["check", "peek"]) }),
  current.extend({
    action: z.literal("assess"), outcome: reviewAssessment, nextReviewOn: reviewDateOverride,
    learningStateVersion: revisionNumber.optional(),
  }),
  current.pick({ position: true }).extend({ action: z.enum(["next", "resume"]) }),
]);

export type DueReviewScope = Omit<Extract<z.infer<typeof startReviewInput>, { kind: "due" }>, "kind">;
export type StartReview = z.infer<typeof startReviewInput>;
export type ReviewCommand = z.infer<typeof reviewCommand>;
export type ReviewAssessment = z.infer<typeof reviewAssessment>;
export type QuestionAssessment = z.infer<typeof questionAssessment>;
export type ReviewIntervals = Record<ReviewAssessment, number>;
