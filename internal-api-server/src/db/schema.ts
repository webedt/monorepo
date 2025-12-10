import { pgTable, serial, text, timestamp, boolean, integer, json } from 'drizzle-orm/pg-core';

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
  // OpenRouter API key for code completions (autocomplete)
  openrouterApiKey: text('openrouter_api_key'),
  // Autocomplete settings
  autocompleteEnabled: boolean('autocomplete_enabled').default(true).notNull(),
  autocompleteModel: text('autocomplete_model').default('openai/gpt-oss-120b:cerebras'),
  preferredProvider: text('preferred_provider').default('claude').notNull(),
  imageResizeMaxDimension: integer('image_resize_max_dimension').default(1024).notNull(),
  voiceCommandKeywords: json('voice_command_keywords').$type<string[]>().default([]),
  stopListeningAfterSubmit: boolean('stop_listening_after_submit').default(false).notNull(),
  defaultLandingPage: text('default_landing_page').default('store').notNull(),
  preferredModel: text('preferred_model'),
  chatVerbosityLevel: text('chat_verbosity_level').default('verbose').notNull(), // 'minimal' | 'normal' | 'verbose'
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(), // UUID instead of serial
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionPath: text('session_path').unique(), // Format: {owner}__{repo}__{branch} - populated after branch creation
  repositoryOwner: text('repository_owner'),
  repositoryName: text('repository_name'),
  userRequest: text('user_request').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'error'
  repositoryUrl: text('repository_url'),
  baseBranch: text('base_branch'),
  branch: text('branch'), // Working branch name - populated when branch is created
  provider: text('provider').default('claude'), // 'claude' | 'codex' | 'copilot' | 'gemini'
  providerSessionId: text('provider_session_id'), // Claude SDK session ID for conversation resume
  autoCommit: boolean('auto_commit').default(false).notNull(),
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  deletedAt: timestamp('deleted_at'), // Soft delete timestamp
  workerLastActivity: timestamp('worker_last_activity'), // Last time worker sent an event (for orphan detection)
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'user' | 'assistant' | 'system' | 'error'
  content: text('content').notNull(),
  images: json('images').$type<Array<{
    id: string;
    data: string;
    mediaType: string;
    fileName: string;
  }>>(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// Raw SSE events table - stores events exactly as received for replay
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(), // SSE event name: 'commit_progress', 'github_pull_progress', 'assistant_message', etc.
  eventData: json('event_data').notNull(), // Raw JSON data from SSE event
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
