ALTER TABLE nodes ADD COLUMN edge_use_github_mirror INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN edge_deploy_asset_url TEXT NOT NULL DEFAULT 'https://github.com/byJoey/cfnew/releases/latest/download/Pages.zip';
ALTER TABLE nodes ADD COLUMN edge_subscription_sources_json TEXT NOT NULL DEFAULT '[]';
