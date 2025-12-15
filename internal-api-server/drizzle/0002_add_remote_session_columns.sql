-- Add remote session columns to chat_sessions table
-- These columns support Claude Remote Sessions feature

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "remote_session_id" text;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "remote_web_url" text;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "total_cost" text;
