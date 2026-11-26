import { and, desc, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { approvalGuard, queueReviews, type AiApproval } from "./ai-review";
import { advanceEpoch, catalogMutations, catalogPrecondition, writeReceipt, type CatalogWrite, type WriteContext } from "@/db/queries/catalog";
import { questionMutations, questionPrecondition, type QuestionRecordWrite } from "@/db/queries/questions";
import {
  assets, attempts, chapters, courses, importAttemptRefs, importBatches, importBatchKeys, importItems,
  aiReviews, importQuestionRefs, importReviews, importTopicRefs, provenanceLinks, questionTopics, questions, retainedImportNotes, sources, systemState, topicRelations, topics,
} from "@/db/schema";
import { contextImportNamespace } from "@/domain/context-reference";
import { historyImportNamespace } from "@/domain/history-reference";
import { importReviewStatuses } from "@/domain/import-status";
import { isTopicCandidate, type ImportCandidate, type TopicImportCandidate } from "@/domain/imports";

export type BatchRow = typeof importBatches.$inferSelect;
export type ItemRow = typeof importItems.$inferSelect;
export type QuestionItem = ItemRow & { candidateJson: ImportCandidate };
export type TopicItem = ItemRow & { candidateJson: TopicImportCandidate };
export function isTopicItem(item: ItemRow): item is TopicItem {
  return isTopicCandidate(item.candidateJson);
}
export function isQuestionItem(item: ItemRow): item is QuestionItem {
  return !isTopicCandidate(item.candidateJson);
}
type ItemChange = Partial<Pick<ItemRow, "status" | "candidateJson" | "mappingJson" | "approvedHash" | "issueJson"
  | "questionId" | "topicId" | "committedVersion">>;
type Review = {
  item: ItemRow; change: ItemChange; action: typeof importReviews.$inferSelect.action;
  detail: Record<string, unknown>;
};

export function batchList(ownerId: string, { before, limit = 50 }: { before?: string; limit?: number } = {}) {
  // Drizzle removes column qualifiers in single-table selections, including inside SQL fragments.
  const batchItems = sql`FROM import_items AS i WHERE i.batch_id = "import_batches"."id"`;
  const olderBatches = before ? sql`(${importBatches.createdAt}, ${importBatches.id}) < (
    SELECT cursor.created_at, cursor.id FROM import_batches AS cursor
    WHERE cursor.id = ${before} AND cursor.owner_id = ${ownerId}
  )` : undefined;
  return getDb().select({
    id: importBatches.id, namespace: importBatches.namespace, batchKey: importBatches.batchKey, createdAt: importBatches.createdAt,
    schemaVersion: importBatches.schemaVersion,
    sourceTitle: sql<string | null>`json_extract(${importBatches.sourceJson}, '$[0].title')`,
    total: sql<number>`(SELECT count(*) ${batchItems})`,
    pending: sql<number>`(SELECT count(*) ${batchItems} AND i.status IN ${importReviewStatuses.map((status) => sql`${status}`)})`,
    committed: sql<number>`(SELECT count(*) ${batchItems} AND i.status = 'committed'
      AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = i.question_id AND q.deleted_at IS NOT NULL))`,
  }).from(importBatches).where(and(eq(importBatches.ownerId, ownerId), olderBatches))
    .orderBy(desc(importBatches.createdAt), desc(importBatches.id)).limit(limit).all();
}

export async function batchDetail(ownerId: string, id: string) {
  const db = getDb();
  const [batches, items] = await db.batch([
    db.select().from(importBatches).where(and(eq(importBatches.ownerId, ownerId), eq(importBatches.id, id))),
    db.select({ ...getTableColumns(importItems), targetInTrash: sql<number>`(${questions.deletedAt} IS NOT NULL)`.as("target_in_trash") })
      .from(importItems).leftJoin(questions, eq(questions.id, importItems.questionId))
      .where(and(eq(importItems.batchId, id), ownsBatch(id, ownerId))).orderBy(importItems.position),
  ]);
  return batches[0] ? { batch: batches[0], items } : undefined;
}

export function itemHistory(batchId: string, ownerId: string) {
  const db = getDb();
  return db.select({ itemId: importReviews.itemId, itemVersion: importReviews.itemVersion, action: importReviews.action,
    createdAt: importReviews.createdAt, reviewer: sql<string | null>`json_extract(${importReviews.detailJson}, '$.reviewer')` }).from(importReviews)
    .innerJoin(importItems, eq(importItems.id, importReviews.itemId))
    .where(and(eq(importItems.batchId, batchId), ownsBatch(batchId, ownerId)))
    .orderBy(desc(importReviews.createdAt), desc(importReviews.itemVersion)).limit(200).all();
}

export async function previousBatch(ownerId: string, namespace: string, batchKey: string, hash: string) {
  const db = getDb();
  const [named, identical] = await db.batch([
    db.select({ id: importBatches.id, contentHash: importBatches.contentHash }).from(importBatchKeys)
      .innerJoin(importBatches, eq(importBatchKeys.batchId, importBatches.id))
      .where(and(eq(importBatchKeys.ownerId, ownerId), eq(importBatchKeys.namespace, namespace), eq(importBatchKeys.batchKey, batchKey))),
    db.select({ id: importBatches.id }).from(importBatches).where(and(eq(importBatches.ownerId, ownerId),
      eq(importBatches.namespace, namespace), eq(importBatches.contentHash, hash))),
  ]);
  return { named: named[0], identical: identical[0] };
}

export type BatchAttachment = {
  result: { id: string; rowVersion: number };
  precondition: SQL;
  append: (db: ReturnType<typeof getDb>, batchId: string) => readonly BatchItem<"sqlite">[];
};

export async function insertBatch(
  batch: BatchRow, items: (typeof importItems.$inferInsert)[], existingId: string | undefined, ctx: WriteContext, attachment?: BatchAttachment,
) {
  const db = getDb();
  const id = existingId ?? batch.id;
  const result = attachment?.result ?? { id, rowVersion: 1 };
  await db.batch([
    writeReceipt(db, ctx, result, sql`NOT EXISTS (
      SELECT 1 FROM import_batch_keys WHERE owner_id = ${ctx.actorId} AND namespace = ${batch.namespace}
        AND batch_key = ${batch.batchKey} AND batch_id <> ${id}
    ) AND ${attachment?.precondition ?? sql`1`}`),
    ...existingId ? [] : [db.insert(importBatches).values(batch), ...items.map((item) => db.insert(importItems).values(item)), queueReviews(batch, items)],
    db.insert(importBatchKeys).values({ ownerId: ctx.actorId, namespace: batch.namespace, batchKey: batch.batchKey, batchId: id })
      .onConflictDoNothing(),
    ...attachment?.append(db, id) ?? [],
    advanceEpoch(db, ctx),
  ]);
  return result;
}

export function importCatalog(ownerId: string, namespace: string, items: ItemRow[]) {
  const db = getDb();
  const liveCourse = and(isNull(courses.deletedAt), isNull(courses.archivedAt));
  const questionItems = items.filter(isQuestionItem);
  const assetIds = [...new Set(questionItems.flatMap(({ candidateJson }) => candidateJson.original_asset_ids ?? []))];
  const imageHashes = [...new Set(questionItems.flatMap(({ candidateJson }) => candidateJson.history_images?.map(({ sha256 }) => sha256) ?? []))];
  const externalIds = items.map(({ externalId }) => externalId);
  const attemptIds = questionItems.flatMap(({ candidateJson }) => candidateJson.attempts?.map(({ external_id }) => external_id) ?? []);
  return db.batch([
    db.select({ id: courses.id, name: courses.name, slug: courses.slug }).from(courses).where(liveCourse).orderBy(courses.name, courses.id),
    db.select({ id: topics.id, courseId: topics.courseId, title: topics.title, slug: topics.slug,
      chapterId: topics.chapterId, rowVersion: topics.rowVersion })
      .from(topics).leftJoin(courses, eq(courses.id, topics.courseId)).where(and(liveCourse, isNull(topics.deletedAt)))
      .orderBy(topics.title, topics.id),
    db.select({ id: chapters.id, courseId: chapters.courseId, title: chapters.title, slug: chapters.slug, parentId: chapters.parentId })
      .from(chapters).innerJoin(courses, eq(courses.id, chapters.courseId)).where(and(liveCourse, isNull(chapters.deletedAt))),
    db.select({ id: assets.id, storageKey: assets.storageKey, sha256: assets.sha256, byteSize: assets.byteSize, mimeType: assets.mimeType }).from(assets)
      .where(and(eq(assets.createdBy, ownerId), eq(assets.status, "ready"), isNull(assets.deletedAt),
        sql`(${inJson(assets.id, assetIds)} OR ${inJson(assets.sha256, imageHashes)})`))
      .orderBy(assets.createdAt, assets.id),
    db.select({ externalId: importQuestionRefs.externalId, questionId: importQuestionRefs.questionId, title: questions.title,
      deleted: sql<number>`(${questions.deletedAt} IS NOT NULL)`.as("deleted") }).from(importQuestionRefs)
      .innerJoin(questions, eq(questions.id, importQuestionRefs.questionId))
      .where(and(eq(importQuestionRefs.ownerId, ownerId), eq(importQuestionRefs.namespace, namespace),
        inJson(importQuestionRefs.externalId, externalIds))),
    db.select({ externalId: importAttemptRefs.externalId }).from(importAttemptRefs)
      .where(and(eq(importAttemptRefs.ownerId, ownerId), eq(importAttemptRefs.namespace, namespace),
        inJson(importAttemptRefs.externalId, attemptIds))),
    db.select({ dataEpoch: systemState.dataEpoch }).from(systemState).where(eq(systemState.id, 1)),
  ]);
}

export async function topicImportRecords(ownerId: string, namespace: string, items: TopicItem[], questionIds: string[]) {
  const db = getDb();
  const targetIds = items.flatMap(({ candidateJson, mappingJson }) => mappingJson.topicTarget?.topicId
    ?? (candidateJson.operation === "propose_update" ? candidateJson.target_id : []));
  return db.batch([
    db.select({ topic: topics }).from(topics).leftJoin(courses, eq(courses.id, topics.courseId))
      .where(and(isNull(topics.deletedAt), isNull(courses.deletedAt), isNull(courses.archivedAt), inJson(topics.id, targetIds))),
    db.select({ id: questions.id, title: questions.title }).from(questions).leftJoin(courses, eq(courses.id, questions.primaryCourseId))
      .where(and(isNull(questions.deletedAt), isNull(courses.deletedAt), isNull(courses.archivedAt), inJson(questions.id, questionIds))),
    db.select({ externalId: importTopicRefs.externalId, id: importTopicRefs.topicId, title: topics.title,
      courseId: topics.courseId, version: topics.rowVersion }).from(importTopicRefs).innerJoin(topics, eq(topics.id, importTopicRefs.topicId))
      .where(and(eq(importTopicRefs.ownerId, ownerId), eq(importTopicRefs.namespace, namespace),
        inJson(importTopicRefs.externalId, items.map(({ externalId }) => externalId)))),
  ]);
}

function inJson(column: SQL | SQLiteColumn, values: string[]) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;
}

export type Fingerprint = { statementHash: string | null; statement: string; imageHashes: string[]; title: string; courseId: string | null };
function similarQuestions(input: Fingerprint, exclude?: string) {
  const { statementHash, statement, imageHashes, title, courseId } = input;
  return sql`
    SELECT q.id, q.title, q.row_version AS version, substr(q.statement_md, 1, 240) AS excerpt,
      CASE
        WHEN (${statementHash} IS NOT NULL AND ((q.fingerprint_version = 1 AND q.statement_hash = ${statementHash})
          OR (q.statement_hash IS NULL AND trim(replace(replace(q.statement_md, char(13)||char(10), char(10)), char(13), char(10)),
            char(9)||char(10)||char(32)) = ${statement}))) THEN 'statement'
        WHEN EXISTS (
          SELECT 1 FROM asset_links l JOIN assets a ON a.id = l.asset_id
          WHERE l.question_id = q.id AND l.role = 'original' AND a.status = 'ready' AND ${inJson(sql`a.sha256`, imageHashes)}
        ) THEN 'image'
        WHEN q.primary_course_id = ${courseId} AND lower(trim(q.title)) = lower(${title}) THEN 'title'
      END AS reason
    FROM questions q LEFT JOIN courses c ON c.id = q.primary_course_id
    WHERE q.deleted_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL AND q.id IS NOT ${exclude ?? null}
    AND reason IS NOT NULL`;
}

export type Duplicate = { id: string; title: string; version: number | null; excerpt: string; courseId?: string | null;
  reason: "statement" | "image" | "title" | "external_id" | "batch" | "topic_title" | "topic_similar" };

export async function duplicateMatches(inputs: { fingerprint: Fingerprint; exclude?: string }[]) {
  if (!inputs.length) return [];
  const db = getDb();
  const queries = inputs.map(({ fingerprint, exclude }) => db.select({
    id: sql<string>`candidate.id`.as("id"), title: sql<string>`candidate.title`.as("title"),
    version: sql<number>`candidate.version`.as("version"), excerpt: sql<string>`candidate.excerpt`.as("excerpt"),
    reason: sql<Duplicate["reason"]>`candidate.reason`.as("reason"),
  }).from(sql`(${similarQuestions(fingerprint, exclude)}) AS candidate`)
    .orderBy(sql`CASE candidate.reason WHEN 'statement' THEN 0 WHEN 'image' THEN 1 ELSE 2 END`, sql`candidate.id`).limit(8));
  const [first, ...rest] = queries;
  return db.batch([first, ...rest]);
}

function ownsBatch(id: string, ownerId: string) {
  return sql`EXISTS (SELECT 1 FROM import_batches b WHERE b.id = ${id} AND b.owner_id = ${ownerId})`;
}

function itemVersion(item: ItemRow) {
  return sql`EXISTS (SELECT 1 FROM import_items i WHERE i.id = ${item.id} AND i.batch_id = ${item.batchId}
    AND i.row_version = ${item.rowVersion} AND i.status = ${item.status} AND i.approved_hash IS ${item.approvedHash})`;
}

function reviewMutations(db: ReturnType<typeof getDb>, review: Review, ctx: WriteContext) {
  const { item, change, action, detail } = review;
  const version = item.rowVersion + 1;
  return [
    db.update(importItems).set({ ...change, rowVersion: version }).where(eq(importItems.id, item.id)),
    db.insert(importReviews).values({
      id: crypto.randomUUID(), itemId: item.id, actorId: ctx.actorId, itemVersion: version, action, detailJson: detail, createdAt: ctx.now,
    }),
  ] as const;
}

export async function saveReviews(batchId: string, reviews: Review[], ctx: WriteContext, checkedItems = reviews.map(({ item }) => item)) {
  const db = getDb();
  const result = { id: batchId, rowVersion: 1 };
  const checks = checkedItems.map(({ id, rowVersion }) => ({ id, version: rowVersion }));
  const receipt = writeReceipt(db, ctx, result, sql`${ownsBatch(batchId, ctx.actorId)} AND NOT EXISTS (
    SELECT 1 FROM json_each(${JSON.stringify(checks)}) r WHERE NOT EXISTS (
      SELECT 1 FROM import_items i WHERE i.id = json_extract(r.value, '$.id')
        AND i.batch_id = ${batchId} AND i.row_version = json_extract(r.value, '$.version')
    )
  )`);
  await db.batch([receipt, ...reviews.flatMap((review) => reviewMutations(db, review, ctx)), ...(reviews.length ? [advanceEpoch(db, ctx)] : [])]);
  return result;
}

export type CommitData = {
  write: QuestionRecordWrite;
  fingerprint: Fingerprint;
  duplicateIds: string[];
  sources: (typeof sources.$inferInsert)[];
  provenance: (typeof provenanceLinks.$inferInsert)[];
  attempts: { externalId: string; row: typeof attempts.$inferSelect }[];
};

export async function commitItem(batch: BatchRow, item: ItemRow, data: CommitData, ctx: WriteContext, permit?: AiApproval) {
  const db = getDb();
  const { write, fingerprint, duplicateIds } = data;
  const result = { id: write.row.id, rowVersion: write.row.rowVersion };
  const ref = { ownerId: ctx.actorId, namespace: batch.namespace, externalId: item.externalId, itemId: item.id };
  const noChangedDuplicate = write.expectedVersion !== undefined ? sql`1` : sql`NOT EXISTS (
    SELECT 1 FROM (SELECT id FROM (${similarQuestions(fingerprint)}) ORDER BY
      CASE reason WHEN 'statement' THEN 0 WHEN 'image' THEN 1 ELSE 2 END, id LIMIT 8) duplicate
    WHERE NOT (${inJson(sql`duplicate.id`, duplicateIds)})
  )`;
  const receipt = writeReceipt(db, ctx, result, sql`${ownsBatch(batch.id, ctx.actorId)} AND ${itemVersion(item)}
    AND ${questionPrecondition(write, ctx)} AND ${noChangedDuplicate}
    AND ${permit ? approvalGuard(item, batch, permit, ctx) : sql`1`}
    AND NOT EXISTS (SELECT 1 FROM import_question_refs r WHERE r.owner_id = ${ref.ownerId} AND r.namespace = ${ref.namespace}
      AND r.external_id = ${ref.externalId} AND r.question_id <> ${write.row.id})`);
  const approved = permit ? { ...item, rowVersion: item.rowVersion + 1, approvedHash: permit.planHash } : item;
  const systemAudit = permit ? { reviewer: "system:deepseek", runId: permit.runId, sourceDigest: permit.digest } : {};
  await db.batch([
    receipt,
    ...permit ? reviewMutations(db, {
      item, change: { status: "approved", approvedHash: permit.planHash, issueJson: null },
      action: "approve", detail: { ...systemAudit, planHash: permit.planHash },
    }, ctx) : [],
    ...await questionMutations(db, write, ctx),
    ...data.sources.map((source) => db.insert(sources).values(source).onConflictDoNothing({ target: sources.id })),
    ...data.attempts.flatMap(({ externalId, row }) => [
      db.insert(attempts).values(row),
      db.insert(importAttemptRefs).values({ ...ref, externalId, attemptId: row.id }),
    ]),
    ...data.provenance.map((link) => db.insert(provenanceLinks).values(link)),
    db.insert(importQuestionRefs).values({ ...ref, questionId: write.row.id }).onConflictDoNothing(),
    ...reviewMutations(db, {
      item: approved, change: { status: "committed", questionId: result.id, committedVersion: result.rowVersion, issueJson: null },
      action: "commit", detail: { ...result, ...systemAudit, planHash: approved.approvedHash, attemptIds: data.attempts.map(({ row }) => row.id) },
    }, ctx),
    ...permit ? [db.update(aiReviews).set({ state: "auto_committed", approvedDay: permit.day, questionId: result.id, reasons: [] })
      .where(eq(aiReviews.id, permit.runId))] : [],
    advanceEpoch(db, ctx),
  ]);
}

type TopicCommitData = Pick<CommitData, "sources" | "provenance"> & {
  write: Extract<CatalogWrite, { kind: "topic" }>;
  relatedTopicIds: string[];
  questionWrites: QuestionRecordWrite[];
  dataEpoch: number | undefined;
};

export async function commitTopicItem(batch: BatchRow, item: TopicItem, data: TopicCommitData, ctx: WriteContext) {
  const db = getDb();
  const { write, relatedTopicIds, questionWrites } = data;
  const topicId = write.row.id;
  const result = { id: topicId, rowVersion: write.row.rowVersion };
  const ref = { ownerId: ctx.actorId, namespace: batch.namespace, externalId: item.externalId, itemId: item.id };
  // The directory snapshot includes title matches. The epoch catches concurrent creates and changes to reviewed associations.
  const receipt = writeReceipt(db, ctx, result, sql`${ownsBatch(batch.id, ctx.actorId)} AND ${itemVersion(item)}
    AND ${catalogPrecondition(write)}
    AND EXISTS (SELECT 1 FROM system_state WHERE id = 1 AND data_epoch = ${data.dataEpoch ?? -1})
    AND NOT EXISTS (SELECT 1 FROM import_topic_refs r WHERE r.owner_id = ${ref.ownerId} AND r.namespace = ${ref.namespace}
      AND r.external_id = ${ref.externalId} AND r.topic_id <> ${topicId})`);
  const questionChanges = questionWrites.flatMap(({ row }) => [
      db.update(questions).set({ rowVersion: row.rowVersion, updatedAt: row.updatedAt, updatedBy: row.updatedBy, lastOrigin: row.lastOrigin })
        .where(eq(questions.id, row.id)),
      db.insert(questionTopics).values({ questionId: row.id, topicId, relationRole: "uses", createdAt: ctx.now, createdBy: ctx.actorId }),
  ]);
  await db.batch([
    receipt,
    ...catalogMutations(db, write, ctx),
    ...relatedTopicIds.map((toTopicId) => db.insert(topicRelations).values({
      fromTopicId: topicId, toTopicId, createdAt: ctx.now, createdBy: ctx.actorId,
    }).onConflictDoNothing()),
    ...questionChanges,
    ...data.sources.map((source) => db.insert(sources).values(source).onConflictDoNothing({ target: sources.id })),
    ...data.provenance.map((link) => db.insert(provenanceLinks).values(link)),
    db.insert(importTopicRefs).values({ ...ref, topicId }).onConflictDoNothing(),
    ...reviewMutations(db, {
      item, change: { status: "committed", topicId, committedVersion: result.rowVersion, issueJson: null },
      action: "commit", detail: { ...result, planHash: item.approvedHash, relatedTopicIds, questionIds: questionWrites.map(({ row }) => row.id) },
    }, ctx),
    advanceEpoch(db, ctx),
  ]);
}

export function relatedImportedTopics(topicId: string) {
  return getDb().select({ id: topics.id, title: topics.title }).from(topics)
    .leftJoin(courses, eq(topics.courseId, courses.id))
    .where(and(isNull(topics.deletedAt), isNull(courses.deletedAt), isNull(courses.archivedAt), sql`${topics.id} IN (
      SELECT to_topic_id FROM topic_relations WHERE from_topic_id = ${topicId}
      UNION SELECT from_topic_id FROM topic_relations WHERE to_topic_id = ${topicId}
    )`)).orderBy(topics.title, topics.id).all();
}

export function questionConversationSources(questionId: string, ownerId: string) {
  const namespace = sql<string>`coalesce(${importBatches.namespace}, json_extract(${sources.extraJson}, '$.namespace'), '')`;
  return getDb().select({
    id: sources.id, title: sources.title, namespace: namespace.as("namespace"),
    primary: sql<number>`max(case when ${provenanceLinks.fieldPath} = 'statementMd' then 1 else 0 end)`.as("primary_source"),
  }).from(provenanceLinks).innerJoin(sources, eq(sources.id, provenanceLinks.sourceId))
    .leftJoin(importBatches, eq(importBatches.id, sql`json_extract(${sources.extraJson}, '$.batchId')`))
    .where(and(eq(provenanceLinks.questionId, questionId), eq(sources.createdBy, ownerId),
      inArray(namespace, [contextImportNamespace, historyImportNamespace])))
    .groupBy(sources.id, sources.title, namespace)
    .having(or(eq(namespace, contextImportNamespace), sql`max(case
      when ${provenanceLinks.verification} = 'verified' and json_type(${provenanceLinks.locatorJson}, '$.history') = 'object' then 1
      else 0 end) = 1`))
    .orderBy(sources.title, sources.id).all();
}

export async function committedTopicNotes(topicId: string, ownerId: string) {
  const rows = await getDb().select({
    id: importItems.id, batchId: importItems.batchId, namespace: importBatches.namespace,
    candidate: importItems.candidateJson, sources: importBatches.sourceJson,
  }).from(importItems).innerJoin(importBatches, eq(importBatches.id, importItems.batchId))
    .where(and(eq(importItems.topicId, topicId), eq(importItems.status, "committed"), eq(importBatches.ownerId, ownerId)))
    .orderBy(importBatches.createdAt, importItems.position).all();
  const retained = await getDb().select().from(retainedImportNotes)
    .where(and(eq(retainedImportNotes.topicId, topicId), eq(retainedImportNotes.ownerId, ownerId)))
    .orderBy(retainedImportNotes.createdAt, retainedImportNotes.id).all();
  const preserved = retained.flatMap(({ id, note, namespace, sources }) => isTopicCandidate(note)
    ? [{ id, batchId: null, namespace, learner_questions: note.learner_questions ?? [],
      evidenced_mistakes: note.evidenced_mistakes ?? [], aiNotesMd: note.ai_notes_md?.trim(), sources }] : []);
  const active = rows.flatMap(({ id, batchId, namespace, candidate, sources }) => {
    if (!isTopicCandidate(candidate)) return [];
    const learner_questions = candidate.learner_questions ?? [];
    const evidenced_mistakes = candidate.evidenced_mistakes ?? [];
    const keys = new Set([
      ...candidate.source_keys ?? [], ...(candidate.summary?.evidence ?? []).map(({ source_key }) => source_key),
      ...(candidate.sections ?? []).flatMap(({ content }) => (content.evidence ?? []).map(({ source_key }) => source_key)),
      ...[...learner_questions, ...evidenced_mistakes].flatMap(({ evidence }) => evidence.map(({ source_key }) => source_key)),
    ]);
    const aiNotesMd = candidate.ai_notes_md?.trim();
    if (!learner_questions.length && !evidenced_mistakes.length && !keys.size && !aiNotesMd) return [];
    return [{ id, batchId, namespace, learner_questions, evidenced_mistakes, aiNotesMd, sources: sources.filter(({ source_key }) => keys.has(source_key)) }];
  });
  return [...active, ...preserved];
}

export async function committedLearningNotes(questionId: string, ownerId: string) {
  const rows = await getDb().select({
    batchId: importItems.batchId, id: importItems.id,
    sources: importBatches.sourceJson,
    learnerQuestions: sql<string | null>`json_extract(${importItems.candidateJson}, '$.learner_questions')`,
    mistakes: sql<string | null>`json_extract(${importItems.candidateJson}, '$.evidenced_mistakes')`,
    annotations: sql<string | null>`json_extract(${importItems.candidateJson}, '$.solution_document.annotations')`,
  })
    .from(importItems).innerJoin(importBatches, eq(importBatches.id, importItems.batchId))
    .where(and(eq(importItems.questionId, questionId), eq(importItems.status, "committed"), eq(importBatches.ownerId, ownerId)))
    .orderBy(importItems.batchId, importItems.position).all();
  const retained = await getDb().select().from(retainedImportNotes)
    .where(and(eq(retainedImportNotes.questionId, questionId), eq(retainedImportNotes.ownerId, ownerId)))
    .orderBy(retainedImportNotes.createdAt, retainedImportNotes.id).all();
  type Annotations = NonNullable<NonNullable<ImportCandidate["solution_document"]>["annotations"]>;
  const preserved = retained.flatMap(({ id, note, sources }) => !isTopicCandidate(note) ? [{
    id, batchId: null, sources, learner_questions: note.learner_questions ?? [],
    evidenced_mistakes: note.evidenced_mistakes ?? [], annotations: note.solution_document?.annotations ?? [],
  }] : []);
  const active = rows.map(({ batchId, id, sources, learnerQuestions, mistakes, annotations }) => ({
    batchId, id, sources,
    learner_questions: (learnerQuestions ? JSON.parse(learnerQuestions) : []) as NonNullable<ImportCandidate["learner_questions"]>,
    evidenced_mistakes: (mistakes ? JSON.parse(mistakes) : []) as NonNullable<ImportCandidate["evidenced_mistakes"]>,
    annotations: (annotations ? JSON.parse(annotations) : []) as Annotations,
  }));
  return [...active, ...preserved].filter(({ learner_questions, evidenced_mistakes, annotations }) =>
    learner_questions.length || evidenced_mistakes.length || annotations.length);
}
