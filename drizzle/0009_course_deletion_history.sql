CREATE TABLE `course_deletions` (
	`course_id` text PRIMARY KEY NOT NULL,
	`destination_id` text,
	`snapshot_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `deleted_course_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`revision_no` integer NOT NULL,
	`snapshot_schema_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`actor_id` text NOT NULL,
	`origin` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `course_deletions`(`course_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deleted_course_revision_no` ON `deleted_course_revisions` (`course_id`,`revision_no`);