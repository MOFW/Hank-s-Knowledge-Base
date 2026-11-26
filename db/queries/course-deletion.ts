import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { usableCourse, type WriteContext } from "@/db/queries/catalog";
import { moveCatalogRows } from "@/db/queries/catalog-management";
import { commitManagement, epochIs, ids, removeRevisions } from "@/db/queries/content-deletion";
import { courses } from "@/db/schema";
import type { DeleteCourseInput } from "@/domain/catalog";

type Course = typeof courses.$inferSelect;

export async function courseDeletionPlan(id: string, ownerId: string) {
  const db = getDb();
  const [source, destinations, counts] = await db.batch([
    db.select().from(courses).where(sql`${courses.id} = ${id} AND ${usableCourse(id)}`),
    db.select({ id: courses.id, name: courses.name, slug: courses.slug }).from(courses)
      .where(sql`${courses.id} <> ${id} AND ${courses.deletedAt} IS NULL AND ${courses.archivedAt} IS NULL`)
      .orderBy(courses.sortOrder, courses.name, courses.id),
    db.select({
      dataEpoch: sql<number>`impact.dataEpoch`, chapters: sql<number>`impact.chapters`,
      topics: sql<number>`impact.topics`, questions: sql<number>`impact.questions`,
      relatedQuestions: sql<number>`impact.relatedQuestions`, attempts: sql<number>`impact.attempts`,
      learningStates: sql<number>`impact.learningStates`, reviewItems: sql<number>`impact.reviewItems`,
      topicRelations: sql<number>`impact.topicRelations`, assetRefs: sql<number>`impact.assetRefs`,
      candidates: sql<number>`impact.candidates`, importReviews: sql<number>`impact.importReviews`,
    }).from(sql`(
      WITH
      course_content AS (
        SELECT id, row_version, 'chapter' AS kind FROM chapters WHERE course_id = ${id}
        UNION ALL SELECT id, row_version, 'topic' FROM topics WHERE course_id = ${id}
        UNION ALL SELECT id, row_version, 'question' FROM questions WHERE primary_course_id = ${id}
      ),
      course_topics AS (SELECT id FROM course_content WHERE kind = 'topic'),
      affected_questions AS (
        SELECT id FROM course_content WHERE kind = 'question'
        UNION SELECT question_id FROM question_topics WHERE topic_id IN (SELECT id FROM course_topics)
      ),
      affected_attempts AS (SELECT id FROM attempts WHERE question_id IN (SELECT id FROM affected_questions)),
      affected_revisions AS (SELECT id, course_id FROM content_revisions WHERE course_id = ${id}
        OR topic_id IN (SELECT id FROM course_topics)
        OR question_id IN (SELECT id FROM affected_questions)
        OR attempt_id IN (SELECT id FROM affected_attempts)),
      candidate_refs AS (
        SELECT i.id FROM import_items i JOIN import_batches b ON b.id = i.batch_id
        WHERE b.owner_id = ${ownerId} AND (
          i.question_id IN (SELECT id FROM affected_questions) OR i.topic_id IN (SELECT id FROM course_topics)
          OR EXISTS (
            SELECT 1 FROM json_tree(json_array(json(i.candidate_json), json(i.mapping_json))) ref
            WHERE ref.type = 'text' AND (
              ref.atom = ${id} OR ref.atom IN (SELECT id FROM course_content)
              OR (ref.key = 'name' AND lower(trim(ref.atom)) IN (
                SELECT lower(trim(name)) FROM courses WHERE id = ${id}
                UNION SELECT lower(slug) FROM courses WHERE id = ${id}
              ))
            )
          )
        )
      )
      SELECT data_epoch AS dataEpoch,
        (SELECT count(*) FROM course_content WHERE kind = 'chapter') AS chapters,
        (SELECT count(*) FROM course_topics) AS topics,
        (SELECT count(*) FROM course_content WHERE kind = 'question') AS questions,
        (SELECT count(*) FROM affected_questions WHERE id NOT IN (
          SELECT id FROM course_content WHERE kind = 'question'
        )) AS relatedQuestions,
        (SELECT count(*) FROM affected_attempts) AS attempts,
        (SELECT count(*) FROM learning_states WHERE question_id IN (SELECT id FROM affected_questions)) AS learningStates,
        (SELECT count(*) FROM review_items WHERE question_id IN (SELECT id FROM affected_questions)) AS reviewItems,
        (SELECT count(*) FROM topic_relations WHERE from_topic_id IN (SELECT id FROM course_topics)
          OR to_topic_id IN (SELECT id FROM course_topics)) AS topicRelations,
        (SELECT count(*) FROM asset_links WHERE topic_id IN (SELECT id FROM course_topics)
          OR question_id IN (SELECT id FROM affected_questions) OR attempt_id IN (SELECT id FROM affected_attempts)
          OR revision_id IN (SELECT id FROM affected_revisions)) AS assetRefs,
        (SELECT count(*) FROM candidate_refs) AS candidates,
        (SELECT count(*) FROM import_reviews WHERE item_id IN (SELECT id FROM candidate_refs))
          + (SELECT count(*) FROM ai_reviews WHERE item_id IN (SELECT id FROM candidate_refs)) AS importReviews
      FROM system_state WHERE id = 1
    ) AS impact`),
  ]);
  if (!source[0] || !counts[0]) return null;
  return { course: source[0], destinations, ...counts[0] };
}

export async function commitCourseDeletion(course: Course, input: DeleteCourseInput, ctx: WriteContext) {
  const { id } = course;
  const { destinationId, dataEpoch } = input;
  const result = { id, rowVersion: course.rowVersion };
  const destinationCheck = destinationId ? usableCourse(destinationId) : sql`
    NOT EXISTS (SELECT 1 FROM chapters WHERE course_id = ${id})
    AND NOT EXISTS (SELECT 1 FROM topics WHERE course_id = ${id})
    AND NOT EXISTS (SELECT 1 FROM questions WHERE primary_course_id = ${id})`;
  const move = destinationId ? [
    sql`PRAGMA defer_foreign_keys = ON`,
    ...moveCatalogRows("chapter", sql`(SELECT id FROM chapters WHERE course_id = ${id})`, { courseId: destinationId }, ctx),
    ...moveCatalogRows("topic", sql`(SELECT id FROM topics WHERE course_id = ${id})`, { courseId: destinationId }, ctx),
    ...moveCatalogRows("question", sql`(SELECT id FROM questions WHERE primary_course_id = ${id})`, { courseId: destinationId }, ctx),
  ] : [];
  return commitManagement(result, sql`${usableCourse(id)} AND (${destinationCheck}) AND ${epochIs(dataEpoch)}`, [
    ...move,
    ...removeRevisions("course", ids([id])),
    sql`INSERT INTO course_deletions (course_id, destination_id, snapshot_json, actor_id, deleted_at)
      VALUES (${id}, ${destinationId ?? null}, json_object('id', ${id}), ${ctx.actorId}, ${ctx.now})`,
    sql`DELETE FROM courses WHERE id = ${id}`,
  ], ctx, { code: "COURSE_DELETE_CONFLICT", message: "关联内容已经变化，请刷新后重新确认。" });
}

export async function deletedCourseDestination(id: string) {
  return getDb().get<{ destinationId: string | null }>(sql`
    WITH RECURSIVE destinations(id, destination_id) AS (
      SELECT course_id, destination_id FROM course_deletions WHERE course_id = ${id}
      UNION
      SELECT d.course_id, d.destination_id FROM course_deletions d
      JOIN destinations previous ON previous.destination_id = d.course_id
    )
    SELECT d.destination_id AS destinationId FROM destinations d
    LEFT JOIN course_deletions following ON following.course_id = d.destination_id
    WHERE following.course_id IS NULL LIMIT 1
  `);
}
