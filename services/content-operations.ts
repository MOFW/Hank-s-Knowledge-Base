import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { getAssetStore } from "@/adapters/assets";
import { getDb } from "@/db";
import { catalogMutations, catalogPrecondition, type WriteContext } from "@/db/queries/catalog";
import { epochIs, ids, removeQuestions, removeTopics } from "@/db/queries/content-deletion";
import {
  applyContentBatch, currentUndoSlot, restoreContentBatch, undoAssetIds, type OperationReceipt, type PlannedChange,
} from "@/db/queries/content-undo";
import { duplicateMatches } from "@/db/queries/imports";
import { questionMutations, questionPrecondition, type QuestionRecordWrite } from "@/db/queries/questions";
import { topicPatch } from "@/domain/catalog";
import { contentOperation, type ContentFailure, type ContentOperation, type ContentOperations } from "@/domain/content-operations";
import { Problem } from "@/domain/problem";
import { newQuestion } from "@/domain/questions";
import { cleanReleasedUndoAssets, prepareAssetRemoval, releaseUndoAssets } from "@/services/asset-cleanup";
import { getTopic, prepareChapterCreate, prepareCourseCreate, prepareTopicCreate, prepareTopicUpdate } from "@/services/catalog";
import { prepareCatalogOperation, readChapter } from "@/services/content-catalog";
import { editSolution, prepareManagedEdit, prepareMerge } from "@/services/content-edits";
import { exampleTopicVersion, exampleWrites, prepareExamples } from "@/services/content-examples";
import { contentChange as change, replaceUnique, versioned } from "@/services/content-plan";
import { getQuestion, prepareQuestionCreate, prepareQuestionUpdate } from "@/services/questions";
import { createOrganizedSolution, organizeSolution, requireLearningMaterial } from "@/services/solution-organization";
import { errorDetails, existingResult, requireWriteAccess } from "@/services/writes";

async function currentEpoch() {
  return (await getDb().get<{ epoch: number }>(sql`SELECT data_epoch AS epoch FROM system_state WHERE id = 1`))?.epoch ?? -1;
}

async function requireImages(assetIds: string[], ownerId: string, allowHeld = false) {
  const unique = [...new Set(assetIds)];
  const available = new Map<string, string>();
  if (!unique.length) return available;
  const rows = await getDb().all<{ id: string; storageKey: string; digest: string }>(sql`
    SELECT id, storage_key AS storageKey, sha256 AS digest FROM assets
    WHERE id IN ${ids(unique)} AND created_by = ${ownerId} AND deleted_at IS NULL
    AND (status = 'ready' OR (${allowHeld} AND status = 'quarantined' AND json_extract(extra_json, '$.undoHeld') = 1))`);
  const found = new Set(rows.map(({ id }) => id));
  const missing = unique.filter((id) => !found.has(id));
  try {
    if (rows.length) {
      const store = getAssetStore();
      // Keep batches of R2 requests bounded while checking actual bytes of registered originals.
      for (let offset = 0; offset < rows.length; offset += 8) {
        const group = rows.slice(offset, offset + 8);
        const objects = await Promise.all(group.map(({ storageKey }) => store.head(storageKey)));
        group.forEach(({ id, digest }, index) => {
          if (objects[index]) available.set(id, digest);
          else missing.push(id);
        });
      }
    }
  } catch {
    throw new Problem(503, "ASSET_UNAVAILABLE", "暂时无法核对原图，请重试。");
  }
  if (missing.length) throw new Problem(422, "MISSING_ORIGINAL_IMAGE", "有原图缺失或不可用。", { assetIds: missing });
  return available;
}

type Creation = ReturnType<typeof prepareCourseCreate | typeof prepareChapterCreate | typeof prepareTopicCreate>;
function planCreations(operations: ContentOperation[], ctx: WriteContext) {
  const created = new Map<number, Creation>();
  const byKey = new Map<string, Creation>();
  const declared = new Map(operations.flatMap((op, index) => "key" in op && op.key ? [[op.key, index] as const] : []));
  const visiting = new Set<number>();
  const resolve = (key: string | undefined, kind: Creation["kind"]) => {
    if (!key) return undefined;
    const index = declared.get(key);
    if (index !== undefined) prepare(index);
    const match = byKey.get(key);
    if (!match || match.kind !== kind) throw new Problem(422, "INVALID_REFERENCE", "批次内标识的对象类型不匹配。", { key });
    return match;
  };
  function prepare(index: number) {
    if (created.has(index)) return;
    if (visiting.has(index)) throw new Problem(422, "CHAPTER_CYCLE", "批次内章节不能互相作为父级。");
    visiting.add(index);
    const op = operations[index];
    let write: Creation;
    if (op.action === "create_course") write = prepareCourseCreate(op.input, ctx);
    else if (op.action === "create_chapter" || op.action === "create_topic") {
      const localCourse = resolve(op.courseKey, "course");
      const localChapter = resolve(op.action === "create_chapter" ? op.parentKey : op.chapterKey, "chapter");
      const chapter = localChapter?.kind === "chapter" ? localChapter.row : undefined;
      const courseId = mergeReference(op.input.courseId ?? undefined, localCourse?.row.id, chapter?.courseId) ?? null;
      const parent = mergeReference((op.action === "create_chapter" ? op.input.parentId : op.input.chapterId) ?? undefined, chapter?.id) ?? null;
      if (op.action === "create_chapter") {
        if (!courseId) throw new Problem(422, "INVALID_REFERENCE", "新章节须指定课程或批次内课程及父级。");
        write = prepareChapterCreate({ ...op.input, courseId, parentId: parent }, ctx);
      } else write = prepareTopicCreate({ ...op.input, courseId, chapterId: parent }, ctx);
    } else return;
    visiting.delete(index);
    created.set(index, write);
    if (op.key) byKey.set(op.key, write);
  }
  operations.forEach((op, index) => {
    if (op.action === "create_course" || op.action === "create_chapter" || op.action === "create_topic") prepare(index);
  });
  return { created, resolve };
}

function mergeReference(...ids: Array<string | undefined>) {
  const supplied = [...new Set(ids.filter((id) => id !== undefined))];
  if (supplied.length > 1) throw new Problem(422, "INVALID_REFERENCE", "对象 ID 与批次内归属不一致。");
  return supplied[0];
}

type PreparedQuestion = { write: QuestionRecordWrite; checkDuplicate: boolean };
async function rejectDuplicateQuestions(input: PreparedQuestion[], images: Map<string, string>) {
  const candidates = input.filter(({ checkDuplicate }) => checkDuplicate).map(({ write }) => ({
    fingerprint: {
      statementHash: write.row.statementHash,
      statement: write.row.statementMd.replace(/\r\n?/g, "\n").trim(),
      imageHashes: [...new Set(write.originalAssetIds.map((id) => images.get(id)!))].sort(),
      title: write.row.title, courseId: write.row.primaryCourseId,
    },
    exclude: write.row.id,
  }));
  const matches = await duplicateMatches(candidates);
  for (const [index, { fingerprint, exclude }] of candidates.entries()) {
    const exact = matches[index].filter(({ reason, excerpt }) => reason === "statement"
      || (reason === "image" && (!fingerprint.statement || !excerpt.trim())));
    const batch = candidates.slice(0, index).find(({ fingerprint: other }) =>
      (fingerprint.statementHash && other.statementHash === fingerprint.statementHash)
      || ((!fingerprint.statement || !other.statement) && fingerprint.imageHashes.some((hash) => other.imageHashes.includes(hash))));
    if (exact.length || batch) throw new Problem(409, "POSSIBLE_DUPLICATE",
      "发现相同题干或原图，请核对正式题目后再决定是否补充。", {
        candidates: exact, batchMatches: batch ? [batch.fingerprint.title, fingerprint.title] : [], targetId: exclude,
      });
  }
}

type TopicEdit = Extract<ContentOperation, { action: "update_topic" | "edit_topic_text" }>;

async function prepareTopicEdit(op: TopicEdit, ctx: WriteContext) {
  const current = versioned(await getTopic(op.id), op.version);
  if (op.action === "update_topic") return { current, write: prepareTopicUpdate(current, op.patch, ctx) };
  if (!op.append?.trim() && !op.replacement) throw new Problem(422, "INVALID_INPUT", "请输入要补充或替换的正文。");
  let body = op.replacement ? replaceUnique(current.bodyMd, op.replacement.find, op.replacement.replace) : current.bodyMd;
  if (op.append?.trim()) body = [body, op.append].filter(Boolean).join("\n\n");
  const patch = { bodyMd: topicPatch.parse({ bodyMd: body }).bodyMd! };
  return { current, write: prepareTopicUpdate(current, patch, ctx) };
}

async function planBatch({ operations }: ContentOperations, ctx: WriteContext) {
  const db = getDb();
  const plans = new Map<number, PlannedChange>();
  const { created, resolve } = planCreations(operations, ctx);
  const deletedTopics = new Set(operations.flatMap((op) => op.action === "delete_topic" ? [op.id] : []));
  const writtenQuestions = operations.flatMap((op) => op.action === "update_question" || op.action === "delete_question"
    || op.action === "edit_solution" ? [op.id] : []);
  const pendingQuestions: PreparedQuestion[] = [];
  const assetIds: string[] = [];
  const exampleTopics = new Map<string, Parameters<typeof exampleTopicVersion>[0]>();
  const topicEdits = new Map(await Promise.all(operations.flatMap((op) =>
    op.action === "update_topic" || op.action === "edit_topic_text"
      ? [prepareTopicEdit(op, ctx).then((edit) => [op.id, edit] as const)] : [],
  )));
  const conflictingExampleWrites = new Set(operations.flatMap((op) => {
    if (op.action === "merge_topics") return [op.id, ...op.sources.map(({ id }) => id)];
    return op.action === "delete_topic" || op.action === "set_question_links" ? [op.id] : [];
  }));
  for (const [index, op] of operations.entries()) {
    if (op.action === "create_course" || op.action === "create_chapter" || op.action === "create_topic") {
      const write = created.get(index)!;
      plans.set(index, { change: change(write.kind, "create", write.row.id, write.row.rowVersion,
        write.kind === "chapter" ? `/courses/${write.row.courseId}` : undefined,
        write.kind === "course" ? write.row.name : write.row.title),
      condition: catalogPrecondition(write), writes: [...catalogMutations(db, write, ctx)] });
    } else if (op.action === "update_course" || op.action === "delete_course" || op.action === "reorder_reading"
      || op.action === "update_chapter" || op.action === "delete_chapter") {
      plans.set(index, await prepareCatalogOperation(op, ctx));
    } else if (op.action === "set_question_links" || op.action === "create_attempt" || op.action === "update_attempt"
      || op.action === "delete_attempt" || op.action === "update_learning" || op.action === "clear_learning") {
      plans.set(index, await prepareManagedEdit(op, ctx));
    } else if (op.action === "merge_topics" || op.action === "merge_questions") {
      plans.set(index, await prepareMerge(op, ctx));
    } else if (op.action === "delete_asset") {
      await requireImages([op.id], ctx.actorId);
      plans.set(index, { change: change("asset", "delete", op.id, 1), ...prepareAssetRemoval(op.id, ctx) });
    } else if (op.action === "update_topic" || op.action === "edit_topic_text") {
      const { write } = topicEdits.get(op.id)!;
      if (write.relatedTopicIds?.some((id) => deletedTopics.has(id))) {
        throw new Problem(422, "INVALID_REFERENCE", "同一批次不能关联即将删除的知识点。");
      }
      plans.set(index, {
        change: change("topic", "update", write.row.id, write.row.rowVersion, undefined, write.row.title),
        condition: catalogPrecondition(write), writes: [...catalogMutations(db, write, ctx)],
      });
    } else if (op.action === "delete_topic" || op.action === "delete_question") {
      const isTopic = op.action === "delete_topic";
      const current = versioned(await (isTopic ? getTopic(op.id) : getQuestion(op.id, ctx.actorId)), op.version);
      const target = ids([op.id]);
      const table = sql.identifier(isTopic ? "topics" : "questions");
      const condition = sql`EXISTS (SELECT 1 FROM ${table} WHERE id = ${op.id} AND row_version = ${op.version} AND deleted_at IS NULL)`;
      const sessions = isTopic ? [] : await db.all<{ id: string }>(sql`
        SELECT session_id AS id FROM review_items WHERE question_id = ${op.id}`);
      const writes = isTopic ? [
        // A saved question form uses this version for its complete relationship set.
        sql`UPDATE questions SET row_version = row_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.actorId}
          WHERE id IN (SELECT question_id FROM question_topics WHERE topic_id = ${op.id})
            AND id NOT IN ${ids(writtenQuestions)}`,
        ...removeTopics(target),
      ] : removeQuestions(target, ctx.now, ids(sessions.map(({ id }) => id)));
      if ("originalAssetIds" in current && Array.isArray(current.originalAssetIds)) {
        assetIds.push(...current.originalAssetIds);
      }
      plans.set(index, { change: change(isTopic ? "topic" : "question", "delete", op.id, current.rowVersion, undefined, current.title), condition, writes });
    } else {
      if ("materialIssue" in op) requireLearningMaterial(op.materialIssue);
      const examples = "examples" in op && op.examples ? await prepareExamples(op.examples, (key) => {
        const target = resolve(key, "topic");
        if (target?.kind !== "topic") throw new Problem(422, "INVALID_REFERENCE", "找不到批次内的目标笔记。", { key });
        return target.row;
      }, async (id, version) => {
        const edit = topicEdits.get(id);
        const topic = versioned(edit?.current ?? await getTopic(id), version);
        return { topic, placementBody: edit?.write.row.bodyMd };
      }) : [];
      const exampleIds = examples.map(({ topic }) => topic.id);
      for (const { existing, topic } of examples) {
        if (!existing) continue;
        if (conflictingExampleWrites.has(topic.id)) {
          throw new Problem(422, "OVERLAPPING_TOPIC_CHANGE", "先提交该笔记的其他编辑，再按新版本设置例题。", { topicId: topic.id });
        }
        if (!topicEdits.has(topic.id)) exampleTopics.set(topic.id, topic);
      }
      let write: QuestionRecordWrite;
      if (op.action === "create_question") {
        const added = op.topicKeys.map((key) => {
          return resolve(key, "topic")!.row.id;
        });
        if (op.solution && (op.input.solutionDocument || op.input.solutionLayers || op.input.solutionSteps.length)) {
          throw new Problem(422, "MIXED_SOLUTION_FORMAT", "请选择简化解答输入或原有正式结构。");
        }
        write = await prepareQuestionCreate(newQuestion.parse({
          ...op.input, ...(op.solution ? createOrganizedSolution(op.solution) : {}),
          topicIds: [...op.input.topicIds, ...added, ...exampleIds],
          primaryCourseId: mergeReference(op.input.primaryCourseId ?? undefined, resolve(op.courseKey, "course")?.row.id) ?? null,
        }), ctx);
      } else {
        const current = versioned(await getQuestion(op.id, ctx.actorId), op.version);
        if (op.action === "edit_solution" && op.edits && op.organize) {
          throw new Problem(422, "MIXED_SOLUTION_FORMAT", "请选择简化增量输入或原有精确编辑。");
        }
        if (op.action === "edit_solution" && !op.edits && !op.organize && !examples.length) {
          throw new Problem(422, "INVALID_INPUT", "请输入要修改的解答或例题关系。");
        }
        const patch = op.action !== "edit_solution" ? op.patch : op.edits ? editSolution(current, op.edits)
          : op.organize ? organizeSolution(current, op.organize) : {};
        const edited = { ...current, ...patch, topicIds: [...(patch.topicIds ?? current.topicIds), ...exampleIds] };
        write = await prepareQuestionUpdate(current, newQuestion.strip().parse(edited), ctx);
        write.preserveOriginalAssets = patch.originalAssetIds === undefined;
      }
      if ("requiresOriginalImage" in op && op.requiresOriginalImage && !write.originalAssetIds.length) {
        throw new Problem(422, "MISSING_ORIGINAL_IMAGE", "这道题需要原图，请提供已登记的文件。", { operation: index });
      }
      if (write.topicIds.some((id) => deletedTopics.has(id))) {
        throw new Problem(422, "INVALID_REFERENCE", "同一批次不能为题目关联即将删除的知识点。");
      }
      pendingQuestions.push({ write, checkDuplicate: op.action === "create_question"
        || ("patch" in op && (op.patch.statementMd !== undefined || op.patch.originalAssetIds !== undefined)) });
      assetIds.push(...write.originalAssetIds);
      plans.set(index, {
        change: change("question", op.action === "create_question" ? "create" : "update", write.row.id, write.row.rowVersion, undefined, write.row.title),
        condition: questionPrecondition(write, ctx),
        // The topic edit checks the shared version and advances it once, regardless of operation order.
        additionalChecks: examples.filter(({ topic }) => !topicEdits.has(topic.id)).map(({ topic }) => exampleTopicVersion(topic)),
        writes: [...await questionMutations(db, write, ctx), ...exampleWrites(examples, write.row.id, ctx)],
      });
    }
  }
  await rejectDuplicateQuestions(pendingQuestions, await requireImages(assetIds, ctx.actorId));
  const ordered = [...plans.values()];
  const creates = [...created.keys()].map((index) => plans.get(index)!);
  const later = ordered.filter((plan) => !creates.includes(plan));
  const topicVersions = [...exampleTopics.values()].map((topic): PlannedChange => ({
    change: change("topic", "update", topic.id, topic.rowVersion + 1, undefined, topic.title),
    condition: exampleTopicVersion(topic),
    writes: [sql`UPDATE topics SET row_version = row_version + 1 WHERE id = ${topic.id}`],
  }));
  return {
    changes: [...ordered, ...topicVersions].flatMap(({ change, relatedChanges, reportPrimary }) => [
      ...(reportPrimary === false ? [] : [change]), ...(relatedChanges ?? []),
    ]),
    writes: [
      ...creates, ...later.filter(({ change }) => change.action !== "delete"),
      ...later.filter(({ change }) => change.action === "delete"), ...topicVersions,
    ],
  };
}

async function operationReplay(ctx: WriteContext) {
  const receipt = await existingResult(ctx);
  if (!receipt) return undefined;
  if (!receipt.contentOperation) throw new Problem(409, "IDEMPOTENCY_CONFLICT", "这个保存标识已用于另一项修改。");
  return { ...receipt, contentOperation: receipt.contentOperation };
}

async function response(receipt: OperationReceipt, ctx: WriteContext) {
  const assetCleanupPending = await cleanReleasedUndoAssets(ctx.actorId);
  const slot = await currentUndoSlot(ctx.actorId);
  const changes = await Promise.all(receipt.contentOperation.changes.map(async (change) => {
    if (change.kind !== "chapter" || change.href || change.action === "delete") return change;
    const chapter = await readChapter(change.id);
    return { ...change, href: chapter ? `/courses/${chapter.courseId}` : null };
  }));
  return {
    operationId: receipt.id, outcome: receipt.contentOperation.action, changes,
    canUndo: receipt.contentOperation.action === "apply" && slot?.operationId === receipt.id && !slot.conflicted,
    assetCleanupPending,
    ...(receipt.contentOperation.failures ? { failures: receipt.contentOperation.failures } : {}),
  };
}

export async function getLatestContentOperation(ownerId: string) {
  const slot = await currentUndoSlot(ownerId);
  return slot ? { operationId: slot.operationId, changes: slot.changes, createdAt: slot.createdAt, canUndo: !slot.conflicted } : null;
}

export async function executeContentOperations(input: ContentOperations, ctx: WriteContext) {
  await requireWriteAccess(ctx);
  const previous = input.preview ? undefined : await operationReplay(ctx);
  if (previous) return response(previous, ctx);
  const epoch = await currentEpoch();
  try {
    return await commitPlan(await planBatch(input, ctx), ctx, epoch, input.preview);
  } catch (error) {
    const raced = await operationReplay(ctx);
    if (raced) return response(raced, ctx);
    const details = errorDetails(error);
    if (details.includes("content_undo_phase") || /SQLITE_TOOBIG/i.test(details)) {
      throw new Problem(422, "UNDO_TOO_LARGE", "这批资料的恢复数据过大，请缩小本次操作范围。");
    }
    if (details.includes("receipts_precondition")) {
      await requireWriteAccess(ctx);
      if (await currentEpoch() !== epoch) throw new Problem(409, "VERSION_CONFLICT", "资料已有更新，请重新读取后重试。");
      throw new Problem(422, "INVALID_REFERENCE", "请选择有效的课程、章节、知识点或已登记的原图。");
    }
    if (/UNIQUE constraint failed: (topics|chapters|courses)\./i.test(details)) {
      throw new Problem(409, "DUPLICATE_SLUG", "该目录或资料路径已被使用。");
    }
    throw error;
  }
}

async function commitPlan({ changes, writes }: Awaited<ReturnType<typeof planBatch>>, ctx: WriteContext,
  epoch: number, preview?: boolean, failures?: ContentFailure[],
) {
  if (preview || !changes.length) return {
    operationId: null, outcome: preview ? "preview" as const : "skipped" as const,
    changes: changes.map((change) => change.action === "create" ? { ...change, href: null } : change),
    canUndo: false, assetCleanupPending: false, ...(failures ? { failures } : {}),
  };
  const released = await undoAssetIds(ctx.actorId);
  const receipt: OperationReceipt = { id: crypto.randomUUID(), rowVersion: 1, contentOperation: { action: "apply", changes, failures } };
  await applyContentBatch(writes, epochIs(epoch), receipt, ctx, releaseUndoAssets(released.map(({ id }) => id), ctx));
  return response(receipt, ctx);
}

// Recoverable per-item failures are useful when a discussion produced independent new records.
// The successful subset still uses one checked D1 batch and one undo slot.
export async function executeIndependentCreates(raw: unknown[], ctx: WriteContext, preview?: boolean) {
  await requireWriteAccess(ctx);
  const previous = preview ? undefined : await operationReplay(ctx);
  if (previous) return response(previous, ctx);
  const epoch = await currentEpoch();
  const db = getDb();
  const plan: Awaited<ReturnType<typeof planBatch>> = { changes: [], writes: [] };
  const failures: ContentFailure[] = [];
  const used = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const parsed = contentOperation.safeParse(entry);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      failures.push({ index, code: "INVALID_INPUT", message: `${issue.path.join(".")} · ${issue.message}` });
      continue;
    }
    const op = parsed.data;
    try {
      if ((op.action !== "create_question" && op.action !== "create_topic") || op.courseKey
        || ("chapterKey" in op && op.chapterKey) || ("key" in op && op.key)
        || ("topicKeys" in op && op.topicKeys.length) || ("examples" in op && op.examples?.length)) {
        throw new Problem(422, "DEPENDENT_OPERATION", "独立提交仅接受直接使用正式 ID 的新笔记或新题目。");
      }
      const conflictKeys = op.action === "create_topic" ? (op.input.slug && op.input.courseId ? [`slug:${op.input.courseId}:${op.input.slug}`] : [])
        : (op.input.statementMd.trim() ? [`statement:${op.input.statementMd.replace(/\r\n?/g, "\n").trim()}`]
          : op.input.originalAssetIds.map((id) => `asset:${id}`));
      if (conflictKeys.some((key) => used.has(key))) throw new Problem(409, "POSSIBLE_DUPLICATE", "同批中已有相同资料。");
      const unit = await planBatch({ operations: [op] }, ctx);
      for (const { condition } of unit.writes) {
        if (!(await db.get<{ ok: number }>(sql`SELECT coalesce((${condition}), 0) AS ok`))?.ok) {
          throw new Problem(422, "INVALID_REFERENCE", "请核对已登记的课程、章节、知识点或原图。");
        }
      }
      if (op.action === "create_topic" && op.input.slug && op.input.courseId && (await db.get(sql`
        SELECT 1 FROM topics WHERE course_id = ${op.input.courseId} AND slug = ${op.input.slug}`))) {
        throw new Problem(409, "DUPLICATE_SLUG", "该笔记路径已被使用。");
      }
      conflictKeys.forEach((key) => used.add(key));
      plan.changes.push(...unit.changes);
      plan.writes.push(...unit.writes);
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        failures.push({ index, code: "INVALID_INPUT", message: `${issue.path.join(".")} · ${issue.message}` });
        continue;
      }
      if (!(error instanceof Problem) || error.status >= 500) throw error;
      failures.push({ index, code: error.code, message: error.message });
    }
  }
  try {
    return await commitPlan(plan, ctx, epoch, preview, failures);
  } catch (error) {
    const raced = await operationReplay(ctx);
    if (raced) return response(raced, ctx);
    if (errorDetails(error).includes("receipts_precondition")) {
      await requireWriteAccess(ctx);
      throw new Problem(409, "VERSION_CONFLICT", "资料已有更新，请重新读取后重试。");
    }
    throw error;
  }
}

export async function undoLatestContentOperation(operationId: string, ctx: WriteContext) {
  await requireWriteAccess(ctx);
  const previous = await operationReplay(ctx);
  if (previous) return response(previous, ctx);
  const changed = new Problem(409, "UNDO_CONFLICT", "这轮涉及的资料或关系已有变化，无法安全撤销。");
  try {
    const slot = await currentUndoSlot(ctx.actorId);
    if (!slot || slot.operationId !== operationId) throw new Problem(409, "UNDO_REPLACED", "这轮操作已撤销或已被下一轮替换。");
    if (slot.conflicted) throw changed;
    await requireImages((await undoAssetIds(ctx.actorId)).map(({ id }) => id), ctx.actorId, true);
    const changes = slot.changes.map((prior) => change(prior.kind,
      prior.action === "create" ? "delete" : prior.action === "delete" ? "create" : "update",
      prior.id, prior.rowVersion + (prior.action === "create" || prior.kind === "asset" ? 0 : 1),
      prior.kind === "chapter" ? undefined : prior.href ?? undefined, prior.title));
    const receipt: OperationReceipt = { id: operationId, rowVersion: 1, contentOperation: { action: "undo", changes } };
    await restoreContentBatch(receipt, ctx);
    return response(receipt, ctx);
  } catch (error) {
    const raced = await operationReplay(ctx);
    if (raced) return response(raced, ctx);
    if (/receipts_precondition|(?:FOREIGN KEY|UNIQUE|CHECK) constraint failed/i.test(errorDetails(error))) {
      await requireWriteAccess(ctx);
      throw changed;
    }
    throw error;
  }
}
