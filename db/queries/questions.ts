import { and, asc, desc, eq, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { AtomicStatement } from "@/db/atomic";
import { filterSolutionTopics } from "@/domain/solution";
import { getDb } from "@/db";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import {
  assetLinks, attempts, chapters, contentRevisions, courses, learningStates,
  provenanceLinks, questions, questionTopics, reviewItems, reviewSessions, sources, topics,
} from "@/db/schema";

export type QuestionRow = typeof questions.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type LearningStateRow = typeof learningStates.$inferSelect;
export type RevisionTarget = "question" | "topic" | "attempt";

const topicColumns = {
  id: topics.id,
  title: topics.title,
  courseId: topics.courseId,
  courseName: sql<string>`coalesce(${courses.name}, '未归类')`.as("course_name"),
  chapterId: topics.chapterId,
  chapterTitle: sql<string | null>`${chapters.title}`.as("chapter_title"),
};

const activeCourse = and(isNull(courses.deletedAt), isNull(courses.archivedAt));
export const activeQuestion = and(isNull(questions.deletedAt), activeCourse);
const manualSourceField = "statementMd";

export function questionTopicChoices() {
  return getDb().select(topicColumns).from(topics)
    .leftJoin(courses, eq(topics.courseId, courses.id))
    .leftJoin(chapters, and(eq(topics.chapterId, chapters.id), isNull(chapters.deletedAt)))
    .where(and(isNull(topics.deletedAt), activeCourse))
    .orderBy(courses.sortOrder, courses.name, courses.id, chapters.sortOrder, topics.sortOrder, topics.title, topics.id).all();
}

function questionSource(db: ReturnType<typeof getDb>, questionId: string) {
  return db.select({
    id: sources.id, title: sources.title, locator: provenanceLinks.locatorJson,
  }).from(provenanceLinks).innerJoin(sources, eq(provenanceLinks.sourceId, sources.id))
    .where(and(eq(provenanceLinks.questionId, questionId), eq(provenanceLinks.fieldPath, manualSourceField)))
    .orderBy(desc(provenanceLinks.createdAt), provenanceLinks.id).limit(1);
}

export function questionExists(id: string, includeDeleted = false) {
  return getDb().select({ id: questions.id }).from(questions)
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(questions.id, id), includeDeleted ? undefined : activeQuestion)).get()
    .then(Boolean);
}

function questionContentQueries(db: ReturnType<typeof getDb>, id: string, includeDeleted = false) {
  return [
    db.select({ question: questions, courseName: sql<string>`coalesce(${courses.name}, '未归类')`.as("course_name") })
      .from(questions)
      .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
      .where(and(eq(questions.id, id), includeDeleted ? undefined : activeQuestion)),
    db.select({
      ...topicColumns, topicDeletedAt: sql<string | null>`${topics.deletedAt}`.as("topic_deleted_at"),
      courseDeletedAt: sql<string | null>`${courses.deletedAt}`.as("course_deleted_at"),
      courseArchivedAt: sql<string | null>`${courses.archivedAt}`.as("course_archived_at"),
    }).from(questionTopics)
      .innerJoin(topics, eq(questionTopics.topicId, topics.id))
      .leftJoin(courses, eq(topics.courseId, courses.id))
      .leftJoin(chapters, and(eq(topics.chapterId, chapters.id), isNull(chapters.deletedAt)))
      .where(eq(questionTopics.questionId, id))
      .orderBy(courses.sortOrder, courses.name, courses.id, chapters.sortOrder, topics.sortOrder, topics.title, topics.id),
    questionSource(db, id),
    db.select({ id: assetLinks.assetId }).from(assetLinks)
      .where(and(eq(assetLinks.questionId, id), eq(assetLinks.role, "original")))
      .orderBy(assetLinks.sortOrder, assetLinks.assetId),
  ] as const;
}

type QueryResults<Queries extends readonly unknown[]> = { [Index in keyof Queries]: Awaited<Queries[Index]> };
type ContentRows = QueryResults<ReturnType<typeof questionContentQueries>>;
type QuestionContent = NonNullable<ReturnType<typeof assembleQuestion>>;

function assembleQuestion([records, related, sourceRows, imageRows]: ContentRows) {
  const record = records[0];
  if (!record) return undefined;
  const source = sourceRows[0];
  const liveTopics = related.filter(({ topicDeletedAt, courseDeletedAt, courseArchivedAt }) =>
    !topicDeletedAt && !courseDeletedAt && !courseArchivedAt)
    .map(({ id, title, courseId, courseName, chapterId, chapterTitle }) => ({ id, title, courseId, courseName, chapterId, chapterTitle }));
  const topicIds = liveTopics.map(({ id }) => id);
  return {
    ...record.question,
    ...filterSolutionTopics(record.question, topicIds),
    courseName: record.courseName, topicIds, topics: liveTopics,
    sourceTitle: source?.title ?? null,
    sourceLocator: source?.locator.reference ?? null,
    originalAssetIds: imageRows.map(({ id }) => id),
  };
}

export type QuestionDetail = QuestionContent & { learningState: LearningStateRow | null };

export async function questionDetail(id: string, userId: string, includeDeleted = false): Promise<QuestionDetail | undefined> {
  const db = getDb();
  // D1 batch returns object rows, which require distinct SQL column names in each SELECT.
  const [records, related, sourceRows, imageRows, states] = await db.batch([
    ...questionContentQueries(db, id, includeDeleted),
    db.select().from(learningStates).where(and(eq(learningStates.questionId, id),
      eq(learningStates.userId, userId), isNull(learningStates.deletedAt))),
  ]);
  const question = assembleQuestion([records, related, sourceRows, imageRows]);
  return question ? { ...question, learningState: states[0] ?? null } : undefined;
}

export async function questionImportTargets(ids: string[]) {
  const db = getDb();
  const [first, ...rest] = ids.flatMap((id) => [...questionContentQueries(db, id)]);
  if (!first) return new Map<string, QuestionContent | undefined>();
  const rows = await db.batch([first, ...rest]);
  const queryCount: ContentRows["length"] = 4;
  return new Map(ids.map((id, index) => {
    const offset = index * queryCount;
    return [id, assembleQuestion(rows.slice(offset, offset + queryCount) as unknown as ContentRows)] as const;
  }));
}

export type QuestionFilters = {
  courseId?: string;
  scope?: "primary" | "related";
  chapterId?: string;
  topicId?: string;
  mastery?: LearningStateRow["mastery"];
  isMistake?: boolean;
  dueBefore?: string;
  limit?: number;
  before?: { updatedAt: string; id: string };
};

function linkedTopic(conditions: SQL[]) {
  return sql`EXISTS (
    SELECT 1 FROM question_topics AS qt
    JOIN topics AS t ON t.id = qt.topic_id AND t.deleted_at IS NULL
    LEFT JOIN courses AS c ON c.id = t.course_id
    WHERE c.deleted_at IS NULL AND c.archived_at IS NULL AND qt.question_id = ${questions.id} AND ${sql.join(conditions, sql` AND `)}
  )`;
}

function filteredQuestions(userId: string, filters: QuestionFilters) {
  const { courseId, scope, chapterId, topicId, mastery, isMistake, dueBefore, before } = filters;
  const conditions = [activeQuestion];
  if (courseId === "unassigned") conditions.push(isNull(questions.primaryCourseId));
  else if (courseId) {
    const primary = eq(questions.primaryCourseId, courseId);
    conditions.push(scope === "related"
      ? sql`(${primary} OR ${linkedTopic([sql`t.course_id = ${courseId}`])})`
      : primary);
  }
  const topicConditions = [];
  if (chapterId) topicConditions.push(sql`t.chapter_id = ${chapterId}`);
  if (topicId) topicConditions.push(sql`t.id = ${topicId}`);
  if (topicConditions.length) conditions.push(linkedTopic(topicConditions));
  if (mastery) conditions.push(eq(learningStates.mastery, mastery));
  if (isMistake !== undefined) conditions.push(eq(learningStates.isMistake, isMistake));
  if (dueBefore) conditions.push(lte(learningStates.nextReviewOn, dueBefore));
  if (before) conditions.push(sql`(${questions.updatedAt} < ${before.updatedAt}
    OR (${questions.updatedAt} = ${before.updatedAt} AND ${questions.id} > ${before.id}))`);

  return getDb().select({
    id: questions.id,
    title: questions.title,
    primaryCourseId: questions.primaryCourseId,
    courseName: sql<string>`coalesce(${courses.name}, '未归类')`.as("course_name"),
    difficulty: questions.difficulty,
    updatedAt: questions.updatedAt,
    rowVersion: questions.rowVersion,
    mastery: learningStates.mastery,
    isMistake: learningStates.isMistake,
    nextReviewOn: learningStates.nextReviewOn,
  }).from(questions)
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .leftJoin(learningStates, and(eq(learningStates.questionId, questions.id),
      eq(learningStates.userId, userId), isNull(learningStates.deletedAt)))
    .where(and(...conditions));
}

export function dueReviewCandidates(
  userId: string, filters: Pick<QuestionFilters, "courseId" | "topicId"> & { dueBefore: string },
  limit: number, skippedSince: string,
) {
  const due = filteredQuestions(userId, { ...filters, scope: "related" }).as("due_questions");
  const db = getDb();
  const skipped = db.select({ position: reviewItems.position }).from(reviewItems)
    .innerJoin(reviewSessions, eq(reviewSessions.id, reviewItems.sessionId))
    .where(and(eq(reviewSessions.userId, userId), eq(reviewItems.questionId, due.id),
      eq(reviewItems.outcome, "skipped"), sql`${reviewItems.resolvedAt} > ${skippedSince}`));
  const priority = sql`row_number() OVER (ORDER BY ${due.nextReviewOn}, ${due.updatedAt} DESC, ${due.id})`;
  return db.select({ questionId: due.id, sortKey: sql`-(${priority})`.as("sort_key") }).from(due)
    .where(sql`NOT EXISTS (${skipped.getSQL()})`).orderBy(asc(due.nextReviewOn), desc(due.updatedAt), asc(due.id)).limit(limit);
}

export function questionList(userId: string, filters: QuestionFilters = {}) {
  return filteredQuestions(userId, filters).orderBy(desc(questions.updatedAt), asc(questions.id)).limit(filters.limit ?? 20).all();
}

export type QuestionSummary = Awaited<ReturnType<typeof questionList>>[number];

export function attemptList(questionId: string, userId: string, page?: { limit: number; before?: string }) {
  return getDb().select({ attempt: attempts }).from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(attempts.questionId, questionId), eq(attempts.userId, userId),
      isNull(attempts.deletedAt), activeQuestion, page?.before ? sql`
        (attempts.created_at, attempts.id) < (SELECT created_at, id FROM attempts
          WHERE id = ${page.before} AND question_id = ${questionId} AND user_id = ${userId})` : undefined))
    .orderBy(desc(attempts.createdAt), desc(attempts.id)).limit(page?.limit ?? -1).all()
    .then((rows) => rows.map(({ attempt }) => attempt));
}

function activeAttempt(id: string, userId: string) {
  return and(eq(attempts.id, id), eq(attempts.userId, userId), isNull(attempts.deletedAt), activeQuestion);
}

export function attemptExists(id: string, userId: string) {
  return getDb().select({ id: attempts.id }).from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(activeAttempt(id, userId)).get()
    .then(Boolean);
}

export function attemptDetail(id: string, userId: string) {
  return getDb().select({ attempt: attempts }).from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(activeAttempt(id, userId)).get()
    .then((row) => row?.attempt);
}

export function learningStateDetail(questionId: string, userId: string) {
  return getDb().select({ state: learningStates }).from(learningStates)
    .innerJoin(questions, eq(learningStates.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(learningStates.questionId, questionId), eq(learningStates.userId, userId),
      isNull(learningStates.deletedAt), activeQuestion)).get()
    .then((row) => row?.state);
}

const targetColumn = {
  question: contentRevisions.questionId,
  attempt: contentRevisions.attemptId,
  topic: contentRevisions.topicId,
};

export function revisionList(target: RevisionTarget, id: string) {
  return getDb().select({
    id: contentRevisions.id, revisionNo: contentRevisions.revisionNo, createdAt: contentRevisions.createdAt,
    origin: contentRevisions.origin, reason: contentRevisions.reason,
  }).from(contentRevisions)
    .where(eq(targetColumn[target], id)).orderBy(desc(contentRevisions.revisionNo)).all();
}

export function revisionDetail(target: RevisionTarget, id: string, revisionNo: number) {
  return getDb().select().from(contentRevisions)
    .where(and(eq(targetColumn[target], id), eq(contentRevisions.revisionNo, revisionNo))).get();
}

type QuestionRelations = {
  topicIds: string[];
  sourceTitle: string | null;
  sourceLocator: string | null;
  originalAssetIds: string[];
};
type QuestionMutation = BatchItem<"sqlite"> & AtomicStatement;

export type QuestionRecordWrite = QuestionRelations & {
  kind: "question";
  row: QuestionRow;
  expectedVersion?: number;
  state?: LearningStateRow;
  allowDeleted?: boolean;
  restoreFrom?: string;
  preserveOriginalAssets?: boolean;
};

type AttemptWrite = {
  kind: "attempt";
  row: AttemptRow;
  expectedVersion?: number;
  restoreFrom?: string;
};

export type LearningStateWrite = {
  kind: "learningState";
  row: LearningStateRow;
  expectedVersion: number;
};

export type QuestionWrite = QuestionRecordWrite | AttemptWrite | LearningStateWrite;

export function liveQuestion(questionId: string, expectedVersion?: number) {
  return sql`EXISTS (
    SELECT 1 FROM questions AS q
    LEFT JOIN courses AS c ON c.id = q.primary_course_id
    WHERE c.deleted_at IS NULL AND c.archived_at IS NULL AND q.id = ${questionId} AND q.deleted_at IS NULL
    AND ${expectedVersion === undefined ? sql`1` : sql`q.row_version = ${expectedVersion}`}
  )`;
}

export function questionPrecondition(write: QuestionRecordWrite, ctx: WriteContext) {
  const { row, expectedVersion, allowDeleted, topicIds, originalAssetIds, restoreFrom } = write;
  const version = expectedVersion === undefined ? sql`1` : sql`EXISTS (
    SELECT 1 FROM questions WHERE id = ${row.id} AND row_version = ${expectedVersion}
      AND (${Boolean(allowDeleted)} OR deleted_at IS NULL)
  )`;
  if (row.deletedAt !== null) return version;
  return sql`${version}
    AND (${restoreFrom === undefined} OR EXISTS (SELECT 1 FROM content_revisions WHERE id = ${restoreFrom ?? null}))
    AND (${row.primaryCourseId === null} OR EXISTS (
      SELECT 1 FROM courses WHERE id = ${row.primaryCourseId} AND deleted_at IS NULL AND archived_at IS NULL
    ))
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${JSON.stringify(topicIds)}) AS requested
      WHERE NOT EXISTS (
        SELECT 1 FROM topics AS t
        LEFT JOIN courses AS c ON c.id = t.course_id
        WHERE t.id = requested.value AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(${JSON.stringify(originalAssetIds)}) AS requested
      WHERE NOT EXISTS (
        SELECT 1 FROM assets
        WHERE id = requested.value AND created_by = ${ctx.actorId} AND status = 'ready' AND deleted_at IS NULL
      )
    )
    AND (${Boolean(row.statementMd.trim())} OR ${originalAssetIds.length > 0})`;
}

export function learningStateVersion({ row, expectedVersion }: LearningStateWrite, ctx: WriteContext) {
  return sql`EXISTS (
    SELECT 1 FROM ${learningStates} WHERE id = ${row.id} AND row_version = ${expectedVersion} AND deleted_at IS NULL
      AND question_id = ${row.questionId} AND user_id = ${ctx.actorId}
  )`;
}

export function learningStateMutations(db: ReturnType<typeof getDb>, write: LearningStateWrite) {
  const { row } = write;
  return [
    db.update(learningStates).set(row).where(eq(learningStates.id, row.id)),
  ] as const;
}

function topicMutations(db: ReturnType<typeof getDb>, id: string, topicIds: string[], ctx: WriteContext) {
  const ids = JSON.stringify(topicIds);
  return [
    db.delete(questionTopics).where(and(eq(questionTopics.questionId, id),
      sql`${questionTopics.topicId} NOT IN (SELECT value FROM json_each(${ids}))`)),
    db.insert(questionTopics).select(sql`
      SELECT ${id}, value, 'uses', '', ${ctx.now}, ${ctx.actorId}, 'related', 0, NULL, 0 FROM json_each(${ids}) WHERE 1
    `).onConflictDoNothing({ target: [questionTopics.questionId, questionTopics.topicId] }),
  ] as const;
}

async function sourceMutations(db: ReturnType<typeof getDb>, write: QuestionRecordWrite, ctx: WriteContext) {
  const { row, expectedVersion, sourceTitle, sourceLocator } = write;
  const [current] = expectedVersion === undefined ? [] : await questionSource(db, row.id).all();
  if ((current?.title ?? null) === sourceTitle && (current?.locator.reference ?? null) === sourceLocator) return [];

  const changes: QuestionMutation[] = [];
  if (current) changes.push(db.delete(provenanceLinks).where(and(
    eq(provenanceLinks.questionId, row.id), eq(provenanceLinks.fieldPath, manualSourceField),
  )));
  if (sourceTitle) {
    const sourceId = current?.title === sourceTitle ? current.id : crypto.randomUUID();
    if (sourceId !== current?.id) changes.push(db.insert(sources).values({
      id: sourceId, title: sourceTitle, kind: "manual", acquisitionStatus: "partial",
      capturedAt: ctx.now, createdBy: ctx.actorId,
    }));
    changes.push(db.insert(provenanceLinks).values({
      id: crypto.randomUUID(), sourceId, questionId: row.id, fieldPath: manualSourceField,
      locatorJson: sourceLocator ? { reference: sourceLocator } : {},
      evidenceKind: "user_confirmation", verification: "unverified", createdAt: ctx.now,
    }));
  }
  return changes;
}

export function insertAssetLinks(
  db: ReturnType<typeof getDb>, target: { questionId: string }, originalAssetIds: string[],
) {
  return db.insert(assetLinks).values(originalAssetIds.map((assetId, sortOrder) => ({
    id: crypto.randomUUID(), ...target, assetId, role: "original" as const, sortOrder,
  })));
}

export async function questionMutations(
  db: ReturnType<typeof getDb>, write: QuestionRecordWrite, ctx: WriteContext,
) {
  const { row, topicIds, originalAssetIds, state, expectedVersion } = write;
  const mutation = expectedVersion === undefined
    ? db.insert(questions).values(row)
    : db.update(questions).set(row).where(eq(questions.id, row.id));
  const changes: QuestionMutation[] = [mutation];
  if (row.deletedAt === null) {
    changes.push(...topicMutations(db, row.id, topicIds, ctx));
    if (row.lastOrigin !== "import") changes.push(...await sourceMutations(db, write, ctx));
    if (!write.preserveOriginalAssets && expectedVersion !== undefined && row.lastOrigin !== "import") changes.push(db.delete(assetLinks).where(and(
      eq(assetLinks.questionId, row.id), eq(assetLinks.role, "original"),
    )));
    if (!write.preserveOriginalAssets && originalAssetIds.length) {
      const links = insertAssetLinks(db, { questionId: row.id }, originalAssetIds);
      changes.push(row.lastOrigin === "import" ? links.onConflictDoNothing() : links);
    }
  }
  if (state) {
    changes.push(db.insert(learningStates).values(state));
  } else if (expectedVersion === undefined) {
    throw new Error("A new question requires its initial learning state.");
  }
  return changes;
}

export async function commitQuestion(write: QuestionWrite, ctx: WriteContext) {
  const db = getDb();
  const { row } = write;
  const result = { id: row.id, rowVersion: row.rowVersion };
  if (write.kind === "question") {
    const receipt = writeReceipt(db, ctx, result, questionPrecondition(write, ctx));
    await db.batch([receipt, ...await questionMutations(db, write, ctx), advanceEpoch(db, ctx)]);
    return result;
  }

  if (write.kind === "learningState") {
    const { mastery, isMistake, nextReviewOn, questionId, userId } = write.row;
    const saved = { ...result, learningState: { mastery, isMistake, nextReviewOn } };
    const receipt = writeReceipt(db, ctx, saved,
      sql`${liveQuestion(questionId)} AND ${userId === ctx.actorId} AND ${learningStateVersion(write, ctx)}`);
    await db.batch([receipt, ...learningStateMutations(db, write), advanceEpoch(db, ctx)]);
    return saved;
  }

  const { condition, mutation } = attemptMutation(db, write, ctx);
  await db.batch([writeReceipt(db, ctx, result, condition), mutation, advanceEpoch(db, ctx)]);
  return result;
}

export function attemptMutation(db: ReturnType<typeof getDb>, write: AttemptWrite, ctx: WriteContext) {
  const { row: personalRow, expectedVersion } = write;
  const parent = liveQuestion(personalRow.questionId);
  const version = expectedVersion === undefined ? sql`1` : sql`EXISTS (
    SELECT 1 FROM ${attempts} WHERE id = ${personalRow.id} AND row_version = ${expectedVersion} AND deleted_at IS NULL
      AND question_id = ${personalRow.questionId} AND user_id = ${ctx.actorId}
  )`;
  const sourceRevisionId = write.row.sourceRevisionId;
  const source = sourceRevisionId === null ? sql`1` : sql`EXISTS (
    SELECT 1 FROM content_revisions WHERE id = ${sourceRevisionId} AND question_id = ${personalRow.questionId}
  )`;
  const condition = sql`${parent} AND ${personalRow.userId === ctx.actorId} AND ${version} AND ${source}
      AND (${write.restoreFrom === undefined} OR EXISTS (SELECT 1 FROM content_revisions WHERE id = ${write.restoreFrom ?? null}))`;
  const mutation = expectedVersion === undefined
    ? db.insert(attempts).values(write.row)
    : db.update(attempts).set(write.row).where(eq(attempts.id, personalRow.id));
  return { condition, mutation };
}
