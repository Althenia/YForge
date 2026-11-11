ALTER TABLE platform_connections ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'token' CHECK (auth_method IN ('token', 'oauth'));
ALTER TABLE platform_connections ADD COLUMN oauth_client_id TEXT;
ALTER TABLE platform_connections ADD COLUMN login TEXT;
