import { env } from "cloudflare:workers";
import type { LearningStateRow } from "@/db/queries/questions";
import type { WriteContext } from "@/db/queries/catalog";
import type { QuestionAssessment, ReviewIntervals } from "@/domain/review";
import { todayInTimezone } from "@/lib/date";

function intervalDays(value: string | undefined, fallback: number) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : fallback;
}

export function reviewIntervals(): ReviewIntervals {
  return {
    independent: intervalDays(env.HKB_REVIEW_INDEPENDENT_DAYS, 7),
    assisted: intervalDays(env.HKB_REVIEW_ASSISTED_DAYS, 3),
    practice: intervalDays(env.HKB_REVIEW_PRACTICE_DAYS, 1),
  };
}

export function assessedLearningState(
  current: LearningStateRow, { assessment, nextReviewOn }: QuestionAssessment,
  timezone: string, ctx: WriteContext,
): LearningStateRow {
  const nextDate = new Date(`${todayInTimezone(timezone, new Date(ctx.now))}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + reviewIntervals()[assessment]);
  return {
    ...current,
    mastery: assessment === "independent" ? (current.mastery === "mastered" ? "mastered" : "familiar") : "learning",
    nextReviewOn: nextReviewOn === undefined ? nextDate.toISOString().slice(0, 10) : nextReviewOn,
    lastReviewedAt: ctx.now,
    rowVersion: current.rowVersion + 1,
    updatedAt: ctx.now,
    updatedBy: ctx.actorId,
    lastOrigin: "manual",
  };
}
