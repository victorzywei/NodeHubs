CREATE TABLE IF NOT EXISTS panel_backend_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_base_url TEXT NOT NULL DEFAULT '',
  admin_key TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_panel_backend_profiles_sort_order
ON panel_backend_profiles (sort_order, created_at, id);
