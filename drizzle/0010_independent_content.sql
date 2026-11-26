-- Stage dependent rows in the migration transaction before rebuilding the two parent tables.
-- Dropping a referenced table with live references leaves SQLite's deferred counter dirty.
-- Restore every row, with original IDs and constraints, before committing.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE _hkb_0010_ai_review_usage AS SELECT * FROM ai_review_usage;
--> statement-breakpoint
CREATE TABLE _hkb_0010_ai_reviews AS SELECT * FROM ai_reviews;
--> statement-breakpoint
CREATE TABLE _hkb_0010_import_reviews AS SELECT * FROM import_reviews;
--> statement-breakpoint
CREATE TABLE _hkb_0010_import_attempt_refs AS SELECT * FROM import_attempt_refs;
--> statement-breakpoint
CREATE TABLE _hkb_0010_import_question_refs AS SELECT * FROM import_question_refs;
--> statement-breakpoint
CREATE TABLE _hkb_0010_import_topic_refs AS SELECT * FROM import_topic_refs;
--> statement-breakpoint
CREATE TABLE _hkb_0010_import_items AS SELECT * FROM import_items;
--> statement-breakpoint
CREATE TABLE _hkb_0010_asset_links AS SELECT * FROM asset_links;
--> statement-breakpoint
CREATE TABLE _hkb_0010_provenance_links AS SELECT * FROM provenance_links;
--> statement-breakpoint
CREATE TABLE _hkb_0010_question_topics AS SELECT * FROM question_topics;
--> statement-breakpoint
CREATE TABLE _hkb_0010_topic_relations AS SELECT * FROM topic_relations;
--> statement-breakpoint
CREATE TABLE _hkb_0010_review_items AS SELECT * FROM review_items;
--> statement-breakpoint
CREATE TABLE _hkb_0010_attempts AS SELECT * FROM attempts;
--> statement-breakpoint
CREATE TABLE _hkb_0010_content_revisions AS SELECT * FROM content_revisions;
--> statement-breakpoint
CREATE TABLE _hkb_0010_learning_states AS SELECT * FROM learning_states;
--> statement-breakpoint
DELETE FROM ai_review_usage;
--> statement-breakpoint
DELETE FROM ai_reviews;
--> statement-breakpoint
DELETE FROM import_reviews;
--> statement-breakpoint
DELETE FROM import_attempt_refs;
--> statement-breakpoint
DELETE FROM import_question_refs;
--> statement-breakpoint
DELETE FROM import_topic_refs;
--> statement-breakpoint
DELETE FROM import_items;
--> statement-breakpoint
DELETE FROM asset_links;
--> statement-breakpoint
DELETE FROM provenance_links;
--> statement-breakpoint
DELETE FROM question_topics;
--> statement-breakpoint
DELETE FROM topic_relations;
--> statement-breakpoint
DELETE FROM review_items;
--> statement-breakpoint
DELETE FROM content_revisions WHERE attempt_id IS NOT NULL;
--> statement-breakpoint
DELETE FROM attempts;
--> statement-breakpoint
DELETE FROM content_revisions;
--> statement-breakpoint
DELETE FROM learning_states;
--> statement-breakpoint
CREATE TABLE `__new_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`primary_course_id` text,
	`title` text NOT NULL,
	`statement_md` text DEFAULT '' NOT NULL,
	`difficulty` integer,
	`source_date` text,
	`final_answer_md` text DEFAULT '' NOT NULL,
	`solution_steps_json` text DEFAULT '[]' NOT NULL,
	`solution_document_json` text,
	`key_techniques_md` text DEFAULT '' NOT NULL,
	`fingerprint_version` integer DEFAULT 1 NOT NULL,
	`statement_hash` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`primary_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "questions_version" CHECK("__new_questions"."row_version" >= 1),
	CONSTRAINT "questions_origin" CHECK("__new_questions"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "questions_extra" CHECK(json_valid("__new_questions"."extra_json") AND json_type("__new_questions"."extra_json") = 'object'),
	CONSTRAINT "questions_title" CHECK(length(trim("__new_questions"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "questions_difficulty" CHECK("__new_questions"."difficulty" IS NULL OR
    (typeof("__new_questions"."difficulty") = 'integer' AND "__new_questions"."difficulty" BETWEEN 1 AND 5)),
	CONSTRAINT "questions_source_date" CHECK("__new_questions"."source_date" IS NULL OR (length("__new_questions"."source_date") = 10 AND date("__new_questions"."source_date", '+0 days') IS "__new_questions"."source_date")),
	CONSTRAINT "questions_solution_steps" CHECK(json_valid("__new_questions"."solution_steps_json") AND json_type("__new_questions"."solution_steps_json") = 'array'),
	CONSTRAINT "questions_solution_document" CHECK("__new_questions"."solution_document_json" IS NULL OR
    (json_valid("__new_questions"."solution_document_json") AND json_type("__new_questions"."solution_document_json") = 'object')),
	CONSTRAINT "questions_fingerprint_version" CHECK("__new_questions"."fingerprint_version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_questions`("id", "row_version", "created_at", "updated_at", "created_by", "updated_by", "last_origin", "extra_json", "deleted_at", "primary_course_id", "title", "statement_md", "difficulty", "source_date", "final_answer_md", "solution_steps_json", "solution_document_json", "key_techniques_md", "fingerprint_version", "statement_hash") SELECT "id", "row_version", "created_at", "updated_at", "created_by", "updated_by", "last_origin", "extra_json", "deleted_at", "primary_course_id", "title", "statement_md", "difficulty", "source_date", "final_answer_md", "solution_steps_json", "solution_document_json", "key_techniques_md", "fingerprint_version", "statement_hash" FROM `questions`;
--> statement-breakpoint
DROP TABLE `questions`;
--> statement-breakpoint
ALTER TABLE `__new_questions` RENAME TO `questions`;
--> statement-breakpoint
CREATE INDEX `questions_course_updated` ON `questions` (`primary_course_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `questions_updated` ON `questions` (`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `questions_statement_hash` ON `questions` (`fingerprint_version`,`statement_hash`);
--> statement-breakpoint
CREATE TABLE `__new_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`course_id` text,
	`chapter_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`summary_md` text DEFAULT '' NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chapter_id`,`course_id`) REFERENCES `chapters`(`id`,`course_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "topics_version" CHECK("__new_topics"."row_version" >= 1),
	CONSTRAINT "topics_origin" CHECK("__new_topics"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "topics_extra" CHECK(json_valid("__new_topics"."extra_json") AND json_type("__new_topics"."extra_json") = 'object'),
	CONSTRAINT "topics_chapter_requires_course" CHECK("__new_topics"."chapter_id" IS NULL OR "__new_topics"."course_id" IS NOT NULL),
	CONSTRAINT "topics_title" CHECK(length(trim("__new_topics"."title")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
INSERT INTO `__new_topics`("id", "row_version", "created_at", "updated_at", "created_by", "updated_by", "last_origin", "extra_json", "deleted_at", "course_id", "chapter_id", "title", "slug", "summary_md", "body_md", "sort_order") SELECT "id", "row_version", "created_at", "updated_at", "created_by", "updated_by", "last_origin", "extra_json", "deleted_at", "course_id", "chapter_id", "title", "slug", "summary_md", "body_md", "sort_order" FROM `topics`;
--> statement-breakpoint
DROP TABLE `topics`;
--> statement-breakpoint
ALTER TABLE `__new_topics` RENAME TO `topics`;
--> statement-breakpoint
CREATE INDEX `topics_directory` ON `topics` (`course_id`,`chapter_id`,`sort_order`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_course_slug` ON `topics` (`course_id`,`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_id_course` ON `topics` (`id`,`course_id`);
--> statement-breakpoint
INSERT INTO learning_states SELECT * FROM _hkb_0010_learning_states;
--> statement-breakpoint
INSERT INTO content_revisions SELECT * FROM _hkb_0010_content_revisions;
--> statement-breakpoint
INSERT INTO attempts SELECT * FROM _hkb_0010_attempts;
--> statement-breakpoint
INSERT INTO review_items SELECT * FROM _hkb_0010_review_items;
--> statement-breakpoint
INSERT INTO topic_relations SELECT * FROM _hkb_0010_topic_relations;
--> statement-breakpoint
INSERT INTO question_topics SELECT * FROM _hkb_0010_question_topics;
--> statement-breakpoint
INSERT INTO provenance_links SELECT * FROM _hkb_0010_provenance_links;
--> statement-breakpoint
INSERT INTO asset_links SELECT * FROM _hkb_0010_asset_links;
--> statement-breakpoint
INSERT INTO import_items SELECT * FROM _hkb_0010_import_items;
--> statement-breakpoint
INSERT INTO import_topic_refs SELECT * FROM _hkb_0010_import_topic_refs;
--> statement-breakpoint
INSERT INTO import_question_refs SELECT * FROM _hkb_0010_import_question_refs;
--> statement-breakpoint
INSERT INTO import_attempt_refs SELECT * FROM _hkb_0010_import_attempt_refs;
--> statement-breakpoint
INSERT INTO import_reviews SELECT * FROM _hkb_0010_import_reviews;
--> statement-breakpoint
INSERT INTO ai_reviews SELECT * FROM _hkb_0010_ai_reviews;
--> statement-breakpoint
INSERT INTO ai_review_usage SELECT * FROM _hkb_0010_ai_review_usage;
--> statement-breakpoint
DROP TABLE _hkb_0010_ai_review_usage;
--> statement-breakpoint
DROP TABLE _hkb_0010_ai_reviews;
--> statement-breakpoint
DROP TABLE _hkb_0010_import_reviews;
--> statement-breakpoint
DROP TABLE _hkb_0010_import_attempt_refs;
--> statement-breakpoint
DROP TABLE _hkb_0010_import_question_refs;
--> statement-breakpoint
DROP TABLE _hkb_0010_import_topic_refs;
--> statement-breakpoint
DROP TABLE _hkb_0010_import_items;
--> statement-breakpoint
DROP TABLE _hkb_0010_asset_links;
--> statement-breakpoint
DROP TABLE _hkb_0010_provenance_links;
--> statement-breakpoint
DROP TABLE _hkb_0010_question_topics;
--> statement-breakpoint
DROP TABLE _hkb_0010_topic_relations;
--> statement-breakpoint
DROP TABLE _hkb_0010_review_items;
--> statement-breakpoint
DROP TABLE _hkb_0010_attempts;
--> statement-breakpoint
DROP TABLE _hkb_0010_content_revisions;
--> statement-breakpoint
DROP TABLE _hkb_0010_learning_states;
