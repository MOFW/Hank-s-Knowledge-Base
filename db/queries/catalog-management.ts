import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { ids, removeQuestions, removeRevisions, removeTopics } from "./content-deletion";
import type { WriteContext } from "./catalog";

export async function catalogScope(kind: "course" | "chapter", id: string) {
  const course = kind === "course";
  // Follow live links in both directions. A boundary reference protects the connected in-scope material.
  const rows = await getDb().all<{ id: string; kind: "chapter" | "topic" | "question" | "epoch"; kept: number }>(sql`
    WITH RECURSIVE section(id) AS (
      SELECT id FROM chapters WHERE ${course ? sql`course_id` : sql`id`} = ${id}
      UNION SELECT c.id FROM chapters c JOIN section s ON c.parent_id = s.id
    ),
    notes AS MATERIALIZED (SELECT id FROM topics WHERE
      ${course ? sql`course_id = ${id}` : sql`chapter_id IN (SELECT id FROM section)`}),
    exercises AS MATERIALIZED (SELECT q.id FROM questions q WHERE
      ${course ? sql`q.primary_course_id = ${id}` : sql`
        q.primary_course_id = (SELECT course_id FROM chapters WHERE id = ${id})
        AND EXISTS (SELECT 1 FROM question_topics qt JOIN notes n ON n.id = qt.topic_id WHERE qt.question_id = q.id)`}),
    placement(kind, id) AS MATERIALIZED (
      SELECT 'topic', id FROM notes UNION ALL SELECT 'question', id FROM exercises
    ),
    forward_edges(from_kind, from_id, to_kind, to_id) AS MATERIALIZED (
      SELECT 'topic', t.id, 'question', q.id FROM question_topics qt
      JOIN topics t ON t.id = qt.topic_id AND t.deleted_at IS NULL
      JOIN questions q ON q.id = qt.question_id AND q.deleted_at IS NULL
      UNION ALL
      SELECT 'topic', a.id, 'topic', b.id FROM topic_relations r
      JOIN topics a ON a.id = r.from_topic_id AND a.deleted_at IS NULL
      JOIN topics b ON b.id = r.to_topic_id AND b.deleted_at IS NULL
    ),
    edges(from_kind, from_id, to_kind, to_id) AS MATERIALIZED (
      SELECT * FROM forward_edges UNION ALL SELECT to_kind, to_id, from_kind, from_id FROM forward_edges
    ),
    shared(kind, id) AS (
      SELECT p.kind, p.id FROM placement p JOIN edges e ON e.from_kind = p.kind AND e.from_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM placement boundary WHERE boundary.kind = e.to_kind AND boundary.id = e.to_id)
      UNION
      SELECT p.kind, p.id FROM shared s JOIN edges e ON e.from_kind = s.kind AND e.from_id = s.id
      JOIN placement p ON p.kind = e.to_kind AND p.id = e.to_id
    )
    SELECT id, 'chapter' AS kind, 0 AS kept FROM section
    UNION ALL SELECT p.id, p.kind, EXISTS (SELECT 1 FROM shared s WHERE s.kind = p.kind AND s.id = p.id) FROM placement p
    UNION ALL SELECT '', 'epoch', data_epoch FROM system_state WHERE id = 1
  `);
  return {
    epoch: rows.find((row) => row.kind === "epoch")?.kept ?? -1,
    chapters: rows.filter((row) => row.kind === "chapter").map((row) => row.id),
    topics: rows.filter((row) => row.kind === "topic"),
    questions: rows.filter((row) => row.kind === "question"),
  };
}

type Kind = "chapter" | "topic" | "question";
const tableNames = { chapter: "chapters", topic: "topics", question: "questions" } as const;

export function moveCatalogRows(
  kind: Kind, selected: SQL, destination: { courseId: string | null; chapterId?: string | null; rootId?: string },
  ctx: WriteContext,
) {
  const table = sql.raw(tableNames[kind]);
  const isQuestion = kind === "question";
  const courseColumn = sql.raw(isQuestion ? "primary_course_id" : "course_id");
  const parentColumn = sql.raw(kind === "topic" ? "chapter_id" : "parent_id");
  const parent = destination.chapterId === undefined ? sql`source.${parentColumn}`
    : destination.rootId ? sql`CASE WHEN source.id = ${destination.rootId} THEN ${destination.chapterId} ELSE source.${parentColumn} END`
    : sql`${destination.chapterId}`;
  // IDs stay stable. UUID-based fallback slugs avoid ordinary collisions when whole trees move.
  const slug = sql`CASE WHEN source.course_id IS NOT ${destination.courseId} AND EXISTS (
    SELECT 1 FROM ${table} other WHERE other.course_id IS ${destination.courseId} AND other.slug = source.slug
  ) THEN 'moved-' || source.id ELSE source.slug END`;
  return [sql`UPDATE ${table} AS source SET ${courseColumn} = ${destination.courseId}, row_version = row_version + 1,
      updated_at = ${ctx.now}, updated_by = ${ctx.actorId}, last_origin = 'manual'
      ${isQuestion ? sql.empty() : sql`, ${parentColumn} = ${parent}, slug = ${slug}`}
      WHERE source.id IN ${selected}`];
}

export function removeChapters(selected: SQL) {
  return [
    ...removeRevisions("chapter", selected),
    sql`UPDATE chapters SET parent_id = NULL WHERE id IN ${selected}`,
    sql`DELETE FROM chapters WHERE id IN ${selected}`,
  ];
}

export function removeCatalogContents(
  scope: Awaited<ReturnType<typeof catalogScope>>, mode: "keep" | "purge",
  destination: { courseId: string | null; chapterId: string | null }, ctx: WriteContext, course: boolean,
) {
  const deletedTopics = mode === "purge" ? scope.topics.filter((row) => !row.kept).map(({ id }) => id) : [];
  const deletedQuestions = mode === "purge" ? scope.questions.filter((row) => !row.kept).map(({ id }) => id) : [];
  const movedTopics = scope.topics.filter((row) => mode === "keep" || row.kept).map(({ id }) => id);
  const movedQuestions = course ? scope.questions.filter((row) => mode === "keep" || row.kept).map(({ id }) => id) : [];
  return [
    ...deletedQuestions.length ? removeQuestions(ids(deletedQuestions), ctx.now) : [],
    ...deletedTopics.length ? removeTopics(ids(deletedTopics)) : [],
    ...movedTopics.length ? moveCatalogRows("topic", ids(movedTopics), destination, ctx) : [],
    ...movedQuestions.length ? moveCatalogRows("question", ids(movedQuestions), destination, ctx) : [],
    ...scope.chapters.length ? removeChapters(ids(scope.chapters)) : [],
  ];
}
