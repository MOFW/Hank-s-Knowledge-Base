CREATE TABLE `review_items` (
	`session_id` text NOT NULL,
	`position` integer NOT NULL,
	`question_id` text NOT NULL,
	`draft_md` text DEFAULT '' NOT NULL,
	`used_hint` integer DEFAULT false NOT NULL,
	`answer_mode` text,
	`outcome` text,
	`resolved_at` text,
	PRIMARY KEY(`session_id`, `position`),
	FOREIGN KEY (`session_id`) REFERENCES `review_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_item_position" CHECK("review_items"."position" >= 1),
	CONSTRAINT "review_item_hint" CHECK("review_items"."used_hint" IN (0, 1)),
	CONSTRAINT "review_item_answer_mode" CHECK("review_items"."answer_mode" IN ('check', 'peek')),
	CONSTRAINT "review_item_outcome" CHECK("review_items"."outcome" IN ('independent', 'assisted', 'practice', 'skipped', 'unavailable')),
	CONSTRAINT "review_item_resolution" CHECK(("review_items"."resolved_at" IS NULL) = ("review_items"."outcome" IS NULL)
    AND ("review_items"."outcome" NOT IN ('independent', 'assisted', 'practice') OR "review_items"."answer_mode" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_item_question` ON `review_items` (`session_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `review_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`total` integer NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_session_status" CHECK("review_sessions"."status" IN ('active', 'paused', 'completed', 'ended')),
	CONSTRAINT "review_session_position" CHECK("review_sessions"."position" BETWEEN 1 AND "review_sessions"."total" AND "review_sessions"."row_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_one_open_session` ON `review_sessions` (`user_id`) WHERE "review_sessions"."status" IN ('active', 'paused');--> statement-breakpoint
CREATE INDEX `review_sessions_user_updated` ON `review_sessions` (`user_id`,`updated_at`);