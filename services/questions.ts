import type { WriteContext } from "@/db/queries/catalog";
import { deletedCourseDestination } from "@/db/queries/course-deletion";
import { filterSolutionTopics } from "@/domain/solution";
import { solutionLayerAnchorIssues } from "@/domain/solution-layers";
import * as store from "@/db/queries/questions";
import type { AttemptRow, LearningStateRow, QuestionDetail, QuestionWrite } from "@/db/queries/questions";
import { Problem } from "@/domain/problem";
import {
  newAttempt, newQuestion, questionCursor, type AttemptPatch, type LearningStatePatch, type NewAttempt,
  type NewQuestion, type QuestionListInput, type QuestionPatch,
} from "@/domain/questions";
import { sha256 } from "@/lib/hash";
import { type QuestionAssessment } from "@/domain/review";
import { getAsset } from "@/services/assets";
import { getCourse, getTopic } from "@/services/catalog";
import { assessedLearningState } from "@/services/review-policy";
import { conflict, errorDetails, existingResult, newRow, requireWriteAccess } from "@/services/writes";

function notFound(resource: string) {
  return new Problem(404, "NOT_FOUND", `找不到${resource}。`);
}

function requireVersion<T extends { rowVersion: number }>(row: T | null | undefined, version: number, resource: string) {
  if (!row) throw notFound(resource);
  if (row.rowVersion !== version) throw conflict(row.rowVersion);
  return row;
}

function revisionSnapshot(
  revision: { snapshotSchemaVersion: number; snapshotJson: Record<string, unknown> } | undefined,
  resource: string,
) {
  if (!revision) throw notFound(resource);
  if (revision.snapshotSchemaVersion !== 1) {
    throw new Problem(409, "UNSUPPORTED_REVISION", "当前版本无法恢复此历史记录。");
  }
  return revision.snapshotJson;
}

function auditUpdate(version: number, ctx: WriteContext, origin = "manual") {
  return { rowVersion: version + 1, updatedAt: ctx.now, updatedBy: ctx.actorId, lastOrigin: origin };
}

async function save(ctx: WriteContext, prepare: () => QuestionWrite | Promise<QuestionWrite>) {
  const previous = await existingResult(ctx);
  if (previous) return previous;

  try {
    return await store.commitQuestion(await prepare(), ctx);
  } catch (error) {
    const raced = await existingResult(ctx);
    if (raced) return raced;
    if (!errorDetails(error).includes("receipts_precondition")) throw error;

    await requireWriteAccess(ctx);
    // Read the current row again to distinguish a stale edit or deleted parent from invalid links.
    await prepare();
    throw new Problem(422, "INVALID_REFERENCE", "请选择可用的课程、知识点或题图。");
  }
}

function encodeCursor(cursor: { updatedAt: string; id: string }) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string) {
  try {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return questionCursor.parse(JSON.parse(decoded));
  } catch {
    throw new Problem(422, "INVALID_CURSOR", "分页标记无效，请重新打开题目列表。");
  }
}

export async function listQuestions(ownerId: string, filters: QuestionListInput & Pick<store.QuestionFilters, "mastery"> = {}) {
  const { limit = 20, cursor, ...conditions } = filters;
  const before = cursor ? decodeCursor(cursor) : undefined;
  const rows = await store.questionList(ownerId, { ...conditions, before, limit: limit + 1 });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
  };
}

export async function listTopicQuestions(topicId: string, ownerId: string, filters: QuestionListInput = {}) {
  if (!await getTopic(topicId)) return null;
  return listQuestions(ownerId, { ...filters, topicId });
}

export function getQuestion(id: string, ownerId: string, { includeDeleted = false } = {}) {
  return store.questionDetail(id, ownerId, includeDeleted);
}

export function listQuestionTopicChoices() {
  return store.questionTopicChoices();
}

export async function listAttempts(questionId: string, ownerId: string) {
  if (!await store.questionExists(questionId)) return null;
  return store.attemptList(questionId, ownerId);
}

export const getAttempt = store.attemptDetail;
export const getLearningState = store.learningStateDetail;

export async function listQuestionRevisions(id: string) {
  if (!await store.questionExists(id, true)) return null;
  return store.revisionList("question", id);
}

export async function getQuestionRevision(id: string, revisionNo: number) {
  if (!await store.questionExists(id, true)) return null;
  return store.revisionDetail("question", id, revisionNo);
}

export async function listAttemptRevisions(id: string, ownerId: string) {
  if (!await store.attemptExists(id, ownerId)) return null;
  return store.revisionList("attempt", id);
}

export async function getAttemptRevision(id: string, ownerId: string, revisionNo: number) {
  if (!await store.attemptExists(id, ownerId)) return null;
  return store.revisionDetail("attempt", id, revisionNo);
}

function questionParts(input: NewQuestion) {
  const { topicIds, originalAssetIds, sourceTitle, sourceLocator, ...fields } = input;
  return { fields, topicIds, originalAssetIds, sourceTitle, sourceLocator };
}

export function statementFingerprint(statementMd: string) {
  const normalized = statementMd.replace(/\r\n?/g, "\n").trim();
  return normalized ? sha256(new TextEncoder().encode(normalized)) : Promise.resolve(null);
}

async function questionContent(input: NewQuestion) {
  const { fields, ...links } = questionParts(input);
  const anchorIssues = solutionLayerAnchorIssues(fields.solutionDocument, fields.solutionLayers);
  if (anchorIssues.length) {
    throw new Problem(422, "INVALID_SOLUTION_ANCHOR", anchorIssues[0].message, anchorIssues);
  }
  const normalized = fields.statementMd.replace(/\r\n?/g, "\n").trim();
  if (!normalized && !links.originalAssetIds.length) {
    throw new Problem(422, "STATEMENT_REQUIRED", "请填写题干或上传至少一张原题图。");
  }
  if (links.sourceLocator && !links.sourceTitle) {
    throw new Problem(422, "SOURCE_TITLE_REQUIRED", "填写页码或题号时，请提供来源名称。");
  }
  const linkedTopics = new Set(links.topicIds);
  const unlinkedStep = fields.solutionSteps.find((step) => step.topicIds.some((id) => !linkedTopics.has(id)));
  if (unlinkedStep) {
    throw new Problem(422, "UNLINKED_STEP_TOPIC", `请先为题目关联「${unlinkedStep.title}」引用的知识点，或移除步骤中的引用。`);
  }
  const unlinkedAnnotation = fields.solutionDocument?.annotations.find((annotation) =>
    annotation.topicIds.some((id) => !linkedTopics.has(id)));
  if (unlinkedAnnotation) {
    const label = unlinkedAnnotation.label ?? unlinkedAnnotation.id;
    throw new Problem(422, "UNLINKED_ANNOTATION_TOPIC", `请先为题目关联「${label}」引用的知识点，或移除注释中的引用。`);
  }
  const statementHash = await statementFingerprint(normalized);
  return { fields: { ...fields, statementHash, fingerprintVersion: 1 }, ...links };
}

export async function prepareQuestionCreate(input: NewQuestion, ctx: WriteContext, origin = "manual"): Promise<store.QuestionRecordWrite> {
  const { fields, ...links } = await questionContent(input);
  const row = { ...newRow(ctx), ...fields, lastOrigin: origin };
  const state: LearningStateRow = {
    ...newRow(ctx), lastOrigin: origin, questionId: row.id, userId: ctx.actorId, mastery: "new", isMistake: false,
    nextReviewOn: null, lastReviewedAt: null,
  };
  return { kind: "question", row, state, ...links };
}

export function createQuestion(input: NewQuestion, ctx: WriteContext) {
  return save(ctx, () => prepareQuestionCreate(input, ctx));
}

type QuestionAudit = Pick<QuestionDetail, "id" | "createdAt" | "createdBy" | "extraJson" | "rowVersion">;

function questionAudit(current: QuestionAudit) {
  return { id: current.id, createdAt: current.createdAt, createdBy: current.createdBy, extraJson: current.extraJson };
}

export function updateQuestion(id: string, patch: QuestionPatch, version: number, ctx: WriteContext) {
  return save(ctx, async () => {
    const current = requireVersion(await getQuestion(id, ctx.actorId), version, "该题目");
    return prepareQuestionUpdate(current, newQuestion.strip().parse({ ...current, ...patch }), ctx);
  });
}

export async function prepareQuestionUpdate(
  current: QuestionAudit, input: NewQuestion, ctx: WriteContext, origin = "manual",
): Promise<store.QuestionRecordWrite> {
  const version = current.rowVersion;
  const { fields, ...links } = await questionContent(input);
  return {
    kind: "question", expectedVersion: version, ...links,
    row: { ...questionAudit(current), ...fields, ...auditUpdate(version, ctx, origin), deletedAt: null },
  };
}

export function deleteQuestion(id: string, version: number, ctx: WriteContext) {
  return save(ctx, async () => {
    const current = requireVersion(await getQuestion(id, ctx.actorId), version, "该题目");
    const { fields, ...links } = questionParts(newQuestion.strip().parse(current));
    return {
      kind: "question", expectedVersion: version, ...links,
      row: {
        ...questionAudit(current), ...fields, ...auditUpdate(version, ctx), deletedAt: ctx.now,
        statementHash: current.statementHash, fingerprintVersion: current.fingerprintVersion,
      },
    };
  });
}

export function restoreQuestion(id: string, revisionNo: number, version: number, ctx: WriteContext) {
  return save(ctx, async () => {
    const current = requireVersion(await getQuestion(id, ctx.actorId, { includeDeleted: true }), version, "该题目");
    const revision = await store.revisionDetail("question", id, revisionNo);
    if (!revision) throw notFound("该题目的历史版本");
    const snapshot = revisionSnapshot(revision, "该题目的历史版本");
    const input = newQuestion.strip().parse(snapshot);
    const deletion = input.primaryCourseId ? await deletedCourseDestination(input.primaryCourseId) : undefined;
    if (deletion) {
      const destination = deletion.destinationId ? await getCourse(deletion.destinationId) : null;
      input.primaryCourseId = destination?.id ?? null;
    }
    const availableImages = await Promise.all(input.originalAssetIds.map((id) => getAsset(id, ctx.actorId)));
    input.originalAssetIds = availableImages.flatMap((asset) => asset ? [asset.id] : []);
    if (!input.statementMd.trim() && !input.originalAssetIds.length) {
      throw new Problem(422, "REVISION_IMAGE_REMOVED", "此版本的原题图已清理，无法恢复没有题干的版本。");
    }
    const availableTopics = new Set((await listQuestionTopicChoices()).map(({ id }) => id));
    const topicIds = input.topicIds.filter((id) => availableTopics.has(id));
    const { fields, ...links } = await questionContent({ ...input, ...filterSolutionTopics(input, topicIds), topicIds });
    return {
      kind: "question", expectedVersion: version, allowDeleted: true, ...links,
      restoreFrom: revision.id,
      row: { ...questionAudit(current), ...fields, ...auditUpdate(version, ctx, "restore"), deletedAt: null },
    };
  });
}

function originalEvidenceStatus(originalWorkMd: string | null) {
  return originalWorkMd === null ? "missing" : "supplied";
}

export function createAttempt(questionId: string, input: NewAttempt, ctx: WriteContext) {
  return save(ctx, async () => {
    if (!await store.questionExists(questionId)) throw notFound("该题目");
    return prepareAttemptCreate(questionId, input, ctx);
  });
}

export function updateAttempt(id: string, patch: AttemptPatch, version: number, ctx: WriteContext) {
  return save(ctx, async () => {
    const current = requireVersion(await getAttempt(id, ctx.actorId), version, "该作答记录");
    return prepareAttemptUpdate(current, patch, ctx);
  });
}

export function prepareAttemptCreate(questionId: string, input: NewAttempt, ctx: WriteContext) {
  const row: AttemptRow = {
    ...newRow(ctx), ...input, questionId, userId: ctx.actorId,
    originalEvidenceStatus: originalEvidenceStatus(input.originalWorkMd), sourceRevisionId: null,
  };
  return { kind: "attempt" as const, row };
}

export function prepareAttemptUpdate(current: AttemptRow, patch: AttemptPatch, ctx: WriteContext) {
  const row = { ...current, ...patch, ...auditUpdate(current.rowVersion, ctx) };
  if (current.originalWorkMd !== row.originalWorkMd) row.originalEvidenceStatus = originalEvidenceStatus(row.originalWorkMd);
  return { kind: "attempt" as const, row, expectedVersion: current.rowVersion };
}

export function restoreAttempt(id: string, revisionNo: number, version: number, ctx: WriteContext) {
  return save(ctx, async () => {
    const current = requireVersion(await getAttempt(id, ctx.actorId), version, "该作答记录");
    const revision = await store.revisionDetail("attempt", id, revisionNo);
    if (!revision) throw notFound("该作答记录的历史版本");
    const snapshot = revisionSnapshot(revision, "该作答记录的历史版本");
    const fields = newAttempt.strip().parse(snapshot);
    const status = snapshot.originalEvidenceStatus;
    const row: AttemptRow = {
      ...current, ...fields, ...auditUpdate(version, ctx, "restore"),
      originalEvidenceStatus: status === "user_confirmed" ? status : originalEvidenceStatus(fields.originalWorkMd),
    };
    return { kind: "attempt", row, expectedVersion: version, restoreFrom: revision.id };
  });
}

export function updateLearningState(
  questionId: string, patch: LearningStatePatch | QuestionAssessment, version: number, timezone: string, ctx: WriteContext,
) {
  return save(ctx, async () => {
    const current = requireVersion(await getLearningState(questionId, ctx.actorId), version, "该学习记录");
    const row = "assessment" in patch ? assessedLearningState(current, patch, timezone, ctx)
      : prepareLearningUpdate(current, patch, ctx).row;
    return {
      kind: "learningState", row, expectedVersion: version,
    };
  });
}

export function prepareLearningUpdate(current: LearningStateRow, patch: LearningStatePatch, ctx: WriteContext) {
  return { kind: "learningState" as const,
    row: { ...current, ...patch, ...auditUpdate(current.rowVersion, ctx) }, expectedVersion: current.rowVersion };
}

export { todayInTimezone } from "@/lib/date";
