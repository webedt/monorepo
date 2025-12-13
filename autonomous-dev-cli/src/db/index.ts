import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { pgTable, serial, text, timestamp, boolean, integer, json } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';
import {
  withTimeout,
  DEFAULT_TIMEOUTS,
  getTimeoutFromEnv,
  TimeoutError,
} from '../utils/timeout.js';
import { getErrorMessage } from '../utils/errors.js';

const { Pool } = pg;

// ============================================================================
// Connection Pool Configuration
// ============================================================================

export interface PoolConfig {
  max?: number; // Maximum number of clients in the pool (default: 20)
  min?: number; // Minimum number of clients in the pool (default: 2)
  idleTimeoutMillis?: number; // How long a client can sit idle (default: 30000)
  connectionTimeoutMillis?: number; // How long to wait for connection (default: 5000)
  acquireTimeoutMillis?: number; // How long to wait for acquire (default: 10000)
  statementTimeout?: number; // Query timeout in ms (default: 30000)
}

// ============================================================================
// Schema (matching internal-api-server)
// ============================================================================

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  githubId: text('github_id').unique(),
  githubAccessToken: text('github_access_token'),
  claudeAuth: json('claude_auth').$type<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  }>(),
  codexAuth: json('codex_auth').$type<{
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }>(),
  geminiAuth: json('gemini_auth').$type<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    tokenType?: string;
    scope?: string;
  }>(),
  openrouterApiKey: text('openrouter_api_key'),
  autocompleteEnabled: boolean('autocomplete_enabled').default(true).notNull(),
  autocompleteModel: text('autocomplete_model').default('openai/gpt-oss-120b:cerebras'),
  imageAiKeys: json('image_ai_keys').$type<{
    openrouter?: string;
    cometapi?: string;
    google?: string;
  }>(),
  imageAiProvider: text('image_ai_provider').default('openrouter'),
  imageAiModel: text('image_ai_model').default('google/gemini-2.5-flash-image'),
  preferredProvider: text('preferred_provider').default('claude').notNull(),
  imageResizeMaxDimension: integer('image_resize_max_dimension').default(1024).notNull(),
  voiceCommandKeywords: json('voice_command_keywords').$type<string[]>().default([]),
  stopListeningAfterSubmit: boolean('stop_listening_after_submit').default(false).notNull(),
  defaultLandingPage: text('default_landing_page').default('store').notNull(),
  preferredModel: text('preferred_model'),
  chatVerbosityLevel: text('chat_verbosity_level').default('verbose').notNull(),
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sessionPath: text('session_path').unique(),
  repositoryOwner: text('repository_owner'),
  repositoryName: text('repository_name'),
  userRequest: text('user_request').notNull(),
  status: text('status').notNull().default('pending'),
  repositoryUrl: text('repository_url'),
  baseBranch: text('base_branch'),
  branch: text('branch'),
  provider: text('provider').default('claude'),
  providerSessionId: text('provider_session_id'),
  autoCommit: boolean('auto_commit').default(false).notNull(),
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  deletedAt: timestamp('deleted_at'),
  workerLastActivity: timestamp('worker_last_activity'),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  chatSessionId: text('chat_session_id').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull(),
  images: json('images').$type<Array<{
    id: string;
    data: string;
    mediaType: string;
    fileName: string;
  }>>(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  chatSessionId: text('chat_session_id').notNull(),
  eventType: text('event_type').notNull(),
  eventData: json('event_data').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// Execution history for task audit trail
export const taskExecutionHistory = pgTable('task_execution_history', {
  id: serial('id').primaryKey(),
  taskId: text('task_id').notNull(),
  issueNumber: integer('issue_number'),
  branchName: text('branch_name'),
  repository: text('repository').notNull(),
  priority: text('priority').notNull().default('medium'),
  category: text('category'),
  complexity: text('complexity'),
  status: text('status').notNull(), // 'queued' | 'started' | 'completed' | 'failed' | 'dropped' | 'retrying'
  workerId: text('worker_id'),
  queuedAt: timestamp('queued_at').notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  duration: integer('duration'), // milliseconds
  retryCount: integer('retry_count').default(0).notNull(),
  maxRetries: integer('max_retries').default(3).notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  isRetryable: boolean('is_retryable'),
  priorityScore: integer('priority_score'),
  groupId: text('group_id'),
  metadata: json('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Types
// ============================================================================

export type User = typeof users.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DbEvent = typeof events.$inferSelect;
export type TaskExecutionHistoryEntry = typeof taskExecutionHistory.$inferSelect;

/** Status values for task execution */
export type TaskExecutionStatus = 'queued' | 'started' | 'completed' | 'failed' | 'dropped' | 'retrying';

/** Priority levels for tasks */
export type TaskPriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/** Parameters for recording task execution history */
export interface RecordExecutionHistoryParams {
  taskId: string;
  repository: string;
  status: TaskExecutionStatus;
  issueNumber?: number;
  branchName?: string;
  priority?: TaskPriorityLevel;
  category?: string;
  complexity?: string;
  workerId?: string;
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  retryCount?: number;
  maxRetries?: number;
  errorCode?: string;
  errorMessage?: string;
  isRetryable?: boolean;
  priorityScore?: number;
  groupId?: string;
  metadata?: Record<string, unknown>;
}

/** Query options for execution history */
export interface ExecutionHistoryQueryOptions {
  repository?: string;
  status?: TaskExecutionStatus;
  priority?: TaskPriorityLevel;
  workerId?: string;
  since?: Date;
  until?: Date;
  issueNumber?: number;
  limit?: number;
  offset?: number;
}

export interface UserCredentials {
  userId: string;
  githubAccessToken: string | null;
  claudeAuth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null;
  codexAuth: {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null;
  geminiAuth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null;
}

export interface CreateChatSessionParams {
  userId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl: string;
  baseBranch: string;
  userRequest: string;
  provider?: string;
}

export interface EventData {
  type: string;
  message?: string;
  stage?: string;
  data?: unknown;
  [key: string]: unknown;
}

// ============================================================================
// Database Connection
// ============================================================================

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let poolConfig: PoolConfig = {};
let poolStats = {
  totalConnections: 0,
  idleConnections: 0,
  waitingClients: 0,
  queryCount: 0,
  lastQueryTime: 0,
};

/**
 * Initialize database with optimized connection pool settings
 * Supports configuration for concurrent worker scenarios
 */
export async function initDatabase(databaseUrl: string, config: PoolConfig = {}): Promise<void> {
  if (pool) {
    return;
  }

  poolConfig = config;

  // Calculate optimal pool size based on expected concurrent workers
  const maxConnections = config.max ?? 20; // Higher default for concurrent workers
  const minConnections = config.min ?? 2;

  pool = new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    min: minConnections,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5000,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    // Additional optimizations
    application_name: 'autonomous-dev-cli',
    statement_timeout: config.statementTimeout ?? 30000,
    query_timeout: config.statementTimeout ?? 30000,
  });

  // Set up pool event handlers for monitoring
  pool.on('connect', () => {
    poolStats.totalConnections++;
    logger.debug('Pool: new client connected', { total: poolStats.totalConnections });
  });

  pool.on('acquire', () => {
    logger.debug('Pool: client acquired');
  });

  pool.on('remove', () => {
    poolStats.totalConnections--;
    logger.debug('Pool: client removed', { total: poolStats.totalConnections });
  });

  pool.on('error', (err) => {
    logger.error('Pool: unexpected error', { error: err.message });
  });

  db = drizzle(pool, { schema: { users, chatSessions, messages, events, taskExecutionHistory } });

  try {
    await pool.query('SELECT 1');
    logger.info('Database connection established', {
      maxConnections,
      minConnections,
      idleTimeout: config.idleTimeoutMillis ?? 30000,
    });
  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw error;
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase first.');
  }
  return db;
}

/**
 * Get current pool status for monitoring
 */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
} {
  if (!pool) {
    return { totalCount: 0, idleCount: 0, waitingCount: 0, maxConnections: 0 };
  }

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    maxConnections: poolConfig.max ?? 20,
  };
}

/**
 * Check pool health and log warnings if connections are exhausted
 */
export function checkPoolHealth(): boolean {
  const stats = getPoolStats();

  if (stats.waitingCount > 0) {
    logger.warn('Database pool has waiting clients', {
      waiting: stats.waitingCount,
      total: stats.totalCount,
      max: stats.maxConnections,
    });
    return false;
  }

  if (stats.totalCount >= stats.maxConnections * 0.9) {
    logger.warn('Database pool near capacity', {
      total: stats.totalCount,
      max: stats.maxConnections,
    });
    return false;
  }

  return true;
}

/**
 * Options for closing the database connection
 */
export interface CloseDatabaseOptions {
  /** Timeout in milliseconds for closing connections (default: 10000) */
  timeoutMs?: number;
  /** Force close even if connections are active (default: false) */
  force?: boolean;
}

/**
 * Close database connections gracefully with timeout handling.
 * Ensures all connections are properly drained before closing.
 */
export async function closeDatabase(options: CloseDatabaseOptions = {}): Promise<void> {
  const { timeoutMs = 10000, force = false } = options;

  if (!pool) {
    logger.debug('Database connection already closed');
    return;
  }

  // Flush any pending activity updates before closing
  try {
    await flushActivityUpdates();
  } catch (error: unknown) {
    logger.warn(`Failed to flush activity updates: ${getErrorMessage(error)}`);
  }

  const stats = getPoolStats();
  logger.info('Closing database connections...', {
    totalConnections: stats.totalCount,
    idleConnections: stats.idleCount,
    waitingClients: stats.waitingCount,
  });

  // Create timeout promise
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Database close timeout exceeded (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    // Wait for pool to drain or timeout
    await Promise.race([
      pool.end(),
      timeoutPromise,
    ]);

    pool = null;
    db = null;
    logger.info('Database connection closed gracefully');
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    if (errorMsg.includes('timeout')) {
      logger.warn(`Database close timed out after ${timeoutMs}ms`);

      if (force) {
        logger.warn('Forcing database connection close...');
        // Force close by directly destroying all clients
        try {
          // The pool.end() should be called regardless to cleanup
          if (pool) {
            pool.end().catch(() => {
              // Ignore errors on force close
            });
          }
        } catch {
          // Ignore errors during force close
        }
        pool = null;
        db = null;
        logger.warn('Database connection forcefully closed');
      } else {
        throw error;
      }
    } else {
      logger.error(`Database close error: ${errorMsg}`);
      throw error;
    }
  }
}

// ============================================================================
// Query Timeout Utilities
// ============================================================================

/**
 * Get the configured database query timeout from environment or defaults
 */
export function getDatabaseTimeout(): number {
  return getTimeoutFromEnv('DATABASE_QUERY', DEFAULT_TIMEOUTS.DATABASE_QUERY);
}

/**
 * Execute a database query with timeout protection.
 * Wraps any async database operation to ensure it doesn't hang indefinitely.
 *
 * @param queryFn - The async function containing the database query
 * @param operationName - Name of the operation for error messages
 * @param timeoutMs - Optional custom timeout in ms (defaults to DATABASE_QUERY timeout)
 * @returns The result of the query
 * @throws TimeoutError if the query times out
 *
 * @example
 * ```typescript
 * const user = await withQueryTimeout(
 *   () => db.select().from(users).where(eq(users.id, id)),
 *   'getUserById'
 * );
 * ```
 */
export async function withQueryTimeout<T>(
  queryFn: () => Promise<T>,
  operationName: string,
  timeoutMs?: number
): Promise<T> {
  const timeout = timeoutMs ?? getDatabaseTimeout();

  return withTimeout(
    async () => queryFn(),
    {
      timeoutMs: timeout,
      operationName: `Database: ${operationName}`,
      context: {
        poolStats: getPoolStats(),
      },
      onTimeout: (ms, opName) => {
        logger.warn(`Database query timed out: ${opName}`, {
          timeoutMs: ms,
          poolStats: getPoolStats(),
        });
      },
    }
  );
}

// ============================================================================
// User Operations
// ============================================================================

export async function getUserCredentials(email: string): Promise<UserCredentials | null> {
  const database = getDb();

  try {
    // Wrap the query with timeout protection
    const result = await withQueryTimeout(
      () => database
        .select({
          userId: users.id,
          githubAccessToken: users.githubAccessToken,
          claudeAuth: users.claudeAuth,
          codexAuth: users.codexAuth,
          geminiAuth: users.geminiAuth,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1),
      'getUserCredentials'
    );

    if (result.length === 0) {
      logger.warn(`User not found: ${email}`);
      return null;
    }

    const user = result[0];
    return {
      userId: user.userId,
      githubAccessToken: user.githubAccessToken,
      claudeAuth: user.claudeAuth,
      codexAuth: user.codexAuth,
      geminiAuth: user.geminiAuth,
    };
  } catch (error) {
    // Provide more context for timeout errors
    if (error instanceof TimeoutError) {
      logger.error(`Database query timed out while getting user credentials for ${email}`, { error });
    } else {
      logger.error(`Failed to get user credentials for ${email}`, { error });
    }
    throw error;
  }
}

// ============================================================================
// Chat Session Operations
// ============================================================================

export async function createChatSession(params: CreateChatSessionParams): Promise<ChatSession> {
  const database = getDb();
  const sessionId = randomUUID();

  const [session] = await database
    .insert(chatSessions)
    .values({
      id: sessionId,
      userId: params.userId,
      repositoryOwner: params.repositoryOwner,
      repositoryName: params.repositoryName,
      repositoryUrl: params.repositoryUrl,
      baseBranch: params.baseBranch,
      userRequest: params.userRequest,
      provider: params.provider || 'claude',
      status: 'pending',
      autoCommit: true,
    })
    .returning();

  logger.debug(`Created chat session: ${sessionId}`);
  return session;
}

export async function updateChatSession(
  sessionId: string,
  updates: Partial<{
    status: string;
    branch: string;
    sessionPath: string;
    providerSessionId: string;
    completedAt: Date;
    workerLastActivity: Date;
  }>
): Promise<void> {
  const database = getDb();

  await database
    .update(chatSessions)
    .set(updates)
    .where(eq(chatSessions.id, sessionId));

  logger.debug(`Updated chat session: ${sessionId}`, { updates });
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  const database = getDb();

  const [session] = await database
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  return session || null;
}

// ============================================================================
// Message Operations
// ============================================================================

export async function addMessage(
  chatSessionId: string,
  type: 'user' | 'assistant' | 'system' | 'error',
  content: string
): Promise<Message> {
  const database = getDb();

  const [message] = await database
    .insert(messages)
    .values({
      chatSessionId,
      type,
      content,
    })
    .returning();

  return message;
}

// ============================================================================
// Event Operations
// ============================================================================

export async function addEvent(
  chatSessionId: string,
  eventType: string,
  eventData: EventData
): Promise<DbEvent> {
  const database = getDb();

  const [event] = await database
    .insert(events)
    .values({
      chatSessionId,
      eventType,
      eventData,
    })
    .returning();

  // Also update worker last activity
  await database
    .update(chatSessions)
    .set({ workerLastActivity: new Date() })
    .where(eq(chatSessions.id, chatSessionId));

  return event;
}

// Helper to generate session path (matches internal-api-server format)
export function generateSessionPath(owner: string, repo: string, branch: string): string {
  return `${owner}__${repo}__${branch.replace(/\//g, '-')}`;
}

// ============================================================================
// Batch Operations for Improved Performance
// ============================================================================

/**
 * Add multiple messages in a single batch operation
 * More efficient than individual inserts for high-volume scenarios
 */
export async function addMessagesBatch(
  chatSessionId: string,
  msgs: Array<{ type: 'user' | 'assistant' | 'system' | 'error'; content: string }>
): Promise<Message[]> {
  if (msgs.length === 0) return [];

  const database = getDb();

  const values = msgs.map((msg) => ({
    chatSessionId,
    type: msg.type,
    content: msg.content,
  }));

  const insertedMessages = await database
    .insert(messages)
    .values(values)
    .returning();

  logger.debug(`Batch inserted ${insertedMessages.length} messages`);
  return insertedMessages;
}

/**
 * Add multiple events in a single batch operation
 */
export async function addEventsBatch(
  chatSessionId: string,
  evts: Array<{ eventType: string; eventData: EventData }>
): Promise<DbEvent[]> {
  if (evts.length === 0) return [];

  const database = getDb();

  const values = evts.map((evt) => ({
    chatSessionId,
    eventType: evt.eventType,
    eventData: evt.eventData,
  }));

  const insertedEvents = await database
    .insert(events)
    .values(values)
    .returning();

  // Update worker last activity once for the batch
  await database
    .update(chatSessions)
    .set({ workerLastActivity: new Date() })
    .where(eq(chatSessions.id, chatSessionId));

  logger.debug(`Batch inserted ${insertedEvents.length} events`);
  return insertedEvents;
}

/**
 * Optimized addEvent that batches worker activity updates
 * Uses a debounce mechanism to avoid excessive updates
 */
const activityUpdateTimers = new Map<string, NodeJS.Timeout>();
const ACTIVITY_UPDATE_DEBOUNCE_MS = 5000; // Only update activity every 5 seconds

export async function addEventOptimized(
  chatSessionId: string,
  eventType: string,
  eventData: EventData
): Promise<DbEvent> {
  const database = getDb();

  const [event] = await database
    .insert(events)
    .values({
      chatSessionId,
      eventType,
      eventData,
    })
    .returning();

  // Debounce worker activity updates to reduce database load
  if (!activityUpdateTimers.has(chatSessionId)) {
    const timer = setTimeout(async () => {
      try {
        await database
          .update(chatSessions)
          .set({ workerLastActivity: new Date() })
          .where(eq(chatSessions.id, chatSessionId));
      } catch (err) {
        logger.warn('Failed to update worker activity', { chatSessionId, error: err });
      }
      activityUpdateTimers.delete(chatSessionId);
    }, ACTIVITY_UPDATE_DEBOUNCE_MS);

    activityUpdateTimers.set(chatSessionId, timer);
  }

  return event;
}

/**
 * Flush pending activity updates (call before closing session)
 */
export async function flushActivityUpdates(chatSessionId?: string): Promise<void> {
  const database = getDb();

  if (chatSessionId) {
    const timer = activityUpdateTimers.get(chatSessionId);
    if (timer) {
      clearTimeout(timer);
      activityUpdateTimers.delete(chatSessionId);
      await database
        .update(chatSessions)
        .set({ workerLastActivity: new Date() })
        .where(eq(chatSessions.id, chatSessionId));
    }
  } else {
    // Flush all pending updates
    const entries: Array<[string, NodeJS.Timeout]> = [];
    activityUpdateTimers.forEach((timer, sessionId) => {
      entries.push([sessionId, timer]);
    });
    for (const [sessionId, timer] of entries) {
      clearTimeout(timer);
      try {
        await database
          .update(chatSessions)
          .set({ workerLastActivity: new Date() })
          .where(eq(chatSessions.id, sessionId));
      } catch (err) {
        logger.warn('Failed to flush activity update', { sessionId, error: err });
      }
    }
    activityUpdateTimers.clear();
  }
}

// ============================================================================
// Task Execution History Operations
// ============================================================================

/**
 * Record a task execution event in the history.
 * This creates or updates a history entry for audit trail purposes.
 */
export async function recordExecutionHistory(
  params: RecordExecutionHistoryParams
): Promise<TaskExecutionHistoryEntry> {
  const database = getDb();

  const [entry] = await withQueryTimeout(
    () => database
      .insert(taskExecutionHistory)
      .values({
        taskId: params.taskId,
        repository: params.repository,
        status: params.status,
        issueNumber: params.issueNumber,
        branchName: params.branchName,
        priority: params.priority ?? 'medium',
        category: params.category,
        complexity: params.complexity,
        workerId: params.workerId,
        queuedAt: params.queuedAt ?? new Date(),
        startedAt: params.startedAt,
        completedAt: params.completedAt,
        duration: params.duration,
        retryCount: params.retryCount ?? 0,
        maxRetries: params.maxRetries ?? 3,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        isRetryable: params.isRetryable,
        priorityScore: params.priorityScore,
        groupId: params.groupId,
        metadata: params.metadata,
      })
      .returning(),
    'recordExecutionHistory'
  );

  logger.debug(`Recorded execution history: ${params.taskId} - ${params.status}`);
  return entry;
}

/**
 * Update an existing execution history entry
 */
export async function updateExecutionHistory(
  taskId: string,
  updates: Partial<Omit<RecordExecutionHistoryParams, 'taskId' | 'repository'>>
): Promise<void> {
  const database = getDb();

  await withQueryTimeout(
    () => database
      .update(taskExecutionHistory)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(taskExecutionHistory.taskId, taskId)),
    'updateExecutionHistory'
  );

  logger.debug(`Updated execution history: ${taskId}`);
}

/**
 * Query execution history with optional filters
 */
export async function queryExecutionHistory(
  options: ExecutionHistoryQueryOptions = {}
): Promise<TaskExecutionHistoryEntry[]> {
  const database = getDb();

  return withQueryTimeout(
    async () => {
      // Build where conditions dynamically
      const whereConditions: ReturnType<typeof sql>[] = [];

      if (options.repository) {
        whereConditions.push(sql`${taskExecutionHistory.repository} = ${options.repository}`);
      }
      if (options.status) {
        whereConditions.push(sql`${taskExecutionHistory.status} = ${options.status}`);
      }
      if (options.priority) {
        whereConditions.push(sql`${taskExecutionHistory.priority} = ${options.priority}`);
      }
      if (options.workerId) {
        whereConditions.push(sql`${taskExecutionHistory.workerId} = ${options.workerId}`);
      }
      if (options.issueNumber) {
        whereConditions.push(sql`${taskExecutionHistory.issueNumber} = ${options.issueNumber}`);
      }
      if (options.since) {
        whereConditions.push(sql`${taskExecutionHistory.queuedAt} >= ${options.since}`);
      }
      if (options.until) {
        whereConditions.push(sql`${taskExecutionHistory.queuedAt} <= ${options.until}`);
      }

      // Build the query with all conditions
      if (whereConditions.length === 0) {
        return database
          .select()
          .from(taskExecutionHistory)
          .orderBy(sql`${taskExecutionHistory.createdAt} DESC`)
          .limit(options.limit ?? 100)
          .offset(options.offset ?? 0);
      }

      // Combine all conditions with AND
      const combinedCondition = whereConditions.reduce((acc, cond, idx) => {
        if (idx === 0) return cond;
        return sql`${acc} AND ${cond}`;
      });

      return database
        .select()
        .from(taskExecutionHistory)
        .where(combinedCondition)
        .orderBy(sql`${taskExecutionHistory.createdAt} DESC`)
        .limit(options.limit ?? 100)
        .offset(options.offset ?? 0);
    },
    'queryExecutionHistory'
  );
}

/**
 * Get execution statistics for a repository
 */
export async function getExecutionStatistics(
  repository: string,
  since?: Date
): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  avgDuration: number;
  successRate: number;
  totalRetries: number;
  failedTasks: number;
}> {
  const database = getDb();

  return withQueryTimeout(
    async () => {
      // Build where condition
      const whereCondition = since
        ? sql`${taskExecutionHistory.repository} = ${repository} AND ${taskExecutionHistory.queuedAt} >= ${since}`
        : sql`${taskExecutionHistory.repository} = ${repository}`;

      // Get all entries for the repository in the time window
      const entries = await database
        .select()
        .from(taskExecutionHistory)
        .where(whereCondition);

      const stats = {
        total: entries.length,
        byStatus: {} as Record<string, number>,
        byPriority: {} as Record<string, number>,
        avgDuration: 0,
        successRate: 0,
        totalRetries: 0,
        failedTasks: 0,
      };

      let totalDuration = 0;
      let durationCount = 0;
      let successCount = 0;

      for (const entry of entries) {
        // Count by status
        stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;

        // Count by priority
        stats.byPriority[entry.priority] = (stats.byPriority[entry.priority] || 0) + 1;

        // Sum durations
        if (entry.duration) {
          totalDuration += entry.duration;
          durationCount++;
        }

        // Count successes and failures
        if (entry.status === 'completed') {
          successCount++;
        } else if (entry.status === 'failed') {
          stats.failedTasks++;
        }

        // Sum retries
        stats.totalRetries += entry.retryCount;
      }

      stats.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;
      stats.successRate = stats.total > 0 ? (successCount / stats.total) * 100 : 0;

      return stats;
    },
    'getExecutionStatistics'
  );
}

/**
 * Get recent failed tasks that are retryable
 */
export async function getRetryableTasks(
  repository: string,
  limit: number = 10
): Promise<TaskExecutionHistoryEntry[]> {
  const database = getDb();

  return withQueryTimeout(
    () => database
      .select()
      .from(taskExecutionHistory)
      .where(
        sql`${taskExecutionHistory.repository} = ${repository}
            AND ${taskExecutionHistory.status} = 'failed'
            AND ${taskExecutionHistory.isRetryable} = true
            AND ${taskExecutionHistory.retryCount} < ${taskExecutionHistory.maxRetries}`
      )
      .orderBy(sql`${taskExecutionHistory.priorityScore} DESC, ${taskExecutionHistory.createdAt} DESC`)
      .limit(limit),
    'getRetryableTasks'
  );
}

/**
 * Record batch execution history entries efficiently
 */
export async function recordExecutionHistoryBatch(
  entries: RecordExecutionHistoryParams[]
): Promise<TaskExecutionHistoryEntry[]> {
  if (entries.length === 0) return [];

  const database = getDb();

  const values = entries.map(params => ({
    taskId: params.taskId,
    repository: params.repository,
    status: params.status,
    issueNumber: params.issueNumber,
    branchName: params.branchName,
    priority: params.priority ?? 'medium',
    category: params.category,
    complexity: params.complexity,
    workerId: params.workerId,
    queuedAt: params.queuedAt ?? new Date(),
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    duration: params.duration,
    retryCount: params.retryCount ?? 0,
    maxRetries: params.maxRetries ?? 3,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    isRetryable: params.isRetryable,
    priorityScore: params.priorityScore,
    groupId: params.groupId,
    metadata: params.metadata,
  }));

  const insertedEntries = await withQueryTimeout(
    () => database
      .insert(taskExecutionHistory)
      .values(values)
      .returning(),
    'recordExecutionHistoryBatch'
  );

  logger.debug(`Batch recorded ${insertedEntries.length} execution history entries`);
  return insertedEntries;
}

/**
 * Clean up old execution history entries
 */
export async function cleanupExecutionHistory(
  repository: string,
  retentionDays: number = 30
): Promise<number> {
  const database = getDb();
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await withQueryTimeout(
    () => database
      .delete(taskExecutionHistory)
      .where(
        sql`${taskExecutionHistory.repository} = ${repository}
            AND ${taskExecutionHistory.createdAt} < ${cutoffDate}`
      )
      .returning({ id: taskExecutionHistory.id }),
    'cleanupExecutionHistory'
  );

  const deletedCount = result.length;
  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} old execution history entries`, {
      repository,
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
    });
  }

  return deletedCount;
}
