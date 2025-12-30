/**
 * Database Configuration - PostgreSQL with Drizzle ORM
 *
 * Features:
 * - Lazy initialization (only connects when first used)
 * - Automatic schema migration with version tracking
 * - Schema validation on startup with clear error messages
 * - Connection health checks with automatic reconnection
 * - Database backup before migrations
 *
 * Note: SQLite support was removed to simplify builds and avoid native compilation issues.
 * See SQLITE_REMOVED.md in this directory for instructions on reintroducing SQLite if needed.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import {
  DatabaseConnection,
  createConnection,
  type ConnectionStats,
  type DatabaseHealthCheckResult,
} from './connection.js';
import { TIMEOUTS, LIMITS, RETRY, CONTEXT_RETRY } from '../config/constants.js';
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
import {
  DATABASE_URL,
  QUIET_DB,
  DEBUG_SQL,
  NODE_ENV,
  SKIP_MIGRATIONS,
  BACKUP_DIR,
} from '../config/env.js';

const { Pool } = pg;

// ============================================================================
// LAZY INITIALIZATION
// ============================================================================
// Database is only initialized when first accessed via getDb() or initializeDatabase()
// This allows CLI commands that don't need DB to run without DATABASE_URL

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;
let connectionManager: DatabaseConnection | null = null;
let initializationComplete = false;
let initializationError: Error | null = null;
let initializationPromise: Promise<void> | null = null;

// Skip verbose logging if QUIET_DB is set (for CLI commands)
const quietMode = QUIET_DB;

/**
 * Get or create the database pool (lazy initialization)
 */
function ensurePool(): pg.Pool {
  if (!_pool) {
    if (!DATABASE_URL) {
      throw new Error(
        'DATABASE_URL environment variable is required. PostgreSQL is the only supported database.\n' +
        'Set DATABASE_URL in your environment:\n' +
        '  export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname'
      );
    }

    if (!quietMode) {
      console.log('Connecting to PostgreSQL database...');
    }

    _pool = new Pool({
      connectionString: DATABASE_URL,
      max: LIMITS.DATABASE.MAX_CONNECTIONS,
      idleTimeoutMillis: TIMEOUTS.DATABASE.IDLE,
      connectionTimeoutMillis: TIMEOUTS.DATABASE.CONNECTION,
      ssl: DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    });
  }
  return _pool;
}

/**
 * Get or create the Drizzle database instance (lazy initialization)
 */
function getDbInstance(): NodePgDatabase<typeof schema> {
  if (!_db) {
    const pool = ensurePool();
    _db = drizzle(pool, {
      schema,
      logger: NODE_ENV === 'development' && DEBUG_SQL
    });
  }
  return _db;
}

/**
 * Create a lazy-initialization proxy for database objects.
 * Uses dynamic property access which requires type assertions.
 * This is a deliberate use of Record<string, unknown> for proxy forwarding.
 */
function createLazyProxy<T extends object>(getTarget: () => T): T {
  return new Proxy({} as T, {
    get(_, prop) {
      const target = getTarget();
      // Proxy handlers require dynamic access; cast is unavoidable but safe
      // since we forward all property access to the actual target
      const targetRecord = target as unknown as Record<string | symbol, unknown>;
      const value = targetRecord[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Create proxies for backward compatibility
// These will lazily initialize the pool/db on first access
export const pool: pg.Pool = createLazyProxy(ensurePool);

export const db: NodePgDatabase<typeof schema> = createLazyProxy(getDbInstance);

// Re-export schema tables (these don't need DB connection)
export const { users, sessions, chatSessions, messages, events } = schema;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Display database statistics
 */
async function showDatabaseStats(): Promise<void> {
  try {
    const realPool = ensurePool();
    const result = await realPool.query(`
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

/**
 * Initialize database with migrations and validation
 * Call this explicitly when you need full initialization (backend, CLI db commands)
 */
export async function initializeDatabase(): Promise<void> {
  // Return existing promise if initialization is in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  // Skip if already complete
  if (initializationComplete) {
    return;
  }

  initializationPromise = doInitialize();
  return initializationPromise;
}

async function doInitialize(): Promise<void> {
  // Quick mode: just verify connection
  if (quietMode) {
    try {
      const realPool = ensurePool();
      await realPool.query('SELECT 1');
      initializationComplete = true;
    } catch (error) {
      initializationError = error instanceof Error ? error : new Error(String(error));
    }
    return;
  }

  console.log('');
  console.log('📦 Initializing PostgreSQL database...');
  console.log('');

  try {
    const realPool = ensurePool();

    // Test basic connectivity first
    await realPool.query('SELECT 1');
    console.log('  ✅ Database connection established');

    // Run migrations unless skipped
    const skipMigrations = SKIP_MIGRATIONS;

    if (!skipMigrations) {
      console.log('');
      console.log('Running database migrations...');

      const migrationResult = await runMigrations(DATABASE_URL!, {
        backup: NODE_ENV === 'production',
        backupDir: BACKUP_DIR,
      });

      if (!migrationResult.success) {
        console.error('');
        console.error('❌ Migration failed:', migrationResult.error);
        if (migrationResult.details) {
          for (const detail of migrationResult.details) {
            console.error('  ', detail);
          }
        }
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
    const schemaUpdate = await ensureSchemaUpToDate(realPool);

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

    if (schemaUpdate.duplicatesRemoved > 0) {
      console.log(`  Cleaned up duplicate events: ${schemaUpdate.duplicatesRemoved} removed`);
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

    if (schemaUpdate.columnsAdded.length === 0 && schemaUpdate.columnsRemoved.length === 0 && schemaUpdate.errors.length === 0 && schemaUpdate.duplicatesRemoved === 0) {
      console.log('  ✅ Schema is up to date');
    }

    // Validate schema
    console.log('');
    console.log('Validating database schema...');
    const validation = await validateSchema(realPool);

    if (!validation.valid) {
      console.error('');
      console.error(formatSchemaErrors(validation));

      if (NODE_ENV === 'production') {
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
    connectionManager = createConnection(DATABASE_URL!, {
      maxConnections: 1,  // Health checks only need 1 connection
      minConnections: 0,
      maxRetries: RETRY.DEFAULT.MAX_ATTEMPTS,
      baseRetryDelayMs: RETRY.DEFAULT.BASE_DELAY_MS,
      maxRetryDelayMs: CONTEXT_RETRY.DB_HEALTH_CHECK.MAX_DELAY_MS,
    });

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

    console.warn('⚠️  Database may not be fully initialized');
  }
}

/**
 * Wait for database initialization to complete
 * Use this if you need to ensure migrations have run before proceeding
 */
export async function waitForDatabase(): Promise<void> {
  if (initializationPromise) {
    await initializationPromise;
  }
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
export function getDb(): NodePgDatabase<typeof schema> {
  return getDbInstance();
}

/**
 * Get the raw pool instance
 */
export function getPool(): pg.Pool {
  return ensurePool();
}

/**
 * Get connection statistics
 */
export function getConnectionStats(): ConnectionStats | null {
  if (!_pool) return null;

  return connectionManager?.getStats() || {
    totalCount: _pool.totalCount,
    idleCount: _pool.idleCount,
    waitingCount: _pool.waitingCount,
    maxConnections: LIMITS.DATABASE.MAX_CONNECTIONS,
    healthy: true,
    lastHealthCheck: null,
    consecutiveFailures: 0,
    uptime: 0,
  };
}

/**
 * Perform a manual health check
 */
export async function checkHealth(): Promise<DatabaseHealthCheckResult> {
  const start = Date.now();

  try {
    const realPool = ensurePool();
    await realPool.query('SELECT 1');
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
  if (!_pool) return false;
  return _pool.totalCount > 0 && _pool.idleCount >= 0;
}

/**
 * Close the database connection gracefully
 */
export async function closeDatabase(): Promise<void> {
  if (connectionManager) {
    await connectionManager.close();
    connectionManager = null;
  }
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
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
  LiveChatMessage,
  NewLiveChatMessage,
  WorkspacePresence,
  NewWorkspacePresence,
  WorkspaceEvent,
  NewWorkspaceEvent,
  OrchestratorJob,
  NewOrchestratorJob,
  OrchestratorCycle,
  NewOrchestratorCycle,
  OrchestratorTask,
  NewOrchestratorTask,
  Organization,
  NewOrganization,
  OrganizationMember,
  NewOrganizationMember,
  OrganizationRepository,
  NewOrganizationRepository,
  OrganizationInvitation,
  NewOrganizationInvitation,
  OrganizationRole,
  // Players feature types
  Game,
  NewGame,
  UserLibraryItem,
  NewUserLibraryItem,
  Purchase,
  NewPurchase,
  CommunityPost,
  NewCommunityPost,
  CommunityComment,
  NewCommunityComment,
  CommunityVote,
  NewCommunityVote,
  WishlistItem,
  NewWishlistItem,
  // Community channels types
  CommunityChannel,
  NewCommunityChannel,
  ChannelMessage,
  NewChannelMessage,
  // Collections types
  Collection,
  NewCollection,
  SessionCollection,
  NewSessionCollection,
  // Payment types
  PaymentTransaction,
  NewPaymentTransaction,
  PaymentWebhook,
  NewPaymentWebhook,
  // Taxonomy system types
  Taxonomy,
  NewTaxonomy,
  TaxonomyTerm,
  NewTaxonomyTerm,
  ItemTaxonomy,
  NewItemTaxonomy,
  // Game platform library types
  GamePlatform,
  NewGamePlatform,
  GameSystemRequirement,
  NewGameSystemRequirement,
  GameBuild,
  NewGameBuild,
  GameInstallation,
  NewGameInstallation,
  GameAchievement,
  NewGameAchievement,
  UserAchievement,
  NewUserAchievement,
  GameCloudSave,
  NewGameCloudSave,
  // Announcements types
  Announcement,
  NewAnnouncement,
  // Cloud saves types
  CloudSave,
  NewCloudSave,
  CloudSaveVersion,
  NewCloudSaveVersion,
  CloudSaveSyncLog,
  NewCloudSaveSyncLog,
  // Snippets types
  Snippet,
  NewSnippet,
  SnippetCollection,
  NewSnippetCollection,
  SnippetInCollection,
  NewSnippetInCollection,
  SnippetLanguage,
  SnippetCategory,
  // User role type
  UserRole,
} from './schema.js';

// Re-export table definitions from schema
export {
  // User role utilities
  ROLE_HIERARCHY,
  hasRolePermission,
  isValidRole,
  // Organization role utilities
  isOrganizationRole,
  ORGANIZATION_ROLES,
  liveChatMessages,
  workspacePresence,
  workspaceEvents,
  orchestratorJobs,
  orchestratorCycles,
  orchestratorTasks,
  organizations,
  organizationMembers,
  organizationRepositories,
  organizationInvitations,
  // Players feature tables
  games,
  userLibrary,
  purchases,
  communityPosts,
  communityComments,
  communityVotes,
  wishlists,
  // Community channels tables
  communityChannels,
  channelMessages,
  // Collections tables
  collections,
  sessionCollections,
  // Payment tables
  paymentTransactions,
  paymentWebhooks,
  // Taxonomy system tables
  taxonomies,
  taxonomyTerms,
  itemTaxonomies,
  // Game platform library tables
  gamePlatforms,
  gameSystemRequirements,
  gameBuilds,
  gameInstallations,
  gameAchievements,
  userAchievements,
  gameCloudSaves,
  // Announcements tables
  announcements,
  // Cloud saves tables
  cloudSaves,
  cloudSaveVersions,
  cloudSaveSyncLog,
  // Snippets tables
  snippets,
  snippetCollections,
  snippetsInCollections,
  SNIPPET_LANGUAGES,
  SNIPPET_CATEGORIES,
} from './schema.js';

// Re-export migration utilities for CLI usage
export {
  runMigrations,
  validateSchema,
  formatSchemaErrors,
  getCurrentMigrationVersion,
  getAppliedMigrations,
  createBackup,
  ensureSchemaUpToDate,
  getDatabaseDiagnostics,
  type MigrationResult,
  type SchemaValidationResult,
  type BackupResult,
} from './migrations.js';

// Re-export connection utilities
export {
  DatabaseConnection,
  createConnection,
  withRetry as withDatabaseRetry,
  type ConnectionStats,
  type DatabaseHealthCheckResult,
} from './connection.js';

// Re-export transaction utilities
export {
  withTransaction,
  withTransactionOrThrow,
  createTransactionHelper,
  type TransactionContext,
  type TransactionOptions,
  type TransactionResult,
} from './transaction.js';

// Re-export drizzle-orm operators to prevent duplicate package issues in Docker builds
// Consumers should import these from @webedt/shared instead of drizzle-orm directly
export {
  eq,
  and,
  or,
  not,
  lt,
  lte,
  gt,
  gte,
  ne,
  sql,
  asc,
  desc,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  like,
  ilike,
  between,
  exists,
} from 'drizzle-orm';

// Re-export encrypted column types for schema definition
export {
  encryptedText,
  encryptedJsonColumn,
} from './encryptedColumns.js';

// Re-export auth data types (canonical definitions from authTypes.ts)
export type {
  ClaudeAuthData,
  CodexAuthData,
  GeminiAuthData,
  ImageAiKeysData,
} from './authTypes.js';
