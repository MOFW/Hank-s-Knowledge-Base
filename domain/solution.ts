import { z } from "zod";
import { idSchema, markdown } from "@/domain/catalog";

const stepId = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "步骤标识须使用小写字母、数字或连字符。");
export const anchorId = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "注释标识须使用小写字母、数字或连字符。");
const note = markdown(16_384).default("");
export const annotationSourceKinds = ["assistant", "source", "ai_generated"] as const;
const annotationSource = z.enum(annotationSourceKinds).optional();

const solutionStep = z.object({
  id: stepId,
  title: z.string().trim().min(1, "请输入步骤标题。").max(120),
  bodyMd: markdown(32_768).refine((value) => value.trim().length > 0, "请输入步骤正文。"),
  basisMd: note,
  strategyMd: note,
  explanationMd: note,
  aiExplanationMd: note,
  commonMistakesMd: note,
  topicIds: z.array(idSchema).max(16).refine(
    (ids) => new Set(ids).size === ids.length, "步骤中存在重复的知识点。",
  ).default([]),
}).strict();

export const solutionSteps = z.array(solutionStep).max(32, "一道题最多包含 32 个解题步骤。").superRefine((steps, ctx) => {
  const ids = new Set<string>();
  steps.forEach(({ id }, index) => {
    if (ids.has(id)) {
      ctx.addIssue({ code: "custom", path: [index, "id"], message: `步骤标识「${id}」重复。` });
    }
    ids.add(id);
  });
  if (new TextEncoder().encode(JSON.stringify(steps)).length > 131_072) {
    ctx.addIssue({ code: "custom", message: "分步解答整体不得超过 128 KiB。" });
  }
});

export type SolutionStep = z.infer<typeof solutionStep>;

const solutionAnnotation = z.object({
  id: anchorId,
  label: z.string().trim().min(1).max(120).optional(),
  basisMd: note,
  strategyMd: note,
  explanationMd: note,
  aiExplanationMd: note,
  commonMistakesMd: note,
  learnerQuestionsMd: z.array(markdown(16_384)).max(32).optional(),
  noteOrigins: z.object({
    basisMd: annotationSource, strategyMd: annotationSource,
    explanationMd: annotationSource, commonMistakesMd: annotationSource,
  }).strict().optional(),
  topicIds: z.array(idSchema).max(16).refine(
    (ids) => new Set(ids).size === ids.length, "注释中存在重复的知识点。",
  ).default([]),
}).strict();

export const solutionDocument = z.object({
  bodyMd: markdown(131_072).refine((value) => value.trim().length > 0, "请输入解答正文。"),
  annotations: z.array(solutionAnnotation).max(32, "一道题最多包含 32 条解答注释。").default([]),
  stepAnchorIds: z.array(anchorId).max(32).refine(
    (ids) => new Set(ids).size === ids.length, "逐步阅读锚点不能重复。",
  ).optional(),
}).strict().superRefine((document, ctx) => {
  const ids = new Set<string>();
  document.annotations.forEach(({ id }, index) => {
    if (ids.has(id)) {
      ctx.addIssue({ code: "custom", path: ["annotations", index, "id"], message: `注释标识「${id}」重复。` });
    }
    ids.add(id);
  });
  if (new TextEncoder().encode(JSON.stringify(document)).length > 262_144) {
    ctx.addIssue({ code: "custom", message: "解答正文与注释合计不得超过 256 KiB。" });
  }
});

export type SolutionAnnotation = z.infer<typeof solutionAnnotation>;
export type SolutionDocument = z.infer<typeof solutionDocument>;

export function filterSolutionTopics<T extends { solutionSteps: SolutionStep[]; solutionDocument: SolutionDocument | null }>(
  fields: T, topicIds: string[],
) {
  const linked = new Set(topicIds);
  const keep = (id: string) => linked.has(id);
  return {
    solutionSteps: fields.solutionSteps.map((step) => ({ ...step, topicIds: step.topicIds.filter(keep) })),
    solutionDocument: fields.solutionDocument && {
      ...fields.solutionDocument,
      annotations: fields.solutionDocument.annotations.map((note) => ({ ...note, topicIds: note.topicIds.filter(keep) })),
    },
  };
}
