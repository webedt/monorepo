import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';
import * as schemaPg from './schema.js';
import * as schemaSqlite from './schema-sqlite.js';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// Use PostgreSQL if DATABASE_URL is set, otherwise SQLite
const usePostgres = !!process.env.DATABASE_URL;

// Declare exports at top level
export let pool: pg.Pool | null;
export let sqliteDb: Database.Database | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let db: any;

// Re-export schemas based on database type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let users: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let sessions: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let chatSessions: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let messages: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let events: any;

if (usePostgres) {
  console.log('Using PostgreSQL database');

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    // Only use SSL if explicitly required in the connection string
    ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  db = drizzlePg(pool, { schema: schemaPg, logger: process.env.NODE_ENV === 'development' });
  sqliteDb = null;

  // Assign PostgreSQL schemas
  users = schemaPg.users;
  sessions = schemaPg.sessions;
  chatSessions = schemaPg.chatSessions;
  messages = schemaPg.messages;
  events = schemaPg.events;

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
    return pool!.query(`
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
      END $$;
    `);
  }).then(() => {
    console.log('PostgreSQL migrations applied successfully!');
  }).catch((err) => {
    console.error('Error creating PostgreSQL tables:', err);
  });
} else {
  console.log('Using SQLite database');

  // Get __dirname equivalent for ESM
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Use persistent database file for development
  const dbPath = path.join(__dirname, '../../dev.db');
  const sqlite = new Database(dbPath);

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  db = drizzleSqlite(sqlite, { schema: schemaSqlite, logger: process.env.NODE_ENV === 'development' });
  sqliteDb = sqlite;
  pool = null;

  // Assign SQLite schemas
  users = schemaSqlite.users;
  sessions = schemaSqlite.sessions;
  chatSessions = schemaSqlite.chatSessions;
  messages = schemaSqlite.messages;
  events = schemaSqlite.events;

  // Create SQLite tables
  console.log('Creating SQLite tables...');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      github_id TEXT UNIQUE,
      github_access_token TEXT,
      claude_auth TEXT,
      codex_auth TEXT,
      preferred_provider TEXT NOT NULL DEFAULT 'claude',
      image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024,
      voice_command_keywords TEXT DEFAULT '[]',
      default_landing_page TEXT NOT NULL DEFAULT 'store',
      preferred_model TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_path TEXT UNIQUE,
      repository_owner TEXT,
      repository_name TEXT,
      user_request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      repository_url TEXT,
      base_branch TEXT,
      branch TEXT,
      auto_commit INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      deleted_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  console.log('SQLite tables created successfully!');

  // Run migrations for new columns
  try {
    const usersInfo = sqlite.pragma('table_info(users)') as Array<{ name: string }>;

    if (!usersInfo.some((col) => col.name === 'codex_auth')) {
      sqlite.exec('ALTER TABLE users ADD COLUMN codex_auth TEXT;');
      console.log('SQLite migration: Added codex_auth column to users');
    }

    if (!usersInfo.some((col) => col.name === 'preferred_provider')) {
      sqlite.exec("ALTER TABLE users ADD COLUMN preferred_provider TEXT NOT NULL DEFAULT 'claude';");
      console.log('SQLite migration: Added preferred_provider column to users');
    }

    const chatSessionsInfo = sqlite.pragma('table_info(chat_sessions)') as Array<{ name: string }>;

    if (!chatSessionsInfo.some((col) => col.name === 'locked')) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;');
      console.log('SQLite migration: Added locked column to chat_sessions');
    }

    if (!chatSessionsInfo.some((col) => col.name === 'base_branch')) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN base_branch TEXT;');
      console.log('SQLite migration: Added base_branch column to chat_sessions');
    }

    if (!chatSessionsInfo.some((col) => col.name === 'deleted_at')) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;');
      console.log('SQLite migration: Added deleted_at column to chat_sessions');
    }

    const messagesInfo = sqlite.pragma('table_info(messages)') as Array<{ name: string }>;

    if (!messagesInfo.some((col) => col.name === 'images')) {
      sqlite.exec('ALTER TABLE messages ADD COLUMN images TEXT;');
      console.log('SQLite migration: Added images column to messages');
    }
  } catch (err) {
    console.error('Error applying SQLite migrations:', err);
  }
}

// Re-export types from schema
export type { User, NewUser, Session, NewSession, ChatSession, NewChatSession, Message, NewMessage, Event, NewEvent } from './schema.js';
