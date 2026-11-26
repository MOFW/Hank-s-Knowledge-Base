CREATE TABLE `topic_relations` (
	`from_topic_id` text NOT NULL,
	`to_topic_id` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`from_topic_id`, `to_topic_id`),
	FOREIGN KEY (`from_topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "topic_relations_distinct" CHECK("topic_relations"."from_topic_id" <> "topic_relations"."to_topic_id")
);
--> statement-breakpoint
CREATE TABLE `__new_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`position` integer NOT NULL,
	`item_key` text NOT NULL,
	`external_id` text NOT NULL,
	`candidate_json` text NOT NULL,
	`mapping_json` text DEFAULT '{}' NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`approved_hash` text,
	`issue_json` text,
	`question_id` text,
	`topic_id` text,
	`committed_version` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_items_approval" CHECK(("__new_import_items"."approved_hash" IS NOT NULL) = ("__new_import_items"."status" IN ('approved', 'failed', 'committed'))),
	CONSTRAINT "import_items_commit" CHECK(CASE WHEN "__new_import_items"."status" = 'committed' THEN
    "__new_import_items"."committed_version" IS NOT NULL AND (
      CASE WHEN json_extract("__new_import_items"."candidate_json", '$.kind') = 'topic'
        THEN "__new_import_items"."topic_id" IS NOT NULL AND "__new_import_items"."question_id" IS NULL
        ELSE "__new_import_items"."question_id" IS NOT NULL AND "__new_import_items"."topic_id" IS NULL END)
    ELSE "__new_import_items"."committed_version" IS NULL AND "__new_import_items"."question_id" IS NULL AND "__new_import_items"."topic_id" IS NULL END)
);
--> statement-breakpoint
INSERT INTO `__new_import_items`("id", "batch_id", "position", "item_key", "external_id", "candidate_json", "mapping_json", "row_version", "status", "approved_hash", "issue_json", "question_id", "committed_version") SELECT "id", "batch_id", "position", "item_key", "external_id", "candidate_json", "mapping_json", "row_version", "status", "approved_hash", "issue_json", "question_id", "committed_version" FROM `import_items`;--> statement-breakpoint
CREATE TABLE `__saved_import_attempt_refs` AS SELECT * FROM `import_attempt_refs`;--> statement-breakpoint
DROP TABLE `import_attempt_refs`;--> statement-breakpoint
CREATE TABLE `__saved_import_question_refs` AS SELECT * FROM `import_question_refs`;--> statement-breakpoint
DROP TABLE `import_question_refs`;--> statement-breakpoint
CREATE TABLE `__saved_import_reviews` AS SELECT * FROM `import_reviews`;--> statement-breakpoint
DROP TABLE `import_reviews`;--> statement-breakpoint
DROP TABLE `import_items`;--> statement-breakpoint
ALTER TABLE `__new_import_items` RENAME TO `import_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_position` ON `import_items` (`batch_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_key` ON `import_items` (`batch_id`,`item_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_external` ON `import_items` (`batch_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `import_attempt_refs` (
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`external_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `namespace`, `external_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `import_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `import_attempt_refs` SELECT * FROM `__saved_import_attempt_refs`;--> statement-breakpoint
DROP TABLE `__saved_import_attempt_refs`;--> statement-breakpoint
CREATE TABLE `import_question_refs` (
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`external_id` text NOT NULL,
	`question_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `namespace`, `external_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `import_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `import_question_refs` SELECT * FROM `__saved_import_question_refs`;--> statement-breakpoint
DROP TABLE `__saved_import_question_refs`;--> statement-breakpoint
CREATE TABLE `import_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`item_version` integer NOT NULL,
	`action` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `import_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `import_reviews` SELECT * FROM `__saved_import_reviews`;--> statement-breakpoint
DROP TABLE `__saved_import_reviews`;--> statement-breakpoint
CREATE INDEX `import_reviews_item` ON `import_reviews` (`item_id`,`item_version`,`created_at`);
--> statement-breakpoint
CREATE TABLE `import_topic_refs` (
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`external_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `namespace`, `external_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `import_items`(`id`) ON UPDATE no action ON DELETE restrict
);
