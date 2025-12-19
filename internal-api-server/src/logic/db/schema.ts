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
  // Image editing AI provider API keys
  imageAiKeys: json('image_ai_keys').$type<{
    openrouter?: string;
    cometapi?: string;
    google?: string;
  }>(),
  // Image editing AI preferences
  imageAiProvider: text('image_ai_provider').default('openrouter'), // 'openrouter' | 'cometapi' | 'google'
  imageAiModel: text('image_ai_model').default('google/gemini-2.5-flash-image'), // model identifier
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
  provider: text('provider').default('claude'), // 'claude' | 'codex' | 'copilot' | 'gemini' | 'claude-remote'
  providerSessionId: text('provider_session_id'), // Claude SDK session ID for conversation resume
  // Claude Remote Sessions fields
  remoteSessionId: text('remote_session_id'), // Anthropic session ID (e.g., session_01S7DYYtwgMZ3gbAmjMmMpnA)
  remoteWebUrl: text('remote_web_url'), // URL to view session in claude.ai (e.g., https://claude.ai/code/session_xxx)
  totalCost: text('total_cost'), // Cost in USD (stored as string for precision)
  issueNumber: integer('issue_number'), // GitHub issue number linked to this session
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
  eventData: json('event_data').notNull(), // Raw JSON event (includes type field within the JSON)
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

// Live Chat messages - branch-based chat messages for workspace collaboration
export const liveChatMessages = pgTable('live_chat_messages', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(), // GitHub repo owner
  repo: text('repo').notNull(), // GitHub repo name
  branch: text('branch').notNull(), // Branch name
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  toolCalls: json('tool_calls').$type<Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>>(), // For assistant tool use
  images: json('images').$type<Array<{
    id: string;
    data: string;
    mediaType: string;
    fileName?: string;
  }>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Workspace presence - ephemeral state for collaborative editing
// One row per user per branch (UPSERT pattern)
export const workspacePresence = pgTable('workspace_presence', {
  id: text('id').primaryKey(), // Composite: {userId}_{owner}_{repo}_{branch}
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(), // GitHub repo owner
  repo: text('repo').notNull(), // GitHub repo name
  branch: text('branch').notNull(), // Branch name
  page: text('page'), // 'code', 'images', 'sounds', 'scenes', 'chat'
  cursorX: integer('cursor_x'),
  cursorY: integer('cursor_y'),
  selection: json('selection').$type<{
    filePath?: string;
    startLine?: number;
    endLine?: number;
    startCol?: number;
    endCol?: number;
  }>(), // Current selection
  heartbeatAt: timestamp('heartbeat_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Workspace events - append-only log of all actions
export const workspaceEvents = pgTable('workspace_events', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  branch: text('branch').notNull(),
  eventType: text('event_type').notNull(), // 'file_edit', 'file_create', 'file_delete', etc.
  page: text('page'), // 'code', 'images', 'sounds', 'scenes', 'chat'
  path: text('path'), // File/resource path affected
  payload: json('payload').$type<Record<string, unknown>>(), // Event-specific data
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
export type LiveChatMessage = typeof liveChatMessages.$inferSelect;
export type NewLiveChatMessage = typeof liveChatMessages.$inferInsert;
export type WorkspacePresence = typeof workspacePresence.$inferSelect;
export type NewWorkspacePresence = typeof workspacePresence.$inferInsert;
export type WorkspaceEvent = typeof workspaceEvents.$inferSelect;
export type NewWorkspaceEvent = typeof workspaceEvents.$inferInsert;

// Orchestrator Jobs - Long-running multi-cycle agent orchestration
export const orchestratorJobs = pgTable('orchestrator_jobs', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Repository context
  repositoryOwner: text('repository_owner').notNull(),
  repositoryName: text('repository_name').notNull(),
  baseBranch: text('base_branch').notNull(),
  workingBranch: text('working_branch').notNull(),
  sessionPath: text('session_path').notNull(), // Format: {owner}__{repo}__{branch}

  // Goal/Request document
  requestDocument: text('request_document').notNull(), // Markdown content defining the goal
  taskList: text('task_list'), // Current TASKLIST.md content

  // Status
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
  currentCycle: integer('current_cycle').notNull().default(0),

  // Limits
  maxCycles: integer('max_cycles'), // Optional cycle limit
  timeLimitMinutes: integer('time_limit_minutes'), // Optional time limit
  maxParallelTasks: integer('max_parallel_tasks').default(3).notNull(),

  // Provider configuration
  provider: text('provider').default('claude').notNull(), // 'claude' | 'claude-remote'

  // Timestamps
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  // Error tracking
  lastError: text('last_error'),
  errorCount: integer('error_count').default(0).notNull(),
});

// Orchestrator Cycles - Individual cycles within a job
export const orchestratorCycles = pgTable('orchestrator_cycles', {
  id: text('id').primaryKey(), // UUID
  jobId: text('job_id')
    .notNull()
    .references(() => orchestratorJobs.id, { onDelete: 'cascade' }),

  cycleNumber: integer('cycle_number').notNull(),
  phase: text('phase').notNull().default('discovery'), // 'discovery' | 'execution' | 'convergence' | 'update'

  // Task tracking
  tasksDiscovered: integer('tasks_discovered').default(0).notNull(),
  tasksLaunched: integer('tasks_launched').default(0).notNull(),
  tasksCompleted: integer('tasks_completed').default(0).notNull(),
  tasksFailed: integer('tasks_failed').default(0).notNull(),

  // Results
  summary: text('summary'), // LLM-generated cycle summary
  learnings: text('learnings'), // New information discovered

  // Timestamps
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Orchestrator Tasks - Individual tasks within a cycle
export const orchestratorTasks = pgTable('orchestrator_tasks', {
  id: text('id').primaryKey(), // UUID
  cycleId: text('cycle_id')
    .notNull()
    .references(() => orchestratorCycles.id, { onDelete: 'cascade' }),
  jobId: text('job_id')
    .notNull()
    .references(() => orchestratorJobs.id, { onDelete: 'cascade' }),

  // Task definition
  taskNumber: integer('task_number').notNull(),
  description: text('description').notNull(), // What the agent should do
  context: text('context'), // Additional context for the agent
  priority: text('priority').default('P1'), // 'P0' | 'P1' | 'P2'
  canRunParallel: boolean('can_run_parallel').default(true).notNull(),

  // Execution
  agentSessionId: text('agent_session_id')
    .references(() => chatSessions.id, { onDelete: 'set null' }), // The spawned agent session
  taskBranch: text('task_branch'), // Branch created for this task
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

  // Results
  resultSummary: text('result_summary'), // What the agent accomplished
  filesModified: json('files_modified').$type<string[]>(), // List of files changed
  commitsMade: json('commits_made').$type<string[]>(), // Commit hashes

  // Timestamps
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),

  // Error tracking
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0).notNull(),
});

export type OrchestratorJob = typeof orchestratorJobs.$inferSelect;
export type NewOrchestratorJob = typeof orchestratorJobs.$inferInsert;
export type OrchestratorCycle = typeof orchestratorCycles.$inferSelect;
export type NewOrchestratorCycle = typeof orchestratorCycles.$inferInsert;
export type OrchestratorTask = typeof orchestratorTasks.$inferSelect;
export type NewOrchestratorTask = typeof orchestratorTasks.$inferInsert;
