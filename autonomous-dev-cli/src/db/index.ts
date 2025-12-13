import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq, sql, and, gte, lte, desc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { pgTable, serial, text, timestamp, boolean, integer, json } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

// Import analytics schema
import {
  cycleMetrics,
  taskMetrics,
  patternEffectiveness,
  monthlySummary,
  type CycleMetric,
  type NewCycleMetric,
  type TaskMetric,
  type NewTaskMetric,
  type PatternEffectiveness as PatternEffectivenessType,
  type NewPatternEffectiveness,
  type MonthlySummary as MonthlySummaryType,
  type NewMonthlySummary,
} from './schema.js';

// Re-export analytics schema
export {
  cycleMetrics,
  taskMetrics,
  patternEffectiveness,
  monthlySummary,
  type CycleMetric,
  type NewCycleMetric,
  type TaskMetric,
  type NewTaskMetric,
  type PatternEffectivenessType,
  type NewPatternEffectiveness,
  type MonthlySummaryType,
  type NewMonthlySummary,
};

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

// ============================================================================
// Types
// ============================================================================

export type User = typeof users.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DbEvent = typeof events.$inferSelect;

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

  db = drizzle(pool, { schema: { users, chatSessions, messages, events } });

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

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info('Database connection closed');
  }
}

// ============================================================================
// User Operations
// ============================================================================

export async function getUserCredentials(email: string): Promise<UserCredentials | null> {
  const database = getDb();

  try {
    const result = await database
      .select({
        userId: users.id,
        githubAccessToken: users.githubAccessToken,
        claudeAuth: users.claudeAuth,
        codexAuth: users.codexAuth,
        geminiAuth: users.geminiAuth,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

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
    logger.error(`Failed to get user credentials for ${email}`, { error });
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
// Analytics Operations
// ============================================================================

/**
 * Insert a new cycle metrics record
 */
export async function insertCycleMetrics(data: NewCycleMetric): Promise<CycleMetric> {
  const database = getDb();

  const [result] = await database
    .insert(cycleMetrics)
    .values(data)
    .returning();

  logger.debug('Inserted cycle metrics', { correlationId: data.correlationId, cycleNumber: data.cycleNumber });
  return result;
}

/**
 * Insert task metrics for a cycle
 */
export async function insertTaskMetrics(data: NewTaskMetric): Promise<TaskMetric> {
  const database = getDb();

  const [result] = await database
    .insert(taskMetrics)
    .values(data)
    .returning();

  return result;
}

/**
 * Insert multiple task metrics in a batch
 */
export async function insertTaskMetricsBatch(data: NewTaskMetric[]): Promise<TaskMetric[]> {
  if (data.length === 0) return [];

  const database = getDb();

  const results = await database
    .insert(taskMetrics)
    .values(data)
    .returning();

  logger.debug(`Batch inserted ${results.length} task metrics`);
  return results;
}

/**
 * Get cycle metrics for a date range
 */
export async function getCycleMetrics(
  repository: string,
  startDate: Date,
  endDate: Date
): Promise<CycleMetric[]> {
  const database = getDb();

  return database
    .select()
    .from(cycleMetrics)
    .where(
      and(
        eq(cycleMetrics.repository, repository),
        gte(cycleMetrics.startedAt, startDate),
        lte(cycleMetrics.startedAt, endDate)
      )
    )
    .orderBy(desc(cycleMetrics.startedAt));
}

/**
 * Get task metrics for a correlation ID
 */
export async function getTaskMetricsByCycle(correlationId: string): Promise<TaskMetric[]> {
  const database = getDb();

  return database
    .select()
    .from(taskMetrics)
    .where(eq(taskMetrics.correlationId, correlationId));
}

/**
 * Upsert pattern effectiveness record
 */
export async function upsertPatternEffectiveness(
  data: NewPatternEffectiveness
): Promise<PatternEffectivenessType> {
  const database = getDb();

  // Check if record exists for this pattern and period
  const existing = await database
    .select()
    .from(patternEffectiveness)
    .where(
      and(
        eq(patternEffectiveness.repository, data.repository),
        eq(patternEffectiveness.pattern, data.pattern),
        eq(patternEffectiveness.periodStart, data.periodStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing record
    const [result] = await database
      .update(patternEffectiveness)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(patternEffectiveness.id, existing[0].id))
      .returning();
    return result;
  }

  // Insert new record
  const [result] = await database
    .insert(patternEffectiveness)
    .values(data)
    .returning();

  return result;
}

/**
 * Get top performing patterns for a repository
 */
export async function getTopPatterns(
  repository: string,
  limit: number = 10
): Promise<PatternEffectivenessType[]> {
  const database = getDb();

  return database
    .select()
    .from(patternEffectiveness)
    .where(
      and(
        eq(patternEffectiveness.repository, repository),
        gte(patternEffectiveness.totalTasks, 3) // Minimum sample size
      )
    )
    .orderBy(desc(patternEffectiveness.successRate))
    .limit(limit);
}

/**
 * Upsert monthly summary record
 */
export async function upsertMonthlySummary(
  data: NewMonthlySummary
): Promise<MonthlySummaryType> {
  const database = getDb();

  // Check if record exists for this month
  const existing = await database
    .select()
    .from(monthlySummary)
    .where(
      and(
        eq(monthlySummary.repository, data.repository),
        eq(monthlySummary.year, data.year),
        eq(monthlySummary.month, data.month)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing record
    const [result] = await database
      .update(monthlySummary)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(monthlySummary.id, existing[0].id))
      .returning();
    return result;
  }

  // Insert new record
  const [result] = await database
    .insert(monthlySummary)
    .values(data)
    .returning();

  return result;
}

/**
 * Get monthly summary for a specific month
 */
export async function getMonthlySummary(
  repository: string,
  year: number,
  month: number
): Promise<MonthlySummaryType | null> {
  const database = getDb();

  const results = await database
    .select()
    .from(monthlySummary)
    .where(
      and(
        eq(monthlySummary.repository, repository),
        eq(monthlySummary.year, year),
        eq(monthlySummary.month, month)
      )
    )
    .limit(1);

  return results[0] || null;
}

/**
 * Get monthly summaries for trend analysis (last N months)
 */
export async function getMonthlySummaries(
  repository: string,
  monthCount: number = 12
): Promise<MonthlySummaryType[]> {
  const database = getDb();

  return database
    .select()
    .from(monthlySummary)
    .where(eq(monthlySummary.repository, repository))
    .orderBy(desc(monthlySummary.year), desc(monthlySummary.month))
    .limit(monthCount);
}

/**
 * Get aggregate success rates by category for a date range
 */
export async function getSuccessRatesByCategory(
  repository: string,
  startDate: Date,
  endDate: Date
): Promise<Record<string, { total: number; successful: number; rate: number }>> {
  const database = getDb();

  // Get all task metrics in the date range
  const tasks = await database
    .select()
    .from(taskMetrics)
    .innerJoin(
      cycleMetrics,
      eq(taskMetrics.cycleMetricsId, cycleMetrics.id)
    )
    .where(
      and(
        eq(cycleMetrics.repository, repository),
        gte(cycleMetrics.startedAt, startDate),
        lte(cycleMetrics.startedAt, endDate)
      )
    );

  // Aggregate by category
  const categories: Record<string, { total: number; successful: number; rate: number }> = {};

  for (const { task_metrics: task } of tasks) {
    const category = task.category || 'other';
    if (!categories[category]) {
      categories[category] = { total: 0, successful: 0, rate: 0 };
    }
    categories[category].total++;
    if (task.outcome === 'success') {
      categories[category].successful++;
    }
  }

  // Calculate rates
  for (const category of Object.keys(categories)) {
    const { total, successful } = categories[category];
    categories[category].rate = total > 0 ? (successful / total) * 100 : 0;
  }

  return categories;
}

/**
 * Get aggregate success rates by complexity for a date range
 */
export async function getSuccessRatesByComplexity(
  repository: string,
  startDate: Date,
  endDate: Date
): Promise<Record<string, { total: number; successful: number; rate: number }>> {
  const database = getDb();

  // Get all task metrics in the date range
  const tasks = await database
    .select()
    .from(taskMetrics)
    .innerJoin(
      cycleMetrics,
      eq(taskMetrics.cycleMetricsId, cycleMetrics.id)
    )
    .where(
      and(
        eq(cycleMetrics.repository, repository),
        gte(cycleMetrics.startedAt, startDate),
        lte(cycleMetrics.startedAt, endDate)
      )
    );

  // Aggregate by complexity
  const complexities: Record<string, { total: number; successful: number; rate: number }> = {};

  for (const { task_metrics: task } of tasks) {
    const complexity = task.complexity || 'medium';
    if (!complexities[complexity]) {
      complexities[complexity] = { total: 0, successful: 0, rate: 0 };
    }
    complexities[complexity].total++;
    if (task.outcome === 'success') {
      complexities[complexity].successful++;
    }
  }

  // Calculate rates
  for (const complexity of Object.keys(complexities)) {
    const { total, successful } = complexities[complexity];
    complexities[complexity].rate = total > 0 ? (successful / total) * 100 : 0;
  }

  return complexities;
}
