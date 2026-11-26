ALTER TABLE `question_topics` ADD COLUMN `display_role` text DEFAULT 'related' NOT NULL
  CONSTRAINT question_topics_display_role CHECK (display_role IN ('related', 'featured'));
--> statement-breakpoint
ALTER TABLE `question_topics` ADD COLUMN `display_order` integer DEFAULT 0 NOT NULL
  CONSTRAINT question_topics_display_order CHECK (typeof(display_order) = 'integer' AND display_order >= 0);
--> statement-breakpoint
ALTER TABLE `question_topics` ADD COLUMN `placement_anchor` text;
--> statement-breakpoint
ALTER TABLE `question_topics` ADD COLUMN `use_question_techniques` integer DEFAULT 0 NOT NULL
  CONSTRAINT question_topics_techniques CHECK (use_question_techniques IN (0, 1));
--> statement-breakpoint
CREATE INDEX `question_topics_display` ON `question_topics` (`topic_id`, `display_role`, `display_order`, `question_id`);
