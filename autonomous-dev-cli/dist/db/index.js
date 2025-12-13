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
    claudeAuth: json('claude_auth').$type(),
    codexAuth: json('codex_auth').$type(),
    geminiAuth: json('gemini_auth').$type(),
    openrouterApiKey: text('openrouter_api_key'),
    autocompleteEnabled: boolean('autocomplete_enabled').default(true).notNull(),
    autocompleteModel: text('autocomplete_model').default('openai/gpt-oss-120b:cerebras'),
    imageAiKeys: json('image_ai_keys').$type(),
    imageAiProvider: text('image_ai_provider').default('openrouter'),
    imageAiModel: text('image_ai_model').default('google/gemini-2.5-flash-image'),
    preferredProvider: text('preferred_provider').default('claude').notNull(),
    imageResizeMaxDimension: integer('image_resize_max_dimension').default(1024).notNull(),
    voiceCommandKeywords: json('voice_command_keywords').$type().default([]),
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
    images: json('images').$type(),
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
// Database Connection
// ============================================================================
let pool = null;
let db = null;
let poolConfig = {};
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
export async function initDatabase(databaseUrl, config = {}) {
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
    }
    catch (error) {
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
export function getPoolStats() {
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
export function checkPoolHealth() {
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
export async function closeDatabase() {
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
export async function getUserCredentials(email) {
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
    }
    catch (error) {
        logger.error(`Failed to get user credentials for ${email}`, { error });
        throw error;
    }
}
// ============================================================================
// Chat Session Operations
// ============================================================================
export async function createChatSession(params) {
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
export async function updateChatSession(sessionId, updates) {
    const database = getDb();
    await database
        .update(chatSessions)
        .set(updates)
        .where(eq(chatSessions.id, sessionId));
    logger.debug(`Updated chat session: ${sessionId}`, { updates });
}
export async function getChatSession(sessionId) {
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
export async function addMessage(chatSessionId, type, content) {
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
export async function addEvent(chatSessionId, eventType, eventData) {
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
export function generateSessionPath(owner, repo, branch) {
    return `${owner}__${repo}__${branch.replace(/\//g, '-')}`;
}
// ============================================================================
// Batch Operations for Improved Performance
// ============================================================================
/**
 * Add multiple messages in a single batch operation
 * More efficient than individual inserts for high-volume scenarios
 */
export async function addMessagesBatch(chatSessionId, msgs) {
    if (msgs.length === 0)
        return [];
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
export async function addEventsBatch(chatSessionId, evts) {
    if (evts.length === 0)
        return [];
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
const activityUpdateTimers = new Map();
const ACTIVITY_UPDATE_DEBOUNCE_MS = 5000; // Only update activity every 5 seconds
export async function addEventOptimized(chatSessionId, eventType, eventData) {
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
            }
            catch (err) {
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
export async function flushActivityUpdates(chatSessionId) {
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
    }
    else {
        // Flush all pending updates
        const entries = [];
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
            }
            catch (err) {
                logger.warn('Failed to flush activity update', { sessionId, error: err });
            }
        }
        activityUpdateTimers.clear();
    }
}
//# sourceMappingURL=index.js.map