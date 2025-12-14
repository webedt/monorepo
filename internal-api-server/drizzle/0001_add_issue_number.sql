-- Add issue_number column to chat_sessions table
-- This links chat sessions to their corresponding GitHub issues for cleanup when issues are closed

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "issue_number" integer;

-- Create index for faster lookups by issue number
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_issue_number" ON "chat_sessions" ("issue_number");

-- Create composite index for issue cleanup queries
CREATE INDEX IF NOT EXISTS "idx_chat_sessions_issue_repo" ON "chat_sessions" ("issue_number", "repository_owner", "repository_name");
