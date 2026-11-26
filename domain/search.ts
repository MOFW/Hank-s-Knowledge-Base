import { z } from "zod";
import { idSchema } from "@/domain/catalog";
import { questionCursor, questionListInput } from "@/domain/questions";

export const searchKind = z.enum(["course", "topic", "question"]);
export const searchTopicMode = z.enum(["any", "all"]);
export const searchMastery = z.enum(["new", "learning", "familiar", "mastered"]);
export const searchQuery = z.string().trim().max(120, "关键词最多 120 个字符。")
  .refine((value) => value.split(/\s+/u).length <= 8, "最多可输入 8 个关键词。");

export const searchInput = questionListInput.extend({
  q: searchQuery.optional(),
  kind: searchKind.optional(),
  topicIds: z.array(idSchema).max(20).transform((ids) => [...new Set(ids)]).default([]),
  topicMode: searchTopicMode.optional(),
  difficulty: z.string().regex(/^[1-5]$/).transform(Number).optional(),
  mastery: searchMastery.optional(),
}).omit({ topicId: true });

export const searchCursor = questionCursor.extend({ kind: searchKind });
export type SearchKind = z.infer<typeof searchKind>;
export type SearchInput = z.infer<typeof searchInput>;
export type SearchCursor = z.infer<typeof searchCursor>;

export function searchParameters(params: URLSearchParams) {
  const fields = Object.fromEntries([...params].filter(([, value]) => value !== ""));
  delete fields.topicId;
  return { ...fields, topicIds: params.getAll("topicId").filter(Boolean) };
}
