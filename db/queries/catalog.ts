import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, courses, systemState, topicRelations, topics, users, writeReceipts } from "@/db/schema";

const activeCourse = and(isNull(courses.deletedAt), isNull(courses.archivedAt));
export const courseList = () => getDb().select().from(courses).where(activeCourse)
  .orderBy(courses.sortOrder, courses.id).all();

export const courseDetail = (id: string) => getDb().select().from(courses)
  .where(and(eq(courses.id, id), activeCourse)).get();

export const chapterList = (courseId: string) => getDb().select().from(chapters)
  .where(and(eq(chapters.courseId, courseId), isNull(chapters.deletedAt)))
  .orderBy(chapters.sortOrder, chapters.id).all();

export const topicList = (courseId: string | null) => getDb().select({
  id: topics.id, title: topics.title, chapterId: topics.chapterId, summaryMd: topics.summaryMd,
  sortOrder: topics.sortOrder, rowVersion: topics.rowVersion,
}).from(topics)
  .where(and(courseId === null ? isNull(topics.courseId) : eq(topics.courseId, courseId), isNull(topics.deletedAt)))
  .orderBy(topics.sortOrder, topics.id).all();

export const topicDetail = (id: string) => getDb().select({ topic: topics }).from(topics)
  .leftJoin(courses, eq(topics.courseId, courses.id))
  .where(and(eq(topics.id, id), isNull(topics.deletedAt), activeCourse)).get()
  .then((row) => row?.topic);

export const readingChapters = (courseId: string) => getDb().select({
  id: chapters.id, parentId: chapters.parentId, title: chapters.title,
}).from(chapters).where(and(eq(chapters.courseId, courseId), isNull(chapters.deletedAt)))
  .orderBy(chapters.sortOrder, chapters.id).all();

export const readingTopics = (courseId: string) => getDb().select({
  id: topics.id, chapterId: topics.chapterId, title: topics.title, rowVersion: topics.rowVersion,
}).from(topics).where(and(eq(topics.courseId, courseId), isNull(topics.deletedAt)))
  .orderBy(topics.sortOrder, topics.id).all();

export const readingTopic = (courseId: string, id: string) => getDb().select({
  id: topics.id, chapterId: topics.chapterId, title: topics.title, rowVersion: topics.rowVersion, bodyMd: topics.bodyMd,
  supplementMd: topics.supplementMd,
}).from(topics).innerJoin(courses, eq(topics.courseId, courses.id))
  .where(and(eq(topics.id, id), eq(topics.courseId, courseId), isNull(topics.deletedAt), activeCourse));

export const findReceipt = (actorId: string, key: string) => getDb().select().from(writeReceipts)
  .where(and(eq(writeReceipts.actorId, actorId), eq(writeReceipts.idempotencyKey, key))).get();

export type CatalogWrite =
  | { kind: "course"; row: typeof courses.$inferSelect; expectedVersion?: number }
  | { kind: "chapter"; row: typeof chapters.$inferSelect }
  | { kind: "topic"; row: typeof topics.$inferSelect; expectedVersion?: number; relatedTopicIds?: string[] };

export type WriteContext = {
  actorId: string; key: string; hash: string; now: string;
};

export function usableCourse(courseId: string | null) {
  if (courseId === null) return sql`1`;
  return sql`EXISTS (SELECT 1 FROM courses
    WHERE id = ${courseId} AND deleted_at IS NULL AND archived_at IS NULL)`;
}

export function validChapterChain(courseId: string | null, chapterId: string | null, maxDepth: number) {
  if (chapterId === null) return sql`1`;
  if (courseId === null) return sql`0`;
  // Bound recursion even if old data has an invalid cycle.
  return sql`EXISTS (
    WITH RECURSIVE ancestors(parent_id, depth) AS (
      SELECT parent_id, 1 FROM chapters
      WHERE id = ${chapterId} AND course_id = ${courseId} AND deleted_at IS NULL
      UNION ALL
      SELECT c.parent_id, a.depth + 1 FROM chapters c
      JOIN ancestors a ON a.parent_id = c.id
      WHERE c.course_id = ${courseId} AND c.deleted_at IS NULL AND a.depth < ${maxDepth}
    )
    SELECT 1 FROM ancestors WHERE parent_id IS NULL
  )`;
}

function validParent(write: CatalogWrite): SQL {
  if (write.kind === "course") return sql`1`;
  const row = write.row;
  const chain = write.kind === "chapter"
    ? validChapterChain(write.row.courseId, write.row.parentId, 5)
    : validChapterChain(write.row.courseId, write.row.chapterId, 6);
  return sql`${usableCourse(row.courseId)} AND ${chain}`;
}

export function writeReceipt(
  db: ReturnType<typeof getDb>,
  ctx: WriteContext,
  result: typeof writeReceipts.$inferSelect.resultJson,
  precondition: SQL,
) {
  return db.insert(writeReceipts).values({
    id: crypto.randomUUID(),
    actorId: ctx.actorId,
    idempotencyKey: ctx.key,
    requestHash: ctx.hash,
    preconditionOk: sql`CASE WHEN
      EXISTS (SELECT 1 FROM users WHERE id = ${ctx.actorId} AND role = 'owner' AND disabled_at IS NULL)
      AND EXISTS (SELECT 1 FROM system_state WHERE id = 1
        AND (maintenance_expires_at IS NULL OR maintenance_expires_at <= ${ctx.now}))
      AND (${precondition})
      THEN 1 ELSE 0 END`,
    resultJson: result,
    createdAt: ctx.now,
  });
}

export function advanceEpoch(db: ReturnType<typeof getDb>, ctx: WriteContext) {
  return db.update(systemState).set({
    dataEpoch: sql`${systemState.dataEpoch} + 1`,
    updatedAt: ctx.now,
  }).where(eq(systemState.id, 1));
}

export function catalogPrecondition(write: CatalogWrite) {
  const { row } = write;
  const expected = write.kind === "chapter" ? undefined : write.expectedVersion;
  const table = write.kind === "course" ? courses : topics;
  const checkVersion = expected === undefined ? sql`1` : sql`EXISTS (
    SELECT 1 FROM ${table} WHERE id = ${row.id} AND row_version = ${expected} AND deleted_at IS NULL
  )`;
  const related = write.kind === "topic" ? write.relatedTopicIds : undefined;
  const checkRelated = related === undefined ? sql`1` : sql`NOT EXISTS (
    SELECT 1 FROM json_each(${JSON.stringify(related)}) wanted WHERE wanted.value = ${row.id} OR NOT EXISTS (
      SELECT 1 FROM topics t LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.id = wanted.value AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL
    )
  )`;
  return sql`${validParent(write)} AND ${checkVersion} AND ${checkRelated}`;
}

export function catalogMutations(
  db: ReturnType<typeof getDb>, write: CatalogWrite, ctx: WriteContext,
) {
  const { row, kind } = write;
  const mutation = kind === "course"
    ? write.expectedVersion === undefined ? db.insert(courses).values(write.row) : db.update(courses).set(write.row).where(eq(courses.id, row.id))
    : kind === "chapter" ? db.insert(chapters).values(write.row)
    : write.expectedVersion === undefined ? db.insert(topics).values(write.row)
    : db.update(topics).set(write.row).where(eq(topics.id, row.id));
  if (kind !== "topic" || write.relatedTopicIds === undefined) return [mutation] as const;
  const wanted = sql`(SELECT value FROM json_each(${JSON.stringify(write.relatedTopicIds)}))`;
  const unlink = db.delete(topicRelations).where(sql`
    (${topicRelations.fromTopicId} = ${row.id} AND ${topicRelations.toTopicId} NOT IN ${wanted})
    OR (${topicRelations.toTopicId} = ${row.id} AND ${topicRelations.fromTopicId} NOT IN ${wanted})
  `);
  const link = db.insert(topicRelations).select(sql`
    SELECT ${row.id}, wanted.value, ${ctx.now}, ${ctx.actorId} FROM ${wanted} wanted
    WHERE NOT EXISTS (
      SELECT 1 FROM topic_relations r
      WHERE (r.from_topic_id = ${row.id} AND r.to_topic_id = wanted.value)
        OR (r.to_topic_id = ${row.id} AND r.from_topic_id = wanted.value)
    )
  `);
  return [mutation, unlink, link] as const;
}

export async function commitCatalog(write: CatalogWrite, ctx: WriteContext) {
  const db = getDb();
  const result = { id: write.row.id, rowVersion: write.row.rowVersion };
  const receipt = writeReceipt(db, ctx, result, catalogPrecondition(write));
  await db.batch([receipt, ...catalogMutations(db, write, ctx), advanceEpoch(db, ctx)]);
  return result;
}

export async function writeBlock(ctx: WriteContext) {
  const db = getDb();
  const actor = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, ctx.actorId), eq(users.role, "owner"), isNull(users.disabledAt))).get();
  if (!actor) return "owner";
  const state = await db.select().from(systemState).where(eq(systemState.id, 1)).get();
  if (!state || (state.maintenanceExpiresAt && state.maintenanceExpiresAt > ctx.now)) return "maintenance";
  return "parent";
}
