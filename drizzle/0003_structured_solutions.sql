ALTER TABLE `questions` ADD COLUMN `solution_steps_json` text DEFAULT '[]' NOT NULL
  CONSTRAINT "questions_solution_steps" CHECK(json_valid(`solution_steps_json`) AND json_type(`solution_steps_json`) = 'array');
