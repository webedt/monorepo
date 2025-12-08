/**
 * Database Configuration - PostgreSQL Only
 *
 * Note: SQLite support was removed to simplify builds and avoid native compilation issues.
 * See SQLITE_REMOVED.md in this directory for instructions on reintroducing SQLite if needed.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

// Require DATABASE_URL for PostgreSQL connection
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. PostgreSQL is the only supported database.');
}

console.log('Connecting to PostgreSQL database...');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Only use SSL if explicitly required in the connection string
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema, logger: process.env.NODE_ENV === 'development' });

// Re-export schema tables
export const { users, sessions, chatSessions, messages, events } = schema;

// Create PostgreSQL tables if they don't exist
console.log('Creating PostgreSQL tables...');
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    github_id TEXT UNIQUE,
    github_access_token TEXT,
    claude_auth JSONB,
    codex_auth JSONB,
    gemini_auth JSONB,
    preferred_provider TEXT NOT NULL DEFAULT 'claude',
    image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024,
    voice_command_keywords JSONB DEFAULT '[]'::jsonb,
    default_landing_page TEXT NOT NULL DEFAULT 'store',
    preferred_model TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_path TEXT UNIQUE,
    repository_owner TEXT,
    repository_name TEXT,
    user_request TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    repository_url TEXT,
    base_branch TEXT,
    branch TEXT,
    provider TEXT DEFAULT 'claude',
    provider_session_id TEXT,
    auto_commit BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    deleted_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    images JSONB,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
  );
`).then(() => {
  console.log('PostgreSQL tables created successfully!');
  // Run migrations for new columns
  return pool.query(`
    DO $$
    BEGIN
      -- Add columns if they don't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'codex_auth') THEN
        ALTER TABLE users ADD COLUMN codex_auth JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'preferred_provider') THEN
        ALTER TABLE users ADD COLUMN preferred_provider TEXT NOT NULL DEFAULT 'claude';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'locked') THEN
        ALTER TABLE chat_sessions ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'base_branch') THEN
        ALTER TABLE chat_sessions ADD COLUMN base_branch TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'deleted_at') THEN
        ALTER TABLE chat_sessions ADD COLUMN deleted_at TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'images') THEN
        ALTER TABLE messages ADD COLUMN images JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'worker_last_activity') THEN
        ALTER TABLE chat_sessions ADD COLUMN worker_last_activity TIMESTAMP;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'provider_session_id') THEN
        ALTER TABLE chat_sessions ADD COLUMN provider_session_id TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'stop_listening_after_submit') THEN
        ALTER TABLE users ADD COLUMN stop_listening_after_submit BOOLEAN NOT NULL DEFAULT FALSE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'chat_verbosity_level') THEN
        ALTER TABLE users ADD COLUMN chat_verbosity_level TEXT NOT NULL DEFAULT 'verbose';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'gemini_auth') THEN
        ALTER TABLE users ADD COLUMN gemini_auth JSONB;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chat_sessions' AND column_name = 'provider') THEN
        ALTER TABLE chat_sessions ADD COLUMN provider TEXT DEFAULT 'claude';
      END IF;
    END $$;
  `);
}).then(() => {
  console.log('PostgreSQL migrations applied successfully!');
  // Show database stats on startup
  return pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users) as users_count,
      (SELECT COUNT(*) FROM sessions) as sessions_count,
      (SELECT COUNT(*) FROM chat_sessions) as chat_sessions_count,
      (SELECT COUNT(*) FROM chat_sessions WHERE deleted_at IS NULL) as active_chat_sessions_count,
      (SELECT COUNT(*) FROM messages) as messages_count,
      (SELECT COUNT(*) FROM events) as events_count
  `);
}).then((result) => {
  console.log('');
  console.log('Database Statistics:');
  if (result && result.rows && result.rows[0]) {
    const stats = result.rows[0];
    console.log(`  Users:              ${stats.users_count}`);
    console.log(`  Sessions:           ${stats.sessions_count}`);
    console.log(`  Chat Sessions:      ${stats.chat_sessions_count} (${stats.active_chat_sessions_count} active)`);
    console.log(`  Messages:           ${stats.messages_count}`);
    console.log(`  Events:             ${stats.events_count}`);
  } else {
    console.log('  (No stats available - result:', JSON.stringify(result), ')');
  }
  console.log('');
}).catch((err) => {
  console.error('Error creating PostgreSQL tables:', err);
});

// Re-export types from schema
export type { User, NewUser, Session, NewSession, ChatSession, NewChatSession, Message, NewMessage, Event, NewEvent } from './schema.js';
