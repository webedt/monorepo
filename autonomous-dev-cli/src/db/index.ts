import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { pgTable, serial, text, timestamp, boolean, integer, json } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

const { Pool } = pg;

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

export async function initDatabase(databaseUrl: string): Promise<void> {
  if (pool) {
    return;
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  db = drizzle(pool, { schema: { users, chatSessions, messages, events } });

  try {
    await pool.query('SELECT 1');
    logger.info('Database connection established');
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

  try {
    await database
      .update(chatSessions)
      .set(updates)
      .where(eq(chatSessions.id, sessionId));

    logger.debug(`Updated chat session: ${sessionId}`, { updates });
  } catch (error: any) {
    // Handle unique constraint violations gracefully
    if (error.code === '23505') {
      logger.warn(`Duplicate session_path, skipping update: ${updates.sessionPath}`);
      // Update without session_path
      const { sessionPath, ...otherUpdates } = updates;
      if (Object.keys(otherUpdates).length > 0) {
        await database
          .update(chatSessions)
          .set(otherUpdates)
          .where(eq(chatSessions.id, sessionId));
      }
    } else {
      throw error;
    }
  }
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
