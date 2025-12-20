/**
 * Database Configuration - PostgreSQL with Drizzle ORM
 *
 * Features:
 * - Automatic schema migration with version tracking
 * - Schema validation on startup with clear error messages
 * - Connection health checks with automatic reconnection
 * - Database backup before migrations
 *
 * Note: SQLite support was removed to simplify builds and avoid native compilation issues.
 * See SQLITE_REMOVED.md in this directory for instructions on reintroducing SQLite if needed.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import {
  DatabaseConnection,
  createConnection,
  type ConnectionStats,
  type HealthCheckResult,
} from './connection.js';
import {
  runMigrations,
  validateSchema,
  formatSchemaErrors,
  getDatabaseDiagnostics,
  getCurrentMigrationVersion,
  ensureSchemaUpToDate,
  type MigrationResult,
  type SchemaValidationResult,
} from './migrations.js';

const { Pool } = pg;

// Database URL from environment
if (!process.env.DATABASE_URL) {
  console.error('');
  console.error('❌ DATABASE_URL environment variable is required');
  console.error('');
  console.error('PostgreSQL is the only supported database.');
  console.error('');
  console.error('Set DATABASE_URL in your environment:');
  console.error('  export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname');
  console.error('');
  console.error('For local development with Docker:');
  console.error('  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/webedt');
  console.error('');
  throw new Error('DATABASE_URL environment variable is required. PostgreSQL is the only supported database.');
}

console.log('Connecting to PostgreSQL database...');

// Create the pool immediately for backward compatibility
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // 10s timeout for remote DB connections
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

// Create Drizzle instance immediately for backward compatibility
export const db = drizzle(pool, { schema, logger: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true' });

// Re-export schema tables
export const { users, sessions, chatSessions, messages, events } = schema;

// Connection manager for health checks (created lazily)
let connectionManager: DatabaseConnection | null = null;
let initializationComplete = false;
let initializationError: Error | null = null;

/**
 * Initialize database with migrations and validation
 * This runs automatically on import but can be awaited for completion
 */
async function initializeDatabase(): Promise<void> {
  console.log('');
  console.log('📦 Initializing PostgreSQL database...');
  console.log('');

  try {
    // Test basic connectivity first
    await pool.query('SELECT 1');
    console.log('  ✅ Database connection established');

    // Run migrations unless skipped
    const skipMigrations = process.env.SKIP_MIGRATIONS === 'true';

    if (!skipMigrations) {
      console.log('');
      console.log('Running database migrations...');

      const migrationResult = await runMigrations(process.env.DATABASE_URL!, {
        backup: process.env.NODE_ENV === 'production',
        backupDir: process.env.BACKUP_DIR || '/tmp/db-backups',
      });

      if (!migrationResult.success) {
        console.error('');
        console.error('❌ Migration failed:', migrationResult.error);
        if (migrationResult.details) {
          for (const detail of migrationResult.details) {
            console.error('  ', detail);
          }
        }
        // Don't throw - allow server to start with existing schema
        console.warn('⚠️  Continuing with existing schema');
      } else {
        if (migrationResult.details) {
          for (const detail of migrationResult.details) {
            console.log('  ', detail);
          }
        }
      }
    } else {
      console.log('  Migrations skipped (SKIP_MIGRATIONS=true)');
    }

    // Auto-migrate: add any missing columns
    console.log('');
    console.log('Checking for schema updates...');
    const schemaUpdate = await ensureSchemaUpToDate(pool);

    if (schemaUpdate.columnsAdded.length > 0) {
      console.log('  Added missing columns:');
      for (const col of schemaUpdate.columnsAdded) {
        console.log(`    ✅ ${col}`);
      }
    }

    if (schemaUpdate.columnsRemoved.length > 0) {
      console.log('  Removed deprecated columns:');
      for (const col of schemaUpdate.columnsRemoved) {
        console.log(`    🗑️  ${col}`);
      }
    }

    if (schemaUpdate.indexesCreated.length > 0) {
      console.log('  Created indexes:');
      for (const idx of schemaUpdate.indexesCreated) {
        console.log(`    ✅ ${idx}`);
      }
    }

    if (schemaUpdate.errors.length > 0) {
      console.warn('  Schema update warnings:');
      for (const err of schemaUpdate.errors) {
        console.warn(`    ⚠️  ${err}`);
      }
    }

    if (schemaUpdate.columnsAdded.length === 0 && schemaUpdate.columnsRemoved.length === 0 && schemaUpdate.errors.length === 0) {
      console.log('  ✅ Schema is up to date');
    }

    // Validate schema
    console.log('');
    console.log('Validating database schema...');
    const validation = await validateSchema(pool);

    if (!validation.valid) {
      console.error('');
      console.error(formatSchemaErrors(validation));

      // In production, warn about validation errors
      if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️  Schema validation failed - some features may not work correctly');
      }
    } else if (validation.warnings.length > 0) {
      console.log('  Schema valid with warnings:');
      for (const warning of validation.warnings) {
        console.log(`    ⚠️  ${warning}`);
      }
    } else {
      console.log('  ✅ Schema validation passed');
    }

    // Show database statistics
    await showDatabaseStats();

    // Set up connection manager for health checks
    connectionManager = createConnection(process.env.DATABASE_URL!, {
      maxConnections: 1, // Use minimal connections for health checks only
      minConnections: 0,
      maxRetries: 3,
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 10000,
    });

    // Don't start health checks yet - pool is managed separately
    // Health checks can be started manually if needed

    console.log('');
    console.log('✅ Database initialization complete');
    console.log('');

    initializationComplete = true;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    initializationError = err;

    console.error('');
    console.error('❌ Database initialization error');
    console.error('');
    console.error(getDatabaseDiagnostics(err));

    // Don't throw - let the application decide how to handle this
    console.warn('⚠️  Database may not be fully initialized');
  }
}

/**
 * Display database statistics
 */
async function showDatabaseStats(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM sessions) as sessions_count,
        (SELECT COUNT(*) FROM chat_sessions) as chat_sessions_count,
        (SELECT COUNT(*) FROM chat_sessions WHERE deleted_at IS NULL) as active_chat_sessions_count,
        (SELECT COUNT(*) FROM messages) as messages_count,
        (SELECT COUNT(*) FROM events) as events_count
    `);

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
      console.log('  (No stats available)');
    }
  } catch (error) {
    console.log('  (Stats unavailable - tables may not exist yet)');
  }
}

// Start initialization (runs in background)
const initializationPromise = initializeDatabase();

/**
 * Wait for database initialization to complete
 * Use this if you need to ensure migrations have run before proceeding
 */
export async function waitForDatabase(): Promise<void> {
  await initializationPromise;
  if (initializationError) {
    throw initializationError;
  }
}

/**
 * Check if database initialization is complete
 */
export function isInitialized(): boolean {
  return initializationComplete;
}

/**
 * Get the database instance
 */
export function getDb(): typeof db {
  return db;
}

/**
 * Get the raw pool instance
 */
export function getPool(): pg.Pool {
  return pool;
}

/**
 * Get connection statistics
 */
export function getConnectionStats(): ConnectionStats | null {
  return connectionManager?.getStats() || {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: 20,
    healthy: true,
    lastHealthCheck: null,
    consecutiveFailures: 0,
    uptime: 0,
  };
}

/**
 * Perform a manual health check
 */
export async function checkHealth(): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    await pool.query('SELECT 1');
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      timestamp: new Date(),
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date(),
    };
  }
}

/**
 * Check if the database is healthy
 */
export function isHealthy(): boolean {
  return pool.totalCount > 0 && pool.idleCount >= 0;
}

/**
 * Close the database connection gracefully
 */
export async function closeDatabase(): Promise<void> {
  if (connectionManager) {
    await connectionManager.close();
    connectionManager = null;
  }
  await pool.end();
  console.log('Database connection closed');
}

// Re-export types from schema
export type {
  User,
  NewUser,
  Session,
  NewSession,
  ChatSession,
  NewChatSession,
  Message,
  NewMessage,
  Event,
  NewEvent,
} from './schema.js';

// Re-export migration utilities for CLI usage
export {
  runMigrations,
  validateSchema,
  formatSchemaErrors,
  getCurrentMigrationVersion,
  ensureSchemaUpToDate,
  type MigrationResult,
  type SchemaValidationResult,
} from './migrations.js';

// Re-export connection utilities
export {
  DatabaseConnection,
  createConnection,
  withRetry,
  type ConnectionStats,
  type HealthCheckResult,
} from './connection.js';
