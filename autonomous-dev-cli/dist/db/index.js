import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
const { Pool } = pg;
// User schema (matching internal-api-server)
import { pgTable, text, boolean, integer, json, timestamp } from 'drizzle-orm/pg-core';
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
let pool = null;
let db = null;
export async function initDatabase(databaseUrl) {
    if (pool) {
        return; // Already initialized
    }
    pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    });
    db = drizzle(pool, { schema: { users } });
    // Test connection
    try {
        await pool.query('SELECT 1');
        logger.info('Database connection established');
    }
    catch (error) {
        logger.error('Failed to connect to database', { error });
        throw error;
    }
}
export async function getUserCredentials(email) {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase first.');
    }
    try {
        const result = await db
            .select({
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
export async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
        db = null;
        logger.info('Database connection closed');
    }
}
//# sourceMappingURL=index.js.map