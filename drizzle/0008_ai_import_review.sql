CREATE TABLE `ai_review_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`revision` integer NOT NULL,
	`conditional_since` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `ai_review_sources` (
	`owner_id` text NOT NULL,
	`digest` text NOT NULL,
	`witness` text NOT NULL,
	`verified_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `digest`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `ai_review_usage` (
	`run_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`cost_micros` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	PRIMARY KEY(`run_id`, `attempt`),
	FOREIGN KEY (`run_id`) REFERENCES `ai_reviews`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ai_review_usage_owner_day` ON `ai_review_usage` (`owner_id`,`day`);--> statement-breakpoint
CREATE TABLE `ai_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`item_id` text NOT NULL,
	`item_version` integer NOT NULL,
	`request_key` text NOT NULL,
	`state` text NOT NULL,
	`settings_revision` integer NOT NULL,
	`lease_until` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	`model` text,
	`provider_model` text,
	`duration_ms` integer,
	`report` text,
	`reasons` text,
	`failure` text,
	`approved_day` text,
	`question_id` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`item_id`) REFERENCES `import_items`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ai_reviews_owner_state` ON `ai_reviews` (`owner_id`,`state`,`lease_until`);--> statement-breakpoint
CREATE INDEX `ai_reviews_item_date` ON `ai_reviews` (`item_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_reviews_request` ON `ai_reviews` (`owner_id`,`item_id`,`item_version`,`request_key`);