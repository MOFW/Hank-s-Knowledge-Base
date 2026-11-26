CREATE TABLE `ai_deleted_daily_usage` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`approvals` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `import_tasks` ADD `cancelled_at` text;