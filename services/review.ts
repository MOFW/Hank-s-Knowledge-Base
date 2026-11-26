import { type DueReviewScope, type ReviewCommand, type ReviewListInput, type StartReview } from "@/domain/review";
import { Problem } from "@/domain/problem";
import type { WriteContext } from "@/db/queries/catalog";
import { questionExists, type LearningStateWrite } from "@/db/queries/questions";
import { commitReviewUpdate, createReviewSession, currentReview, reviewEntry, reviewSummary } from "@/db/queries/review";
import { conflict, errorDetails, existingResult, requireWriteAccess } from "@/services/writes";
import { getLearningState, getQuestion, listQuestions, todayInTimezone } from "@/services/questions";
import { assessedLearningState, reviewIntervals } from "@/services/review-policy";

export function listReview(ownerId: string, timezone: string, filters: ReviewListInput = {}) {
  const { category = "due", ...conditions } = filters;
  if (category === "mistakes") return listQuestions(ownerId, { ...conditions, isMistake: true });
  if (category === "mastered") return listQuestions(ownerId, { ...conditions, mastery: "mastered" });
  return listQuestions(ownerId, { ...conditions, dueBefore: conditions.dueBefore ?? todayInTimezone(timezone) });
}

export function getReviewEntry(ownerId: string, timezone: string, filters: DueReviewScope = {}) {
  return reviewEntry(ownerId, dueQueue(timezone, filters));
}

function dueQueue(timezone: string, filters: DueReviewScope, now = new Date()) {
  return {
    filters: { ...filters, dueBefore: filters.dueBefore ?? todayInTimezone(timezone, now) },
    limit: 12,
    skippedSince: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function startReview(timezone: string, input: StartReview, ctx: WriteContext) {
  const saved = await existingResult(ctx);
  if (saved) return saved;
  const queue = input.kind === "practice" ? { sourceId: input.sessionId }
    : input.kind === "question" ? { questionId: input.questionId }
    : { due: dueQueue(timezone, input, new Date(ctx.now)) };
  try {
    return await createReviewSession(crypto.randomUUID(), queue, ctx);
  } catch (error) {
    const replay = await existingResult(ctx);
    if (replay) return replay;
    if (!/receipts_precondition|review_one_open_session/i.test(errorDetails(error))) throw error;
    await requireWriteAccess(ctx);
    const { open } = await getReviewEntry(ctx.actorId, timezone);
    if (open) throw new Problem(409, "REVIEW_ALREADY_OPEN", "已有一轮复习，请刷新页面后继续。");
    const emptyMessage = { due: "当前范围没有待复习题目。", practice: "本轮没有可重练的题目。", question: "当前题目不可用。" };
    throw new Problem(422, "EMPTY_REVIEW", emptyMessage[input.kind]);
  }
}

export async function getReview(id: string, ownerId: string) {
  const record = await currentReview(id, ownerId);
  if (!record) return null;
  const { session, item } = record;
  const progress = { id, status: session.status, position: session.position, total: session.total, rowVersion: session.rowVersion };
  const intervals = reviewIntervals();
  if (session.status === "completed" || session.status === "ended") {
    return { session: progress, intervals, summary: await reviewSummary(id), item: null, question: null };
  }
  const question = await getQuestion(item.questionId, ownerId);
  return {
    session: progress,
    intervals,
    item: {
      questionId: item.questionId, draftMd: item.draftMd, usedHint: item.usedHint,
      answerMode: item.answerMode, outcome: item.outcome,
      learningStateVersion: question?.learningState?.rowVersion ?? null,
      nextReviewOn: question?.learningState?.nextReviewOn ?? null,
    },
    summary: null,
    question: question ? {
      title: question.title, courseName: question.courseName, statementMd: question.statementMd,
      originalAssetIds: question.originalAssetIds, hasHint: Boolean(question.keyTechniquesMd.trim()),
      hintMd: item.usedHint ? question.keyTechniquesMd : null,
      answerMd: item.answerMode ? question.finalAnswerMd : null,
      solutionSteps: item.answerMode ? question.solutionSteps : null,
      solutionDocument: item.answerMode ? question.solutionDocument : null,
      solutionLayers: item.answerMode ? question.solutionLayers : null,
      solutionTopics: item.answerMode && (question.solutionDocument || question.solutionSteps.length || question.solutionLayers)
        ? question.topics.map(({ id, title }) => ({ id, title })) : null,
    } : null,
  };
}

export type ReviewSnapshot = NonNullable<Awaited<ReturnType<typeof getReview>>>;

function invalidAction(message = "当前题目无法执行此操作。") {
  return new Problem(422, "INVALID_REVIEW_ACTION", message);
}

export async function updateReview(id: string, version: number, command: ReviewCommand, timezone: string, ctx: WriteContext) {
  const saved = await existingResult(ctx);
  if (saved) return saved;
  const record = await currentReview(id, ctx.actorId);
  if (!record) throw new Problem(404, "REVIEW_NOT_FOUND", "找不到这轮复习。");
  const { session, item } = record;
  if (session.rowVersion !== version || session.position !== command.position) {
    const replay = await existingResult(ctx);
    if (replay) return replay;
    throw conflict(session.rowVersion);
  }
  const { action } = command;
  let { status, position } = session;
  const changes: Parameters<typeof commitReviewUpdate>[0]["changes"] = {};
  let availability: boolean | undefined;
  let learningState: LearningStateWrite | undefined;
  if (status !== "active" && !(status === "paused" && (action === "resume" || action === "end"))) throw invalidAction();
  if (action === "pause" || action === "end") {
    status = action === "pause" ? "paused" : "ended";
  } else if (action === "resume") {
    if (status !== "paused") throw invalidAction();
    status = "active";
  } else if (action === "next") {
    if (!item.outcome) throw invalidAction("请先自评或跳过当前题。");
    if (position === session.total) status = "completed";
    else position += 1;
  } else {
    if (item.outcome) throw invalidAction("本题已记录，请进入下一题。");
    availability = await questionExists(item.questionId);
    if (!availability && action !== "skip") throw invalidAction("此题已不可用，可以跳过。");
    if (action === "hint") changes.usedHint = true;
    if (action === "answer") changes.answerMode = item.answerMode ?? command.mode;
    if (action === "assess") {
      if (!item.answerMode) throw invalidAction("请先核对答案。");
      if (command.outcome === "independent" && (item.usedHint || item.answerMode === "peek")) {
        throw invalidAction("本题已使用提示或提前查看答案，请选择「借助提示做对」或「还需练习」。");
      }
      const currentState = await getLearningState(item.questionId, ctx.actorId);
      const staleState = currentState && (command.learningStateVersion === undefined
        ? currentState.updatedAt > session.updatedAt
        : currentState.rowVersion !== command.learningStateVersion);
      if (!currentState || staleState) {
        const replay = await existingResult(ctx);
        if (replay) return replay;
        throw conflict(session.rowVersion);
      }
      learningState = {
        kind: "learningState", expectedVersion: currentState.rowVersion,
        row: assessedLearningState(currentState, { assessment: command.outcome, nextReviewOn: command.nextReviewOn }, timezone, ctx),
      };
      changes.outcome = command.outcome;
      changes.resolvedAt = ctx.now;
    }
    if (action === "skip") {
      changes.outcome = availability ? "skipped" : "unavailable";
      changes.resolvedAt = ctx.now;
      if (position === session.total) status = "completed";
      else position += 1;
    }
  }
  if ("draftMd" in command && !item.outcome) changes.draftMd = command.draftMd;
  try {
    return await commitReviewUpdate({ session, item, changes, status, position, availability, learningState }, ctx);
  } catch (error) {
    const replay = await existingResult(ctx);
    if (replay) return replay;
    if (!/receipts_precondition/i.test(errorDetails(error))) throw error;
    await requireWriteAccess(ctx);
    const latest = await currentReview(id, ctx.actorId);
    throw conflict(latest?.session.rowVersion ?? version);
  }
}
