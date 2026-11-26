ALTER TABLE `questions` ADD COLUMN `solution_document_json` text
  CONSTRAINT "questions_solution_document" CHECK(`solution_document_json` IS NULL OR
    (json_valid(`solution_document_json`) AND json_type(`solution_document_json`) = 'object'));
