ALTER TABLE nodes ADD COLUMN heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 15;
ALTER TABLE nodes ADD COLUMN version_pull_interval_seconds INTEGER NOT NULL DEFAULT 15;
