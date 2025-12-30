import { pgTable, serial, text, timestamp, boolean, integer, json, uniqueIndex } from 'drizzle-orm/pg-core';

import {
  encryptedText,
  encryptedJsonColumn,
} from './encryptedColumns.js';

import type {
  ClaudeAuthData,
  CodexAuthData,
  GeminiAuthData,
  ImageAiKeysData,
} from './encryptedColumns.js';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  githubId: text('github_id').unique(),
  // Encrypted credentials - automatically encrypted on write, decrypted on read
  githubAccessToken: encryptedText('github_access_token'),
  claudeAuth: encryptedJsonColumn<ClaudeAuthData>('claude_auth'),
  codexAuth: encryptedJsonColumn<CodexAuthData>('codex_auth'),
  geminiAuth: encryptedJsonColumn<GeminiAuthData>('gemini_auth'),
  // OpenRouter API key for code completions (autocomplete) - encrypted
  openrouterApiKey: encryptedText('openrouter_api_key'),
  // Autocomplete settings
  autocompleteEnabled: boolean('autocomplete_enabled').default(true).notNull(),
  autocompleteModel: text('autocomplete_model').default('openai/gpt-oss-120b:cerebras'),
  // Image editing AI provider API keys - encrypted
  imageAiKeys: encryptedJsonColumn<ImageAiKeysData>('image_ai_keys'),
  // Image editing AI preferences
  imageAiProvider: text('image_ai_provider').default('openrouter'), // 'openrouter' | 'cometapi' | 'google'
  imageAiModel: text('image_ai_model').default('google/gemini-2.5-flash-image'), // model identifier
  preferredProvider: text('preferred_provider').default('claude').notNull(),
  imageResizeMaxDimension: integer('image_resize_max_dimension').default(1024).notNull(),
  voiceCommandKeywords: json('voice_command_keywords').$type<string[]>().default([]),
  stopListeningAfterSubmit: boolean('stop_listening_after_submit').default(false).notNull(),
  defaultLandingPage: text('default_landing_page').default('store').notNull(),
  preferredModel: text('preferred_model'),
  chatVerbosityLevel: text('chat_verbosity_level').default('normal').notNull(), // 'minimal' | 'normal' | 'verbose'
  isAdmin: boolean('is_admin').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Storage quota fields - "Few GB per user" default quota
  storageQuotaBytes: text('storage_quota_bytes').default('5368709120').notNull(), // 5 GB default (stored as string for bigint precision)
  storageUsedBytes: text('storage_used_bytes').default('0').notNull(), // Current usage (stored as string for bigint precision)
  // Spending limits configuration
  spendingLimitEnabled: boolean('spending_limit_enabled').default(false).notNull(),
  monthlyBudgetCents: text('monthly_budget_cents').default('0').notNull(), // Budget in cents (stored as string for precision)
  perTransactionLimitCents: text('per_transaction_limit_cents').default('0').notNull(), // Per-transaction limit in cents
  spendingResetDay: integer('spending_reset_day').default(1).notNull(), // Day of month to reset (1-31)
  currentMonthSpentCents: text('current_month_spent_cents').default('0').notNull(), // Current month spending in cents
  spendingLimitAction: text('spending_limit_action').default('warn').notNull(), // 'warn' | 'block' - action when limit reached
  spendingResetAt: timestamp('spending_reset_at'), // When the current month spending was last reset
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
  organizationId: text('organization_id')
    .references(() => organizations.id, { onDelete: 'set null' }), // Optional organization ownership
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
  favorite: boolean('favorite').default(false).notNull(), // User favorite/starred status
  // Sharing fields - "public but unlisted" (shareable if you know the link)
  shareToken: text('share_token').unique(), // UUID-based token for sharing
  shareExpiresAt: timestamp('share_expires_at'), // Optional expiration date
  // Optimistic locking - version counter for concurrent update detection
  version: integer('version').default(1).notNull(), // Increments on each update
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
  deletedAt: timestamp('deleted_at'), // Soft delete - cascades from parent session
});

// Raw SSE events table - stores events exactly as received for replay
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  uuid: text('uuid'), // Extracted from eventData for efficient deduplication queries
  eventData: json('event_data').notNull(), // Raw JSON event (includes type field within the JSON)
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'), // Soft delete - cascades from parent session
}, (table) => [
  // Index for efficient UUID-based deduplication queries
  uniqueIndex('events_session_uuid_idx').on(table.chatSessionId, table.uuid),
]);

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

// Organizations/Studios - Group accounts that can contain multiple users
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // URL-friendly identifier (e.g., "acme-corp")
  displayName: text('display_name'), // Optional friendly name
  description: text('description'),
  avatarUrl: text('avatar_url'),
  websiteUrl: text('website_url'),
  githubOrg: text('github_org'), // Linked GitHub organization name
  isVerified: boolean('is_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Organization membership roles
export type OrganizationRole = 'owner' | 'admin' | 'member';

/** Valid organization role values */
export const ORGANIZATION_ROLES: readonly OrganizationRole[] = ['owner', 'admin', 'member'] as const;

/** Type guard to check if a string is a valid OrganizationRole */
export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && ORGANIZATION_ROLES.includes(value as OrganizationRole);
}

// Organization members - junction table for users and organizations
export const organizationMembers = pgTable('organization_members', {
  id: text('id').primaryKey(), // UUID
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  invitedBy: text('invited_by')
    .references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  uniqueIndex('org_member_unique_idx').on(table.organizationId, table.userId),
]);

// Organization repositories - tracks repos owned/managed by organizations
export const organizationRepositories = pgTable('organization_repositories', {
  id: text('id').primaryKey(), // UUID
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  repositoryOwner: text('repository_owner').notNull(), // GitHub repo owner
  repositoryName: text('repository_name').notNull(), // GitHub repo name
  isDefault: boolean('is_default').default(false).notNull(), // Default repo for new sessions
  addedBy: text('added_by')
    .references(() => users.id, { onDelete: 'set null' }),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('org_repo_unique_idx').on(table.organizationId, table.repositoryOwner, table.repositoryName),
]);

// Organization invitations - pending invitations
export const organizationInvitations = pgTable('organization_invitations', {
  id: text('id').primaryKey(), // UUID
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  invitedBy: text('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), // Invitation token for acceptance
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('org_invitation_unique_idx').on(table.organizationId, table.email),
]);

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
  provider: text('provider').default('claude').notNull(), // 'claude'

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

// Organization types
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type OrganizationRepository = typeof organizationRepositories.$inferSelect;
export type NewOrganizationRepository = typeof organizationRepositories.$inferInsert;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;

// ============================================================================
// PLAYERS FEATURE - Store, Library, Purchases, Community
// ============================================================================

// Games - Store catalog items
export const games = pgTable('games', {
  id: text('id').primaryKey(), // UUID
  title: text('title').notNull(),
  description: text('description'),
  shortDescription: text('short_description'), // For cards/previews
  price: integer('price').notNull().default(0), // Price in cents (0 = free)
  currency: text('currency').default('USD').notNull(),
  coverImage: text('cover_image'), // URL to cover image
  screenshots: json('screenshots').$type<string[]>().default([]), // Array of image URLs
  trailerUrl: text('trailer_url'), // Video trailer URL
  developer: text('developer'),
  publisher: text('publisher'),
  releaseDate: timestamp('release_date'),
  genres: json('genres').$type<string[]>().default([]), // e.g., ['Action', 'RPG']
  tags: json('tags').$type<string[]>().default([]), // e.g., ['Multiplayer', 'Open World']
  platforms: json('platforms').$type<string[]>().default([]), // e.g., ['Windows', 'Mac', 'Linux']
  rating: text('rating'), // e.g., 'E', 'T', 'M'
  averageScore: integer('average_score'), // User rating average (0-100)
  reviewCount: integer('review_count').default(0).notNull(),
  downloadCount: integer('download_count').default(0).notNull(),
  featured: boolean('featured').default(false).notNull(), // Featured on store front
  status: text('status').default('published').notNull(), // 'draft' | 'published' | 'archived'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Purchases - Transaction records (defined before userLibrary to avoid forward reference)
export const purchases = pgTable('purchases', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(), // Amount in cents
  currency: text('currency').default('USD').notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'completed' | 'pending_refund' | 'refunded' | 'failed'
  paymentMethod: text('payment_method'), // e.g., 'credit_card', 'wallet', 'paypal', 'free'
  paymentDetails: json('payment_details').$type<{
    transactionId?: string;
    last4?: string;
    brand?: string;
  }>(),
  refundedAt: timestamp('refunded_at'),
  refundReason: text('refund_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// User Library - Games owned by users
export const userLibrary = pgTable('user_library', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  purchaseId: text('purchase_id')
    .references(() => purchases.id, { onDelete: 'set null' }),
  acquiredAt: timestamp('acquired_at').defaultNow().notNull(), // When user got the game
  lastPlayedAt: timestamp('last_played_at'),
  playtimeMinutes: integer('playtime_minutes').default(0).notNull(),
  favorite: boolean('favorite').default(false).notNull(),
  hidden: boolean('hidden').default(false).notNull(), // Hide from library view
  installStatus: text('install_status').default('not_installed').notNull(), // 'not_installed' | 'installing' | 'installed'
}, (table) => ({
  // Unique constraint: a user can only have each game once in their library
  userGameUnique: { name: 'user_library_user_game_unique', columns: [table.userId, table.gameId] },
}));

// Community Posts - Discussions, reviews, guides
export const communityPosts = pgTable('community_posts', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .references(() => games.id, { onDelete: 'cascade' }), // Optional - can be general post
  type: text('type').notNull(), // 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement'
  title: text('title').notNull(),
  content: text('content').notNull(),
  images: json('images').$type<string[]>().default([]), // Attached images
  rating: integer('rating'), // For reviews: 1-5 stars
  upvotes: integer('upvotes').default(0).notNull(),
  downvotes: integer('downvotes').default(0).notNull(),
  commentCount: integer('comment_count').default(0).notNull(),
  pinned: boolean('pinned').default(false).notNull(), // Pinned by moderator
  locked: boolean('locked').default(false).notNull(), // Comments disabled
  status: text('status').default('published').notNull(), // 'draft' | 'published' | 'removed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Community Comments - Replies to posts
export const communityComments = pgTable('community_comments', {
  id: text('id').primaryKey(), // UUID
  postId: text('post_id')
    .notNull()
    .references(() => communityPosts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'), // For nested replies - self-reference
  content: text('content').notNull(),
  upvotes: integer('upvotes').default(0).notNull(),
  downvotes: integer('downvotes').default(0).notNull(),
  status: text('status').default('published').notNull(), // 'published' | 'removed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Community Votes - Track user votes on posts/comments
export const communityVotes = pgTable('community_votes', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id')
    .references(() => communityPosts.id, { onDelete: 'cascade' }),
  commentId: text('comment_id')
    .references(() => communityComments.id, { onDelete: 'cascade' }),
  vote: integer('vote').notNull(), // 1 = upvote, -1 = downvote
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: a user can only vote once per post
  userPostVoteUnique: { name: 'community_votes_user_post_unique', columns: [table.userId, table.postId] },
  // Unique constraint: a user can only vote once per comment
  userCommentVoteUnique: { name: 'community_votes_user_comment_unique', columns: [table.userId, table.commentId] },
}));

// Wishlists - Games users want to buy
export const wishlists = pgTable('wishlists', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  priority: integer('priority').default(0).notNull(), // For ordering
  notifyOnSale: boolean('notify_on_sale').default(true).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: a user can only have each game once in their wishlist
  userGameUnique: { name: 'wishlists_user_game_unique', columns: [table.userId, table.gameId] },
}));

// Type exports for Players feature
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type UserLibraryItem = typeof userLibrary.$inferSelect;
export type NewUserLibraryItem = typeof userLibrary.$inferInsert;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type CommunityPost = typeof communityPosts.$inferSelect;
export type NewCommunityPost = typeof communityPosts.$inferInsert;
export type CommunityComment = typeof communityComments.$inferSelect;
export type NewCommunityComment = typeof communityComments.$inferInsert;
export type CommunityVote = typeof communityVotes.$inferSelect;
export type NewCommunityVote = typeof communityVotes.$inferInsert;
export type WishlistItem = typeof wishlists.$inferSelect;
export type NewWishlistItem = typeof wishlists.$inferInsert;

// ============================================================================
// COMMUNITY CHANNELS - Real-time community activity and messaging
// ============================================================================

// Community Channels - Chat channels for community discussions
export const communityChannels = pgTable('community_channels', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // URL-friendly identifier (e.g., "general", "help", "showcase")
  description: text('description'),
  gameId: text('game_id')
    .references(() => games.id, { onDelete: 'cascade' }), // Optional - can be game-specific channel
  isDefault: boolean('is_default').default(false).notNull(), // Default channel for new users
  isReadOnly: boolean('is_read_only').default(false).notNull(), // Only admins can post
  sortOrder: integer('sort_order').default(0).notNull(), // For ordering channels
  status: text('status').default('active').notNull(), // 'active' | 'archived'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Channel Messages - Messages in community channels
export const channelMessages = pgTable('channel_messages', {
  id: text('id').primaryKey(), // UUID
  channelId: text('channel_id')
    .notNull()
    .references(() => communityChannels.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  replyToId: text('reply_to_id'), // For threaded replies
  images: json('images').$type<string[]>().default([]), // Attached images
  edited: boolean('edited').default(false).notNull(),
  status: text('status').default('published').notNull(), // 'published' | 'removed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Type exports for Community Channels
export type CommunityChannel = typeof communityChannels.$inferSelect;
export type NewCommunityChannel = typeof communityChannels.$inferInsert;
export type ChannelMessage = typeof channelMessages.$inferSelect;
export type NewChannelMessage = typeof channelMessages.$inferInsert;

// ============================================================================
// COLLECTIONS - User-created organizational folders for sessions
// ============================================================================

// Collections - User-created organizational folders
export const collections = pgTable('collections', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'), // Optional color for visual distinction (e.g., '#FF5733')
  icon: text('icon'), // Optional icon identifier (e.g., 'folder', 'star', 'code')
  sortOrder: integer('sort_order').default(0).notNull(), // For custom ordering
  isDefault: boolean('is_default').default(false).notNull(), // Default collection for new sessions
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('collection_user_name_idx').on(table.userId, table.name),
]);

// Session Collections - Junction table for sessions in collections (many-to-many)
export const sessionCollections = pgTable('session_collections', {
  id: text('id').primaryKey(), // UUID
  sessionId: text('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  collectionId: text('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('session_collection_unique_idx').on(table.sessionId, table.collectionId),
]);

// Type exports for Collections
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type SessionCollection = typeof sessionCollections.$inferSelect;
export type NewSessionCollection = typeof sessionCollections.$inferInsert;

// ============================================================================
// PAYMENT TRANSACTIONS - Stripe and PayPal payment tracking
// ============================================================================

// Payment Transactions - Tracks payment provider transactions
export const paymentTransactions = pgTable('payment_transactions', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purchaseId: text('purchase_id')
    .references(() => purchases.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(), // 'stripe' | 'paypal'
  providerTransactionId: text('provider_transaction_id').notNull(), // Stripe PaymentIntent ID or PayPal Order ID
  providerSessionId: text('provider_session_id'), // Stripe Checkout Session ID
  type: text('type').notNull(), // 'checkout' | 'payment_intent' | 'refund'
  status: text('status').notNull().default('pending'), // 'pending' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded'
  amount: integer('amount').notNull(), // Amount in cents
  currency: text('currency').default('USD').notNull(),
  metadata: json('metadata').$type<{
    gameId?: string;
    gameName?: string;
    customerEmail?: string;
    [key: string]: string | undefined;
  }>(),
  providerResponse: json('provider_response').$type<Record<string, unknown>>(), // Raw provider response for debugging
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Payment Webhooks - Logs all webhook events for auditing
export const paymentWebhooks = pgTable('payment_webhooks', {
  id: text('id').primaryKey(), // UUID
  provider: text('provider').notNull(), // 'stripe' | 'paypal'
  eventId: text('event_id').notNull(), // Provider's event ID
  eventType: text('event_type').notNull(), // e.g., 'checkout.session.completed'
  transactionId: text('transaction_id')
    .references(() => paymentTransactions.id, { onDelete: 'set null' }),
  payload: json('payload').notNull(), // Raw webhook payload
  processed: boolean('processed').default(false).notNull(),
  processedAt: timestamp('processed_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports for Payment
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
export type PaymentWebhook = typeof paymentWebhooks.$inferSelect;
export type NewPaymentWebhook = typeof paymentWebhooks.$inferInsert;

// ============================================================================
// TAXONOMY SYSTEM - Admin-configurable categories, tags, and genres
// ============================================================================

// Taxonomies - Defines taxonomy types (e.g., 'genre', 'category', 'tag', 'platform')
export const taxonomies = pgTable('taxonomies', {
  id: text('id').primaryKey(), // UUID
  name: text('name').notNull().unique(), // Internal name (e.g., 'genre', 'category')
  displayName: text('display_name').notNull(), // User-facing name (e.g., 'Genre', 'Category')
  description: text('description'),
  slug: text('slug').notNull().unique(), // URL-friendly identifier
  allowMultiple: boolean('allow_multiple').default(true).notNull(), // Can items have multiple terms?
  isRequired: boolean('is_required').default(false).notNull(), // Must items have at least one term?
  itemTypes: json('item_types').$type<string[]>().default([]), // Which item types can use this taxonomy (e.g., ['game', 'post'])
  sortOrder: integer('sort_order').default(0).notNull(), // For ordering taxonomies in UI
  status: text('status').default('active').notNull(), // 'active' | 'archived'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Taxonomy Terms - Individual terms within a taxonomy (e.g., 'Action', 'RPG' for genre taxonomy)
export const taxonomyTerms = pgTable('taxonomy_terms', {
  id: text('id').primaryKey(), // UUID
  taxonomyId: text('taxonomy_id')
    .notNull()
    .references(() => taxonomies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), // Display name (e.g., 'Action', 'Role-Playing Game')
  slug: text('slug').notNull(), // URL-friendly identifier
  description: text('description'),
  parentId: text('parent_id'), // For hierarchical taxonomies (self-reference)
  color: text('color'), // Optional color for UI display (e.g., '#FF5733')
  icon: text('icon'), // Optional icon name or URL
  metadata: json('metadata').$type<Record<string, unknown>>(), // Flexible additional data
  sortOrder: integer('sort_order').default(0).notNull(), // For ordering terms
  status: text('status').default('active').notNull(), // 'active' | 'archived'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Unique constraint: slug must be unique within a taxonomy
  uniqueIndex('taxonomy_term_slug_unique_idx').on(table.taxonomyId, table.slug),
]);

// Item Taxonomies - Junction table linking items to taxonomy terms
// Polymorphic design: itemType + itemId identifies any entity
export const itemTaxonomies = pgTable('item_taxonomies', {
  id: text('id').primaryKey(), // UUID
  termId: text('term_id')
    .notNull()
    .references(() => taxonomyTerms.id, { onDelete: 'cascade' }),
  itemType: text('item_type').notNull(), // e.g., 'game', 'post', 'session'
  itemId: text('item_id').notNull(), // ID of the item
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Unique constraint: an item can only have each term once
  uniqueIndex('item_taxonomy_unique_idx').on(table.termId, table.itemType, table.itemId),
]);

// Type exports for Taxonomy System
export type Taxonomy = typeof taxonomies.$inferSelect;
export type NewTaxonomy = typeof taxonomies.$inferInsert;
export type TaxonomyTerm = typeof taxonomyTerms.$inferSelect;
export type NewTaxonomyTerm = typeof taxonomyTerms.$inferInsert;
export type ItemTaxonomy = typeof itemTaxonomies.$inferSelect;
export type NewItemTaxonomy = typeof itemTaxonomies.$inferInsert;

// ============================================================================
// GAME PLATFORM LIBRARIES - Platforms, installations, achievements, cloud saves
// ============================================================================

// Game Platforms - Supported platforms (Windows, Mac, Linux, etc.)
export const gamePlatforms = pgTable('game_platforms', {
  id: text('id').primaryKey(), // UUID
  os: text('os').notNull(), // 'windows' | 'macos' | 'linux'
  architecture: text('architecture').notNull(), // 'x64' | 'x86' | 'arm64'
  displayName: text('display_name').notNull(),
  iconUrl: text('icon_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('game_platform_os_arch_idx').on(table.os, table.architecture),
]);

// Game System Requirements - Minimum/recommended specs per platform
export const gameSystemRequirements = pgTable('game_system_requirements', {
  id: text('id').primaryKey(), // UUID
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  platformId: text('platform_id')
    .notNull()
    .references(() => gamePlatforms.id, { onDelete: 'cascade' }),
  level: text('level').notNull(), // 'minimum' | 'recommended'
  osVersion: text('os_version'),
  processor: text('processor'),
  memory: integer('memory'), // RAM in MB
  graphics: text('graphics'),
  graphicsMemory: integer('graphics_memory'), // VRAM in MB
  graphicsApi: text('graphics_api'), // 'directx11' | 'directx12' | 'vulkan' | 'metal' | 'opengl'
  storage: integer('storage'), // Required disk space in MB
  additionalNotes: text('additional_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('game_system_req_unique_idx').on(table.gameId, table.platformId, table.level),
]);

// Game Builds - Version/build information per platform
export const gameBuilds = pgTable('game_builds', {
  id: text('id').primaryKey(), // UUID
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  platformId: text('platform_id')
    .notNull()
    .references(() => gamePlatforms.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  buildNumber: integer('build_number'),
  sizeBytes: text('size_bytes').notNull(), // Stored as string for bigint precision
  checksum: text('checksum'),
  checksumType: text('checksum_type'), // 'md5' | 'sha256'
  releaseNotes: text('release_notes'),
  isMandatory: boolean('is_mandatory').default(false).notNull(),
  isPrerelease: boolean('is_prerelease').default(false).notNull(),
  downloadUrl: text('download_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('game_build_version_idx').on(table.gameId, table.platformId, table.version),
]);

// Game Installations - User installation records
export const gameInstallations = pgTable('game_installations', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  platformId: text('platform_id')
    .notNull()
    .references(() => gamePlatforms.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('not_installed'), // 'not_installed' | 'queued' | 'downloading' | 'installing' | 'installed' | 'updating' | 'paused' | 'error'
  installPath: text('install_path'),
  version: text('version'),
  installedSizeBytes: text('installed_size_bytes'), // Stored as string for bigint precision
  downloadProgress: json('download_progress').$type<{
    totalBytes: number;
    downloadedBytes: number;
    bytesPerSecond: number;
    estimatedSecondsRemaining: number;
    currentFile?: string;
    filesTotal?: number;
    filesCompleted?: number;
  }>(),
  lastPlayedAt: timestamp('last_played_at'),
  playtimeMinutes: integer('playtime_minutes').default(0).notNull(),
  autoUpdate: boolean('auto_update').default(true).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('game_installation_user_game_idx').on(table.userId, table.gameId),
]);

// Game Achievements - Achievement definitions
export const gameAchievements = pgTable('game_achievements', {
  id: text('id').primaryKey(), // UUID
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  hiddenDescription: text('hidden_description'), // Shown after unlock for hidden achievements
  iconUrl: text('icon_url'),
  iconLockedUrl: text('icon_locked_url'),
  points: integer('points').default(10).notNull(),
  rarity: text('rarity').default('common').notNull(), // 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  type: text('type').default('standard').notNull(), // 'standard' | 'hidden' | 'progressive'
  maxProgress: integer('max_progress'), // For progressive achievements
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// ANNOUNCEMENTS - Official platform updates
// ============================================================================

// Announcements - Official platform announcements from admins
export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(), // UUID
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull().default('general'), // 'maintenance' | 'feature' | 'alert' | 'general'
  priority: text('priority').notNull().default('normal'), // 'low' | 'normal' | 'high' | 'critical'
  status: text('status').notNull().default('draft'), // 'draft' | 'published' | 'archived'
  authorId: text('author_id')
    .references(() => users.id, { onDelete: 'set null' }), // Nullable to allow onDelete: set null
  publishedAt: timestamp('published_at'),
  expiresAt: timestamp('expires_at'), // Optional expiration date
  pinned: boolean('pinned').default(false).notNull(), // Pinned announcements appear at top
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Type exports for Announcements
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

// User Achievements - User progress on achievements
export const userAchievements = pgTable('user_achievements', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  achievementId: text('achievement_id')
    .notNull()
    .references(() => gameAchievements.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  unlocked: boolean('unlocked').default(false).notNull(),
  unlockedAt: timestamp('unlocked_at'),
  progress: integer('progress'), // For progressive achievements
  notified: boolean('notified').default(false).notNull(), // User has been notified of unlock
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_achievement_unique_idx').on(table.userId, table.achievementId),
]);

// Game Cloud Saves - Cloud save synchronization
export const gameCloudSaves = pgTable('game_cloud_saves', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  slotNumber: integer('slot_number').notNull(),
  slotType: text('slot_type').notNull(), // 'auto' | 'manual' | 'quicksave' | 'checkpoint'
  name: text('name'),
  description: text('description'),
  thumbnailUrl: text('thumbnail_url'),
  sizeBytes: text('size_bytes').notNull(), // Stored as string for bigint precision
  checksum: text('checksum').notNull(),
  checksumType: text('checksum_type').notNull(), // 'md5' | 'sha256'
  gameVersion: text('game_version'),
  playtimeMinutes: integer('playtime_minutes'),
  gameProgress: json('game_progress').$type<Record<string, unknown>>(), // Game-specific metadata
  syncStatus: text('sync_status').default('synced').notNull(), // 'synced' | 'uploading' | 'downloading' | 'conflict' | 'error'
  cloudUrl: text('cloud_url'),
  localPath: text('local_path'),
  conflictData: json('conflict_data').$type<{
    localChecksum: string;
    cloudChecksum: string;
    localModifiedAt: string;
    cloudModifiedAt: string;
    localSizeBytes: number;
    cloudSizeBytes: number;
  }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  syncedAt: timestamp('synced_at'),
}, (table) => [
  uniqueIndex('game_cloud_save_slot_idx').on(table.userId, table.gameId, table.slotNumber),
]);

// Type exports for Game Platform Libraries
export type GamePlatform = typeof gamePlatforms.$inferSelect;
export type NewGamePlatform = typeof gamePlatforms.$inferInsert;
export type GameSystemRequirement = typeof gameSystemRequirements.$inferSelect;
export type NewGameSystemRequirement = typeof gameSystemRequirements.$inferInsert;
export type GameBuild = typeof gameBuilds.$inferSelect;
export type NewGameBuild = typeof gameBuilds.$inferInsert;
export type GameInstallation = typeof gameInstallations.$inferSelect;
export type NewGameInstallation = typeof gameInstallations.$inferInsert;
export type GameAchievement = typeof gameAchievements.$inferSelect;
export type NewGameAchievement = typeof gameAchievements.$inferInsert;
export type UserAchievement = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;
export type GameCloudSave = typeof gameCloudSaves.$inferSelect;
export type NewGameCloudSave = typeof gameCloudSaves.$inferInsert;

// ============================================================================
// CLOUD SAVES - Synced game saves across devices
// ============================================================================

// Cloud Saves - User game saves synced across devices
export const cloudSaves = pgTable('cloud_saves', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  gameId: text('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  slotNumber: integer('slot_number').notNull(), // Save slot 1-N
  slotName: text('slot_name'), // User-given save name (e.g., "Before Boss Fight")
  saveData: text('save_data').notNull(), // Base64 or JSON encoded save content
  fileSize: integer('file_size').notNull(), // Size in bytes
  checksum: text('checksum'), // SHA-256 hash for integrity verification
  platformData: json('platform_data').$type<{
    deviceName?: string;
    platform?: string; // 'web' | 'desktop' | 'mobile'
    gameVersion?: string;
    browserInfo?: string;
  }>(),
  screenshotUrl: text('screenshot_url'), // Optional save screenshot
  playTimeSeconds: integer('play_time_seconds').default(0), // Playtime at save
  gameProgress: json('game_progress').$type<{
    level?: number;
    chapter?: string;
    percentage?: number;
    customData?: Record<string, unknown>;
  }>(), // Game-specific progress metadata
  lastPlayedAt: timestamp('last_played_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Unique constraint: a user can only have one save per slot per game
  uniqueIndex('cloud_saves_user_game_slot_unique_idx').on(table.userId, table.gameId, table.slotNumber),
]);

// Cloud Save Versions - Historical versions of saves for recovery
export const cloudSaveVersions = pgTable('cloud_save_versions', {
  id: text('id').primaryKey(), // UUID
  cloudSaveId: text('cloud_save_id')
    .notNull()
    .references(() => cloudSaves.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  saveData: text('save_data').notNull(),
  fileSize: integer('file_size').notNull(),
  checksum: text('checksum'),
  platformData: json('platform_data').$type<{
    deviceName?: string;
    platform?: string;
    gameVersion?: string;
    browserInfo?: string;
  }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Unique constraint: version number must be unique per save
  uniqueIndex('cloud_save_versions_save_version_unique_idx').on(table.cloudSaveId, table.version),
]);

// Cloud Save Sync Log - Tracks sync operations for debugging
export const cloudSaveSyncLog = pgTable('cloud_save_sync_log', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  cloudSaveId: text('cloud_save_id')
    .references(() => cloudSaves.id, { onDelete: 'set null' }),
  operation: text('operation').notNull(), // 'upload' | 'download' | 'delete' | 'conflict_resolved'
  deviceInfo: json('device_info').$type<{
    deviceName?: string;
    platform?: string;
    browserInfo?: string;
    ipAddress?: string;
  }>(),
  status: text('status').notNull().default('success'), // 'success' | 'failed' | 'conflict'
  errorMessage: text('error_message'),
  bytesTransferred: integer('bytes_transferred'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports for Cloud Saves
export type CloudSave = typeof cloudSaves.$inferSelect;
export type NewCloudSave = typeof cloudSaves.$inferInsert;
export type CloudSaveVersion = typeof cloudSaveVersions.$inferSelect;
export type NewCloudSaveVersion = typeof cloudSaveVersions.$inferInsert;
export type CloudSaveSyncLog = typeof cloudSaveSyncLog.$inferSelect;
export type NewCloudSaveSyncLog = typeof cloudSaveSyncLog.$inferInsert;

// ============================================================================
// SNIPPETS - User code snippets and templates for common patterns
// ============================================================================

// Supported programming languages for snippets
export const SNIPPET_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'c',
  'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'html',
  'css', 'scss', 'sql', 'bash', 'powershell', 'yaml', 'json', 'xml',
  'markdown', 'dockerfile', 'terraform', 'graphql', 'other'
] as const;

export type SnippetLanguage = typeof SNIPPET_LANGUAGES[number];

// Snippet categories for organization
export const SNIPPET_CATEGORIES = [
  'function', 'class', 'component', 'hook', 'utility', 'api',
  'database', 'testing', 'config', 'boilerplate', 'algorithm',
  'pattern', 'snippet', 'template', 'other'
] as const;

export type SnippetCategory = typeof SNIPPET_CATEGORIES[number];

// Snippets - User-created code snippets and templates
export const snippets = pgTable('snippets', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // Snippet content
  title: text('title').notNull(),
  description: text('description'),
  code: text('code').notNull(),

  // Metadata
  language: text('language').notNull().default('other'), // Programming language
  category: text('category').notNull().default('snippet'), // Category for organization
  tags: json('tags').$type<string[]>().default([]), // User-defined tags

  // Template variables (for parameterized snippets)
  // Format: { "variableName": { "description": "...", "defaultValue": "..." } }
  variables: json('variables').$type<Record<string, {
    description?: string;
    defaultValue?: string;
    placeholder?: string;
  }>>(),

  // Usage and status
  usageCount: integer('usage_count').default(0).notNull(),
  isFavorite: boolean('is_favorite').default(false).notNull(),
  isPublic: boolean('is_public').default(false).notNull(), // Share with community

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at'),
}, (table) => [
  // Index for faster lookups by user
  uniqueIndex('snippets_user_title_idx').on(table.userId, table.title),
]);

// Snippet Collections - Organize snippets into folders/categories
export const snippetCollections = pgTable('snippet_collections', {
  id: text('id').primaryKey(), // UUID
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  description: text('description'),
  color: text('color'), // Hex color for visual distinction (e.g., '#FF5733')
  icon: text('icon'), // Icon identifier (e.g., 'folder', 'code', 'star')

  sortOrder: integer('sort_order').default(0).notNull(),
  isDefault: boolean('is_default').default(false).notNull(), // Default collection for new snippets

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('snippet_collections_user_name_idx').on(table.userId, table.name),
]);

// Snippets in Collections - Junction table for many-to-many relationship
export const snippetsInCollections = pgTable('snippets_in_collections', {
  id: text('id').primaryKey(), // UUID
  snippetId: text('snippet_id')
    .notNull()
    .references(() => snippets.id, { onDelete: 'cascade' }),
  collectionId: text('collection_id')
    .notNull()
    .references(() => snippetCollections.id, { onDelete: 'cascade' }),

  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('snippets_in_collections_unique_idx').on(table.snippetId, table.collectionId),
]);

// Type exports for Snippets
export type Snippet = typeof snippets.$inferSelect;
export type NewSnippet = typeof snippets.$inferInsert;
export type SnippetCollection = typeof snippetCollections.$inferSelect;
export type NewSnippetCollection = typeof snippetCollections.$inferInsert;
export type SnippetInCollection = typeof snippetsInCollections.$inferSelect;
export type NewSnippetInCollection = typeof snippetsInCollections.$inferInsert;

// ============================================================================
// IDEMPOTENCY KEYS - Prevent duplicate processing of critical operations
// ============================================================================

// Idempotency Keys - Stores request/response pairs for critical operations
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: text('id').primaryKey(), // UUID
  key: text('key').notNull(), // The idempotency key from X-Idempotency-Key header
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(), // The API endpoint (e.g., '/api/payments/checkout')
  method: text('method').notNull(), // HTTP method (POST, PUT, DELETE)
  requestHash: text('request_hash').notNull(), // SHA-256 hash of request body for consistency check
  statusCode: integer('status_code'), // Response status code (null while processing)
  responseBody: json('response_body').$type<Record<string, unknown>>(), // Cached response (null while processing)
  status: text('status').notNull().default('processing'), // 'processing' | 'completed' | 'failed'
  lockedAt: timestamp('locked_at'), // For concurrent request handling (lock timeout)
  expiresAt: timestamp('expires_at').notNull(), // TTL for the idempotency key (24h default)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  // Unique constraint: one key per user per endpoint
  uniqueIndex('idempotency_key_user_endpoint_idx').on(table.key, table.userId, table.endpoint),
]);

// Type exports for Idempotency Keys
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
