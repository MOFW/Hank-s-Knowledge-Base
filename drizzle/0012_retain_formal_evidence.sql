CREATE TABLE `retained_import_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`topic_id` text,
	`question_id` text,
	`namespace` text NOT NULL,
	`note_json` text NOT NULL,
	`source_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "retained_import_notes_target" CHECK(("retained_import_notes"."topic_id" IS NULL) <> ("retained_import_notes"."question_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `retained_import_notes_topic` ON `retained_import_notes` (`topic_id`);--> statement-breakpoint
CREATE INDEX `retained_import_notes_question` ON `retained_import_notes` (`question_id`);