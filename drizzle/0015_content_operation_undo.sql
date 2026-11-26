CREATE TABLE `content_undo_assets` (
	`owner_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `asset_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `content_undo_slots`(`owner_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `content_undo_asset` ON `content_undo_assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `content_undo_changes` (
	`owner_id` text NOT NULL,
	`table_name` text NOT NULL,
	`row_key` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`after_exists` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`owner_id`, `table_name`, `row_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `content_undo_slots`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_undo_change_key` ON `content_undo_changes` (`table_name`,`row_key`);--> statement-breakpoint
CREATE TABLE `content_undo_slots` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`changes_json` text NOT NULL,
	`phase` integer NOT NULL,
	`conflicted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_undo_phase" CHECK("content_undo_slots"."phase" IN (0, 1, 2)),
	CONSTRAINT "content_undo_conflicted" CHECK("content_undo_slots"."conflicted" IN (0, 1)),
	CONSTRAINT "content_undo_summary" CHECK(json_type("content_undo_slots"."changes_json") = 'array')
);

--> statement-breakpoint
-- Row events record before-images inside a direct batch and guard committed keys against later writes.
-- The application compacts the journal and publishes the slot before the transaction commits.
CREATE UNIQUE INDEX content_undo_one_capture ON content_undo_slots (phase) WHERE phase = 1;
--> statement-breakpoint
CREATE VIEW content_undo_events AS SELECT NULL AS table_name, NULL AS old_key, NULL AS new_key,
  NULL AS old_row, NULL AS new_row WHERE 0;
--> statement-breakpoint
CREATE TRIGGER content_undo_accept_event INSTEAD OF INSERT ON content_undo_events BEGIN
  INSERT INTO content_undo_changes (owner_id, table_name, row_key, before_json, after_json)
    SELECT owner_id, NEW.table_name, NEW.old_key, NEW.old_row,
      CASE WHEN NEW.old_key = NEW.new_key THEN NEW.new_row END
    FROM content_undo_slots WHERE phase = 1 AND NEW.old_key IS NOT NULL
    ON CONFLICT (owner_id, table_name, row_key) DO UPDATE SET after_json = excluded.after_json;
  INSERT INTO content_undo_changes (owner_id, table_name, row_key, before_json, after_json)
    SELECT owner_id, NEW.table_name, NEW.new_key, NULL, NEW.new_row FROM content_undo_slots
    WHERE phase = 1 AND NEW.new_key IS NOT NULL AND NEW.new_key IS NOT NEW.old_key
    ON CONFLICT (owner_id, table_name, row_key) DO UPDATE SET after_json = excluded.after_json;
  UPDATE content_undo_slots SET conflicted = 1 WHERE phase = 0 AND conflicted = 0 AND owner_id IN (
    SELECT owner_id FROM content_undo_changes WHERE table_name = NEW.table_name AND row_key IN (NEW.old_key, NEW.new_key)
  );
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_insert AFTER INSERT ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id, 'title', NEW.title,
      'slug', NEW.slug, 'summary_md', NEW.summary_md, 'body_md', NEW.body_md,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_update AFTER UPDATE ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.updated_by IS NOT NEW.updated_by
    OR OLD.last_origin IS NOT NEW.last_origin
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.deleted_at IS NOT NEW.deleted_at
    OR OLD.course_id IS NOT NEW.course_id
    OR OLD.chapter_id IS NOT NEW.chapter_id
    OR OLD.title IS NOT NEW.title
    OR OLD.slug IS NOT NEW.slug
    OR OLD.summary_md IS NOT NEW.summary_md
    OR OLD.body_md IS NOT NEW.body_md
    OR OLD.sort_order IS NOT NEW.sort_order)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id, 'title', OLD.title,
      'slug', OLD.slug, 'summary_md', OLD.summary_md, 'body_md', OLD.body_md,
      'sort_order', OLD.sort_order
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id, 'title', NEW.title,
      'slug', NEW.slug, 'summary_md', NEW.summary_md, 'body_md', NEW.body_md,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_delete AFTER DELETE ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id, 'title', OLD.title,
      'slug', OLD.slug, 'summary_md', OLD.summary_md, 'body_md', OLD.body_md,
      'sort_order', OLD.sort_order
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_questions_insert AFTER INSERT ON questions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('questions', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'primary_course_id', NEW.primary_course_id, 'title', NEW.title, 'statement_md', NEW.statement_md,
      'difficulty', NEW.difficulty, 'source_date', NEW.source_date, 'final_answer_md', NEW.final_answer_md,
      'solution_steps_json', NEW.solution_steps_json, 'solution_document_json', NEW.solution_document_json, 'solution_layers_json', NEW.solution_layers_json,
      'key_techniques_md', NEW.key_techniques_md, 'fingerprint_version', NEW.fingerprint_version, 'statement_hash', NEW.statement_hash
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_questions_update AFTER UPDATE ON questions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.updated_by IS NOT NEW.updated_by
    OR OLD.last_origin IS NOT NEW.last_origin
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.deleted_at IS NOT NEW.deleted_at
    OR OLD.primary_course_id IS NOT NEW.primary_course_id
    OR OLD.title IS NOT NEW.title
    OR OLD.statement_md IS NOT NEW.statement_md
    OR OLD.difficulty IS NOT NEW.difficulty
    OR OLD.source_date IS NOT NEW.source_date
    OR OLD.final_answer_md IS NOT NEW.final_answer_md
    OR OLD.solution_steps_json IS NOT NEW.solution_steps_json
    OR OLD.solution_document_json IS NOT NEW.solution_document_json
    OR OLD.solution_layers_json IS NOT NEW.solution_layers_json
    OR OLD.key_techniques_md IS NOT NEW.key_techniques_md
    OR OLD.fingerprint_version IS NOT NEW.fingerprint_version
    OR OLD.statement_hash IS NOT NEW.statement_hash)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('questions', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'primary_course_id', OLD.primary_course_id, 'title', OLD.title, 'statement_md', OLD.statement_md,
      'difficulty', OLD.difficulty, 'source_date', OLD.source_date, 'final_answer_md', OLD.final_answer_md,
      'solution_steps_json', OLD.solution_steps_json, 'solution_document_json', OLD.solution_document_json, 'solution_layers_json', OLD.solution_layers_json,
      'key_techniques_md', OLD.key_techniques_md, 'fingerprint_version', OLD.fingerprint_version, 'statement_hash', OLD.statement_hash
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'primary_course_id', NEW.primary_course_id, 'title', NEW.title, 'statement_md', NEW.statement_md,
      'difficulty', NEW.difficulty, 'source_date', NEW.source_date, 'final_answer_md', NEW.final_answer_md,
      'solution_steps_json', NEW.solution_steps_json, 'solution_document_json', NEW.solution_document_json, 'solution_layers_json', NEW.solution_layers_json,
      'key_techniques_md', NEW.key_techniques_md, 'fingerprint_version', NEW.fingerprint_version, 'statement_hash', NEW.statement_hash
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_questions_delete AFTER DELETE ON questions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('questions', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'primary_course_id', OLD.primary_course_id, 'title', OLD.title, 'statement_md', OLD.statement_md,
      'difficulty', OLD.difficulty, 'source_date', OLD.source_date, 'final_answer_md', OLD.final_answer_md,
      'solution_steps_json', OLD.solution_steps_json, 'solution_document_json', OLD.solution_document_json, 'solution_layers_json', OLD.solution_layers_json,
      'key_techniques_md', OLD.key_techniques_md, 'fingerprint_version', OLD.fingerprint_version, 'statement_hash', OLD.statement_hash
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_sources_insert AFTER INSERT ON sources
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('sources', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'kind', NEW.kind, 'title', NEW.title,
      'external_url', NEW.external_url, 'citation_text', NEW.citation_text, 'content_hash', NEW.content_hash,
      'acquisition_status', NEW.acquisition_status, 'excerpt_md', NEW.excerpt_md, 'occurred_on', NEW.occurred_on,
      'captured_at', NEW.captured_at, 'created_by', NEW.created_by, 'extra_json', NEW.extra_json
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_sources_update AFTER UPDATE ON sources
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.kind IS NOT NEW.kind
    OR OLD.title IS NOT NEW.title
    OR OLD.external_url IS NOT NEW.external_url
    OR OLD.citation_text IS NOT NEW.citation_text
    OR OLD.content_hash IS NOT NEW.content_hash
    OR OLD.acquisition_status IS NOT NEW.acquisition_status
    OR OLD.excerpt_md IS NOT NEW.excerpt_md
    OR OLD.occurred_on IS NOT NEW.occurred_on
    OR OLD.captured_at IS NOT NEW.captured_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.extra_json IS NOT NEW.extra_json)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('sources', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'kind', OLD.kind, 'title', OLD.title,
      'external_url', OLD.external_url, 'citation_text', OLD.citation_text, 'content_hash', OLD.content_hash,
      'acquisition_status', OLD.acquisition_status, 'excerpt_md', OLD.excerpt_md, 'occurred_on', OLD.occurred_on,
      'captured_at', OLD.captured_at, 'created_by', OLD.created_by, 'extra_json', OLD.extra_json
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'kind', NEW.kind, 'title', NEW.title,
      'external_url', NEW.external_url, 'citation_text', NEW.citation_text, 'content_hash', NEW.content_hash,
      'acquisition_status', NEW.acquisition_status, 'excerpt_md', NEW.excerpt_md, 'occurred_on', NEW.occurred_on,
      'captured_at', NEW.captured_at, 'created_by', NEW.created_by, 'extra_json', NEW.extra_json
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_sources_delete AFTER DELETE ON sources
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('sources', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'kind', OLD.kind, 'title', OLD.title,
      'external_url', OLD.external_url, 'citation_text', OLD.citation_text, 'content_hash', OLD.content_hash,
      'acquisition_status', OLD.acquisition_status, 'excerpt_md', OLD.excerpt_md, 'occurred_on', OLD.occurred_on,
      'captured_at', OLD.captured_at, 'created_by', OLD.created_by, 'extra_json', OLD.extra_json
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_content_revisions_insert AFTER INSERT ON content_revisions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('content_revisions', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id,
      'topic_id', NEW.topic_id, 'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id,
      'learning_state_id', NEW.learning_state_id, 'revision_no', NEW.revision_no, 'snapshot_schema_version', NEW.snapshot_schema_version,
      'snapshot_json', NEW.snapshot_json, 'actor_id', NEW.actor_id, 'origin', NEW.origin,
      'reason', NEW.reason, 'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_content_revisions_update AFTER UPDATE ON content_revisions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.course_id IS NOT NEW.course_id
    OR OLD.chapter_id IS NOT NEW.chapter_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.attempt_id IS NOT NEW.attempt_id
    OR OLD.learning_state_id IS NOT NEW.learning_state_id
    OR OLD.revision_no IS NOT NEW.revision_no
    OR OLD.snapshot_schema_version IS NOT NEW.snapshot_schema_version
    OR OLD.snapshot_json IS NOT NEW.snapshot_json
    OR OLD.actor_id IS NOT NEW.actor_id
    OR OLD.origin IS NOT NEW.origin
    OR OLD.reason IS NOT NEW.reason
    OR OLD.created_at IS NOT NEW.created_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('content_revisions', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id,
      'topic_id', OLD.topic_id, 'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id,
      'learning_state_id', OLD.learning_state_id, 'revision_no', OLD.revision_no, 'snapshot_schema_version', OLD.snapshot_schema_version,
      'snapshot_json', OLD.snapshot_json, 'actor_id', OLD.actor_id, 'origin', OLD.origin,
      'reason', OLD.reason, 'created_at', OLD.created_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id,
      'topic_id', NEW.topic_id, 'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id,
      'learning_state_id', NEW.learning_state_id, 'revision_no', NEW.revision_no, 'snapshot_schema_version', NEW.snapshot_schema_version,
      'snapshot_json', NEW.snapshot_json, 'actor_id', NEW.actor_id, 'origin', NEW.origin,
      'reason', NEW.reason, 'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_content_revisions_delete AFTER DELETE ON content_revisions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('content_revisions', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id,
      'topic_id', OLD.topic_id, 'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id,
      'learning_state_id', OLD.learning_state_id, 'revision_no', OLD.revision_no, 'snapshot_schema_version', OLD.snapshot_schema_version,
      'snapshot_json', OLD.snapshot_json, 'actor_id', OLD.actor_id, 'origin', OLD.origin,
      'reason', OLD.reason, 'created_at', OLD.created_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_attempts_insert AFTER INSERT ON attempts
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('attempts', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'question_id', NEW.question_id, 'user_id', NEW.user_id, 'attempted_at', NEW.attempted_at,
      'original_work_md', NEW.original_work_md, 'error_analysis_md', NEW.error_analysis_md, 'correction_md', NEW.correction_md,
      'insight_md', NEW.insight_md, 'outcome', NEW.outcome, 'original_evidence_status', NEW.original_evidence_status,
      'correction_author_kind', NEW.correction_author_kind, 'source_revision_id', NEW.source_revision_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_attempts_update AFTER UPDATE ON attempts
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.updated_by IS NOT NEW.updated_by
    OR OLD.last_origin IS NOT NEW.last_origin
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.deleted_at IS NOT NEW.deleted_at
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.user_id IS NOT NEW.user_id
    OR OLD.attempted_at IS NOT NEW.attempted_at
    OR OLD.original_work_md IS NOT NEW.original_work_md
    OR OLD.error_analysis_md IS NOT NEW.error_analysis_md
    OR OLD.correction_md IS NOT NEW.correction_md
    OR OLD.insight_md IS NOT NEW.insight_md
    OR OLD.outcome IS NOT NEW.outcome
    OR OLD.original_evidence_status IS NOT NEW.original_evidence_status
    OR OLD.correction_author_kind IS NOT NEW.correction_author_kind
    OR OLD.source_revision_id IS NOT NEW.source_revision_id)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('attempts', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'question_id', OLD.question_id, 'user_id', OLD.user_id, 'attempted_at', OLD.attempted_at,
      'original_work_md', OLD.original_work_md, 'error_analysis_md', OLD.error_analysis_md, 'correction_md', OLD.correction_md,
      'insight_md', OLD.insight_md, 'outcome', OLD.outcome, 'original_evidence_status', OLD.original_evidence_status,
      'correction_author_kind', OLD.correction_author_kind, 'source_revision_id', OLD.source_revision_id
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'question_id', NEW.question_id, 'user_id', NEW.user_id, 'attempted_at', NEW.attempted_at,
      'original_work_md', NEW.original_work_md, 'error_analysis_md', NEW.error_analysis_md, 'correction_md', NEW.correction_md,
      'insight_md', NEW.insight_md, 'outcome', NEW.outcome, 'original_evidence_status', NEW.original_evidence_status,
      'correction_author_kind', NEW.correction_author_kind, 'source_revision_id', NEW.source_revision_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_attempts_delete AFTER DELETE ON attempts
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('attempts', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'question_id', OLD.question_id, 'user_id', OLD.user_id, 'attempted_at', OLD.attempted_at,
      'original_work_md', OLD.original_work_md, 'error_analysis_md', OLD.error_analysis_md, 'correction_md', OLD.correction_md,
      'insight_md', OLD.insight_md, 'outcome', OLD.outcome, 'original_evidence_status', OLD.original_evidence_status,
      'correction_author_kind', OLD.correction_author_kind, 'source_revision_id', OLD.source_revision_id
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_learning_states_insert AFTER INSERT ON learning_states
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('learning_states', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'question_id', NEW.question_id, 'user_id', NEW.user_id, 'mastery', NEW.mastery,
      'is_mistake', NEW.is_mistake, 'next_review_on', NEW.next_review_on, 'last_reviewed_at', NEW.last_reviewed_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_learning_states_update AFTER UPDATE ON learning_states
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.updated_by IS NOT NEW.updated_by
    OR OLD.last_origin IS NOT NEW.last_origin
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.deleted_at IS NOT NEW.deleted_at
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.user_id IS NOT NEW.user_id
    OR OLD.mastery IS NOT NEW.mastery
    OR OLD.is_mistake IS NOT NEW.is_mistake
    OR OLD.next_review_on IS NOT NEW.next_review_on
    OR OLD.last_reviewed_at IS NOT NEW.last_reviewed_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('learning_states', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'question_id', OLD.question_id, 'user_id', OLD.user_id, 'mastery', OLD.mastery,
      'is_mistake', OLD.is_mistake, 'next_review_on', OLD.next_review_on, 'last_reviewed_at', OLD.last_reviewed_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'question_id', NEW.question_id, 'user_id', NEW.user_id, 'mastery', NEW.mastery,
      'is_mistake', NEW.is_mistake, 'next_review_on', NEW.next_review_on, 'last_reviewed_at', NEW.last_reviewed_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_learning_states_delete AFTER DELETE ON learning_states
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('learning_states', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'question_id', OLD.question_id, 'user_id', OLD.user_id, 'mastery', OLD.mastery,
      'is_mistake', OLD.is_mistake, 'next_review_on', OLD.next_review_on, 'last_reviewed_at', OLD.last_reviewed_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_sessions_insert AFTER INSERT ON review_sessions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_sessions', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'user_id', NEW.user_id, 'status', NEW.status,
      'position', NEW.position, 'total', NEW.total, 'row_version', NEW.row_version,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_sessions_update AFTER UPDATE ON review_sessions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.user_id IS NOT NEW.user_id
    OR OLD.status IS NOT NEW.status
    OR OLD.position IS NOT NEW.position
    OR OLD.total IS NOT NEW.total
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_sessions', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'user_id', OLD.user_id, 'status', OLD.status,
      'position', OLD.position, 'total', OLD.total, 'row_version', OLD.row_version,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'user_id', NEW.user_id, 'status', NEW.status,
      'position', NEW.position, 'total', NEW.total, 'row_version', NEW.row_version,
      'created_at', NEW.created_at, 'updated_at', NEW.updated_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_sessions_delete AFTER DELETE ON review_sessions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_sessions', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'user_id', OLD.user_id, 'status', OLD.status,
      'position', OLD.position, 'total', OLD.total, 'row_version', OLD.row_version,
      'created_at', OLD.created_at, 'updated_at', OLD.updated_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_items_insert AFTER INSERT ON review_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_items', NULL, json_array(NEW.session_id, NEW.question_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'session_id', NEW.session_id, 'position', NEW.position, 'question_id', NEW.question_id,
      'draft_md', NEW.draft_md, 'used_hint', NEW.used_hint, 'answer_mode', NEW.answer_mode,
      'outcome', NEW.outcome, 'resolved_at', NEW.resolved_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_items_update AFTER UPDATE ON review_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.session_id IS NOT NEW.session_id
    OR OLD.position IS NOT NEW.position
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.draft_md IS NOT NEW.draft_md
    OR OLD.used_hint IS NOT NEW.used_hint
    OR OLD.answer_mode IS NOT NEW.answer_mode
    OR OLD.outcome IS NOT NEW.outcome
    OR OLD.resolved_at IS NOT NEW.resolved_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_items', json_array(OLD.session_id, OLD.question_id), json_array(NEW.session_id, NEW.question_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'session_id', OLD.session_id, 'position', OLD.position, 'question_id', OLD.question_id,
      'draft_md', OLD.draft_md, 'used_hint', OLD.used_hint, 'answer_mode', OLD.answer_mode,
      'outcome', OLD.outcome, 'resolved_at', OLD.resolved_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'session_id', NEW.session_id, 'position', NEW.position, 'question_id', NEW.question_id,
      'draft_md', NEW.draft_md, 'used_hint', NEW.used_hint, 'answer_mode', NEW.answer_mode,
      'outcome', NEW.outcome, 'resolved_at', NEW.resolved_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_review_items_delete AFTER DELETE ON review_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('review_items', json_array(OLD.session_id, OLD.question_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'session_id', OLD.session_id, 'position', OLD.position, 'question_id', OLD.question_id,
      'draft_md', OLD.draft_md, 'used_hint', OLD.used_hint, 'answer_mode', OLD.answer_mode,
      'outcome', OLD.outcome, 'resolved_at', OLD.resolved_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topic_relations_insert AFTER INSERT ON topic_relations
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topic_relations', NULL, json_array(NEW.from_topic_id, NEW.to_topic_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'from_topic_id', NEW.from_topic_id, 'to_topic_id', NEW.to_topic_id, 'created_at', NEW.created_at,
      'created_by', NEW.created_by
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topic_relations_update AFTER UPDATE ON topic_relations
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.from_topic_id IS NOT NEW.from_topic_id
    OR OLD.to_topic_id IS NOT NEW.to_topic_id
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.created_by IS NOT NEW.created_by)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topic_relations', json_array(OLD.from_topic_id, OLD.to_topic_id), json_array(NEW.from_topic_id, NEW.to_topic_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'from_topic_id', OLD.from_topic_id, 'to_topic_id', OLD.to_topic_id, 'created_at', OLD.created_at,
      'created_by', OLD.created_by
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'from_topic_id', NEW.from_topic_id, 'to_topic_id', NEW.to_topic_id, 'created_at', NEW.created_at,
      'created_by', NEW.created_by
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_topic_relations_delete AFTER DELETE ON topic_relations
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topic_relations', json_array(OLD.from_topic_id, OLD.to_topic_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'from_topic_id', OLD.from_topic_id, 'to_topic_id', OLD.to_topic_id, 'created_at', OLD.created_at,
      'created_by', OLD.created_by
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_question_topics_insert AFTER INSERT ON question_topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('question_topics', NULL, json_array(NEW.question_id, NEW.topic_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'question_id', NEW.question_id, 'topic_id', NEW.topic_id, 'relation_role', NEW.relation_role,
      'note_md', NEW.note_md, 'created_at', NEW.created_at, 'created_by', NEW.created_by,
      'display_role', NEW.display_role, 'display_order', NEW.display_order, 'placement_anchor', NEW.placement_anchor,
      'use_question_techniques', NEW.use_question_techniques
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_question_topics_update AFTER UPDATE ON question_topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.question_id IS NOT NEW.question_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.relation_role IS NOT NEW.relation_role
    OR OLD.note_md IS NOT NEW.note_md
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.display_role IS NOT NEW.display_role
    OR OLD.display_order IS NOT NEW.display_order
    OR OLD.placement_anchor IS NOT NEW.placement_anchor
    OR OLD.use_question_techniques IS NOT NEW.use_question_techniques)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('question_topics', json_array(OLD.question_id, OLD.topic_id), json_array(NEW.question_id, NEW.topic_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'question_id', OLD.question_id, 'topic_id', OLD.topic_id, 'relation_role', OLD.relation_role,
      'note_md', OLD.note_md, 'created_at', OLD.created_at, 'created_by', OLD.created_by,
      'display_role', OLD.display_role, 'display_order', OLD.display_order, 'placement_anchor', OLD.placement_anchor,
      'use_question_techniques', OLD.use_question_techniques
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'question_id', NEW.question_id, 'topic_id', NEW.topic_id, 'relation_role', NEW.relation_role,
      'note_md', NEW.note_md, 'created_at', NEW.created_at, 'created_by', NEW.created_by,
      'display_role', NEW.display_role, 'display_order', NEW.display_order, 'placement_anchor', NEW.placement_anchor,
      'use_question_techniques', NEW.use_question_techniques
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_question_topics_delete AFTER DELETE ON question_topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('question_topics', json_array(OLD.question_id, OLD.topic_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'question_id', OLD.question_id, 'topic_id', OLD.topic_id, 'relation_role', OLD.relation_role,
      'note_md', OLD.note_md, 'created_at', OLD.created_at, 'created_by', OLD.created_by,
      'display_role', OLD.display_role, 'display_order', OLD.display_order, 'placement_anchor', OLD.placement_anchor,
      'use_question_techniques', OLD.use_question_techniques
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_provenance_links_insert AFTER INSERT ON provenance_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('provenance_links', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'source_id', NEW.source_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id, 'field_path', NEW.field_path,
      'locator_json', NEW.locator_json, 'evidence_kind', NEW.evidence_kind, 'verification', NEW.verification,
      'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_provenance_links_update AFTER UPDATE ON provenance_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.source_id IS NOT NEW.source_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.attempt_id IS NOT NEW.attempt_id
    OR OLD.field_path IS NOT NEW.field_path
    OR OLD.locator_json IS NOT NEW.locator_json
    OR OLD.evidence_kind IS NOT NEW.evidence_kind
    OR OLD.verification IS NOT NEW.verification
    OR OLD.created_at IS NOT NEW.created_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('provenance_links', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'source_id', OLD.source_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id, 'field_path', OLD.field_path,
      'locator_json', OLD.locator_json, 'evidence_kind', OLD.evidence_kind, 'verification', OLD.verification,
      'created_at', OLD.created_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'source_id', NEW.source_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id, 'field_path', NEW.field_path,
      'locator_json', NEW.locator_json, 'evidence_kind', NEW.evidence_kind, 'verification', NEW.verification,
      'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_provenance_links_delete AFTER DELETE ON provenance_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('provenance_links', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'source_id', OLD.source_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id, 'field_path', OLD.field_path,
      'locator_json', OLD.locator_json, 'evidence_kind', OLD.evidence_kind, 'verification', OLD.verification,
      'created_at', OLD.created_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_asset_links_insert AFTER INSERT ON asset_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('asset_links', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'asset_id', NEW.asset_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id, 'source_id', NEW.source_id,
      'revision_id', NEW.revision_id, 'role', NEW.role, 'caption', NEW.caption,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_asset_links_update AFTER UPDATE ON asset_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.asset_id IS NOT NEW.asset_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.attempt_id IS NOT NEW.attempt_id
    OR OLD.source_id IS NOT NEW.source_id
    OR OLD.revision_id IS NOT NEW.revision_id
    OR OLD.role IS NOT NEW.role
    OR OLD.caption IS NOT NEW.caption
    OR OLD.sort_order IS NOT NEW.sort_order)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('asset_links', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'asset_id', OLD.asset_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id, 'source_id', OLD.source_id,
      'revision_id', OLD.revision_id, 'role', OLD.role, 'caption', OLD.caption,
      'sort_order', OLD.sort_order
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'asset_id', NEW.asset_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'attempt_id', NEW.attempt_id, 'source_id', NEW.source_id,
      'revision_id', NEW.revision_id, 'role', NEW.role, 'caption', NEW.caption,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_asset_links_delete AFTER DELETE ON asset_links
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('asset_links', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'asset_id', OLD.asset_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'attempt_id', OLD.attempt_id, 'source_id', OLD.source_id,
      'revision_id', OLD.revision_id, 'role', OLD.role, 'caption', OLD.caption,
      'sort_order', OLD.sort_order
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_items_insert AFTER INSERT ON import_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_items', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'batch_id', NEW.batch_id, 'position', NEW.position,
      'item_key', NEW.item_key, 'external_id', NEW.external_id, 'candidate_json', NEW.candidate_json,
      'mapping_json', NEW.mapping_json, 'row_version', NEW.row_version, 'status', NEW.status,
      'approved_hash', NEW.approved_hash, 'issue_json', NEW.issue_json, 'question_id', NEW.question_id,
      'topic_id', NEW.topic_id, 'committed_version', NEW.committed_version
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_items_update AFTER UPDATE ON import_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.batch_id IS NOT NEW.batch_id
    OR OLD.position IS NOT NEW.position
    OR OLD.item_key IS NOT NEW.item_key
    OR OLD.external_id IS NOT NEW.external_id
    OR OLD.candidate_json IS NOT NEW.candidate_json
    OR OLD.mapping_json IS NOT NEW.mapping_json
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.status IS NOT NEW.status
    OR OLD.approved_hash IS NOT NEW.approved_hash
    OR OLD.issue_json IS NOT NEW.issue_json
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.committed_version IS NOT NEW.committed_version)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_items', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'batch_id', OLD.batch_id, 'position', OLD.position,
      'item_key', OLD.item_key, 'external_id', OLD.external_id, 'candidate_json', OLD.candidate_json,
      'mapping_json', OLD.mapping_json, 'row_version', OLD.row_version, 'status', OLD.status,
      'approved_hash', OLD.approved_hash, 'issue_json', OLD.issue_json, 'question_id', OLD.question_id,
      'topic_id', OLD.topic_id, 'committed_version', OLD.committed_version
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'batch_id', NEW.batch_id, 'position', NEW.position,
      'item_key', NEW.item_key, 'external_id', NEW.external_id, 'candidate_json', NEW.candidate_json,
      'mapping_json', NEW.mapping_json, 'row_version', NEW.row_version, 'status', NEW.status,
      'approved_hash', NEW.approved_hash, 'issue_json', NEW.issue_json, 'question_id', NEW.question_id,
      'topic_id', NEW.topic_id, 'committed_version', NEW.committed_version
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_items_delete AFTER DELETE ON import_items
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_items', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'batch_id', OLD.batch_id, 'position', OLD.position,
      'item_key', OLD.item_key, 'external_id', OLD.external_id, 'candidate_json', OLD.candidate_json,
      'mapping_json', OLD.mapping_json, 'row_version', OLD.row_version, 'status', OLD.status,
      'approved_hash', OLD.approved_hash, 'issue_json', OLD.issue_json, 'question_id', OLD.question_id,
      'topic_id', OLD.topic_id, 'committed_version', OLD.committed_version
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_question_refs_insert AFTER INSERT ON import_question_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_question_refs', NULL, json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'question_id', NEW.question_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_question_refs_update AFTER UPDATE ON import_question_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.owner_id IS NOT NEW.owner_id
    OR OLD.namespace IS NOT NEW.namespace
    OR OLD.external_id IS NOT NEW.external_id
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.item_id IS NOT NEW.item_id)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_question_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'question_id', OLD.question_id, 'item_id', OLD.item_id
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'question_id', NEW.question_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_question_refs_delete AFTER DELETE ON import_question_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_question_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'question_id', OLD.question_id, 'item_id', OLD.item_id
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_topic_refs_insert AFTER INSERT ON import_topic_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_topic_refs', NULL, json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'topic_id', NEW.topic_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_topic_refs_update AFTER UPDATE ON import_topic_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.owner_id IS NOT NEW.owner_id
    OR OLD.namespace IS NOT NEW.namespace
    OR OLD.external_id IS NOT NEW.external_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.item_id IS NOT NEW.item_id)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_topic_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'topic_id', OLD.topic_id, 'item_id', OLD.item_id
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'topic_id', NEW.topic_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_topic_refs_delete AFTER DELETE ON import_topic_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_topic_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'topic_id', OLD.topic_id, 'item_id', OLD.item_id
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_attempt_refs_insert AFTER INSERT ON import_attempt_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_attempt_refs', NULL, json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'attempt_id', NEW.attempt_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_attempt_refs_update AFTER UPDATE ON import_attempt_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.owner_id IS NOT NEW.owner_id
    OR OLD.namespace IS NOT NEW.namespace
    OR OLD.external_id IS NOT NEW.external_id
    OR OLD.attempt_id IS NOT NEW.attempt_id
    OR OLD.item_id IS NOT NEW.item_id)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_attempt_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), json_array(NEW.owner_id, NEW.namespace, NEW.external_id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'attempt_id', OLD.attempt_id, 'item_id', OLD.item_id
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', NEW.owner_id, 'namespace', NEW.namespace, 'external_id', NEW.external_id,
      'attempt_id', NEW.attempt_id, 'item_id', NEW.item_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_import_attempt_refs_delete AFTER DELETE ON import_attempt_refs
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('import_attempt_refs', json_array(OLD.owner_id, OLD.namespace, OLD.external_id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'owner_id', OLD.owner_id, 'namespace', OLD.namespace, 'external_id', OLD.external_id,
      'attempt_id', OLD.attempt_id, 'item_id', OLD.item_id
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_retained_import_notes_insert AFTER INSERT ON retained_import_notes
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('retained_import_notes', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'owner_id', NEW.owner_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'namespace', NEW.namespace, 'note_json', NEW.note_json,
      'source_json', NEW.source_json, 'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_retained_import_notes_update AFTER UPDATE ON retained_import_notes
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.owner_id IS NOT NEW.owner_id
    OR OLD.topic_id IS NOT NEW.topic_id
    OR OLD.question_id IS NOT NEW.question_id
    OR OLD.namespace IS NOT NEW.namespace
    OR OLD.note_json IS NOT NEW.note_json
    OR OLD.source_json IS NOT NEW.source_json
    OR OLD.created_at IS NOT NEW.created_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('retained_import_notes', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'owner_id', OLD.owner_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'namespace', OLD.namespace, 'note_json', OLD.note_json,
      'source_json', OLD.source_json, 'created_at', OLD.created_at
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'owner_id', NEW.owner_id, 'topic_id', NEW.topic_id,
      'question_id', NEW.question_id, 'namespace', NEW.namespace, 'note_json', NEW.note_json,
      'source_json', NEW.source_json, 'created_at', NEW.created_at
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_retained_import_notes_delete AFTER DELETE ON retained_import_notes
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('retained_import_notes', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'owner_id', OLD.owner_id, 'topic_id', OLD.topic_id,
      'question_id', OLD.question_id, 'namespace', OLD.namespace, 'note_json', OLD.note_json,
      'source_json', OLD.source_json, 'created_at', OLD.created_at
    ) END,
    NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_ai_reviews_insert AFTER INSERT ON ai_reviews
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('ai_reviews', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'owner_id', NEW.owner_id, 'item_id', NEW.item_id,
      'item_version', NEW.item_version, 'request_key', NEW.request_key, 'state', NEW.state,
      'settings_revision', NEW.settings_revision, 'lease_until', NEW.lease_until, 'created_at', NEW.created_at,
      'finished_at', NEW.finished_at, 'model', NEW.model, 'provider_model', NEW.provider_model,
      'duration_ms', NEW.duration_ms, 'report', NEW.report, 'reasons', NEW.reasons,
      'failure', NEW.failure, 'approved_day', NEW.approved_day, 'question_id', NEW.question_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_ai_reviews_update AFTER UPDATE ON ai_reviews
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.owner_id IS NOT NEW.owner_id
    OR OLD.item_id IS NOT NEW.item_id
    OR OLD.item_version IS NOT NEW.item_version
    OR OLD.request_key IS NOT NEW.request_key
    OR OLD.state IS NOT NEW.state
    OR OLD.settings_revision IS NOT NEW.settings_revision
    OR OLD.lease_until IS NOT NEW.lease_until
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.finished_at IS NOT NEW.finished_at
    OR OLD.model IS NOT NEW.model
    OR OLD.provider_model IS NOT NEW.provider_model
    OR OLD.duration_ms IS NOT NEW.duration_ms
    OR OLD.report IS NOT NEW.report
    OR OLD.reasons IS NOT NEW.reasons
    OR OLD.failure IS NOT NEW.failure
    OR OLD.approved_day IS NOT NEW.approved_day
    OR OLD.question_id IS NOT NEW.question_id)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('ai_reviews', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'owner_id', OLD.owner_id, 'item_id', OLD.item_id,
      'item_version', OLD.item_version, 'request_key', OLD.request_key, 'state', OLD.state,
      'settings_revision', OLD.settings_revision, 'lease_until', OLD.lease_until, 'created_at', OLD.created_at,
      'finished_at', OLD.finished_at, 'model', OLD.model, 'provider_model', OLD.provider_model,
      'duration_ms', OLD.duration_ms, 'report', OLD.report, 'reasons', OLD.reasons,
      'failure', OLD.failure, 'approved_day', OLD.approved_day, 'question_id', OLD.question_id
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'owner_id', NEW.owner_id, 'item_id', NEW.item_id,
      'item_version', NEW.item_version, 'request_key', NEW.request_key, 'state', NEW.state,
      'settings_revision', NEW.settings_revision, 'lease_until', NEW.lease_until, 'created_at', NEW.created_at,
      'finished_at', NEW.finished_at, 'model', NEW.model, 'provider_model', NEW.provider_model,
      'duration_ms', NEW.duration_ms, 'report', NEW.report, 'reasons', NEW.reasons,
      'failure', NEW.failure, 'approved_day', NEW.approved_day, 'question_id', NEW.question_id
    ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_ai_reviews_delete AFTER DELETE ON ai_reviews
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('ai_reviews', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'owner_id', OLD.owner_id, 'item_id', OLD.item_id,
      'item_version', OLD.item_version, 'request_key', OLD.request_key, 'state', OLD.state,
      'settings_revision', OLD.settings_revision, 'lease_until', OLD.lease_until, 'created_at', OLD.created_at,
      'finished_at', OLD.finished_at, 'model', OLD.model, 'provider_model', OLD.provider_model,
      'duration_ms', OLD.duration_ms, 'report', OLD.report, 'reasons', OLD.reasons,
      'failure', OLD.failure, 'approved_day', OLD.approved_day, 'question_id', OLD.question_id
    ) END,
    NULL);
END;
