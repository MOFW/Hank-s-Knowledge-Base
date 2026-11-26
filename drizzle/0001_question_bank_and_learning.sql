CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`primary_course_id` text NOT NULL,
	`title` text NOT NULL,
	`statement_md` text DEFAULT '' NOT NULL,
	`difficulty` integer,
	`source_date` text,
	`final_answer_md` text DEFAULT '' NOT NULL,
	`key_techniques_md` text DEFAULT '' NOT NULL,
	`fingerprint_version` integer DEFAULT 1 NOT NULL,
	`statement_hash` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "questions_version" CHECK("questions"."row_version" >= 1),
	CONSTRAINT "questions_origin" CHECK("questions"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "questions_extra" CHECK(json_valid("questions"."extra_json") AND json_type("questions"."extra_json") = 'object'),
	CONSTRAINT "questions_title" CHECK(length(trim("questions"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "questions_difficulty" CHECK("questions"."difficulty" IS NULL OR
    (typeof("questions"."difficulty") = 'integer' AND "questions"."difficulty" BETWEEN 1 AND 5)),
	CONSTRAINT "questions_source_date" CHECK("questions"."source_date" IS NULL OR (length("questions"."source_date") = 10 AND date("questions"."source_date", '+0 days') IS "questions"."source_date")),
	CONSTRAINT "questions_fingerprint_version" CHECK("questions"."fingerprint_version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `questions_course_updated` ON `questions` (`primary_course_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `questions_updated` ON `questions` (`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `questions_statement_hash` ON `questions` (`fingerprint_version`,`statement_hash`);
--> statement-breakpoint
CREATE TABLE `question_topics` (
	`question_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`relation_role` text DEFAULT 'uses' NOT NULL,
	`note_md` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`question_id`, `topic_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "question_topics_role" CHECK("question_topics"."relation_role" IN ('uses', 'primary', 'extension'))
);
--> statement-breakpoint
CREATE INDEX `question_topics_reverse` ON `question_topics` (`topic_id`,`question_id`);
--> statement-breakpoint
CREATE TABLE `learning_states` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mastery` text DEFAULT 'new' NOT NULL,
	`is_mistake` integer DEFAULT false NOT NULL,
	`next_review_on` text,
	`last_reviewed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "learning_states_version" CHECK("learning_states"."row_version" >= 1),
	CONSTRAINT "learning_states_origin" CHECK("learning_states"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "learning_states_extra" CHECK(json_valid("learning_states"."extra_json") AND json_type("learning_states"."extra_json") = 'object'),
	CONSTRAINT "learning_states_mastery" CHECK("learning_states"."mastery" IN ('new', 'learning', 'familiar', 'mastered')),
	CONSTRAINT "learning_states_mistake" CHECK("learning_states"."is_mistake" IN (0, 1)),
	CONSTRAINT "learning_states_next_review" CHECK("learning_states"."next_review_on" IS NULL OR (length("learning_states"."next_review_on") = 10 AND date("learning_states"."next_review_on", '+0 days') IS "learning_states"."next_review_on"))
);
--> statement-breakpoint
CREATE INDEX `learning_states_mastery_index` ON `learning_states` (`user_id`,`mastery`,`question_id`);
--> statement-breakpoint
CREATE INDEX `learning_states_next_review_index` ON `learning_states` (`user_id`,`next_review_on`,`question_id`);
--> statement-breakpoint
CREATE INDEX `learning_states_mistake_index` ON `learning_states` (`user_id`,`is_mistake`,`question_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_states_user_question` ON `learning_states` (`user_id`,`question_id`);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`external_url` text,
	`citation_text` text,
	`content_hash` text,
	`acquisition_status` text NOT NULL,
	`excerpt_md` text,
	`occurred_on` text,
	`captured_at` text NOT NULL,
	`created_by` text NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sources_kind" CHECK("sources"."kind" IN ('textbook', 'ppt', 'pdf', 'photo', 'chat', 'manual', 'other')),
	CONSTRAINT "sources_title" CHECK(length(trim("sources"."title")) > 0),
	CONSTRAINT "sources_status" CHECK("sources"."acquisition_status" IN ('available', 'partial', 'unavailable')),
	CONSTRAINT "sources_date" CHECK("sources"."occurred_on" IS NULL OR (length("sources"."occurred_on") = 10 AND date("sources"."occurred_on", '+0 days') IS "sources"."occurred_on")),
	CONSTRAINT "sources_extra" CHECK(json_valid("sources"."extra_json") AND json_type("sources"."extra_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`width` integer,
	`height` integer,
	`status` text NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "assets_size" CHECK("assets"."byte_size" >= 0),
	CONSTRAINT "assets_dimensions" CHECK(("assets"."width" IS NULL OR "assets"."width" > 0)
    AND ("assets"."height" IS NULL OR "assets"."height" > 0)),
	CONSTRAINT "assets_status" CHECK("assets"."status" IN ('pending', 'ready', 'quarantined', 'deleted')
    AND ("assets"."deleted_at" IS NOT NULL) = ("assets"."status" = 'deleted')),
	CONSTRAINT "assets_extra" CHECK(json_valid("assets"."extra_json") AND json_type("assets"."extra_json") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_storage_key_unique` ON `assets` (`storage_key`);
--> statement-breakpoint
CREATE INDEX `assets_digest` ON `assets` (`sha256`,`byte_size`);
--> statement-breakpoint
CREATE INDEX `assets_status_created` ON `assets` (`status`,`created_at`);
--> statement-breakpoint
-- Rename before adding references to the new table so foreign keys stay enabled.
ALTER TABLE content_revisions RENAME TO __catalog_content_revisions;
--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text,
	`chapter_id` text,
	`topic_id` text,
	`question_id` text,
	`attempt_id` text,
	`learning_state_id` text,
	`revision_no` integer NOT NULL,
	`snapshot_schema_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`origin` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`learning_state_id`) REFERENCES `learning_states`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "revisions_one_target" CHECK(("content_revisions"."course_id" IS NOT NULL) + ("content_revisions"."chapter_id" IS NOT NULL)
    + ("content_revisions"."topic_id" IS NOT NULL) + ("content_revisions"."question_id" IS NOT NULL) + ("content_revisions"."attempt_id" IS NOT NULL)
    + ("content_revisions"."learning_state_id" IS NOT NULL) = 1),
	CONSTRAINT "revisions_version" CHECK("content_revisions"."revision_no" >= 1 AND "content_revisions"."snapshot_schema_version" >= 1),
	CONSTRAINT "revisions_json" CHECK(json_valid("content_revisions"."snapshot_json") AND json_type("content_revisions"."snapshot_json") = 'object'),
	CONSTRAINT "revisions_origin" CHECK("content_revisions"."origin" IN ('manual', 'import', 'restore', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_question_ref` ON `content_revisions` (`id`,`question_id`);
--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`attempted_at` text,
	`original_work_md` text,
	`error_analysis_md` text,
	`correction_md` text,
	`insight_md` text,
	`outcome` text DEFAULT 'unknown' NOT NULL,
	`original_evidence_status` text DEFAULT 'missing' NOT NULL,
	`correction_author_kind` text DEFAULT 'unknown' NOT NULL,
	`source_revision_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_revision_id`,`question_id`) REFERENCES `content_revisions`(`id`,`question_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempts_version" CHECK("attempts"."row_version" >= 1),
	CONSTRAINT "attempts_origin" CHECK("attempts"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "attempts_extra" CHECK(json_valid("attempts"."extra_json") AND json_type("attempts"."extra_json") = 'object'),
	CONSTRAINT "attempts_outcome" CHECK("attempts"."outcome" IN ('unknown', 'correct', 'partial', 'incorrect')),
	CONSTRAINT "attempts_evidence_status" CHECK("attempts"."original_evidence_status" IN ('missing', 'supplied', 'user_confirmed')),
	CONSTRAINT "attempts_original_evidence" CHECK(("attempts"."original_work_md" IS NULL) = ("attempts"."original_evidence_status" = 'missing')),
	CONSTRAINT "attempts_correction_author" CHECK("attempts"."correction_author_kind" IN ('unknown', 'user', 'ai', 'mixed'))
);
--> statement-breakpoint
CREATE INDEX `attempts_question_created` ON `attempts` (`question_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `attempts_user_attempted` ON `attempts` (`user_id`,`attempted_at`);
--> statement-breakpoint
CREATE INDEX `attempts_source_revision` ON `attempts` (`source_revision_id`,`question_id`);
--> statement-breakpoint
INSERT INTO content_revisions (
  id, course_id, chapter_id, topic_id, revision_no, snapshot_schema_version,
  snapshot_json, actor_id, origin, reason, created_at
)
SELECT id, course_id, chapter_id, topic_id, revision_no, snapshot_schema_version,
  snapshot_json, actor_id, origin, reason, created_at
FROM __catalog_content_revisions;
--> statement-breakpoint
DROP TABLE __catalog_content_revisions;
--> statement-breakpoint
CREATE UNIQUE INDEX `course_revision_no` ON `content_revisions` (`course_id`,`revision_no`) WHERE "content_revisions"."course_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_revision_no` ON `content_revisions` (`chapter_id`,`revision_no`) WHERE "content_revisions"."chapter_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `topic_revision_no` ON `content_revisions` (`topic_id`,`revision_no`) WHERE "content_revisions"."topic_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `question_revision_no` ON `content_revisions` (`question_id`,`revision_no`) WHERE "content_revisions"."question_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_revision_no` ON `content_revisions` (`attempt_id`,`revision_no`) WHERE "content_revisions"."attempt_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_state_revision_no` ON `content_revisions` (`learning_state_id`,`revision_no`) WHERE "content_revisions"."learning_state_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `provenance_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`topic_id` text,
	`question_id` text,
	`attempt_id` text,
	`field_path` text NOT NULL,
	`locator_json` text DEFAULT '{}' NOT NULL,
	`evidence_kind` text NOT NULL,
	`verification` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "provenance_one_target" CHECK(("provenance_links"."topic_id" IS NOT NULL) + ("provenance_links"."question_id" IS NOT NULL)
    + ("provenance_links"."attempt_id" IS NOT NULL) = 1),
	CONSTRAINT "provenance_locator" CHECK(json_valid("provenance_links"."locator_json") AND json_type("provenance_links"."locator_json") = 'object'),
	CONSTRAINT "provenance_kind" CHECK("provenance_links"."evidence_kind" IN ('direct', 'transcription', 'ai_synthesis', 'user_confirmation')),
	CONSTRAINT "provenance_verification" CHECK("provenance_links"."verification" IN ('unverified', 'verified', 'unavailable'))
);
--> statement-breakpoint
CREATE INDEX `provenance_source` ON `provenance_links` (`source_id`);
--> statement-breakpoint
CREATE INDEX `provenance_topic` ON `provenance_links` (`topic_id`);
--> statement-breakpoint
CREATE INDEX `provenance_question` ON `provenance_links` (`question_id`,`field_path`);
--> statement-breakpoint
CREATE INDEX `provenance_attempt` ON `provenance_links` (`attempt_id`);
--> statement-breakpoint
CREATE TABLE `asset_links` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`topic_id` text,
	`question_id` text,
	`attempt_id` text,
	`source_id` text,
	`revision_id` text,
	`role` text NOT NULL,
	`caption` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `content_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "asset_links_one_target" CHECK(("asset_links"."topic_id" IS NOT NULL) + ("asset_links"."question_id" IS NOT NULL)
    + ("asset_links"."attempt_id" IS NOT NULL) + ("asset_links"."source_id" IS NOT NULL) + ("asset_links"."revision_id" IS NOT NULL) = 1),
	CONSTRAINT "asset_links_role" CHECK("asset_links"."role" IN ('original', 'inline', 'attachment', 'evidence'))
);
--> statement-breakpoint
CREATE INDEX `asset_links_asset` ON `asset_links` (`asset_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_links_topic` ON `asset_links` (`topic_id`,`asset_id`,`role`) WHERE "asset_links"."topic_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_links_question` ON `asset_links` (`question_id`,`asset_id`,`role`) WHERE "asset_links"."question_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_links_attempt` ON `asset_links` (`attempt_id`,`asset_id`,`role`) WHERE "asset_links"."attempt_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_links_source` ON `asset_links` (`source_id`,`asset_id`,`role`) WHERE "asset_links"."source_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_links_revision` ON `asset_links` (`revision_id`,`asset_id`,`role`) WHERE "asset_links"."revision_id" IS NOT NULL;
