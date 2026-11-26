import { z } from "zod";
import { markdown } from "@/domain/catalog";
import { isPlacementAnchor } from "@/lib/reading-anchor";

export const questionTopicVersion = z.object({ expectedQuestionVersion: z.number().int().positive().safe() }).strict();

export const questionTopicPatch = questionTopicVersion.extend({
  displayRole: z.enum(["featured", "related"]).optional(),
  displayOrder: z.number().int().min(0).max(2_147_483_647).optional(),
  placementAnchor: z.string().refine(isPlacementAnchor, "请选择笔记中有效的段落或小节。").nullable().optional(),
  noteMd: markdown(131_072).optional(),
  useQuestionTechniques: z.boolean().optional(),
});

export type QuestionTopicPatch = z.infer<typeof questionTopicPatch>;
export type QuestionTopicChanges = Omit<QuestionTopicPatch, "expectedQuestionVersion">;

export type FeaturedExample = {
  questionId: string;
  title: string;
  statementMd: string;
  placementAnchor: string | null;
  displayOrder: number;
  noteMd: string;
  techniquesMd: string | null;
  images: Array<{ id: string; width: number | null; height: number | null; caption: string | null }>;
};
