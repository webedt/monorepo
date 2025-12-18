/**
 * Database Migration System
 *
 * Provides Drizzle-based migration management with:
 * - Version tracking via migrations table
 * - Schema validation on startup
 * - Database backup before migrations
 * - Clear error messages for configuration issues
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Migration tracking table name
const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface MigrationResult {
  success: boolean;
  migrationsApplied: number;
  version: string | null;
  error?: string;
  details?: string[];
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
}

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  error?: string;
  timestamp: string;
}

/**
 * Expected schema structure for validation
 */
const EXPECTED_TABLES = [
  {
    name: 'users',
    requiredColumns: [
      'id', 'email', 'display_name', 'password_hash', 'github_id',
      'github_access_token', 'claude_auth', 'codex_auth', 'gemini_auth',
      'preferred_provider', 'created_at'
    ]
  },
  {
    name: 'sessions',
    requiredColumns: ['id', 'user_id', 'expires_at']
  },
  {
    name: 'chat_sessions',
    requiredColumns: [
      'id', 'user_id', 'session_path', 'repository_owner', 'repository_name',
      'user_request', 'status', 'created_at', 'remote_session_id', 'remote_web_url',
      'total_cost', 'issue_number'
    ]
  },
  {
    name: 'messages',
    requiredColumns: ['id', 'chat_session_id', 'type', 'content', 'timestamp']
  },
  {
    name: 'events',
    requiredColumns: ['id', 'chat_session_id', 'event_data', 'timestamp']
  },
  {
    name: 'live_chat_messages',
    requiredColumns: ['id', 'user_id', 'owner', 'repo', 'branch', 'role', 'content', 'created_at']
  },
  {
    name: 'workspace_presence',
    requiredColumns: ['id', 'user_id', 'owner', 'repo', 'branch', 'heartbeat_at', 'updated_at']
  },
  {
    name: 'workspace_events',
    requiredColumns: ['id', 'user_id', 'owner', 'repo', 'branch', 'event_type', 'created_at']
  }
];

/**
 * Get the current migration version from the database
 */
export async function getCurrentMigrationVersion(pool: pg.Pool): Promise<string | null> {
  try {
    // Check if migrations table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '${MIGRATIONS_TABLE}'
      );
    `);

    if (!tableExists.rows[0].exists) {
      return null;
    }

    // Get the latest migration
    const result = await pool.query(`
      SELECT hash, created_at
      FROM ${MIGRATIONS_TABLE}
      ORDER BY created_at DESC
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].hash;
  } catch (error) {
    return null;
  }
}

/**
 * Get list of applied migrations
 */
export async function getAppliedMigrations(pool: pg.Pool): Promise<string[]> {
  try {
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = '${MIGRATIONS_TABLE}'
      );
    `);

    if (!tableExists.rows[0].exists) {
      return [];
    }

    const result = await pool.query(`
      SELECT hash FROM ${MIGRATIONS_TABLE} ORDER BY created_at ASC;
    `);

    return result.rows.map(row => row.hash);
  } catch (error) {
    return [];
  }
}

/**
 * Validate the database schema against expected structure
 */
export async function validateSchema(pool: pg.Pool): Promise<SchemaValidationResult> {
  const result: SchemaValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    missingTables: [],
    missingColumns: []
  };

  try {
    // Check for each expected table
    for (const table of EXPECTED_TABLES) {
      // Check if table exists
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        );
      `, [table.name]);

      if (!tableExists.rows[0].exists) {
        result.missingTables.push(table.name);
        result.errors.push(`Missing table: ${table.name}`);
        result.valid = false;
        continue;
      }

      // Check for required columns
      const columns = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = $1;
      `, [table.name]);

      const existingColumns = columns.rows.map(row => row.column_name);

      for (const column of table.requiredColumns) {
        if (!existingColumns.includes(column)) {
          result.missingColumns.push({ table: table.name, column });
          result.warnings.push(`Missing column: ${table.name}.${column}`);
        }
      }
    }

    // Check for foreign key constraints
    const fkResult = await pool.query(`
      SELECT tc.table_name, tc.constraint_name, kcu.column_name,
             ccu.table_name AS foreign_table_name,
             ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public';
    `);

    if (fkResult.rows.length === 0 && result.missingTables.length === 0) {
      result.warnings.push('No foreign key constraints found - data integrity may not be enforced');
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.valid = false;
    result.errors.push(`Schema validation failed: ${errorMessage}`);
  }

  return result;
}

/**
 * Create a database backup (schema and data export)
 * Uses pg_dump style export via SQL queries
 */
export async function createBackup(pool: pg.Pool, backupDir: string): Promise<BackupResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `backup-${timestamp}.sql`);

  try {
    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    let backupContent = `-- Database backup created at ${new Date().toISOString()}\n`;
    backupContent += `-- This backup includes schema and data for all tables\n\n`;

    // Get list of tables
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    for (const tableRow of tablesResult.rows) {
      const tableName = tableRow.table_name;

      // Get CREATE TABLE statement
      const createTableResult = await pool.query(`
        SELECT
          'CREATE TABLE IF NOT EXISTS ' || quote_ident(c.table_name) || ' (' ||
          string_agg(
            quote_ident(c.column_name) || ' ' ||
            c.data_type ||
            CASE WHEN c.character_maximum_length IS NOT NULL
              THEN '(' || c.character_maximum_length || ')'
              ELSE ''
            END ||
            CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
            CASE WHEN c.column_default IS NOT NULL
              THEN ' DEFAULT ' || c.column_default
              ELSE ''
            END,
            ', '
            ORDER BY c.ordinal_position
          ) || ');' as create_statement
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = $1
        GROUP BY c.table_name;
      `, [tableName]);

      if (createTableResult.rows.length > 0) {
        backupContent += `\n-- Table: ${tableName}\n`;
        backupContent += `${createTableResult.rows[0].create_statement}\n`;
      }

      // Get row count
      const countResult = await pool.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);
      const rowCount = parseInt(countResult.rows[0].cnt);

      if (rowCount > 0) {
        // Export data in batches
        const batchSize = 1000;
        for (let offset = 0; offset < rowCount; offset += batchSize) {
          const dataResult = await pool.query(
            `SELECT * FROM "${tableName}" LIMIT ${batchSize} OFFSET ${offset}`
          );

          for (const row of dataResult.rows) {
            const columns = Object.keys(row).map(k => `"${k}"`).join(', ');
            const values = Object.values(row).map(v => {
              if (v === null) return 'NULL';
              if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
              if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
              if (v instanceof Date) return `'${v.toISOString()}'`;
              return String(v);
            }).join(', ');

            backupContent += `INSERT INTO "${tableName}" (${columns}) VALUES (${values});\n`;
          }
        }
      }
    }

    // Write backup file
    fs.writeFileSync(backupPath, backupContent, 'utf8');

    return {
      success: true,
      backupPath,
      timestamp
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Backup failed: ${errorMessage}`,
      timestamp
    };
  }
}

/**
 * Run pending migrations with automatic backup
 */
export async function runMigrations(
  databaseUrl: string,
  options: {
    backup?: boolean;
    backupDir?: string;
    migrationsFolder?: string;
  } = {}
): Promise<MigrationResult> {
  const {
    backup = true,
    backupDir = path.join(__dirname, '../../backups'),
    migrationsFolder = path.join(__dirname, '../../drizzle')
  } = options;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  const details: string[] = [];

  try {
    // Test connection
    await pool.query('SELECT 1');
    details.push('Database connection successful');

    // Get current version
    const currentVersion = await getCurrentMigrationVersion(pool);
    details.push(`Current migration version: ${currentVersion || 'none'}`);

    // Create backup if enabled and there's existing data
    if (backup) {
      const schemaValidation = await validateSchema(pool);
      if (schemaValidation.missingTables.length < EXPECTED_TABLES.length) {
        details.push('Creating database backup before migration...');
        const backupResult = await createBackup(pool, backupDir);
        if (backupResult.success) {
          details.push(`Backup created: ${backupResult.backupPath}`);
        } else {
          details.push(`Backup warning: ${backupResult.error}`);
        }
      } else {
        details.push('Skipping backup - database appears to be empty');
      }
    }

    // Check if migrations folder exists
    if (!fs.existsSync(migrationsFolder)) {
      details.push(`Migrations folder not found: ${migrationsFolder}`);
      details.push('Running initial schema creation instead...');

      // Run inline schema creation for fresh databases
      await createInitialSchema(pool);

      return {
        success: true,
        migrationsApplied: 1,
        version: 'initial',
        details
      };
    }

    // Run Drizzle migrations
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });

    // Get new version
    const newVersion = await getCurrentMigrationVersion(pool);
    details.push(`New migration version: ${newVersion || 'initial'}`);

    // Count applied migrations
    const appliedMigrations = await getAppliedMigrations(pool);

    return {
      success: true,
      migrationsApplied: appliedMigrations.length,
      version: newVersion,
      details
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      migrationsApplied: 0,
      version: null,
      error: errorMessage,
      details
    };
  } finally {
    await pool.end();
  }
}

/**
 * Create initial schema for fresh databases
 * This is used when no migration files exist yet
 */
async function createInitialSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    -- Users table
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
      openrouter_api_key TEXT,
      autocomplete_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      autocomplete_model TEXT DEFAULT 'openai/gpt-oss-120b:cerebras',
      image_ai_keys JSONB,
      image_ai_provider TEXT DEFAULT 'openrouter',
      image_ai_model TEXT DEFAULT 'google/gemini-2.5-flash-image',
      preferred_provider TEXT NOT NULL DEFAULT 'claude',
      image_resize_max_dimension INTEGER NOT NULL DEFAULT 1024,
      voice_command_keywords JSONB DEFAULT '[]'::jsonb,
      stop_listening_after_submit BOOLEAN NOT NULL DEFAULT FALSE,
      default_landing_page TEXT NOT NULL DEFAULT 'store',
      preferred_model TEXT,
      chat_verbosity_level TEXT NOT NULL DEFAULT 'verbose',
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Sessions table (for Lucia auth)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    -- Chat sessions table
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
      remote_session_id TEXT,
      remote_web_url TEXT,
      total_cost TEXT,
      issue_number INTEGER,
      auto_commit BOOLEAN NOT NULL DEFAULT FALSE,
      locked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      deleted_at TIMESTAMP,
      worker_last_activity TIMESTAMP
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      images JSONB,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Events table (SSE event storage)
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      event_data JSONB NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_issue_number ON chat_sessions(issue_number);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_issue_repo ON chat_sessions(issue_number, repository_owner, repository_name);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_session_id ON messages(chat_session_id);
    CREATE INDEX IF NOT EXISTS idx_events_chat_session_id ON events(chat_session_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

    -- Live Chat messages table (branch-based chat)
    CREATE TABLE IF NOT EXISTS live_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls JSONB,
      images JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Workspace presence table (ephemeral UPSERT)
    CREATE TABLE IF NOT EXISTS workspace_presence (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      page TEXT,
      cursor_x INTEGER,
      cursor_y INTEGER,
      selection JSONB,
      heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Workspace events table (append-only log)
    CREATE TABLE IF NOT EXISTS workspace_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page TEXT,
      path TEXT,
      payload JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Create indexes for workspace tables
    CREATE INDEX IF NOT EXISTS idx_live_chat_messages_branch ON live_chat_messages(owner, repo, branch);
    CREATE INDEX IF NOT EXISTS idx_live_chat_messages_user ON live_chat_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_live_chat_messages_created ON live_chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_presence_branch ON workspace_presence(owner, repo, branch);
    CREATE INDEX IF NOT EXISTS idx_workspace_presence_heartbeat ON workspace_presence(heartbeat_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_events_branch ON workspace_events(owner, repo, branch);
    CREATE INDEX IF NOT EXISTS idx_workspace_events_created ON workspace_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_workspace_events_type ON workspace_events(event_type);
  `);
}

/**
 * Column definitions for auto-migration
 * Maps table.column to the SQL definition for adding the column
 */
const COLUMN_DEFINITIONS: Record<string, string> = {
  // chat_sessions columns
  'chat_sessions.remote_session_id': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS remote_session_id TEXT',
  'chat_sessions.remote_web_url': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS remote_web_url TEXT',
  'chat_sessions.total_cost': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_cost TEXT',
  'chat_sessions.issue_number': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS issue_number INTEGER',
  'chat_sessions.provider': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT \'claude\'',
  'chat_sessions.provider_session_id': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS provider_session_id TEXT',
  'chat_sessions.deleted_at': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP',
  'chat_sessions.worker_last_activity': 'ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS worker_last_activity TIMESTAMP',
  // users columns (for future additions)
  'users.openrouter_api_key': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS openrouter_api_key TEXT',
  'users.autocomplete_enabled': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS autocomplete_enabled BOOLEAN NOT NULL DEFAULT TRUE',
  'users.autocomplete_model': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS autocomplete_model TEXT DEFAULT \'openai/gpt-oss-120b:cerebras\'',
  'users.image_ai_keys': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS image_ai_keys JSONB',
  'users.image_ai_provider': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS image_ai_provider TEXT DEFAULT \'openrouter\'',
  'users.image_ai_model': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS image_ai_model TEXT DEFAULT \'google/gemini-2.5-flash-image\'',
  'users.is_admin': 'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE',
};

/**
 * Index definitions for auto-migration
 */
const INDEX_DEFINITIONS: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_chat_sessions_issue_number ON chat_sessions(issue_number)',
  'CREATE INDEX IF NOT EXISTS idx_chat_sessions_issue_repo ON chat_sessions(issue_number, repository_owner, repository_name)',
];

/**
 * Ensure the database schema is up to date by adding any missing columns
 * This runs after initial schema creation or migrations to handle schema drift
 */
export async function ensureSchemaUpToDate(pool: pg.Pool): Promise<{ columnsAdded: string[]; columnsRemoved: string[]; indexesCreated: string[]; errors: string[] }> {
  const columnsAdded: string[] = [];
  const columnsRemoved: string[] = [];
  const indexesCreated: string[] = [];
  const errors: string[] = [];

  // Drop deprecated columns
  const COLUMNS_TO_DROP: { table: string; column: string }[] = [
    { table: 'events', column: 'event_type' }, // eventType is now stored inside event_data JSON
  ];

  for (const { table, column } of COLUMNS_TO_DROP) {
    try {
      // Check if column exists before dropping
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        );
      `, [table, column]);

      if (result.rows[0].exists) {
        await pool.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
        columnsRemoved.push(`${table}.${column}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to drop ${table}.${column}: ${errorMessage}`);
    }
  }

  // Check for missing columns and add them
  for (const [key, alterSql] of Object.entries(COLUMN_DEFINITIONS)) {
    const [tableName, columnName] = key.split('.');

    try {
      // Check if column exists
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        );
      `, [tableName, columnName]);

      if (!result.rows[0].exists) {
        // Column doesn't exist, add it
        await pool.query(alterSql);
        columnsAdded.push(`${tableName}.${columnName}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to add ${tableName}.${columnName}: ${errorMessage}`);
    }
  }

  // Create any missing indexes
  for (const indexSql of INDEX_DEFINITIONS) {
    try {
      await pool.query(indexSql);
      // Extract index name from SQL for logging
      const match = indexSql.match(/CREATE INDEX IF NOT EXISTS (\w+)/);
      if (match) {
        indexesCreated.push(match[1]);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create index: ${errorMessage}`);
    }
  }

  return { columnsAdded, columnsRemoved, indexesCreated, errors };
}

/**
 * Format schema validation errors for user-friendly output
 */
export function formatSchemaErrors(validation: SchemaValidationResult): string {
  const lines: string[] = [];

  if (!validation.valid) {
    lines.push('❌ Database schema validation failed:');
    lines.push('');
  }

  if (validation.missingTables.length > 0) {
    lines.push('Missing Tables:');
    for (const table of validation.missingTables) {
      lines.push(`  • ${table}`);
    }
    lines.push('');
    lines.push('To fix: Run migrations to create the required tables.');
    lines.push('  npx drizzle-kit push   (development)');
    lines.push('  npm run db:migrate     (production)');
    lines.push('');
  }

  if (validation.missingColumns.length > 0) {
    lines.push('Missing Columns:');
    for (const col of validation.missingColumns) {
      lines.push(`  • ${col.table}.${col.column}`);
    }
    lines.push('');
    lines.push('To fix: Run migrations to add missing columns.');
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of validation.warnings) {
      lines.push(`  ⚠️  ${warning}`);
    }
  }

  return lines.join('\n');
}

/**
 * Diagnostic information for database connection issues
 */
export function getDatabaseDiagnostics(error: Error): string {
  const message = error.message.toLowerCase();
  const lines: string[] = [''];

  lines.push('Database Configuration Help:');
  lines.push('─'.repeat(50));

  if (message.includes('econnrefused') || message.includes('connection refused')) {
    lines.push('');
    lines.push('❌ Connection Refused');
    lines.push('');
    lines.push('The database server is not accepting connections.');
    lines.push('');
    lines.push('Possible causes:');
    lines.push('  1. PostgreSQL is not running');
    lines.push('  2. Wrong host/port in DATABASE_URL');
    lines.push('  3. Firewall blocking the connection');
    lines.push('');
    lines.push('Solutions:');
    lines.push('  • Start PostgreSQL: sudo systemctl start postgresql');
    lines.push('  • Check DATABASE_URL format: postgresql://user:pass@host:5432/dbname');
    lines.push('  • Verify the host and port are correct');
  } else if (message.includes('authentication failed') || message.includes('password')) {
    lines.push('');
    lines.push('❌ Authentication Failed');
    lines.push('');
    lines.push('The username or password is incorrect.');
    lines.push('');
    lines.push('Solutions:');
    lines.push('  • Verify DATABASE_URL credentials');
    lines.push('  • Check pg_hba.conf for authentication settings');
    lines.push('  • Reset database password if needed');
  } else if (message.includes('does not exist') || message.includes('database')) {
    lines.push('');
    lines.push('❌ Database Not Found');
    lines.push('');
    lines.push('The specified database does not exist.');
    lines.push('');
    lines.push('Solutions:');
    lines.push('  • Create the database: CREATE DATABASE your_database;');
    lines.push('  • Check the database name in DATABASE_URL');
  } else if (message.includes('timeout') || message.includes('timed out')) {
    lines.push('');
    lines.push('❌ Connection Timeout');
    lines.push('');
    lines.push('The connection took too long to establish.');
    lines.push('');
    lines.push('Solutions:');
    lines.push('  • Check network connectivity');
    lines.push('  • Verify the database server is responsive');
    lines.push('  • Increase connection timeout in configuration');
  } else if (message.includes('ssl') || message.includes('certificate')) {
    lines.push('');
    lines.push('❌ SSL/TLS Error');
    lines.push('');
    lines.push('There is an issue with the secure connection.');
    lines.push('');
    lines.push('Solutions:');
    lines.push('  • Add ?sslmode=require to DATABASE_URL for SSL');
    lines.push('  • Or add ?sslmode=disable to skip SSL');
    lines.push('  • Verify SSL certificates are valid');
  } else {
    lines.push('');
    lines.push('❌ Database Error');
    lines.push('');
    lines.push(`Error: ${error.message}`);
    lines.push('');
    lines.push('General troubleshooting:');
    lines.push('  • Verify DATABASE_URL environment variable is set');
    lines.push('  • Check PostgreSQL server status');
    lines.push('  • Review database logs for more details');
  }

  lines.push('');
  lines.push('─'.repeat(50));
  lines.push('');
  lines.push('Environment variable format:');
  lines.push('  DATABASE_URL=postgresql://username:password@hostname:5432/database');
  lines.push('');
  lines.push('For local development with Docker:');
  lines.push('  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webedt');
  lines.push('');

  return lines.join('\n');
}
