-- Add new node fields for network type, WARP license, GitHub mirror, Argo tunnel, CF DNS token
ALTER TABLE nodes ADD COLUMN network_type TEXT NOT NULL DEFAULT 'public';
ALTER TABLE nodes ADD COLUMN github_mirror_url TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN warp_license_key TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN cf_dns_token TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN argo_tunnel_token TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN argo_tunnel_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN argo_tunnel_port INTEGER NOT NULL DEFAULT 2053;
