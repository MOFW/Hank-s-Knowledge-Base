import { sql } from "drizzle-orm";
import { prepareReading } from "@/components/markdown-reading";
import { getDb } from "@/db";
import { catalogScope } from "@/db/queries/catalog-management";
import { ids } from "@/db/queries/content-deletion";
import { relatedImportedTopics } from "@/db/queries/imports";
import { attemptList } from "@/db/queries/questions";
import { topicQuestionRelations } from "@/db/queries/question-topics";
import { contentOperations } from "@/domain/content-operations";
import { mcpBatchInput, mcpContextInput, mcpProposalInput, mcpSearchInput } from "@/domain/knowledge-mcp";
import { deletionCommand, directMcpInput, recentMcpInput } from "@/domain/mcp-content";
import { importTaskInput } from "@/domain/import-task";
import { runImportTask } from "@/services/import-tasks";
import { importDigest, validateImport } from "@/domain/imports";
import { valueType } from "@/domain/input-details";
import { prepareQuickImport } from "@/domain/quick-learning-import";
import { Problem } from "@/domain/problem";
import { getCourse, getTopic, listCourses } from "@/services/catalog";
import { chapterList, topicList, type WriteContext } from "@/db/queries/catalog";
import { getImport, getImportResult } from "@/services/imports";
import { receiveAndReview } from "@/services/ai-review";
import { getAttempt, getQuestion, listQuestions } from "@/services/questions";
import { searchLibrary } from "@/services/search";
import { assetManagement } from "@/services/asset-cleanup";
import { getAsset } from "@/services/assets";
import { readChapter } from "@/services/content-catalog";
import { executeContentOperations, executeIndependentCreates, getLatestContentOperation, undoLatestContentOperation } from "@/services/content-operations";
import { solutionIndex } from "@/services/solution-organization";
import { sha256 } from "@/lib/hash";
import { solutionAnnotationPositions } from "@/lib/solution-anchors";

export { knowledgeMcpTools } from "@/domain/knowledge-mcp";

type Context = { ownerId: string; origin: string };

async function search(args: unknown, { ownerId, origin }: Context) {
  const { items, nextCursor } = await searchLibrary(ownerId, mcpSearchInput.parse(args));
  return {
    items: items.map(({ id, kind, title, courseId, courseName, chapterId, chapterTitle, difficulty, excerpt, matchSource, href }) => ({
      id, kind, title, courseId, courseName, chapterId, chapterTitle, difficulty, excerpt, matchSource,
      href: new URL(href, origin).href,
    })),
    nextCursor,
  };
}

async function courseContext(id: string, origin: string, withOrder = false) {
  const course = await getCourse(id);
  if (!course) throw new Problem(404, "NOT_FOUND", "找不到该课程。");
  return { id, name: course.name, descriptionMd: course.descriptionMd, rowVersion: course.rowVersion,
    ...(withOrder ? { sortOrder: course.sortOrder } : {}), href: new URL(`/courses/${id}`, origin).href };
}

async function knowledgeContext(args: unknown, { ownerId, origin }: Context) {
  const input = mcpContextInput.parse(args);
  const assetLink = (id: string) => new URL(`/api/v1/assets/${id}`, origin).href;
  if ("courses" in input) return { courses: (await listCourses()).map(({ id, name, rowVersion, sortOrder }) =>
    ({ id, name, rowVersion, sortOrder, href: new URL(`/courses/${id}`, origin).href })) };
  if ("assetId" in input) {
    const asset = await getAsset(input.assetId, ownerId);
    if (!asset) throw new Problem(404, "NOT_FOUND", "找不到可用的原图或附件。");
    const { id, originalFilename, mimeType, byteSize, width, height } = asset;
    return { asset: { id, name: originalFilename, mimeType, byteSize, width, height, href: assetLink(id) } };
  }
  if ("assets" in input) {
    const { rows, next } = await assetManagement(ownerId, input.before);
    return { assets: rows.filter(({ status }) => status === "ready")
      .map(({ id, name, references }) => ({ id, name, references, href: assetLink(id) })), nextBefore: next };
  }
  if ("attemptId" in input) {
    const row = await getAttempt(input.attemptId, ownerId);
    if (!row) throw new Problem(404, "NOT_FOUND", "找不到这条作答。");
    return { attempt: attemptContext(row, origin) };
  }
  if ("chapterId" in input) {
    const row = await readChapter(input.chapterId);
    if (!row) throw new Problem(404, "NOT_FOUND", "找不到该章节。");
    return { chapter: chapterContext(row), deletionScope: await deletionContext("chapter", row.id) };
  }
  if ("courseId" in input) {
    const course = await courseContext(input.courseId, origin, Boolean(input.view));
    const chapters = await chapterList(course.id);
    return { course, chapters: chapters.map((row) => input.view ? chapterContext(row) : {
      id: row.id, parentId: row.parentId, title: row.title,
    }),
      ...(input.view === "directory" ? { notes: (await topicList(course.id))
        .map(({ id, title, chapterId, sortOrder, rowVersion }) => ({ id, title, chapterId, sortOrder, rowVersion })) } : {}),
      ...(input.view === "delete_scope" ? { deletionScope: await deletionContext("course", course.id) } : {}) };
  }
  if ("topicId" in input) {
    const { topicId, limit, cursor } = input;
    const topic = await getTopic(topicId);
    if (!topic) throw new Problem(404, "NOT_FOUND", "找不到该知识点。");
    const { id, title, courseId, chapterId, summaryMd, bodyMd, supplementMd, rowVersion, sortOrder } = topic;
    const [course, related] = await Promise.all([
      courseId ? courseContext(courseId, origin) : null,
      listQuestions(ownerId, { topicId, limit, cursor }),
    ]);
    return {
      topic: { id, title, courseId, chapterId, summaryMd, rowVersion, ...(input.view ? { sortOrder } : {}),
        ...(input.view === "summary" ? {} : { bodyMd, ...(supplementMd?.trim() ? { supplementMd } : {}) }),
        href: new URL(`/topics/${id}`, origin).href },
      course,
      relatedQuestions: {
        items: related.items.map(({ id, title, primaryCourseId, courseName, difficulty, rowVersion }) => ({
          id, title, primaryCourseId, courseName, difficulty, rowVersion, href: new URL(`/questions/${id}`, origin).href,
        })),
        nextCursor: related.nextCursor,
      },
      ...(input.view === "edit" || input.view === "summary" ? {
        relatedTopics: await relatedImportedTopics(id),
        relationships: await topicQuestionRelations(id, related.items.map(({ id }) => id)),
      } : {}),
      ...(input.view === "edit" ? { placements: prepareReading(bodyMd).placements } : {}),
    };
  }

  const found = await getQuestion(input.questionId, ownerId);
  if (!found) throw new Problem(404, "NOT_FOUND", "找不到该题目。");
  if (input.view === "solution_index") {
    return { questionId: found.id, rowVersion: found.rowVersion,
      methods: solutionIndex(found.solutionDocument, found.finalAnswerMd, found.solutionLayers) };
  }
  if (input.view === "attempts") {
    const limit = input.limit ?? 20;
    const rows = await attemptList(found.id, ownerId, { limit: limit + 1, before: input.before });
    const shown = rows.slice(0, limit);
    return { questionId: found.id, attempts: shown.map((row) => attemptContext(row, origin)),
      nextBefore: rows.length > limit ? shown.at(-1)!.id : null };
  }
  const { id, title, primaryCourseId, courseName, difficulty, rowVersion, statementMd, sourceTitle, sourceLocator,
    sourceDate, originalAssetIds, finalAnswerMd, keyTechniquesMd, solutionDocument, solutionSteps, solutionLayers, topics, learningState } = found;
  return {
    question: {
      id, title, primaryCourseId, courseName, difficulty, rowVersion, statementMd, sourceTitle, sourceLocator,
      sourceDate, originalAssetIds, ...(input.view === "summary" ? {} : {
        finalAnswerMd, keyTechniquesMd, solutionDocument, solutionSteps, ...(input.view === "edit" ? { solutionLayers } : {}),
      }),
      href: new URL(`/questions/${id}`, origin).href,
    },
    course: primaryCourseId ? await courseContext(primaryCourseId, origin) : null,
    topics: topics.map((topic) => ({ ...topic, href: new URL(`/topics/${topic.id}`, origin).href })),
    ...(input.view ? {
      learningState: learningState && { rowVersion: learningState.rowVersion, mastery: learningState.mastery,
        isMistake: learningState.isMistake, nextReviewOn: learningState.nextReviewOn },
      originals: originalAssetIds.map((id) => ({ id, href: assetLink(id) })),
    } : {}),
    ...(input.view === "edit" ? {
      solutionLocations: [
        ...(solutionDocument ? locations(solutionDocument.bodyMd, null) : []),
        ...solutionLayers?.alternatives.flatMap(({ id, body }) => locations(body.markdown, id)) ?? [],
      ],
      sourceReferences: await getDb().all(sql`SELECT DISTINCT s.id, s.title, s.kind, s.external_url AS url
        FROM sources s JOIN provenance_links p ON p.source_id = s.id WHERE p.question_id = ${id} LIMIT 40`),
    } : {}),
  };
}

function chapterContext({ id, parentId, title, rowVersion, sortOrder }: {
  id: string; parentId: string | null; title: string; rowVersion: number; sortOrder: number;
}) {
  return { id, parentId, title, rowVersion, sortOrder };
}

async function deletionContext(kind: "course" | "chapter", id: string) {
  const { chapters, topics, questions } = await catalogScope(kind, id);
  const titles = new Map((await getDb().all<{ id: string; title: string }>(sql`
    SELECT id, title FROM topics WHERE id IN ${ids(topics.map(({ id }) => id))}
    UNION ALL SELECT id, title FROM questions WHERE id IN ${ids(questions.map(({ id }) => id))}
  `)).map(({ id, title }) => [id, title]));
  const summarize = (rows: { id: string; kept: number }[]) =>
    rows.map(({ id, kept }) => ({ id, title: titles.get(id) ?? "", shared: Boolean(kept) }));
  return { chapters, topics: summarize(topics), questions: summarize(questions) };
}

function attemptContext(row: NonNullable<Awaited<ReturnType<typeof getAttempt>>>, origin: string) {
  const { id, questionId, rowVersion, attemptedAt, originalWorkMd, errorAnalysisMd, correctionMd,
    insightMd, outcome, correctionAuthorKind } = row;
  return { id, questionId, rowVersion, attemptedAt, originalWorkMd, errorAnalysisMd, correctionMd,
    insightMd, outcome, correctionAuthorKind, href: new URL(`/attempts/${id}/edit`, origin).href };
}

function locations(body: string, solutionId: string | null) {
  const lines = body.split(/\r?\n/);
  return [...solutionAnnotationPositions(body)].map(([anchorId, line]) => ({
    solutionId, anchorId, line, text: line ? lines[line - 1]?.slice(0, 150) ?? "" : "",
  }));
}

async function directContext(ownerId: string, scope: string, value: object, key?: string): Promise<WriteContext> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (raw.byteLength > 900_000) throw new Problem(413, "TOO_LARGE", "操作内容不得超过 900,000 字节。");
  const hash = await sha256(raw);
  return { actorId: ownerId, now: new Date().toISOString(), key: `mcp-content:${scope}:${key ?? hash}`, hash };
}

function absoluteChanges<T extends { changes: Array<{ href: string | null }> }>(value: T, origin: string) {
  return { ...value, changes: value.changes.map((change) => ({ ...change, href: change.href && new URL(change.href, origin).href })) };
}

async function directWrite(name: "save" | "delete", args: unknown, { ownerId, origin }: Context) {
  const { idempotencyKey, operations, preview, skipInvalid } = directMcpInput.parse(args);
  const ctx = await directContext(ownerId, name, { operations, preview, skipInvalid }, idempotencyKey);
  if (name === "save" && skipInvalid) return absoluteChanges(await executeIndependentCreates(operations, ctx, preview), origin);
  if (name === "delete" && skipInvalid) throw new Problem(422, "INVALID_INPUT", "删除批次须整体校验。");
  const parsed = contentOperations.parse({ operations, preview });
  if (parsed.operations.some(({ action }) => deletionCommand(action) !== (name === "delete"))) {
    throw new Problem(422, "INVALID_OPERATION_KIND", "请选择与本批操作相符的保存或删除工具。");
  }
  return absoluteChanges(await executeContentOperations(parsed, ctx), origin);
}

async function recentOperation(args: unknown, { ownerId, origin }: Context) {
  const { operationId, idempotencyKey } = recentMcpInput.parse(args);
  if (!operationId) {
    const latest = await getLatestContentOperation(ownerId);
    return { latest: latest ? absoluteChanges(latest, origin) : null };
  }
  const ctx = await directContext(ownerId, "undo", { operationId }, idempotencyKey);
  return absoluteChanges(await undoLatestContentOperation(operationId, ctx), origin);
}

async function proposeImport(args: unknown, { ownerId, origin }: Context) {
  const inputArgs = mcpProposalInput.parse(args);
  const quick = inputArgs.quick === undefined ? undefined : await prepareQuickImport(inputArgs.quick);
  const batch = quick?.batch ?? inputArgs.batch!;
  const idempotencyKey = inputArgs.idempotencyKey;
  if (batch.schema_version !== "1.1" && batch.schema_version !== "1.2") {
    throw new Problem(422, "IMPORT_SCHEMA", "请选择受支持的 MCP 导入批次。", [
      { path: "/schema_version", expected: "1.1 | 1.2", actual: valueType(batch.schema_version),
        message: "MCP 支持 v1.1 题目批次和 v1.2 统一批次。", suggestion: "填写相应版本字符串，或改用 quick 短聊提案。" },
    ]);
  }
  // Validate before serializing or hashing untrusted nested content.
  const input = validateImport(quick ? JSON.parse(JSON.stringify(batch)) : batch);
  const raw = JSON.stringify(input);
  if (new TextEncoder().encode(raw).byteLength > 900_000) {
    throw new Problem(413, "TOO_LARGE", "候选批次不得超过 900,000 字节。");
  }
  const hash = await importDigest(input);
  const key = idempotencyKey ? `mcp-proposal:${idempotencyKey}` : `mcp-proposal-derived:${hash}`;
  const { id: batchId } = await receiveAndReview(input, raw, { actorId: ownerId, key, hash, now: new Date().toISOString() });
  const reviewUrl = new URL(`/imports/${batchId}`, origin).href;
  if (!quick) return { batchId, reviewUrl };
  const review = await getImport(ownerId, batchId);
  const items = review.items.map(({ id, kind, status, candidate, needsVerification, duplicates, issues, issue }) => ({
    itemId: id, kind, status, title: candidate.title ?? null, followUps: candidate.learner_questions?.length ?? 0,
    needsVerification, possibleDuplicate: duplicates.length > 0,
    issues: issue ? [...issues, issue] : issues, reviewUrl: `${reviewUrl}#item-${id}`,
  }));
  return {
    batchId, reviewUrl, scope: quick.scope, items,
    counts: {
      questions: items.filter(({ kind }) => kind === "question").length,
      topics: items.filter(({ kind }) => kind === "topic").length,
      waitingReview: items.filter(({ status }) => status === "pending" || status === "conflict").length,
      readyToCommit: items.filter(({ status }) => status === "approved").length,
      committed: items.filter(({ status }) => status === "committed").length,
      needsVerification: items.filter((item) => item.needsVerification).length,
    },
  };
}

async function importReview(args: unknown, { ownerId, origin }: Context) {
  const { batchId } = mcpBatchInput.parse(args);
  const { namespace, batchKey, schemaVersion, createdAt, items, history } = await getImport(ownerId, batchId);
  const reviewUrl = new URL(`/imports/${batchId}`, origin).href;
  return {
    batchId, reviewUrl, namespace, batchKey, schemaVersion, createdAt, history,
    items: items.map(({ id, kind, candidate, rowVersion, status, issue, issues, needsVerification, duplicates, courseCandidates,
      courseId, topicMappings, target, currentTargetVersion, currentTargetTitle, questionId, committedVersion, topicId, topicPlan }) => ({
      itemId: id, itemKey: candidate.item_key, externalId: candidate.external_id, title: candidate.title ?? null,
      rowVersion, status, issue, issues, needsVerification,
      duplicates: duplicates.map((match) => ({
        ...match, href: match.reason === "batch" ? `${reviewUrl}#item-${match.id}`
          : new URL(`/${kind === "topic" ? "topics" : "questions"}/${match.id}`, origin).href,
      })),
      courseCandidates, courseId, topicMappings, target, currentTargetVersion, currentTargetTitle, questionId, committedVersion,
      ...topicOutput({ kind, topicId }, origin),
      topicPlan: topicPlan ? {
        chapterId: topicPlan.chapterId, target: topicPlan.target,
        current: topicPlan.current ? { id: topicPlan.current.id, title: topicPlan.current.title, rowVersion: topicPlan.current.rowVersion } : undefined,
        relatedTopics: topicPlan.relatedTopics.map(({ id, title }) => ({ id, title })),
        relatedQuestions: topicPlan.relatedQuestions.map(({ id, title, itemKey }) => ({ id, title, itemKey })),
      } : undefined,
    })),
  };
}

function topicOutput({ kind, topicId }: { kind: string; topicId: string | null }, origin: string) {
  if (kind === "topic") return { kind, topicId, topicUrl: topicId ? new URL(`/topics/${topicId}`, origin).href : null };
}

async function importResult(args: unknown, { ownerId, origin }: Context) {
  const { batchId } = mcpBatchInput.parse(args);
  const items = await getImportResult(ownerId, batchId);
  return {
    batchId, reviewUrl: new URL(`/imports/${batchId}`, origin).href,
    items: items.map(({ kind, topicId, ...item }) => ({
      ...item, questionUrl: item.questionId ? new URL(`/questions/${item.questionId}`, origin).href : null,
      ...topicOutput({ kind, topicId }, origin),
    })),
  };
}

async function importTask(args: unknown, { ownerId, origin }: Context) {
  const input = importTaskInput.parse(args);
  const task = await runImportTask(ownerId, input);
  const taskUrl = new URL(task.taskPath, origin).href;
  if (!input.view) return { ...task, taskUrl };

  const { units, segments, saved, ...header } = task;
  if (input.action === "resume" && input.view === "unit") {
    const unit = units.find(({ unitId }) => unitId === input.unitId);
    if (!unit) throw new Problem(404, "NOT_FOUND", "找不到该任务的处理单元。");
    return { ...header, taskUrl, view: input.view, unit, segmentOrders: segments
      .filter(({ links }) => links.some(({ unitId }) => unitId === unit.unitId)).map(({ order }) => order) };
  }
  if (input.action === "resume" && input.view === "segment") {
    const segment = segments.find(({ order }) => order === input.segmentOrder);
    if (!segment) throw new Problem(404, "NOT_FOUND", "找不到该任务的分段。");
    return { ...header, taskUrl, view: input.view, segment };
  }
  const summaries = units.map(({ unitId, title, kind, preparation, draft, currentReview, formalResult, gaps }) => ({
    unitId, title, kind, preparation, draftVersion: draft?.active ? draft.version : null,
    batchId: currentReview?.batchId ?? null, status: currentReview?.item?.status ?? null,
    reviewUrl: currentReview?.batchId ? new URL(`/imports/${currentReview.batchId}`, origin).href : null,
    committed: formalResult !== null,
    openGapVersions: gaps.filter(({ provided }) => !provided).map(({ version }) => version),
  }));
  const next = units.find(({ unitId }) => unitId === task.nextUnitId);
  const nextSegment = segments.find(({ order }) => order === task.coverage.nextOrder);
  return {
    ...header, taskUrl, view: "summary", units: summaries, segmentOrders: segments.map(({ order }) => order),
    nextSegment: nextSegment ? { order: nextSegment.order, source: nextSegment.source, locator: nextSegment.locator, status: nextSegment.status } : null,
    nextUnit: next ? { unitId: next.unitId, locator: next.locator, identityEvidence: next.identityEvidence,
      gaps: next.gaps.filter(({ provided }) => !provided).map(({ version, missing, gapKind, segmentOrder }) =>
        ({ version, missing, gapKind, segmentOrder })) } : null,
    saved: saved ? {
      version: saved.version, unitId: saved.unitId, batchId: saved.batchId, type: saved.event.type,
      ...(saved.event.type === "failed" ? { error: saved.event.error } : {}),
    } : null,
  };
}

export async function callKnowledgeMcpTool(name: string, args: unknown, context: Context) {
  switch (name) {
    case "search_knowledge_base": return search(args, context);
    case "get_knowledge_context": return knowledgeContext(args, context);
    case "propose_learning_import": return proposeImport(args, context);
    case "get_import_review": return importReview(args, context);
    case "get_import_result": return importResult(args, context);
    case "manage_learning_import_task": return importTask(args, context);
    case "save_knowledge_content": return directWrite("save", args, context);
    case "delete_knowledge_content": return directWrite("delete", args, context);
    case "recent_knowledge_operation": return recentOperation(args, context);
    default: throw new Problem(404, "TOOL_NOT_FOUND", "找不到该工具。");
  }
}
