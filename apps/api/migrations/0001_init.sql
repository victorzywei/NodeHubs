CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY NOT NULL,
  agent_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  network_type TEXT NOT NULL DEFAULT 'public',
  primary_domain TEXT NOT NULL DEFAULT '',
  backup_domain TEXT NOT NULL DEFAULT '',
  entry_ip TEXT NOT NULL DEFAULT '',
  github_mirror_url TEXT NOT NULL DEFAULT '',
  install_warp INTEGER NOT NULL DEFAULT 0,
  warp_license_key TEXT NOT NULL DEFAULT '',
  cf_dns_token TEXT NOT NULL DEFAULT '',
  argo_tunnel_token TEXT NOT NULL DEFAULT '',
  argo_tunnel_domain TEXT NOT NULL DEFAULT '',
  argo_tunnel_port INTEGER NOT NULL DEFAULT 2053,
  config_revision INTEGER NOT NULL DEFAULT 1,
  desired_release_revision INTEGER NOT NULL DEFAULT 0,
  current_release_revision INTEGER NOT NULL DEFAULT 0,
  current_release_status TEXT NOT NULL DEFAULT 'idle',
  last_seen_at TEXT,
  heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 15,
  version_pull_interval_seconds INTEGER NOT NULL DEFAULT 15,
  cpu_usage_percent REAL,
  memory_usage_percent REAL,
  bytes_in_total INTEGER NOT NULL DEFAULT 0,
  bytes_out_total INTEGER NOT NULL DEFAULT 0,
  current_connections INTEGER NOT NULL DEFAULT 0,
  warp_status TEXT NOT NULL DEFAULT '',
  warp_ipv4 TEXT NOT NULL DEFAULT '',
  warp_ipv6 TEXT NOT NULL DEFAULT '',
  warp_endpoint TEXT NOT NULL DEFAULT '',
  warp_account_type TEXT NOT NULL DEFAULT '',
  warp_tunnel_protocol TEXT NOT NULL DEFAULT '',
  warp_private_key TEXT NOT NULL DEFAULT '',
  warp_reserved_json TEXT NOT NULL DEFAULT '[]',
  argo_status TEXT NOT NULL DEFAULT '',
  argo_domain TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT '',
  sing_box_version TEXT NOT NULL DEFAULT '',
  sing_box_status TEXT NOT NULL DEFAULT '',
  xray_version TEXT NOT NULL DEFAULT '',
  xray_status TEXT NOT NULL DEFAULT '',
  storage_total_bytes INTEGER NOT NULL DEFAULT 0,
  storage_used_bytes INTEGER NOT NULL DEFAULT 0,
  storage_usage_percent REAL,
  cpu_core_count INTEGER,
  memory_total_bytes INTEGER,
  memory_used_bytes INTEGER,
  protocol_runtime_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON nodes(updated_at);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  engine TEXT NOT NULL,
  protocol TEXT NOT NULL,
  transport TEXT NOT NULL,
  tls_mode TEXT NOT NULL,
  warp_exit INTEGER NOT NULL DEFAULT 0,
  warp_route_mode TEXT NOT NULL DEFAULT 'all',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  config_revision INTEGER NOT NULL,
  template_ids_json TEXT NOT NULL DEFAULT '[]',
  artifact_key TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  apply_log TEXT NOT NULL DEFAULT '',
  apply_log_status TEXT NOT NULL DEFAULT '',
  apply_log_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_releases_node_revision ON releases(node_id, revision);
CREATE INDEX IF NOT EXISTS idx_releases_node_updated ON releases(node_id, updated_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  visible_node_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_token ON subscriptions(token);

CREATE TABLE IF NOT EXISTS traffic_samples (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  at TEXT NOT NULL,
  bytes_in_total INTEGER NOT NULL,
  bytes_out_total INTEGER NOT NULL,
  current_connections INTEGER NOT NULL,
  cpu_usage_percent REAL,
  memory_usage_percent REAL,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_traffic_node_at ON traffic_samples(node_id, at);
