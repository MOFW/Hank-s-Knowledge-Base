CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`course_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`parent_id`,`course_id`) REFERENCES `chapters`(`id`,`course_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "chapters_version" CHECK("chapters"."row_version" >= 1),
	CONSTRAINT "chapters_origin" CHECK("chapters"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "chapters_extra" CHECK(json_valid("chapters"."extra_json") AND json_type("chapters"."extra_json") = 'object'),
	CONSTRAINT "chapters_not_own_parent" CHECK("chapters"."parent_id" IS NULL OR "chapters"."parent_id" <> "chapters"."id"),
	CONSTRAINT "chapters_title" CHECK(length(trim("chapters"."title")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX `chapters_directory` ON `chapters` (`course_id`,`parent_id`,`sort_order`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_course_slug` ON `chapters` (`course_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_id_course` ON `chapters` (`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text,
	`chapter_id` text,
	`topic_id` text,
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
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "revisions_one_target" CHECK(("content_revisions"."course_id" IS NOT NULL) + ("content_revisions"."chapter_id" IS NOT NULL) + ("content_revisions"."topic_id" IS NOT NULL) = 1),
	CONSTRAINT "revisions_version" CHECK("content_revisions"."revision_no" >= 1 AND "content_revisions"."snapshot_schema_version" >= 1),
	CONSTRAINT "revisions_json" CHECK(json_valid("content_revisions"."snapshot_json") AND json_type("content_revisions"."snapshot_json") = 'object'),
	CONSTRAINT "revisions_origin" CHECK("content_revisions"."origin" IN ('manual', 'import', 'restore', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_revision_no` ON `content_revisions` (`course_id`,`revision_no`) WHERE "content_revisions"."course_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_revision_no` ON `content_revisions` (`chapter_id`,`revision_no`) WHERE "content_revisions"."chapter_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `topic_revision_no` ON `content_revisions` (`topic_id`,`revision_no`) WHERE "content_revisions"."topic_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "courses_version" CHECK("courses"."row_version" >= 1),
	CONSTRAINT "courses_origin" CHECK("courses"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "courses_extra" CHECK(json_valid("courses"."extra_json") AND json_type("courses"."extra_json") = 'object'),
	CONSTRAINT "courses_name" CHECK(length(trim("courses"."name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_slug_unique` ON `courses` (`slug`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_scope` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `identities_user` ON `identities` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_subject` ON `identities` (`provider`,`provider_scope`,`subject`);--> statement-breakpoint
CREATE TABLE `system_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`data_epoch` integer DEFAULT 0 NOT NULL,
	`maintenance_token` text,
	`maintenance_expires_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "system_singleton" CHECK("system_state"."id" = 1),
	CONSTRAINT "system_epoch" CHECK("system_state"."data_epoch" >= 0),
	CONSTRAINT "system_lease" CHECK(("system_state"."maintenance_token" IS NULL) = ("system_state"."maintenance_expires_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`last_origin` text DEFAULT 'manual' NOT NULL,
	`extra_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text,
	`course_id` text NOT NULL,
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
	CONSTRAINT "topics_version" CHECK("topics"."row_version" >= 1),
	CONSTRAINT "topics_origin" CHECK("topics"."last_origin" IN ('manual', 'import', 'restore', 'system')),
	CONSTRAINT "topics_extra" CHECK(json_valid("topics"."extra_json") AND json_type("topics"."extra_json") = 'object'),
	CONSTRAINT "topics_title" CHECK(length(trim("topics"."title")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX `topics_directory` ON `topics` (`course_id`,`chapter_id`,`sort_order`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `topics_course_slug` ON `topics` (`course_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `topics_id_course` ON `topics` (`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`created_at` text NOT NULL,
	`disabled_at` text,
	CONSTRAINT "users_role" CHECK("users"."role" = 'owner')
);
--> statement-breakpoint
CREATE TABLE `write_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`precondition_ok` integer NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "receipts_precondition" CHECK("write_receipts"."precondition_ok" = 1),
	CONSTRAINT "receipts_result" CHECK(json_valid("write_receipts"."result_json") AND json_type("write_receipts"."result_json") = 'object')
);
--> statement-breakpoint
CREATE INDEX `receipts_created` ON `write_receipts` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_actor_key` ON `write_receipts` (`actor_id`,`idempotency_key`);