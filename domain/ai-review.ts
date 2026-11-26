import { z } from "zod";

export const reviewChecks = [
  "statement", "math", "derivation", "answers_question", "follow_ups", "annotations",
  "attribution", "evidence", "visual", "classification", "duplicates",
] as const;
export const absentChecks = ["follow_ups", "annotations", "visual"] as const;
export const checkStatus = z.enum(["pass", "fail", "unknown", "not_applicable"]);
const brief = z.string().trim().min(1).max(1200);
const finding = z.object({
  path: z.string().max(240).regex(/^\//),
  location: z.string().max(240).nullable(),
  reason: brief,
  suggestion: brief.nullable(),
}).strict();

export const reviewReport = z.object({
  decision: z.enum(["pass", "revise", "manual_review", "reject"]),
  checks: z.object(Object.fromEntries(reviewChecks.map((key) => [key, checkStatus])) as Record<
    typeof reviewChecks[number], typeof checkStatus>).strict(),
  risk_level: z.enum(["low", "medium", "high"]),
  issues: z.array(finding).max(20),
  evidence_assessment: brief,
  math_assessment: brief,
  suggested_corrections: z.array(finding).max(20),
  summary: brief,
}).strict();
export type AiReport = z.infer<typeof reviewReport>;

export const reviewSettings = z.object({
  mode: z.enum(["off", "assist", "conditional"]),
  consent: z.boolean(),
  dailyBudgetMicros: z.number().int().min(0).max(20_000_000),
  dailyApprovalLimit: z.number().int().min(0).max(20),
  allowIntegerArithmetic: z.boolean(),
}).strict().refine(({ mode, consent }) => consent || mode === "off", { message: "请先同意向 DeepSeek 发送必要的审核资料。" });
export type ReviewSettings = z.infer<typeof reviewSettings>;
export const initialReviewSettings: ReviewSettings = {
  mode: "assist", consent: false, dailyBudgetMicros: 100_000, dailyApprovalLimit: 2, allowIntegerArithmetic: false,
};
export const sourceWitness = z.object({
  title: z.string().trim().min(1).max(240),
  locator: z.string().trim().min(1).max(512),
  quote: z.string().trim().min(1).max(512),
}).strict();
export type SourceWitness = z.infer<typeof sourceWitness>;
export const batchReviewLimit = 3;
