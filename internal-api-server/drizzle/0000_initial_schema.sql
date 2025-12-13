-- Initial schema migration
-- Creates all required tables for the internal-api-server

-- Users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL UNIQUE,
  "display_name" text,
  "password_hash" text NOT NULL,
  "github_id" text UNIQUE,
  "github_access_token" text,
  "claude_auth" jsonb,
  "codex_auth" jsonb,
  "gemini_auth" jsonb,
  "openrouter_api_key" text,
  "autocomplete_enabled" boolean DEFAULT true NOT NULL,
  "autocomplete_model" text DEFAULT 'openai/gpt-oss-120b:cerebras',
  "image_ai_keys" jsonb,
  "image_ai_provider" text DEFAULT 'openrouter',
  "image_ai_model" text DEFAULT 'google/gemini-2.5-flash-image',
  "preferred_provider" text DEFAULT 'claude' NOT NULL,
  "image_resize_max_dimension" integer DEFAULT 1024 NOT NULL,
  "voice_command_keywords" jsonb DEFAULT '[]'::jsonb,
  "stop_listening_after_submit" boolean DEFAULT false NOT NULL,
  "default_landing_page" text DEFAULT 'store' NOT NULL,
  "preferred_model" text,
  "chat_verbosity_level" text DEFAULT 'verbose' NOT NULL,
  "is_admin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Sessions table (for Lucia auth)
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamp with time zone NOT NULL
);

-- Chat sessions table
CREATE TABLE IF NOT EXISTS "chat_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_path" text UNIQUE,
  "repository_owner" text,
  "repository_name" text,
  "user_request" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "repository_url" text,
  "base_branch" text,
  "branch" text,
  "provider" text DEFAULT 'claude',
  "provider_session_id" text,
  "auto_commit" boolean DEFAULT false NOT NULL,
  "locked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "deleted_at" timestamp,
  "worker_last_activity" timestamp
);

-- Messages table
CREATE TABLE IF NOT EXISTS "messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_session_id" text NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "content" text NOT NULL,
  "images" jsonb,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

-- Events table (SSE event storage)
CREATE TABLE IF NOT EXISTS "events" (
  "id" serial PRIMARY KEY NOT NULL,
  "chat_session_id" text NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "event_data" jsonb NOT NULL,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_user_id" ON "chat_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_status" ON "chat_sessions" ("status");
CREATE INDEX IF NOT EXISTS "idx_messages_chat_session_id" ON "messages" ("chat_session_id");
CREATE INDEX IF NOT EXISTS "idx_events_chat_session_id" ON "events" ("chat_session_id");
CREATE INDEX IF NOT EXISTS "idx_events_timestamp" ON "events" ("timestamp");
