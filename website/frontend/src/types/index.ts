/**
 * Core type definitions for WebEDT client
 */

/**
 * User role - defines access levels for the platform
 * - user: Basic user access (read-only, limited features)
 * - editor: Full access to the editor suite for game creation
 * - developer: Full access plus development tools and API access
 * - admin: Full administrative access including user management
 *
 * IMPORTANT: This type must stay in sync with shared/src/db/schema.ts
 * If modifying roles here, update ROLE_HIERARCHY in the shared package as well.
 */
export type UserRole = 'user' | 'editor' | 'developer' | 'admin';

// User types
export interface User {
  id: string;
  email: string;
  displayName?: string;
  githubId?: string;
  githubAccessToken?: string;
  claudeAuth?: ClaudeAuth;
  codexAuth?: CodexAuth;
  geminiAuth?: GeminiAuth;
  preferredProvider?: Provider;
  preferredModel?: string;
  imageResizeMaxDimension?: number;
  voiceCommandKeywords?: string[];
  stopListeningAfterSubmit?: boolean;
  defaultLandingPage?: LandingPage;
  chatVerbosityLevel?: VerbosityLevel;
  imageAiProvider?: ImageAiProvider;
  imageAiModel?: string;
  imageAiKeys?: ImageAiKeys;
  openrouterApiKey?: string;
  autocompleteEnabled?: boolean;
  autocompleteModel?: string;
  isAdmin: boolean;
  role: UserRole;
  createdAt: string;
}

export interface ClaudeAuth {
  sessionKey?: string;
  organizationId?: string;
}

export interface CodexAuth {
  apiKey?: string;
}

export interface GeminiAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface ImageAiKeys {
  openrouter?: string;
  cometapi?: string;
  google?: string;
}

export type Provider = 'claude' | 'codex' | 'copilot' | 'gemini';
export type LandingPage = 'dashboard' | 'store' | 'library' | 'community' | 'sessions';
export type VerbosityLevel = 'minimal' | 'normal' | 'verbose';
export type ImageAiProvider = 'openrouter' | 'cometapi' | 'google';

// Session types
export interface Session {
  id: string;
  userId: string;
  aiWorkerSessionId?: string;
  sessionPath: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryUrl?: string;
  userRequest?: string;
  status: SessionStatus;
  baseBranch?: string;
  branch?: string;
  autoCommit?: boolean;
  locked?: boolean;
  createdAt: string;
  completedAt?: string;
  deletedAt?: string;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Message {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageAttachment[];
  createdAt: string;
}

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: string;
  fileName?: string;
}

// GitHub types
export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description?: string;
  html_url: string;
}

export interface Branch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export interface TreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface FileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  html_url: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  merged_at?: string;
}

export interface CommitResult {
  success: boolean;
  data: {
    commitSha: string;
    message: string;
    branch: string;
    filesCommitted: number;
    htmlUrl: string;
  };
}

// SSE Event types
export interface SSEEvent {
  type: string;
  timestamp?: string;
  data?: unknown;
}

export interface ExecutionEvent extends SSEEvent {
  type:
    | 'connected'
    | 'message'
    | 'session_name'
    | 'assistant_message'
    | 'tool_use'
    | 'tool_result'
    | 'completed'
    | 'error';
  content?: string;
  stage?: string;
  emoji?: string;
}

// Orchestrator types
export interface OrchestratorJob {
  id: string;
  userId: string;
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch: string;
  sessionPath: string;
  requestDocument: string;
  taskList: string | null;
  status: OrchestratorJobStatus;
  currentCycle: number;
  maxCycles: number | null;
  timeLimitMinutes: number | null;
  maxParallelTasks: number;
  provider: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export type OrchestratorJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface OrchestratorCycle {
  id: string;
  jobId: string;
  cycleNumber: number;
  phase: string;
  tasksDiscovered: number;
  tasksLaunched: number;
  tasksCompleted: number;
  tasksFailed: number;
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface OrchestratorTask {
  id: string;
  cycleId: string;
  jobId: string;
  taskNumber: number;
  description: string;
  context: string | null;
  priority: string;
  canRunParallel: boolean;
  status: string;
  agentSessionId: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Admin types
export interface AdminStats {
  userCount: number;
  sessionCount: number;
  activeSessionCount: number;
  roleCounts?: {
    user: number;
    editor: number;
    developer: number;
    admin: number;
  };
}
