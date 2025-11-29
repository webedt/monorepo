-- Add Codex authentication and preferred provider columns for multi-provider support

-- Add codex_auth JSON column to store OpenAI/Codex credentials
ALTER TABLE users ADD COLUMN IF NOT EXISTS codex_auth jsonb;

-- Add preferred_provider column with default 'claude'
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_provider text DEFAULT 'claude' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.codex_auth IS 'OpenAI Codex credentials: { apiKey?, accessToken?, refreshToken?, expiresAt? }';
COMMENT ON COLUMN users.preferred_provider IS 'User preferred AI provider: claude or codex';
