ALTER TABLE releases ADD COLUMN apply_log TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN apply_log_status TEXT NOT NULL DEFAULT '';
ALTER TABLE releases ADD COLUMN apply_log_updated_at TEXT;
