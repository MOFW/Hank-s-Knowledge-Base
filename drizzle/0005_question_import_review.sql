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
CREATE TABLE `import_batch_keys` (
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`batch_key` text NOT NULL,
	`batch_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `namespace`, `batch_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`batch_key` text NOT NULL,
	`schema_version` text NOT NULL,
	`raw_json` text NOT NULL,
	`raw_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `import_batches_owner_created` ON `import_batches` (`owner_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_content` ON `import_batches` (`owner_id`,`namespace`,`content_hash`);--> statement-breakpoint
CREATE TABLE `import_items` (
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
	`committed_version` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_items_approval" CHECK(("import_items"."approved_hash" IS NOT NULL) = ("import_items"."status" IN ('approved', 'failed', 'committed'))),
	CONSTRAINT "import_items_commit" CHECK(("import_items"."question_id" IS NOT NULL AND "import_items"."committed_version" IS NOT NULL) = ("import_items"."status" = 'committed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_position` ON `import_items` (`batch_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_key` ON `import_items` (`batch_id`,`item_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_external` ON `import_items` (`batch_id`,`external_id`);--> statement-breakpoint
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
CREATE INDEX `import_reviews_item` ON `import_reviews` (`item_id`,`item_version`,`created_at`);