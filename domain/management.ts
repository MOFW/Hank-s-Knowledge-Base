import { z } from "zod";
import { idSchema, newChapter } from "./catalog";

export const managementKind = z.enum(["topic", "chapter", "question", "attempt", "learning", "batch", "task", "course-history"]);
export type ManagementKind = z.infer<typeof managementKind>;

export const managementInput = z.object({
  dataEpoch: z.number().int().nonnegative().safe(),
  action: z.enum(["delete", "keep", "purge", "move", "attempts", "reset", "selected", "cancel", "restore", "rename"]),
  title: newChapter.shape.title.optional(),
  confirmation: z.string().max(400).optional(),
  courseId: idSchema.nullable().optional(),
  chapterId: idSchema.nullable().optional(),
  itemIds: z.array(idSchema).min(1).max(100).refine((value) => new Set(value).size === value.length).optional(),
}).strict();
export type ManagementInput = z.infer<typeof managementInput>;
