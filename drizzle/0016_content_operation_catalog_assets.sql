-- Extend the existing undo journal to catalog and attachment operations.
CREATE TRIGGER content_undo_courses_insert AFTER INSERT ON courses
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('courses', NULL, json_array(NEW.id),
  NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'row_version', NEW.row_version,
    'created_at', NEW.created_at,
    'updated_at', NEW.updated_at,
    'created_by', NEW.created_by,
    'updated_by', NEW.updated_by,
    'last_origin', NEW.last_origin,
    'extra_json', NEW.extra_json,
    'deleted_at', NEW.deleted_at,
    'name', NEW.name,
    'slug', NEW.slug,
    'description_md', NEW.description_md,
    'sort_order', NEW.sort_order,
    'archived_at', NEW.archived_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_courses_update AFTER UPDATE ON courses
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
    OR OLD.name IS NOT NEW.name
    OR OLD.slug IS NOT NEW.slug
    OR OLD.description_md IS NOT NEW.description_md
    OR OLD.sort_order IS NOT NEW.sort_order
    OR OLD.archived_at IS NOT NEW.archived_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('courses', json_array(OLD.id), json_array(NEW.id),
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'row_version', OLD.row_version,
    'created_at', OLD.created_at,
    'updated_at', OLD.updated_at,
    'created_by', OLD.created_by,
    'updated_by', OLD.updated_by,
    'last_origin', OLD.last_origin,
    'extra_json', OLD.extra_json,
    'deleted_at', OLD.deleted_at,
    'name', OLD.name,
    'slug', OLD.slug,
    'description_md', OLD.description_md,
    'sort_order', OLD.sort_order,
    'archived_at', OLD.archived_at
  ) END,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'row_version', NEW.row_version,
    'created_at', NEW.created_at,
    'updated_at', NEW.updated_at,
    'created_by', NEW.created_by,
    'updated_by', NEW.updated_by,
    'last_origin', NEW.last_origin,
    'extra_json', NEW.extra_json,
    'deleted_at', NEW.deleted_at,
    'name', NEW.name,
    'slug', NEW.slug,
    'description_md', NEW.description_md,
    'sort_order', NEW.sort_order,
    'archived_at', NEW.archived_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_courses_delete AFTER DELETE ON courses
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('courses', json_array(OLD.id), NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'row_version', OLD.row_version,
    'created_at', OLD.created_at,
    'updated_at', OLD.updated_at,
    'created_by', OLD.created_by,
    'updated_by', OLD.updated_by,
    'last_origin', OLD.last_origin,
    'extra_json', OLD.extra_json,
    'deleted_at', OLD.deleted_at,
    'name', OLD.name,
    'slug', OLD.slug,
    'description_md', OLD.description_md,
    'sort_order', OLD.sort_order,
    'archived_at', OLD.archived_at
  ) END,
  NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_chapters_insert AFTER INSERT ON chapters
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('chapters', NULL, json_array(NEW.id),
  NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'row_version', NEW.row_version,
    'created_at', NEW.created_at,
    'updated_at', NEW.updated_at,
    'created_by', NEW.created_by,
    'updated_by', NEW.updated_by,
    'last_origin', NEW.last_origin,
    'extra_json', NEW.extra_json,
    'deleted_at', NEW.deleted_at,
    'course_id', NEW.course_id,
    'parent_id', NEW.parent_id,
    'title', NEW.title,
    'slug', NEW.slug,
    'sort_order', NEW.sort_order,
    'description_md', NEW.description_md
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_chapters_update AFTER UPDATE ON chapters
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
    OR OLD.parent_id IS NOT NEW.parent_id
    OR OLD.title IS NOT NEW.title
    OR OLD.slug IS NOT NEW.slug
    OR OLD.sort_order IS NOT NEW.sort_order
    OR OLD.description_md IS NOT NEW.description_md)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('chapters', json_array(OLD.id), json_array(NEW.id),
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'row_version', OLD.row_version,
    'created_at', OLD.created_at,
    'updated_at', OLD.updated_at,
    'created_by', OLD.created_by,
    'updated_by', OLD.updated_by,
    'last_origin', OLD.last_origin,
    'extra_json', OLD.extra_json,
    'deleted_at', OLD.deleted_at,
    'course_id', OLD.course_id,
    'parent_id', OLD.parent_id,
    'title', OLD.title,
    'slug', OLD.slug,
    'sort_order', OLD.sort_order,
    'description_md', OLD.description_md
  ) END,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'row_version', NEW.row_version,
    'created_at', NEW.created_at,
    'updated_at', NEW.updated_at,
    'created_by', NEW.created_by,
    'updated_by', NEW.updated_by,
    'last_origin', NEW.last_origin,
    'extra_json', NEW.extra_json,
    'deleted_at', NEW.deleted_at,
    'course_id', NEW.course_id,
    'parent_id', NEW.parent_id,
    'title', NEW.title,
    'slug', NEW.slug,
    'sort_order', NEW.sort_order,
    'description_md', NEW.description_md
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_chapters_delete AFTER DELETE ON chapters
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('chapters', json_array(OLD.id), NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'row_version', OLD.row_version,
    'created_at', OLD.created_at,
    'updated_at', OLD.updated_at,
    'created_by', OLD.created_by,
    'updated_by', OLD.updated_by,
    'last_origin', OLD.last_origin,
    'extra_json', OLD.extra_json,
    'deleted_at', OLD.deleted_at,
    'course_id', OLD.course_id,
    'parent_id', OLD.parent_id,
    'title', OLD.title,
    'slug', OLD.slug,
    'sort_order', OLD.sort_order,
    'description_md', OLD.description_md
  ) END,
  NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_course_deletions_insert AFTER INSERT ON course_deletions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('course_deletions', NULL, json_array(NEW.course_id),
  NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'course_id', NEW.course_id,
    'destination_id', NEW.destination_id,
    'snapshot_json', NEW.snapshot_json,
    'actor_id', NEW.actor_id,
    'deleted_at', NEW.deleted_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_course_deletions_update AFTER UPDATE ON course_deletions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.course_id IS NOT NEW.course_id
    OR OLD.destination_id IS NOT NEW.destination_id
    OR OLD.snapshot_json IS NOT NEW.snapshot_json
    OR OLD.actor_id IS NOT NEW.actor_id
    OR OLD.deleted_at IS NOT NEW.deleted_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('course_deletions', json_array(OLD.course_id), json_array(NEW.course_id),
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'course_id', OLD.course_id,
    'destination_id', OLD.destination_id,
    'snapshot_json', OLD.snapshot_json,
    'actor_id', OLD.actor_id,
    'deleted_at', OLD.deleted_at
  ) END,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'course_id', NEW.course_id,
    'destination_id', NEW.destination_id,
    'snapshot_json', NEW.snapshot_json,
    'actor_id', NEW.actor_id,
    'deleted_at', NEW.deleted_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_course_deletions_delete AFTER DELETE ON course_deletions
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('course_deletions', json_array(OLD.course_id), NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'course_id', OLD.course_id,
    'destination_id', OLD.destination_id,
    'snapshot_json', OLD.snapshot_json,
    'actor_id', OLD.actor_id,
    'deleted_at', OLD.deleted_at
  ) END,
  NULL);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_assets_insert AFTER INSERT ON assets
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('assets', NULL, json_array(NEW.id),
  NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'storage_key', NEW.storage_key,
    'sha256', NEW.sha256,
    'byte_size', NEW.byte_size,
    'mime_type', NEW.mime_type,
    'original_filename', NEW.original_filename,
    'width', NEW.width,
    'height', NEW.height,
    'status', NEW.status,
    'extra_json', NEW.extra_json,
    'created_at', NEW.created_at,
    'created_by', NEW.created_by,
    'deleted_at', NEW.deleted_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_assets_update AFTER UPDATE ON assets
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
  AND (OLD.id IS NOT NEW.id
    OR OLD.storage_key IS NOT NEW.storage_key
    OR OLD.sha256 IS NOT NEW.sha256
    OR OLD.byte_size IS NOT NEW.byte_size
    OR OLD.mime_type IS NOT NEW.mime_type
    OR OLD.original_filename IS NOT NEW.original_filename
    OR OLD.width IS NOT NEW.width
    OR OLD.height IS NOT NEW.height
    OR OLD.status IS NOT NEW.status
    OR OLD.extra_json IS NOT NEW.extra_json
    OR OLD.created_at IS NOT NEW.created_at
    OR OLD.created_by IS NOT NEW.created_by
    OR OLD.deleted_at IS NOT NEW.deleted_at)
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('assets', json_array(OLD.id), json_array(NEW.id),
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'storage_key', OLD.storage_key,
    'sha256', OLD.sha256,
    'byte_size', OLD.byte_size,
    'mime_type', OLD.mime_type,
    'original_filename', OLD.original_filename,
    'width', OLD.width,
    'height', OLD.height,
    'status', OLD.status,
    'extra_json', OLD.extra_json,
    'created_at', OLD.created_at,
    'created_by', OLD.created_by,
    'deleted_at', OLD.deleted_at
  ) END,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', NEW.id,
    'storage_key', NEW.storage_key,
    'sha256', NEW.sha256,
    'byte_size', NEW.byte_size,
    'mime_type', NEW.mime_type,
    'original_filename', NEW.original_filename,
    'width', NEW.width,
    'height', NEW.height,
    'status', NEW.status,
    'extra_json', NEW.extra_json,
    'created_at', NEW.created_at,
    'created_by', NEW.created_by,
    'deleted_at', NEW.deleted_at
  ) END);
END;
--> statement-breakpoint
CREATE TRIGGER content_undo_assets_delete AFTER DELETE ON assets
WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1 OR (phase = 0 AND conflicted = 0))
BEGIN
  INSERT INTO content_undo_events (table_name, old_key, new_key, old_row, new_row)
  VALUES ('assets', json_array(OLD.id), NULL,
  CASE WHEN EXISTS (SELECT 1 FROM content_undo_slots WHERE phase = 1) THEN json_object(
    'id', OLD.id,
    'storage_key', OLD.storage_key,
    'sha256', OLD.sha256,
    'byte_size', OLD.byte_size,
    'mime_type', OLD.mime_type,
    'original_filename', OLD.original_filename,
    'width', OLD.width,
    'height', OLD.height,
    'status', OLD.status,
    'extra_json', OLD.extra_json,
    'created_at', OLD.created_at,
    'created_by', OLD.created_by,
    'deleted_at', OLD.deleted_at
  ) END,
  NULL);
END;
