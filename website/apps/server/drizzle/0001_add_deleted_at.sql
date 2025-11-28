-- Add deletedAt column to chat_sessions table for soft deletes
ALTER TABLE chat_sessions ADD COLUMN deleted_at timestamp;
