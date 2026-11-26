CREATE TABLE `import_task_checkpoints` (
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`unit_id` text NOT NULL,
	`event_json` text NOT NULL,
	`batch_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`task_id`, `version`),
	FOREIGN KEY (`task_id`) REFERENCES `import_tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_task_checkpoint_batch" CHECK((json_extract("import_task_checkpoints"."event_json", '$.type') = 'submitted') = ("import_task_checkpoints"."batch_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `import_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scope_json` text NOT NULL,
	`row_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `import_tasks_owner_updated` ON `import_tasks` (`owner_id`,`updated_at`,`id`);