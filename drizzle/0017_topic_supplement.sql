ALTER TABLE `topics` ADD `supplement_md` text;
--> statement-breakpoint
-- Capture the added field in the existing single-operation undo journal.
DROP TRIGGER content_undo_topics_insert;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_insert AFTER INSERT ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', NULL, json_array(NEW.id),
    NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id, 'title', NEW.title,
      'slug', NEW.slug, 'summary_md', NEW.summary_md, 'body_md', NEW.body_md, 'supplement_md', NEW.supplement_md,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
DROP TRIGGER content_undo_topics_update;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_update AFTER UPDATE ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.row_version IS NOT NEW.row_version
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.updated_at IS NOT NEW.updated_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.updated_by IS NOT NEW.updated_by
    OR OLD.last_origin IS NOT NEW.last_origin
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.deleted_at IS NOT NEW.deleted_at
    OR OLD.course_id IS NOT NEW.course_id
    OR OLD.chapter_id IS NOT NEW.chapter_id
    OR OLD.title IS NOT NEW.title
    OR OLD.slug IS NOT NEW.slug
    OR OLD.summary_md IS NOT NEW.summary_md
    OR OLD.body_md IS NOT NEW.body_md
    OR OLD.supplement_md IS NOT NEW.supplement_md
    OR OLD.sort_order IS NOT NEW.sort_order)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', json_array(OLD.id), json_array(NEW.id),
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id, 'title', OLD.title,
      'slug', OLD.slug, 'summary_md', OLD.summary_md, 'body_md', OLD.body_md, 'supplement_md', OLD.supplement_md,
      'sort_order', OLD.sort_order
    ) END,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', NEW.id, 'row_version', NEW.row_version, 'created_at', NEW.created_at,
      'updated_at', NEW.updated_at, 'created_by', NEW.created_by, 'updated_by', NEW.updated_by,
      'last_origin', NEW.last_origin, 'extra_json', NEW.extra_json, 'deleted_at', NEW.deleted_at,
      'course_id', NEW.course_id, 'chapter_id', NEW.chapter_id, 'title', NEW.title,
      'slug', NEW.slug, 'summary_md', NEW.summary_md, 'body_md', NEW.body_md, 'supplement_md', NEW.supplement_md,
      'sort_order', NEW.sort_order
    ) END);
END;
--> statement-breakpoint
DROP TRIGGER content_undo_topics_delete;
--> statement-breakpoint
CREATE TRIGGER content_undo_topics_delete AFTER DELETE ON topics
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('topics', json_array(OLD.id), NULL,
    CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
      'id', OLD.id, 'row_version', OLD.row_version, 'created_at', OLD.created_at,
      'updated_at', OLD.updated_at, 'created_by', OLD.created_by, 'updated_by', OLD.updated_by,
      'last_origin', OLD.last_origin, 'extra_json', OLD.extra_json, 'deleted_at', OLD.deleted_at,
      'course_id', OLD.course_id, 'chapter_id', OLD.chapter_id, 'title', OLD.title,
      'slug', OLD.slug, 'summary_md', OLD.summary_md, 'body_md', OLD.body_md, 'supplement_md', OLD.supplement_md,
      'sort_order', OLD.sort_order
    ) END,
    NULL);
END;
