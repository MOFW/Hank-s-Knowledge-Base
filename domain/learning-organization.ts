import { z } from "zod";
import { idSchema, markdown } from "@/domain/catalog";
import { revisionNumber } from "@/domain/questions";
import { anchorId } from "@/domain/solution";
import { evidenceSnapshot } from "@/domain/solution-layers";

const prose = markdown(131_072).refine((value) => Boolean(value.trim()), "请输入实际内容。");
const locatorText = z.string().trim().min(1).max(1000);
const locator = z.union([locatorText, z.object({ anchorId }).strict()]);
const method = z.string().trim().min(1).max(120);
const answer = {
  answer: prose, answerFrom: z.enum(["discussion", "new_ai"]).optional(),
  answerEvidence: z.array(evidenceSnapshot).min(1).max(8).optional(),
};
const followUp = z.object({
  at: locator, question: prose, questionEvidence: z.array(evidenceSnapshot).min(1).max(8).optional(), ...answer,
}).strict();
const alternative = z.object({
  title: method, markdown: prose, followUps: z.array(followUp).min(1).max(64).optional(),
}).strict();

const mainContent = {
  alternatives: z.array(alternative).min(1).max(12).optional(),
  summary: prose.optional(),
};
export const organizedSolution = z.object({
  main: prose, followUps: z.array(followUp).min(1).max(64).optional(), ...mainContent,
}).strict();

const correction = z.object({
  method: method.optional(), at: locator, question: locatorText.optional(), turnId: anchorId.optional(),
  reply: z.number().int().min(1).max(12).optional(), ...answer,
}).strict();
export const solutionOrganization = z.object({
  followUps: z.array(followUp.extend({ method: method.optional() })).min(1).max(64).optional(),
  corrections: z.array(correction).min(1).max(32).optional(),
  ...mainContent,
}).strict().refine((value) => Object.keys(value).length > 0, "请输入要补充或修订的解答内容。");

const exampleDisplay = {
  role: z.enum(["related", "featured"]).optional(),
  at: z.string().trim().min(1).max(120).nullable().optional(),
  order: z.number().int().min(0).max(2_147_483_647).optional(),
  note: markdown(131_072).optional(),
};
export const exampleLink = z.union([
  z.object({ topicId: idSchema, topicVersion: revisionNumber, ...exampleDisplay }).strict(),
  z.object({ topicKey: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), ...exampleDisplay }).strict(),
]);

export const learningMaterialIssue = z.object({
  kind: z.enum(["missing_statement", "missing_image", "unidentified", "uncertain_math"]),
  detail: z.string().trim().min(1).max(280).optional(),
}).strict();

export type OrganizedSolution = z.infer<typeof organizedSolution>;
export type SolutionOrganization = z.infer<typeof solutionOrganization>;
export type SolutionFollowUp = z.infer<typeof followUp>;
export type ExampleLink = z.infer<typeof exampleLink>;
export type LearningMaterialIssue = z.infer<typeof learningMaterialIssue>;
