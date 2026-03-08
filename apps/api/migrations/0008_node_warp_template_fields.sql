ALTER TABLE nodes ADD COLUMN warp_peer_public_key TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN warp_system_interface INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN warp_local_address_ipv4 TEXT NOT NULL DEFAULT '';
