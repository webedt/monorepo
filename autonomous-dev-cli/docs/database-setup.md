# Database Setup Guide

This guide explains how to set up PostgreSQL database integration for the Autonomous Dev CLI.

## Overview

The CLI can optionally use a PostgreSQL database to:
- Store and retrieve GitHub access tokens
- Store and retrieve Claude API credentials
- Share credentials across multiple services or instances
- Track execution history (if enabled)

**Note**: Database integration is optional. You can also use environment variables directly for credentials.

## Prerequisites

- PostgreSQL 12 or higher
- `psql` command-line tool (for setup)
- Network access to the database from where you run the CLI

## Database Schema

The CLI expects a `users` table with the following structure:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  github_id TEXT UNIQUE,
  github_access_token TEXT,
  claude_auth JSONB,
  codex_auth JSONB,
  gemini_auth JSONB,
  openrouter_api_key TEXT,
  autocomplete_enabled BOOLEAN DEFAULT true NOT NULL,
  autocomplete_model TEXT DEFAULT 'openai/gpt-oss-120b:cerebras',
  image_ai_keys JSONB,
  image_ai_provider TEXT DEFAULT 'openrouter',
  image_ai_model TEXT DEFAULT 'google/gemini-2.5-flash-image',
  preferred_provider TEXT DEFAULT 'claude' NOT NULL,
  image_resize_max_dimension INTEGER DEFAULT 1024 NOT NULL,
  voice_command_keywords JSONB DEFAULT '[]',
  stop_listening_after_submit BOOLEAN DEFAULT false NOT NULL,
  default_landing_page TEXT DEFAULT 'store' NOT NULL,
  preferred_model TEXT,
  chat_verbosity_level TEXT DEFAULT 'verbose' NOT NULL,
  is_admin BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

### Minimal Schema

If you're setting up a new database just for the CLI, you only need these columns:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  github_access_token TEXT,
  claude_auth JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

## Credential Formats

### GitHub Access Token

The `github_access_token` column stores the GitHub personal access token as plain text:

```sql
UPDATE users
SET github_access_token = 'ghp_xxxxxxxxxxxxxxxxxxxx'
WHERE email = 'your.email@example.com';
```

### Claude Authentication

The `claude_auth` column stores a JSON object with the following structure:

```json
{
  "accessToken": "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "sk-ant-ort01-xxxxxxxxxxxxxxxxxxxx",
  "expiresAt": 1234567890,
  "scopes": ["read", "write"],
  "subscriptionType": "pro",
  "rateLimitTier": "tier-1"
}
```

Required fields:
- `accessToken`: The main API access token
- `refreshToken`: Token for refreshing access
- `expiresAt`: Unix timestamp (seconds) when the access token expires

Optional fields:
- `scopes`: Array of authorized scopes
- `subscriptionType`: Type of Claude subscription
- `rateLimitTier`: Rate limiting tier

Example SQL update:

```sql
UPDATE users
SET claude_auth = '{
  "accessToken": "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxx",
  "refreshToken": "sk-ant-ort01-xxxxxxxxxxxxxxxxxxxx",
  "expiresAt": 1735689600
}'::jsonb
WHERE email = 'your.email@example.com';
```

## Connection Configuration

### Environment Variable

Set the `DATABASE_URL` environment variable with your connection string:

```bash
# Basic connection
DATABASE_URL=postgresql://username:password@hostname:5432/database_name

# With SSL (required for most cloud providers)
DATABASE_URL=postgresql://username:password@hostname:5432/database_name?sslmode=require

# With connection options
DATABASE_URL=postgresql://username:password@hostname:5432/database_name?sslmode=require&connect_timeout=10
```

### Connection String Format

```
postgresql://[user]:[password]@[host]:[port]/[database]?[options]
```

- **user**: Database username
- **password**: Database password (URL-encoded if contains special characters)
- **host**: Database hostname or IP address
- **port**: Database port (default: 5432)
- **database**: Database name
- **options**: Additional connection options

### SSL Configuration

For cloud-hosted databases, you typically need SSL:

```bash
# Accept any certificate (development only)
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require

# Full SSL verification (production)
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=verify-full&sslrootcert=/path/to/ca.crt
```

## Creating a User

To add a user to the database:

```sql
-- Generate a UUID for the user ID
INSERT INTO users (id, email, password_hash, github_access_token, claude_auth)
VALUES (
  gen_random_uuid()::text,
  'your.email@example.com',
  'placeholder-not-used-by-cli',
  'ghp_your_github_token',
  '{
    "accessToken": "sk-ant-oat01-your-access-token",
    "refreshToken": "sk-ant-ort01-your-refresh-token",
    "expiresAt": 1735689600
  }'::jsonb
);
```

## Updating Credentials

### Update GitHub Token

```sql
UPDATE users
SET github_access_token = 'ghp_new_token_here'
WHERE email = 'your.email@example.com';
```

### Update Claude Credentials

```sql
UPDATE users
SET claude_auth = '{
  "accessToken": "sk-ant-oat01-new-access-token",
  "refreshToken": "sk-ant-ort01-new-refresh-token",
  "expiresAt": 1767225600
}'::jsonb
WHERE email = 'your.email@example.com';
```

### Verify Credentials

```sql
SELECT
  email,
  github_access_token IS NOT NULL as has_github_token,
  claude_auth IS NOT NULL as has_claude_auth,
  claude_auth->>'expiresAt' as claude_expires_at
FROM users
WHERE email = 'your.email@example.com';
```

## CLI Configuration

Once the database is set up, configure the CLI to use it:

### Using Environment Variables

```bash
# Database connection
export DATABASE_URL=postgresql://user:password@localhost:5432/webedt

# User email for credential lookup
export USER_EMAIL=your.email@example.com
```

### Using Configuration File

```json
{
  "credentials": {
    "databaseUrl": "postgresql://user:password@localhost:5432/webedt",
    "userEmail": "your.email@example.com"
  }
}
```

## How Credential Lookup Works

When the CLI starts:

1. Checks if `DATABASE_URL` and `USER_EMAIL` are configured
2. If yes, connects to the database
3. Looks up the user by email address
4. Retrieves `github_access_token` and `claude_auth` from the user record
5. Uses these credentials for GitHub API and Claude API calls

If credentials are also set via environment variables (`GITHUB_TOKEN`, `CLAUDE_ACCESS_TOKEN`), the environment variables take precedence over database values.

## Troubleshooting

### "User not found in database"

The email address doesn't match any user:

```sql
-- Check if user exists
SELECT email FROM users WHERE email LIKE '%your.email%';

-- List all users
SELECT email FROM users;
```

### Connection Refused

Check that:
1. PostgreSQL is running
2. The host/port are correct
3. Network/firewall allows the connection
4. The database exists

```bash
# Test connection
psql "$DATABASE_URL" -c "SELECT 1"
```

### SSL Certificate Error

For development, use `sslmode=require` instead of `sslmode=verify-full`:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

### Invalid Credentials in Database

Check the format of stored credentials:

```sql
SELECT
  claude_auth,
  jsonb_typeof(claude_auth) as type
FROM users
WHERE email = 'your.email@example.com';
```

The `claude_auth` should be a valid JSON object with `accessToken` and `refreshToken` keys.

## Security Considerations

1. **Never commit credentials** to version control
2. **Use SSL** for database connections in production
3. **Limit database user permissions** to only what's needed:
   ```sql
   GRANT SELECT ON users TO autonomous_dev_user;
   ```
4. **Rotate tokens regularly** and update the database
5. **Use environment variables** for credentials when possible instead of config files

---

*Documentation last updated: December 14, 2025*
