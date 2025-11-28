import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';
import * as schemaPg from './schema';
import * as schemaSqlite from './schema-sqlite';
import path from 'path';

const { Pool } = pg;

// Use PostgreSQL if DATABASE_URL is set, otherwise SQLite
const usePostgres = !!process.env.DATABASE_URL;

// Declare exports at top level
export let pool: pg.Pool | null;
export let sqliteDb: Database.Database | null;
export let db: any;

// Re-export schemas based on database type
export let users: any;
export let sessions: any;
export let chatSessions: any;
export let messages: any;
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
      image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024,
      voice_command_keywords JSONB DEFAULT '[]'::jsonb,
      default_landing_page TEXT NOT NULL DEFAULT 'store',
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
      completed_at TIMESTAMP
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
    // Add locked column if it doesn't exist (migration)
    return pool!.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'locked'
        ) THEN
          ALTER TABLE chat_sessions ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'base_branch'
        ) THEN
          ALTER TABLE chat_sessions ADD COLUMN base_branch TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'messages' AND column_name = 'images'
        ) THEN
          ALTER TABLE messages ADD COLUMN images JSONB;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'image_resize_max_dimension'
        ) THEN
          ALTER TABLE users ADD COLUMN image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'display_name'
        ) THEN
          ALTER TABLE users ADD COLUMN display_name TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'voice_command_keywords'
        ) THEN
          ALTER TABLE users ADD COLUMN voice_command_keywords JSONB DEFAULT '[]'::jsonb;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'is_admin'
        ) THEN
          ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'default_landing_page'
        ) THEN
          ALTER TABLE users ADD COLUMN default_landing_page TEXT NOT NULL DEFAULT 'store';
        END IF;
        -- Refactor session ID to use {owner}/{repo}/{branch} format
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'session_path'
        ) THEN
          ALTER TABLE chat_sessions ADD COLUMN session_path TEXT;
          ALTER TABLE chat_sessions ADD COLUMN repository_owner TEXT;
          ALTER TABLE chat_sessions ADD COLUMN repository_name TEXT;
        END IF;
        -- Drop old ai_worker_session_id column if session_path exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'session_path'
        ) AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'ai_worker_session_id'
        ) THEN
          ALTER TABLE chat_sessions DROP COLUMN IF EXISTS ai_worker_session_id;
        END IF;
        -- Add unique constraint on session_path if not exists
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chat_sessions_session_path_unique'
        ) THEN
          ALTER TABLE chat_sessions ADD CONSTRAINT chat_sessions_session_path_unique UNIQUE (session_path);
        END IF;
        -- Add auto_commit column if not exists
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'auto_commit'
        ) THEN
          ALTER TABLE chat_sessions ADD COLUMN auto_commit BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
        -- Migrate chat_sessions.id from INTEGER to TEXT (UUID)
        -- This migration is needed when upgrading from old schema with SERIAL id to new UUID-based id
        DO $migration$
        DECLARE
          id_data_type TEXT;
        BEGIN
          -- Check current data type of id column
          SELECT data_type INTO id_data_type
          FROM information_schema.columns
          WHERE table_name = 'chat_sessions' AND column_name = 'id';

          -- If id is integer-based (integer, bigint, serial, bigserial), migrate to TEXT
          IF id_data_type IN ('integer', 'bigint', 'smallint') THEN
            RAISE NOTICE 'Migrating chat_sessions.id from % to TEXT (UUID)', id_data_type;

            -- Drop foreign key constraint from messages table
            ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_chat_session_id_fkey;

            -- Convert existing integer IDs to UUID format (pad with zeros and format as UUID)
            -- This is a data-preserving migration that converts old integer IDs to UUID strings
            ALTER TABLE chat_sessions ALTER COLUMN id TYPE TEXT USING LPAD(id::TEXT, 8, '0') || '-0000-0000-0000-000000000000';
            ALTER TABLE messages ALTER COLUMN chat_session_id TYPE TEXT USING LPAD(chat_session_id::TEXT, 8, '0') || '-0000-0000-0000-000000000000';

            -- Re-add foreign key constraint
            ALTER TABLE messages ADD CONSTRAINT messages_chat_session_id_fkey
              FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

            RAISE NOTICE 'Successfully migrated chat_sessions.id to TEXT (UUID format)';
          ELSIF id_data_type = 'text' THEN
            RAISE NOTICE 'chat_sessions.id is already TEXT, no migration needed';
          END IF;
        END $migration$;
      END $$;
    `);
  }).then(() => {
    console.log('PostgreSQL migrations applied successfully!');
    // Make etdofresh@gmail.com admin if they exist
    return pool!.query(`
      UPDATE users
      SET is_admin = TRUE
      WHERE email = 'etdofresh@gmail.com' AND is_admin = FALSE
      RETURNING email;
    `);
  }).then((result) => {
    if (result && result.rows && result.rows.length > 0) {
      console.log('✓ Set etdofresh@gmail.com as admin');
    }
  }).catch((err) => {
    console.error('Error creating PostgreSQL tables:', err);
  });
} else {
  console.log('Using SQLite database');

  // Use persistent database file for development
  const dbPath = path.join(process.cwd(), 'dev.db');
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
      image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024,
      voice_command_keywords TEXT DEFAULT '[]',
      default_landing_page TEXT NOT NULL DEFAULT 'store',
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

  // Add locked column if it doesn't exist (migration)
  try {
    const chatSessionsInfo = sqlite.pragma('table_info(chat_sessions)') as Array<{ name: string }>;
    const hasLockedColumn = chatSessionsInfo.some((col) => col.name === 'locked');
    if (!hasLockedColumn) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;');
      console.log('SQLite migration: Added locked column to chat_sessions');
    }

    const hasBaseBranchColumn = chatSessionsInfo.some((col) => col.name === 'base_branch');
    if (!hasBaseBranchColumn) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN base_branch TEXT;');
      console.log('SQLite migration: Added base_branch column to chat_sessions');
    }

    // Refactor session ID to use {owner}/{repo}/{branch} format
    const hasSessionPathColumn = chatSessionsInfo.some((col) => col.name === 'session_path');
    if (!hasSessionPathColumn) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN session_path TEXT;');
      console.log('SQLite migration: Added session_path column to chat_sessions');
    }

    const hasRepositoryOwnerColumn = chatSessionsInfo.some((col) => col.name === 'repository_owner');
    if (!hasRepositoryOwnerColumn) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN repository_owner TEXT;');
      console.log('SQLite migration: Added repository_owner column to chat_sessions');
    }

    const hasRepositoryNameColumn = chatSessionsInfo.some((col) => col.name === 'repository_name');
    if (!hasRepositoryNameColumn) {
      sqlite.exec('ALTER TABLE chat_sessions ADD COLUMN repository_name TEXT;');
      console.log('SQLite migration: Added repository_name column to chat_sessions');
    }

    const messagesInfo = sqlite.pragma('table_info(messages)') as Array<{ name: string }>;
    const hasImagesColumn = messagesInfo.some((col) => col.name === 'images');
    if (!hasImagesColumn) {
      sqlite.exec('ALTER TABLE messages ADD COLUMN images TEXT;');
      console.log('SQLite migration: Added images column to messages');
    }

    const usersInfo = sqlite.pragma('table_info(users)') as Array<{ name: string }>;
    const hasImageResizeColumn = usersInfo.some((col) => col.name === 'image_resize_max_dimension');
    if (!hasImageResizeColumn) {
      sqlite.exec('ALTER TABLE users ADD COLUMN image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024;');
      console.log('SQLite migration: Added image_resize_max_dimension column to users');
    }

    const hasDisplayNameColumn = usersInfo.some((col) => col.name === 'display_name');
    if (!hasDisplayNameColumn) {
      sqlite.exec('ALTER TABLE users ADD COLUMN display_name TEXT;');
      console.log('SQLite migration: Added display_name column to users');
    }

    const hasVoiceCommandKeywordsColumn = usersInfo.some((col) => col.name === 'voice_command_keywords');
    if (!hasVoiceCommandKeywordsColumn) {
      sqlite.exec("ALTER TABLE users ADD COLUMN voice_command_keywords TEXT DEFAULT '[]';");
      console.log('SQLite migration: Added voice_command_keywords column to users');
    }

    const hasIsAdminColumn = usersInfo.some((col) => col.name === 'is_admin');
    if (!hasIsAdminColumn) {
      sqlite.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;');
      console.log('SQLite migration: Added is_admin column to users');
    }

    const hasDefaultLandingPageColumn = usersInfo.some((col) => col.name === 'default_landing_page');
    if (!hasDefaultLandingPageColumn) {
      sqlite.exec("ALTER TABLE users ADD COLUMN default_landing_page TEXT NOT NULL DEFAULT 'store';");
      console.log('SQLite migration: Added default_landing_page column to users');
    }

    // Make etdofresh@gmail.com admin if they exist
    const result = sqlite.prepare(`
      UPDATE users
      SET is_admin = 1
      WHERE email = 'etdofresh@gmail.com' AND is_admin = 0
    `).run();

    if (result.changes > 0) {
      console.log('✓ Set etdofresh@gmail.com as admin');
    }
  } catch (err) {
    console.error('Error applying SQLite migrations:', err);
  }
}
