import { z } from "zod";

export const idSchema = z.string().uuid("标识符必须是 UUID");
const name = z.string().trim().min(1, "请输入名称").max(120, "名称最多 120 字符");
const slug = z.string().trim().max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "使用小写字母、数字和连字符");
const sortOrder = z.number().int().min(0).max(1_000_000);

export function markdown(maxBytes: number) {
  return z.string().refine(
    (value) => new TextEncoder().encode(value).length <= maxBytes,
    "Markdown 超出允许的大小",
  );
}

export const newCourse = z.object({
  name, slug: slug.optional(), descriptionMd: markdown(16_384).default(""),
  sortOrder: sortOrder.default(0),
}).strict();

export const deleteCourseInput = z.object({
  dataEpoch: z.number().int().nonnegative().safe(),
  mode: z.enum(["keep", "purge"]).optional(),
  destinationId: idSchema.nullable().default(null),
  confirmation: z.string().max(120).optional(),
}).strict();

export type DeleteCourseInput = z.infer<typeof deleteCourseInput>;

export const newChapter = z.object({
  courseId: idSchema, parentId: idSchema.nullable().default(null),
  title: name, slug: slug.optional(), descriptionMd: markdown(16_384).default(""),
  sortOrder: sortOrder.default(0),
}).strict();

export const topicSupplement = markdown(32_768).nullable();

const topicFields = z.object({
  chapterId: idSchema.nullable(), title: name, slug,
  summaryMd: markdown(8_192), bodyMd: markdown(131_072), supplementMd: topicSupplement.optional(), sortOrder,
}).strict();

export const newTopic = topicFields.extend({
  courseId: idSchema.nullable().default(null), chapterId: topicFields.shape.chapterId.default(null),
  slug: slug.optional(), summaryMd: topicFields.shape.summaryMd.default(""),
  sortOrder: sortOrder.default(0),
});

export const topicPatch = topicFields.extend({
  courseId: idSchema.nullable(),
  relatedTopicIds: z.array(idSchema).max(100).refine((values) => new Set(values).size === values.length),
}).partial().refine(
  (value) => Object.keys(value).length > 0, "请输入至少一个要修改的字段",
);

export const coursePatch = newCourse.partial().refine((value) => Object.keys(value).length > 0, "请输入要修改的字段");
export type CoursePatch = z.infer<typeof coursePatch>;
export type NewCourse = z.infer<typeof newCourse>;
export type NewChapter = z.infer<typeof newChapter>;
export type NewTopic = z.infer<typeof newTopic>;
export type TopicPatch = z.infer<typeof topicPatch>;

export const readingOrderInput = z.object({
  kind: z.enum(["chapter", "topic"]),
  chapterId: idSchema.nullable(),
  items: z.array(z.object({ id: idSchema, rowVersion: z.number().int().positive().safe() }).strict())
    .min(2).max(10_000).refine((items) => new Set(items.map(({ id }) => id)).size === items.length),
}).strict();
export type ReadingOrderInput = z.infer<typeof readingOrderInput>;
