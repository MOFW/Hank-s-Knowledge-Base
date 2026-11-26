import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { advanceEpoch, writeReceipt, type WriteContext } from "@/db/queries/catalog";
import { activeQuestion, dueReviewCandidates, learningStateMutations, learningStateVersion, type LearningStateWrite } from "@/db/queries/questions";
import { courses, questions, reviewItems, reviewSessions } from "@/db/schema";
import type { DueReviewScope } from "@/domain/review";

export type ReviewSessionRow = typeof reviewSessions.$inferSelect;
export type ReviewItemRow = typeof reviewItems.$inferSelect;
const openStatuses = ["active", "paused"] as const;
const practiceOutcomes = ["assisted", "practice"] as const;

function openSessions(ownerId: string) {
  return and(eq(reviewSessions.userId, ownerId), inArray(reviewSessions.status, openStatuses));
}

type DueQueue = { filters: DueReviewScope & { dueBefore: string }; limit: number; skippedSince: string };

export async function reviewEntry(ownerId: string, queue: DueQueue) {
  const db = getDb();
  const [open, latest] = await db.batch([
    db.select({ id: reviewSessions.id, position: reviewSessions.position, total: reviewSessions.total })
      .from(reviewSessions).where(openSessions(ownerId)).limit(1),
    db.select({ id: reviewSessions.id }).from(reviewSessions).where(eq(reviewSessions.userId, ownerId))
      .orderBy(desc(reviewSessions.updatedAt), desc(reviewSessions.id)).limit(1),
  ]);
  const candidates = dueReviewCandidates(ownerId, queue.filters, queue.limit + 1, queue.skippedSince).as("candidates");
  const available = open.length ? 0 : (await db.select({ total: count() }).from(candidates).get())?.total ?? 0;
  return { open: open[0] ?? null, latest: latest[0] ?? null, due: Math.min(available, queue.limit), capped: available > queue.limit };
}

function practiceCandidates(ownerId: string, sourceId: string) {
  return getDb().select({ questionId: reviewItems.questionId, sortKey: sql`-${reviewItems.position}`.as("sort_key") })
    .from(reviewItems)
    .innerJoin(reviewSessions, eq(reviewItems.sessionId, reviewSessions.id))
    .innerJoin(questions, eq(reviewItems.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(reviewSessions.id, sourceId), eq(reviewSessions.userId, ownerId),
      inArray(reviewSessions.status, ["completed", "ended"]), inArray(reviewItems.outcome, practiceOutcomes), activeQuestion));
}

type Queue = { due: DueQueue } | { sourceId: string } | { questionId: string };

export async function createReviewSession(id: string, queue: Queue, ctx: WriteContext) {
  const db = getDb();
  const candidates = ("due" in queue
    ? dueReviewCandidates(ctx.actorId, queue.due.filters, queue.due.limit, queue.due.skippedSince)
    : "sourceId" in queue ? practiceCandidates(ctx.actorId, queue.sourceId)
      : db.select({ questionId: questions.id, sortKey: sql`0`.as("sort_key") }).from(questions)
        .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
        .where(and(eq(questions.id, queue.questionId), activeQuestion))).as("candidates");
  const available = db.select({ questionId: candidates.questionId }).from(candidates);
  const open = db.select({ id: reviewSessions.id }).from(reviewSessions).where(openSessions(ctx.actorId));
  const receipt = { id, rowVersion: 1 };
  await db.batch([
    writeReceipt(db, ctx, receipt, sql`EXISTS (${available.getSQL()}) AND NOT EXISTS (${open.getSQL()})`),
    db.insert(reviewSessions).values({
      id, userId: ctx.actorId, status: "active", total: sql`(${db.select({ total: count() }).from(candidates).getSQL()})`,
      createdAt: ctx.now, updatedAt: ctx.now,
    }),
    db.insert(reviewItems).select(db.select({
      sessionId: sql<string>`${id}`.as("session_id"),
      position: sql<number>`row_number() OVER (ORDER BY ${candidates.sortKey} DESC, ${candidates.questionId})`.as("position"),
      questionId: candidates.questionId,
      draftMd: sql<string>`''`.as("draft_md"),
      usedHint: sql<boolean>`0`.as("used_hint"),
      answerMode: sql<null>`NULL`.as("answer_mode"),
      outcome: sql<null>`NULL`.as("outcome"),
      resolvedAt: sql<null>`NULL`.as("resolved_at"),
    }).from(candidates)),
    advanceEpoch(db, ctx),
  ]);
  return receipt;
}

export function currentReview(id: string, ownerId: string) {
  return getDb().select({ session: reviewSessions, item: reviewItems }).from(reviewSessions)
    .innerJoin(reviewItems, and(eq(reviewItems.sessionId, reviewSessions.id), eq(reviewItems.position, reviewSessions.position)))
    .where(and(eq(reviewSessions.id, id), eq(reviewSessions.userId, ownerId))).get();
}

export async function reviewSummary(id: string) {
  const rows = await getDb().select({ outcome: reviewItems.outcome, total: count() }).from(reviewItems)
    .where(eq(reviewItems.sessionId, id)).groupBy(reviewItems.outcome).all();
  const counts = new Map(rows.map(({ outcome, total }) => [outcome, total]));
  const practice = practiceOutcomes.reduce((total, outcome) => total + (counts.get(outcome) ?? 0), 0);
  return {
    completed: (counts.get("independent") ?? 0) + practice,
    skipped: (counts.get("skipped") ?? 0) + (counts.get("unavailable") ?? 0),
    unavailable: counts.get("unavailable") ?? 0,
    practice, pending: counts.get(null) ?? 0,
  };
}

type ReviewUpdate = {
  session: Pick<ReviewSessionRow, "id" | "rowVersion" | "position" | "status">;
  item: Pick<ReviewItemRow, "questionId">;
  changes: Partial<Pick<ReviewItemRow, "draftMd" | "usedHint" | "answerMode" | "outcome" | "resolvedAt">>;
  status: ReviewSessionRow["status"];
  position: number;
  availability?: boolean;
  learningState?: LearningStateWrite;
};

export async function commitReviewUpdate(write: ReviewUpdate, ctx: WriteContext) {
  const db = getDb();
  const { session, item, changes } = write;
  const version = and(eq(reviewSessions.id, session.id), eq(reviewSessions.userId, ctx.actorId),
    eq(reviewSessions.rowVersion, session.rowVersion), eq(reviewSessions.position, session.position));
  const current = sql`EXISTS (${db.select({ id: reviewSessions.id }).from(reviewSessions).where(version).getSQL()})`;
  const live = sql`EXISTS (${db.select({ id: questions.id }).from(questions)
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(questions.id, item.questionId), activeQuestion)).getSQL()})`;
  const availability = write.availability === undefined ? sql`1` : write.availability ? live : sql`NOT ${live}`;
  const result = { id: session.id, rowVersion: session.rowVersion + 1 };
  const stateVersion = write.learningState ? learningStateVersion(write.learningState, ctx) : sql`1`;
  const receipt = writeReceipt(db, ctx, result, sql`${current} AND ${availability} AND ${stateVersion}`);
  const updateSession = db.update(reviewSessions).set({
    rowVersion: result.rowVersion, position: write.position, status: write.status, updatedAt: ctx.now,
  }).where(version);
  const epoch = advanceEpoch(db, ctx);
  const stateChanges = write.learningState ? learningStateMutations(db, write.learningState) : [];
  if (Object.keys(changes).length) {
    const updateItem = db.update(reviewItems).set(changes)
      .where(and(eq(reviewItems.sessionId, session.id), eq(reviewItems.position, session.position)));
    await db.batch([receipt, updateItem, updateSession, ...stateChanges, epoch]);
  } else {
    await db.batch([receipt, updateSession, epoch]);
  }
  return result;
}
