import { z } from "zod";
import { markdown } from "@/domain/catalog";
import { anchorId, type SolutionDocument } from "@/domain/solution";
import { exportSolutionMarkdown, solutionAnchorReviewIssues } from "@/lib/solution-anchors";

const nonempty = (limit: number) => markdown(limit).refine((value) => Boolean(value.trim()), "请输入正文。");
const title = z.string().trim().min(1).max(120);
const sourceSpeaker = z.enum(["learner", "assistant", "source_author", "unknown"]);
const locationPart = z.string().min(1).max(2048);

export const evidenceSnapshot = z.object({
  sourceKey: z.string().min(1).max(200),
  sourceTitle: z.string().trim().min(1).max(300).optional(),
  locator: locationPart,
  quote: nonempty(16_384),
  speaker: sourceSpeaker,
  history: z.object({
    role: z.string().min(1).max(80),
    location: z.object({
      digest: z.string().regex(/^[0-9a-f]{64}$/),
      entryPath: locationPart,
      ordinal: z.number().int().nonnegative(),
      conversationPath: locationPart,
      nodePath: locationPart,
      messagePath: locationPart,
    }).strict(),
  }).strict().optional(),
}).strict();

const teachingText = z.object({
  markdown: nonempty(131_072),
  origin: z.enum(["quoted", "transcribed", "source_summary", "ai_generated", "owner"]),
  speaker: z.enum(["learner", "assistant", "source_author", "new_ai", "owner"]),
  evidence: z.array(evidenceSnapshot).max(16).optional(),
}).strict().superRefine(({ markdown, origin, speaker, evidence }, ctx) => {
  if ((origin === "ai_generated") !== (speaker === "new_ai") || (origin === "owner") !== (speaker === "owner")) {
    ctx.addIssue({ code: "custom", path: ["speaker"], message: "发言者与内容来源不一致。" });
  }
  const documentedDiscussion = origin === "source_summary" && (speaker === "learner" || speaker === "assistant") && evidence?.length;
  if (origin === "quoted" || origin === "transcribed" || documentedDiscussion) {
    if (!evidence?.some((entry) => entry.speaker === speaker)) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "原始内容须保留对应发言者的引句与定位。" });
    }
  }
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  if (origin === "quoted" && !evidence?.some((entry) =>
    entry.speaker === speaker && normalize(entry.quote).includes(normalize(markdown)))) {
    ctx.addIssue({ code: "custom", path: ["evidence"], message: "原话须能在对应发言者的引句中核对。" });
  }
});

function unique<T>(schema: z.ZodType<T>, key: keyof T, limit: number) {
  return z.array(schema).max(limit).superRefine((items, ctx) => {
    const seen = new Set<T[keyof T]>();
    items.forEach((item, index) => {
      if (seen.has(item[key])) ctx.addIssue({ code: "custom", path: [index, String(key)], message: "同一范围内的标识不能重复。" });
      seen.add(item[key]);
    });
  });
}

export const solutionTurn = z.object({
  id: anchorId,
  learner: teachingText.refine(({ speaker }) => speaker === "learner" || speaker === "owner", "疑问须归于学习者或编辑者。"),
  replies: z.array(teachingText.refine(({ speaker }) => speaker !== "learner", "解释须记录解释者。")).min(1).max(12),
}).strict();
const thread = z.object({ anchorId, turns: unique(solutionTurn, "id", 32).refine((turns) => turns.length > 0, "请至少保留一轮追问。") }).strict();
export const solutionAlternative = z.object({
  id: anchorId,
  title,
  body: teachingText,
  stepAnchorIds: z.array(anchorId).max(32).refine((ids) => new Set(ids).size === ids.length, "逐步阅读锚点不能重复。").optional(),
  threads: unique(thread, "anchorId", 32),
}).strict();
export const solutionSupplement = z.object({
  id: anchorId,
  kind: z.enum(["method_summary", "clarification", "comparison", "extension"]),
  title,
  body: teachingText,
}).strict();

export const solutionLayers = z.object({
  mainThreads: unique(thread, "anchorId", 32),
  alternatives: unique(solutionAlternative, "id", 12),
  supplements: unique(solutionSupplement, "id", 24),
}).strict().superRefine((layers, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(layers)).length > 524_288) {
    ctx.addIssue({ code: "custom", message: "追问、替代解法及整题补充合计不得超过 512 KiB。" });
  }
});

export type SolutionLayers = z.infer<typeof solutionLayers>;
export type SolutionThread = z.infer<typeof thread>;
export type TeachingText = z.infer<typeof teachingText>;
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshot>;

export function solutionLayerAnchorIssues(document: SolutionDocument | null, layers: SolutionLayers | null) {
  if (!layers) return [];
  const check = (bodyMd: string, threads: SolutionThread[], path: (string | number)[], stepAnchorIds?: string[]) =>
    solutionAnchorReviewIssues({ bodyMd, annotations: threads.map(({ anchorId }) => ({ id: anchorId })), stepAnchorIds })
      .map(({ id, kind, reason }) => ({
        path: kind === "annotation" ? [...path, threads.findIndex(({ anchorId }) => anchorId === id), "anchorId"]
          : [...path.slice(0, -1), "stepAnchorIds", stepAnchorIds!.indexOf(id)],
        message: `锚点「${id}」${{ missing: "未在正文出现", duplicate: "在正文重复", unplaced: "未紧邻对应推导" }[reason]}。`,
      }));
  return [
    ...check(document?.bodyMd ?? "", layers.mainThreads, ["solutionLayers", "mainThreads"]),
    ...layers.alternatives.flatMap(({ body, threads, stepAnchorIds }, index) =>
      check(body.markdown, threads, ["solutionLayers", "alternatives", index, "threads"], stepAnchorIds)),
  ];
}

export function plainSolutionMarkdown({ solutionDocument, solutionSteps, finalAnswerMd, solutionLayers, keyTechniquesMd }: {
  solutionDocument: SolutionDocument | null;
  solutionSteps: { bodyMd: string }[];
  finalAnswerMd: string;
  solutionLayers: SolutionLayers | null;
  keyTechniquesMd: string;
}) {
  const main = solutionDocument ? exportSolutionMarkdown(solutionDocument.bodyMd)
    : finalAnswerMd.trim() ? finalAnswerMd : solutionSteps.map(({ bodyMd }) => bodyMd).join("\n\n");
  if (!solutionLayers) return main;
  const { alternatives, supplements } = solutionLayers;
  return [
    main,
    ...alternatives.map(({ title, body }) => `## ${title}\n\n${exportSolutionMarkdown(body.markdown)}`),
    ...supplements.map(({ title, body }) => `## ${title}\n\n${body.markdown}`),
    ...(keyTechniquesMd.trim() ? [`## 思路与关键技巧\n\n${keyTechniquesMd}`] : []),
  ].filter((part) => part.trim()).join("\n\n");
}
