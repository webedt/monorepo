-- Add workspace tables for Live Chat and Collaborative Layer
-- Supports branch-based chat and real-time collaboration features

-- Live Chat messages table (branch-based chat)
CREATE TABLE IF NOT EXISTS "live_chat_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "branch" text NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "tool_calls" jsonb,
  "images" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Workspace presence table (ephemeral UPSERT)
CREATE TABLE IF NOT EXISTS "workspace_presence" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "branch" text NOT NULL,
  "page" text,
  "cursor_x" integer,
  "cursor_y" integer,
  "selection" jsonb,
  "heartbeat_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Workspace events table (append-only log)
CREATE TABLE IF NOT EXISTS "workspace_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "owner" text NOT NULL,
  "repo" text NOT NULL,
  "branch" text NOT NULL,
  "event_type" text NOT NULL,
  "page" text,
  "path" text,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_branch ON live_chat_messages(owner, repo, branch);
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_user ON live_chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_created ON live_chat_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_workspace_presence_branch ON workspace_presence(owner, repo, branch);
CREATE INDEX IF NOT EXISTS idx_workspace_presence_heartbeat ON workspace_presence(heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_workspace_events_branch ON workspace_events(owner, repo, branch);
CREATE INDEX IF NOT EXISTS idx_workspace_events_created ON workspace_events(created_at);
CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
