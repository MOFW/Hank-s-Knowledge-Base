import { sql } from "drizzle-orm";
import type { ContentChange, ContentOperationReceipt } from "@/domain/content-operations";
import type { ImportCheckpoint, ImportTaskScope } from "@/domain/import-task";
import type { SolutionDocument, SolutionStep } from "@/domain/solution";
import type { SolutionLayers } from "@/domain/solution-layers";
import type { AnyImportCandidate, HistoryMessageReference, ImportIssue, ImportMapping, ImportSource } from "@/domain/imports";
import {
  check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex, type SQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("owner"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: text("created_at").notNull(),
  disabledAt: text("disabled_at"),
}, (t) => [check("users_role", sql`${t.role} = 'owner'`)]);

export const identities = sqliteTable("identities", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  providerScope: text("provider_scope").notNull(),
  subject: text("subject").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  unique("identities_subject").on(t.provider, t.providerScope, t.subject),
  index("identities_user").on(t.userId),
]);

export const systemState = sqliteTable("system_state", {
  id: integer("id").primaryKey(),
  dataEpoch: integer("data_epoch").notNull().default(0),
  maintenanceToken: text("maintenance_token"),
  maintenanceExpiresAt: text("maintenance_expires_at"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("system_singleton", sql`${t.id} = 1`),
  check("system_epoch", sql`${t.dataEpoch} >= 0`),
  check("system_lease", sql`(${t.maintenanceToken} IS NULL) = (${t.maintenanceExpiresAt} IS NULL)`),
]);

function auditColumns() {
  return {
    id: text("id").primaryKey(),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    lastOrigin: text("last_origin").notNull().default("manual"),
    extraJson: text("extra_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    deletedAt: text("deleted_at"),
  };
}

function auditChecks(name: string, t: {
  rowVersion: SQLiteColumn; lastOrigin: SQLiteColumn; extraJson: SQLiteColumn;
}) {
  return [
    check(name + "_version", sql`${t.rowVersion} >= 1`),
    check(name + "_origin", sql`${t.lastOrigin} IN ('manual', 'import', 'restore', 'system')`),
    check(name + "_extra", sql`json_valid(${t.extraJson}) AND json_type(${t.extraJson}) = 'object'`),
  ];
}

export const courses = sqliteTable("courses", {
  ...auditColumns(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  descriptionMd: text("description_md").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
}, (t) => [
  ...auditChecks("courses", t),
  check("courses_name", sql`length(trim(${t.name})) BETWEEN 1 AND 120`),
]);

// Historical records are kept after the live course and its catalog links are gone.
export const courseDeletions = sqliteTable("course_deletions", {
  courseId: text("course_id").primaryKey(),
  destinationId: text("destination_id"),
  snapshotJson: text("snapshot_json", { mode: "json" }).$type<typeof courses.$inferSelect>().notNull(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  deletedAt: text("deleted_at").notNull(),
});

export const deletedCourseRevisions = sqliteTable("deleted_course_revisions", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courseDeletions.courseId, { onDelete: "restrict" }),
  revisionNo: integer("revision_no").notNull(),
  snapshotSchemaVersion: integer("snapshot_schema_version").notNull(),
  snapshotJson: text("snapshot_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  origin: text("origin").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
}, (t) => [unique("deleted_course_revision_no").on(t.courseId, t.revisionNo)]);

export const chapters = sqliteTable("chapters", {
  ...auditColumns(),
  courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "restrict" }),
  parentId: text("parent_id"),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  descriptionMd: text("description_md").notNull().default(""),
}, (t) => [
  ...auditChecks("chapters", t),
  unique("chapters_course_slug").on(t.courseId, t.slug),
  unique("chapters_id_course").on(t.id, t.courseId),
  foreignKey({
    name: "chapters_parent_course",
    columns: [t.parentId, t.courseId],
    foreignColumns: [t.id, t.courseId],
  }).onDelete("restrict"),
  check("chapters_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  check("chapters_title", sql`length(trim(${t.title})) BETWEEN 1 AND 120`),
  index("chapters_directory").on(t.courseId, t.parentId, t.sortOrder, t.id),
]);

export const topics = sqliteTable("topics", {
  ...auditColumns(),
  courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
  chapterId: text("chapter_id"),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  summaryMd: text("summary_md").notNull().default(""),
  bodyMd: text("body_md").notNull().default(""),
  supplementMd: text("supplement_md"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  ...auditChecks("topics", t),
  unique("topics_course_slug").on(t.courseId, t.slug),
  unique("topics_id_course").on(t.id, t.courseId),
  foreignKey({
    name: "topics_chapter_course",
    columns: [t.chapterId, t.courseId],
    foreignColumns: [chapters.id, chapters.courseId],
  }).onDelete("restrict"),
  check("topics_chapter_requires_course", sql`${t.chapterId} IS NULL OR ${t.courseId} IS NOT NULL`),
  check("topics_title", sql`length(trim(${t.title})) BETWEEN 1 AND 120`),
  index("topics_directory").on(t.courseId, t.chapterId, t.sortOrder, t.id),
]);

export const topicRelations = sqliteTable("topic_relations", {
  fromTopicId: text("from_topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  toTopicId: text("to_topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
}, (t) => [
  primaryKey({ columns: [t.fromTopicId, t.toTopicId] }),
  check("topic_relations_distinct", sql`${t.fromTopicId} <> ${t.toTopicId}`),
]);

function optionalDate(column: SQLiteColumn) {
  return sql`${column} IS NULL OR (length(${column}) = 10 AND date(${column}, '+0 days') IS ${column})`;
}

export const questions = sqliteTable("questions", {
  ...auditColumns(),
  primaryCourseId: text("primary_course_id").references(() => courses.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  statementMd: text("statement_md").notNull().default(""),
  difficulty: integer("difficulty"),
  sourceDate: text("source_date"),
  finalAnswerMd: text("final_answer_md").notNull().default(""),
  solutionSteps: text("solution_steps_json", { mode: "json" }).$type<SolutionStep[]>().notNull().default(sql`'[]'`),
  solutionDocument: text("solution_document_json", { mode: "json" }).$type<SolutionDocument>(),
  solutionLayers: text("solution_layers_json", { mode: "json" }).$type<SolutionLayers>(),
  keyTechniquesMd: text("key_techniques_md").notNull().default(""),
  fingerprintVersion: integer("fingerprint_version").notNull().default(1),
  statementHash: text("statement_hash"),
}, (t) => [
  ...auditChecks("questions", t),
  check("questions_title", sql`length(trim(${t.title})) BETWEEN 1 AND 200`),
  check("questions_difficulty", sql`${t.difficulty} IS NULL OR
    (typeof(${t.difficulty}) = 'integer' AND ${t.difficulty} BETWEEN 1 AND 5)`),
  check("questions_source_date", optionalDate(t.sourceDate)),
  check("questions_solution_steps", sql`json_valid(${t.solutionSteps}) AND json_type(${t.solutionSteps}) = 'array'`),
  check("questions_solution_document", sql`${t.solutionDocument} IS NULL OR
    (json_valid(${t.solutionDocument}) AND json_type(${t.solutionDocument}) = 'object')`),
  check("questions_fingerprint_version", sql`${t.fingerprintVersion} >= 1`),
  index("questions_course_updated").on(t.primaryCourseId, t.updatedAt, t.id),
  index("questions_updated").on(t.updatedAt, t.id),
  index("questions_statement_hash").on(t.fingerprintVersion, t.statementHash),
]);

export const questionTopics = sqliteTable("question_topics", {
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  relationRole: text("relation_role", { enum: ["uses", "primary", "extension"] }).notNull().default("uses"),
  noteMd: text("note_md").notNull().default(""),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  displayRole: text("display_role", { enum: ["related", "featured"] }).notNull().default("related"),
  displayOrder: integer("display_order").notNull().default(0),
  placementAnchor: text("placement_anchor"),
  useQuestionTechniques: integer("use_question_techniques", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.questionId, t.topicId] }),
  check("question_topics_role", sql`${t.relationRole} IN ('uses', 'primary', 'extension')`),
  check("question_topics_display_role", sql`${t.displayRole} IN ('related', 'featured')`),
  check("question_topics_display_order", sql`typeof(${t.displayOrder}) = 'integer' AND ${t.displayOrder} >= 0`),
  check("question_topics_techniques", sql`${t.useQuestionTechniques} IN (0, 1)`),
  index("question_topics_reverse").on(t.topicId, t.questionId),
  index("question_topics_display").on(t.topicId, t.displayRole, t.displayOrder, t.questionId),
]);

function questionRevisionColumns(): [SQLiteColumn, SQLiteColumn] {
  return [contentRevisions.id, contentRevisions.questionId];
}

export const attempts = sqliteTable("attempts", {
  ...auditColumns(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  attemptedAt: text("attempted_at"),
  originalWorkMd: text("original_work_md"),
  errorAnalysisMd: text("error_analysis_md"),
  correctionMd: text("correction_md"),
  insightMd: text("insight_md"),
  outcome: text("outcome", { enum: ["unknown", "correct", "partial", "incorrect"] }).notNull().default("unknown"),
  originalEvidenceStatus: text("original_evidence_status", {
    enum: ["missing", "supplied", "user_confirmed"],
  }).notNull().default("missing"),
  correctionAuthorKind: text("correction_author_kind", {
    enum: ["unknown", "user", "ai", "mixed"],
  }).notNull().default("unknown"),
  sourceRevisionId: text("source_revision_id"),
}, (t) => [
  ...auditChecks("attempts", t),
  foreignKey({
    name: "attempts_question_revision",
    columns: [t.sourceRevisionId, t.questionId],
    foreignColumns: questionRevisionColumns(),
  }).onDelete("restrict"),
  check("attempts_outcome", sql`${t.outcome} IN ('unknown', 'correct', 'partial', 'incorrect')`),
  check("attempts_evidence_status", sql`${t.originalEvidenceStatus} IN ('missing', 'supplied', 'user_confirmed')`),
  check("attempts_original_evidence", sql`(${t.originalWorkMd} IS NULL) = (${t.originalEvidenceStatus} = 'missing')`),
  check("attempts_correction_author", sql`${t.correctionAuthorKind} IN ('unknown', 'user', 'ai', 'mixed')`),
  index("attempts_question_created").on(t.questionId, t.createdAt, t.id),
  index("attempts_user_attempted").on(t.userId, t.attemptedAt),
  index("attempts_source_revision").on(t.sourceRevisionId, t.questionId),
]);

export const learningStates = sqliteTable("learning_states", {
  ...auditColumns(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  mastery: text("mastery", { enum: ["new", "learning", "familiar", "mastered"] }).notNull().default("new"),
  isMistake: integer("is_mistake", { mode: "boolean" }).notNull().default(false),
  nextReviewOn: text("next_review_on"),
  lastReviewedAt: text("last_reviewed_at"),
}, (t) => [
  ...auditChecks("learning_states", t),
  unique("learning_states_user_question").on(t.userId, t.questionId),
  check("learning_states_mastery", sql`${t.mastery} IN ('new', 'learning', 'familiar', 'mastered')`),
  check("learning_states_mistake", sql`${t.isMistake} IN (0, 1)`),
  check("learning_states_next_review", optionalDate(t.nextReviewOn)),
  index("learning_states_mastery_index").on(t.userId, t.mastery, t.questionId),
  index("learning_states_next_review_index").on(t.userId, t.nextReviewOn, t.questionId),
  index("learning_states_mistake_index").on(t.userId, t.isMistake, t.questionId),
]);

export const contentRevisions = sqliteTable("content_revisions", {
  id: text("id").primaryKey(),
  courseId: text("course_id").references(() => courses.id, { onDelete: "restrict" }),
  chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "restrict" }),
  topicId: text("topic_id").references(() => topics.id, { onDelete: "restrict" }),
  questionId: text("question_id").references(() => questions.id, { onDelete: "restrict" }),
  attemptId: text("attempt_id").references(() => attempts.id, { onDelete: "restrict" }),
  learningStateId: text("learning_state_id").references(() => learningStates.id, { onDelete: "restrict" }),
  revisionNo: integer("revision_no").notNull(),
  snapshotSchemaVersion: integer("snapshot_schema_version").notNull().default(1),
  snapshotJson: text("snapshot_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  origin: text("origin").notNull(),
  reason: text("reason"),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("revisions_one_target", sql`(${t.courseId} IS NOT NULL) + (${t.chapterId} IS NOT NULL)
    + (${t.topicId} IS NOT NULL) + (${t.questionId} IS NOT NULL) + (${t.attemptId} IS NOT NULL)
    + (${t.learningStateId} IS NOT NULL) = 1`),
  check("revisions_version", sql`${t.revisionNo} >= 1 AND ${t.snapshotSchemaVersion} >= 1`),
  check("revisions_json", sql`json_valid(${t.snapshotJson}) AND json_type(${t.snapshotJson}) = 'object'`),
  check("revisions_origin", sql`${t.origin} IN ('manual', 'import', 'restore', 'system')`),
  uniqueIndex("course_revision_no").on(t.courseId, t.revisionNo).where(sql`${t.courseId} IS NOT NULL`),
  uniqueIndex("chapter_revision_no").on(t.chapterId, t.revisionNo).where(sql`${t.chapterId} IS NOT NULL`),
  uniqueIndex("topic_revision_no").on(t.topicId, t.revisionNo).where(sql`${t.topicId} IS NOT NULL`),
  uniqueIndex("question_revision_no").on(t.questionId, t.revisionNo).where(sql`${t.questionId} IS NOT NULL`),
  uniqueIndex("attempt_revision_no").on(t.attemptId, t.revisionNo).where(sql`${t.attemptId} IS NOT NULL`),
  uniqueIndex("learning_state_revision_no").on(t.learningStateId, t.revisionNo).where(sql`${t.learningStateId} IS NOT NULL`),
  unique("revisions_question_ref").on(t.id, t.questionId),
]);

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull().unique(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  mimeType: text("mime_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  width: integer("width"),
  height: integer("height"),
  status: text("status", { enum: ["pending", "ready", "quarantined", "deleted"] }).notNull(),
  extraJson: text("extra_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  deletedAt: text("deleted_at"),
}, (t) => [
  check("assets_size", sql`${t.byteSize} >= 0`),
  check("assets_dimensions", sql`(${t.width} IS NULL OR ${t.width} > 0)
    AND (${t.height} IS NULL OR ${t.height} > 0)`),
  check("assets_status", sql`${t.status} IN ('pending', 'ready', 'quarantined', 'deleted')
    AND (${t.deletedAt} IS NOT NULL) = (${t.status} = 'deleted')`),
  check("assets_extra", sql`json_valid(${t.extraJson}) AND json_type(${t.extraJson}) = 'object'`),
  index("assets_digest").on(t.sha256, t.byteSize),
  index("assets_status_created").on(t.status, t.createdAt),
]);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["textbook", "ppt", "pdf", "photo", "chat", "manual", "other"] }).notNull(),
  title: text("title").notNull(),
  externalUrl: text("external_url"),
  citationText: text("citation_text"),
  contentHash: text("content_hash"),
  acquisitionStatus: text("acquisition_status", { enum: ["available", "partial", "unavailable"] }).notNull(),
  excerptMd: text("excerpt_md"),
  occurredOn: text("occurred_on"),
  capturedAt: text("captured_at").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  extraJson: text("extra_json", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
}, (t) => [
  check("sources_kind", sql`${t.kind} IN ('textbook', 'ppt', 'pdf', 'photo', 'chat', 'manual', 'other')`),
  check("sources_title", sql`length(trim(${t.title})) > 0`),
  check("sources_status", sql`${t.acquisitionStatus} IN ('available', 'partial', 'unavailable')`),
  check("sources_date", optionalDate(t.occurredOn)),
  check("sources_extra", sql`json_valid(${t.extraJson}) AND json_type(${t.extraJson}) = 'object'`),
]);

export const provenanceLinks = sqliteTable("provenance_links", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
  topicId: text("topic_id").references(() => topics.id, { onDelete: "restrict" }),
  questionId: text("question_id").references(() => questions.id, { onDelete: "restrict" }),
  attemptId: text("attempt_id").references(() => attempts.id, { onDelete: "restrict" }),
  fieldPath: text("field_path").notNull(),
  locatorJson: text("locator_json", { mode: "json" }).$type<{
    reference?: string; speaker?: string; batchId?: string; itemId?: string;
    history?: HistoryMessageReference; attachmentIndex?: number; sha256?: string; assetId?: string;
  }>().notNull().default(sql`'{}'`),
  evidenceKind: text("evidence_kind").notNull(),
  verification: text("verification").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("provenance_one_target", sql`(${t.topicId} IS NOT NULL) + (${t.questionId} IS NOT NULL)
    + (${t.attemptId} IS NOT NULL) = 1`),
  check("provenance_locator", sql`json_valid(${t.locatorJson}) AND json_type(${t.locatorJson}) = 'object'`),
  check("provenance_kind", sql`${t.evidenceKind} IN ('direct', 'transcription', 'ai_synthesis', 'user_confirmation')`),
  check("provenance_verification", sql`${t.verification} IN ('unverified', 'verified', 'unavailable')`),
  index("provenance_source").on(t.sourceId),
  index("provenance_topic").on(t.topicId),
  index("provenance_question").on(t.questionId, t.fieldPath),
  index("provenance_attempt").on(t.attemptId),
]);

export const assetLinks = sqliteTable("asset_links", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  topicId: text("topic_id").references(() => topics.id, { onDelete: "restrict" }),
  questionId: text("question_id").references(() => questions.id, { onDelete: "restrict" }),
  attemptId: text("attempt_id").references(() => attempts.id, { onDelete: "restrict" }),
  sourceId: text("source_id").references(() => sources.id, { onDelete: "restrict" }),
  revisionId: text("revision_id").references(() => contentRevisions.id, { onDelete: "restrict" }),
  role: text("role", { enum: ["original", "inline", "attachment", "evidence"] }).notNull(),
  caption: text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  check("asset_links_one_target", sql`(${t.topicId} IS NOT NULL) + (${t.questionId} IS NOT NULL)
    + (${t.attemptId} IS NOT NULL) + (${t.sourceId} IS NOT NULL) + (${t.revisionId} IS NOT NULL) = 1`),
  check("asset_links_role", sql`${t.role} IN ('original', 'inline', 'attachment', 'evidence')`),
  index("asset_links_asset").on(t.assetId),
  uniqueIndex("asset_links_topic").on(t.topicId, t.assetId, t.role).where(sql`${t.topicId} IS NOT NULL`),
  uniqueIndex("asset_links_question").on(t.questionId, t.assetId, t.role).where(sql`${t.questionId} IS NOT NULL`),
  uniqueIndex("asset_links_attempt").on(t.attemptId, t.assetId, t.role).where(sql`${t.attemptId} IS NOT NULL`),
  uniqueIndex("asset_links_source").on(t.sourceId, t.assetId, t.role).where(sql`${t.sourceId} IS NOT NULL`),
  uniqueIndex("asset_links_revision").on(t.revisionId, t.assetId, t.role).where(sql`${t.revisionId} IS NOT NULL`),
]);

export const writeReceipts = sqliteTable("write_receipts", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  preconditionOk: integer("precondition_ok").notNull(),
  resultJson: text("result_json", { mode: "json" }).$type<{
    id: string; rowVersion: number;
    learningState?: Pick<typeof learningStates.$inferSelect, "mastery" | "isMistake" | "nextReviewOn">;
    contentOperation?: ContentOperationReceipt;
  }>().notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  unique("receipts_actor_key").on(t.actorId, t.idempotencyKey),
  check("receipts_precondition", sql`${t.preconditionOk} = 1`),
  check("receipts_result", sql`json_valid(${t.resultJson}) AND json_type(${t.resultJson}) = 'object'`),
  index("receipts_created").on(t.createdAt),
]);

export const contentUndoSlots = sqliteTable("content_undo_slots", {
  ownerId: text("owner_id").primaryKey().notNull().references(() => users.id, { onDelete: "restrict" }),
  operationId: text("operation_id").notNull(),
  changes: text("changes_json", { mode: "json" }).$type<ContentChange[]>().notNull(),
  phase: integer("phase").notNull(),
  conflicted: integer("conflicted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("content_undo_phase", sql`${t.phase} IN (0, 1, 2)`),
  check("content_undo_conflicted", sql`${t.conflicted} IN (0, 1)`),
  check("content_undo_summary", sql`json_type(${t.changes}) = 'array'`),
]);

export const contentUndoChanges = sqliteTable("content_undo_changes", {
  ownerId: text("owner_id").notNull().references(() => contentUndoSlots.ownerId, { onDelete: "cascade" }),
  tableName: text("table_name").notNull(),
  rowKey: text("row_key").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  afterExists: integer("after_exists", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.tableName, t.rowKey] }),
  index("content_undo_change_key").on(t.tableName, t.rowKey),
]);

export const contentUndoAssets = sqliteTable("content_undo_assets", {
  ownerId: text("owner_id").notNull().references(() => contentUndoSlots.ownerId, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.assetId] }),
  index("content_undo_asset").on(t.assetId),
]);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  batchKey: text("batch_key").notNull(),
  schemaVersion: text("schema_version", { enum: ["1.0", "1.1", "1.2"] }).notNull(),
  rawJson: text("raw_json").notNull(),
  rawHash: text("raw_hash").notNull(),
  contentHash: text("content_hash").notNull(),
  sourceJson: text("source_json", { mode: "json" }).$type<(ImportSource & { id: string })[]>().notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  unique("import_batches_content").on(t.ownerId, t.namespace, t.contentHash),
  index("import_batches_owner_created").on(t.ownerId, t.createdAt, t.id),
]);

export const importBatchKeys = sqliteTable("import_batch_keys", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  batchKey: text("batch_key").notNull(),
  batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.ownerId, t.namespace, t.batchKey] })]);

export const importItems = sqliteTable("import_items", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  itemKey: text("item_key").notNull(),
  externalId: text("external_id").notNull(),
  candidateJson: text("candidate_json", { mode: "json" }).$type<AnyImportCandidate>().notNull(),
  mappingJson: text("mapping_json", { mode: "json" }).$type<ImportMapping>().notNull().default(sql`'{}'`),
  rowVersion: integer("row_version").notNull().default(1),
  status: text("status", { enum: ["pending", "approved", "rejected", "skipped", "conflict", "failed", "committed"] }).notNull(),
  approvedHash: text("approved_hash"),
  issueJson: text("issue_json", { mode: "json" }).$type<ImportIssue>(),
  questionId: text("question_id").references(() => questions.id, { onDelete: "restrict" }),
  topicId: text("topic_id").references(() => topics.id, { onDelete: "restrict" }),
  committedVersion: integer("committed_version"),
}, (t) => [
  unique("import_items_position").on(t.batchId, t.position),
  unique("import_items_key").on(t.batchId, t.itemKey),
  unique("import_items_external").on(t.batchId, t.externalId),
  check("import_items_approval", sql`(${t.approvedHash} IS NOT NULL) = (${t.status} IN ('approved', 'failed', 'committed'))`),
  check("import_items_commit", sql`CASE WHEN ${t.status} = 'committed' THEN
    ${t.committedVersion} IS NOT NULL AND (
      CASE WHEN json_extract(${t.candidateJson}, '$.kind') = 'topic'
        THEN ${t.topicId} IS NOT NULL AND ${t.questionId} IS NULL
        ELSE ${t.questionId} IS NOT NULL AND ${t.topicId} IS NULL END)
    ELSE ${t.committedVersion} IS NULL AND ${t.questionId} IS NULL AND ${t.topicId} IS NULL END`),
]);

export const importReviews = sqliteTable("import_reviews", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => importItems.id, { onDelete: "restrict" }),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  itemVersion: integer("item_version").notNull(),
  action: text("action", { enum: ["edit", "approve", "reject", "skip", "conflict", "failed", "commit"] }).notNull(),
  detailJson: text("detail_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [index("import_reviews_item").on(t.itemId, t.itemVersion, t.createdAt)]);

export const importQuestionRefs = sqliteTable("import_question_refs", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  externalId: text("external_id").notNull(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  itemId: text("item_id").notNull().references(() => importItems.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.ownerId, t.namespace, t.externalId] })]);

export const importAttemptRefs = sqliteTable("import_attempt_refs", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  externalId: text("external_id").notNull(),
  attemptId: text("attempt_id").notNull().references(() => attempts.id, { onDelete: "restrict" }),
  itemId: text("item_id").notNull().references(() => importItems.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.ownerId, t.namespace, t.externalId] })]);

export const importTopicRefs = sqliteTable("import_topic_refs", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  externalId: text("external_id").notNull(),
  topicId: text("topic_id").notNull().references(() => topics.id, { onDelete: "restrict" }),
  itemId: text("item_id").notNull().references(() => importItems.id, { onDelete: "restrict" }),
}, (t) => [primaryKey({ columns: [t.ownerId, t.namespace, t.externalId] })]);

export const reviewSessions = sqliteTable("review_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["active", "paused", "completed", "ended"] }).notNull(),
  position: integer("position").notNull().default(1),
  total: integer("total").notNull(),
  rowVersion: integer("row_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  uniqueIndex("review_one_open_session").on(t.userId).where(sql`${t.status} IN ('active', 'paused')`),
  index("review_sessions_user_updated").on(t.userId, t.updatedAt),
  check("review_session_status", sql`${t.status} IN ('active', 'paused', 'completed', 'ended')`),
  check("review_session_position", sql`${t.position} BETWEEN 1 AND ${t.total} AND ${t.rowVersion} >= 1`),
]);

export const reviewItems = sqliteTable("review_items", {
  sessionId: text("session_id").notNull().references(() => reviewSessions.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  questionId: text("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  draftMd: text("draft_md").notNull().default(""),
  usedHint: integer("used_hint", { mode: "boolean" }).notNull().default(false),
  answerMode: text("answer_mode", { enum: ["check", "peek"] }),
  outcome: text("outcome", { enum: ["independent", "assisted", "practice", "skipped", "unavailable"] }),
  resolvedAt: text("resolved_at"),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.position] }),
  unique("review_item_question").on(t.sessionId, t.questionId),
  check("review_item_position", sql`${t.position} >= 1`),
  check("review_item_hint", sql`${t.usedHint} IN (0, 1)`),
  check("review_item_answer_mode", sql`${t.answerMode} IN ('check', 'peek')`),
  check("review_item_outcome", sql`${t.outcome} IN ('independent', 'assisted', 'practice', 'skipped', 'unavailable')`),
  check("review_item_resolution", sql`(${t.resolvedAt} IS NULL) = (${t.outcome} IS NULL)
    AND (${t.outcome} NOT IN ('independent', 'assisted', 'practice') OR ${t.answerMode} IS NOT NULL)`),
]);

export const importTasks = sqliteTable("import_tasks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  scope: text("scope_json", { mode: "json" }).$type<ImportTaskScope>().notNull(),
  cancelledAt: text("cancelled_at"),
  rowVersion: integer("row_version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("import_tasks_owner_updated").on(t.ownerId, t.updatedAt, t.id)]);

export const importTaskCheckpoints = sqliteTable("import_task_checkpoints", {
  taskId: text("task_id").notNull().references(() => importTasks.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  unitId: text("unit_id").notNull(),
  event: text("event_json", { mode: "json" }).$type<ImportCheckpoint>().notNull(),
  batchId: text("batch_id").references(() => importBatches.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.taskId, t.version] }),
  check("import_task_checkpoint_batch", sql`(json_extract(${t.event}, '$.type') = 'submitted') = (${t.batchId} IS NOT NULL)`),
]);

export { aiReviewSettings, aiReviewSources, aiReviews, aiReviewUsage } from "./ai-review-schema";

export const aiDeletedDailyUsage = sqliteTable("ai_deleted_daily_usage", {
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  day: text("day").notNull(),
  costMicros: integer("cost_micros").notNull().default(0),
  approvals: integer("approvals").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.ownerId, t.day] })]);

export const retainedImportNotes = sqliteTable("retained_import_notes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  topicId: text("topic_id").references(() => topics.id, { onDelete: "restrict" }),
  questionId: text("question_id").references(() => questions.id, { onDelete: "restrict" }),
  namespace: text("namespace").notNull(),
  note: text("note_json", { mode: "json" }).$type<AnyImportCandidate>().notNull(),
  sources: text("source_json", { mode: "json" }).$type<ImportSource[]>().notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  check("retained_import_notes_target", sql`(${t.topicId} IS NULL) <> (${t.questionId} IS NULL)`),
  index("retained_import_notes_topic").on(t.topicId),
  index("retained_import_notes_question").on(t.questionId),
]);
