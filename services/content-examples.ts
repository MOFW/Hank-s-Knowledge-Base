import { sql } from "drizzle-orm";
import { prepareReading } from "@/components/markdown-reading";
import { usableCourse, type WriteContext } from "@/db/queries/catalog";
import { upsertQuestionTopic } from "@/db/queries/question-topics";
import type { ExampleLink } from "@/domain/learning-organization";
import { Problem } from "@/domain/problem";
import type { getTopic } from "@/services/catalog";

type Topic = NonNullable<Awaited<ReturnType<typeof getTopic>>>;

export async function prepareExamples(
  examples: ExampleLink[],
  resolveLocal: (key: string) => Topic,
  resolveExisting: (id: string, version: number) => Promise<{ topic: Topic; placementBody?: string }>,
) {
  const resolved = await Promise.all(examples.map(async (link) => {
    const existing = "topicId" in link;
    const { topic, placementBody } = existing
      ? await resolveExisting(link.topicId, link.topicVersion) : { topic: resolveLocal(link.topicKey) };
    const placementAnchor = typeof link.at === "string" ? notePosition(placementBody ?? topic.bodyMd, link.at) : link.at;
    return { topic, existing, changes: {
      displayRole: link.role, displayOrder: link.order, placementAnchor, noteMd: link.note,
    } };
  }));
  const ids = resolved.map(({ topic }) => topic.id);
  if (new Set(ids).size !== ids.length) {
    throw new Problem(422, "DUPLICATE_EXAMPLE_LINK", "同一道题在每篇笔记中只能指定一次关联。");
  }
  return resolved;
}

export function exampleTopicVersion(topic: Topic) {
  return sql`${usableCourse(topic.courseId)} AND EXISTS (
    SELECT 1 FROM topics WHERE id = ${topic.id} AND deleted_at IS NULL AND row_version = ${topic.rowVersion}
  )`;
}

export function exampleWrites(links: Awaited<ReturnType<typeof prepareExamples>>, questionId: string, ctx: WriteContext) {
  return links.map(({ topic, changes }) => upsertQuestionTopic(topic.id, questionId, changes, ctx));
}

function notePosition(body: string, text: string) {
  const excerpt = text.replace(/\s+/gu, " ");
  const placements = prepareReading(body).placements.filter(({ label }) => label.replace(/\s+/gu, " ").includes(excerpt));
  if (placements.length !== 1) throw new Problem(422,
    placements.length ? "AMBIGUOUS_EXAMPLE_POSITION" : "EXAMPLE_POSITION_NOT_FOUND",
    placements.length ? "笔记中有多个相符位置，请提供更具体的标题或段落开头。" : "找不到精选位置，请核对笔记标题或段落开头。", { at: text });
  return placements[0].id;
}
