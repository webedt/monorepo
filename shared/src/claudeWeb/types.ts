/**
 * Types for Claude Remote Sessions API
 * Based on the Anthropic Sessions API used by claude.ai/code
 */

/**
 * Authentication credentials for Claude Remote Sessions API
 * For user-persisted auth credentials with required refreshToken, use ClaudeAuth from auth/claudeAuth.ts
 */
export interface ClaudeRemoteAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/**
 * Configuration for ClaudeRemoteClient
 */
export interface ClaudeRemoteClientConfig {
  /** OAuth access token */
  accessToken: string;
  /** Environment ID for remote sessions */
  environmentId: string;
  /** Organization UUID (optional, improves routing) */
  orgUuid?: string;
  /** Base URL for API (default: https://api.anthropic.com) */
  baseUrl?: string;
  /** Default model to use */
  model?: string;
}

/**
 * Configuration for the Claude Web Client.
 */
export type ClaudeWebClientConfig = {
  accessToken: string;
  environmentId?: string;
  baseUrl?: string;
  model?: string;
};

/**
 * Parameters for creating a new session
 */
export interface CreateSessionParams {
  /** User's prompt/request - can be string or content blocks with images */
  prompt: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
  /** GitHub repository URL (e.g., https://github.com/owner/repo) */
  gitUrl: string;
  /** Model to use (overrides default) */
  model?: string;
  /** Branch prefix (e.g., 'claude/feature-name') */
  branchPrefix?: string;
  /** Custom title for the session */
  title?: string;
}

/**
 * Result of creating a session
 */
export interface CreateSessionResult {
  /** Session ID (e.g., session_01S7DYYtwgMZ3gbAmjMmMpnA) */
  sessionId: string;
  /** Environment ID */
  environmentId: string;
  /** URL to view session in claude.ai */
  webUrl: string;
  /** Session title */
  title: string;
}

/**
 * Session status from API
 */
export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'archived';

/**
 * Session metadata from GET /v1/sessions/{id}
 */
export interface Session {
  id: string;
  title: string;
  session_status: SessionStatus;
  environment_id: string;
  created_at: string;
  updated_at: string;
  session_context?: {
    model?: string;
    sources?: Array<{ type: string; url?: string }>;
    outcomes?: Array<{ type: string; git_info?: GitOutcomeInfo }>;
  };
}

/**
 * Git outcome info in session context
 */
export interface GitOutcomeInfo {
  type: 'github' | 'gitlab' | 'bitbucket';
  repo: string;
  branches: string[];
}

/**
 * Tool use information in a session event
 */
export interface ToolUseInfo {
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Message content block
 */
export interface MessageContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Message information in a session event
 */
export interface MessageInfo {
  id?: string;
  role?: string;
  content: string | MessageContentBlock[];
  model?: string;
  stop_reason?: string;
}

/**
 * Raw event from Claude Remote sessions API.
 *
 * Events have a `type` field indicating the event kind:
 * - `tool_use`: Claude is using a tool (has `tool_use` field)
 * - `assistant`: Claude's response message (has `message` field)
 * - `result`: Session completed (has `total_cost_usd`, `duration_ms`, etc.)
 * - `env_manager_log`: Environment log (has `data.message`)
 * - `user`: User message
 * - `error`: Error occurred
 */
export interface SessionEvent {
  /** Unique event identifier */
  uuid: string;
  /** Event type (tool_use, assistant, result, env_manager_log, user, error, etc.) */
  type: string;
  /** Event timestamp */
  timestamp?: string;

  // Tool use events
  /** Tool use information (present when type === 'tool_use') */
  tool_use?: ToolUseInfo;

  // Assistant message events
  /** Message information (present when type === 'assistant') */
  message?: MessageInfo;

  // Result events
  /** Total cost in USD (present when type === 'result') */
  total_cost_usd?: number;
  /** Duration in milliseconds */
  duration_ms?: number;
  /** Session result status */
  result_status?: string;

  // Environment manager events
  /** Event data (present for env_manager_log and other events) */
  data?: {
    message?: string;
    [key: string]: unknown;
  };

  // Allow additional properties for forward compatibility
  [key: string]: unknown;
}

/**
 * Image source for base64 encoded images
 */
export interface ImageSource {
  type: 'base64';
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string;
}

/**
 * Image content block for user messages
 */
export interface ImageContentBlock {
  type: 'image';
  source: ImageSource;
}

/**
 * Text content block for user messages
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * User message content - can be string or array of content blocks
 */
export type UserMessageContent = string | Array<TextContentBlock | ImageContentBlock>;

/**
 * Content block in assistant message
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Response from GET /v1/sessions/{id}/events
 */
export interface EventsResponse {
  data: SessionEvent[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
}

/**
 * Parameters for resuming a session
 */
export interface ResumeSessionParams {
  /** Session ID to resume */
  sessionId: string;
  /** New prompt/message to send */
  prompt: string;
}

/**
 * Callback for receiving events during polling
 */
export type EventCallback = (event: SessionEvent) => void | Promise<void>;

/**
 * Callback for receiving raw WebSocket messages before parsing
 */
export type RawMessageCallback = (data: string) => void | Promise<void>;

/**
 * Options for polling session events
 */
export interface PollOptions {
  /** Skip events that already exist (for resume) */
  skipExistingEvents?: boolean;
  /** Pre-captured existing event IDs to skip (used by resume to avoid race condition) */
  existingEventIds?: Set<string>;
  /** Wait for session to become active before checking for idle completion (for resume after interrupt) */
  waitForActive?: boolean;
  /** Polling interval in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Maximum number of polls before timeout (default: 300 = 10 min) */
  maxPolls?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Callback for raw WebSocket messages before parsing */
  onRawMessage?: RawMessageCallback;
}

/**
 * Result from a completed session
 */
export interface SessionResult {
  /** Session ID */
  sessionId: string;
  /** Final session status */
  status: SessionStatus;
  /** Session title */
  title: string;
  /** Branch name created (if any) */
  branch?: string;
  /** Total cost in USD */
  totalCost?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Number of turns */
  numTurns?: number;
  /** Final result text */
  result?: string;
  /** Input tokens used (if available) */
  inputTokens?: number;
  /** Output tokens generated (if available) */
  outputTokens?: number;
  /** Session creation timestamp (if available) */
  createdAt?: string;
}

/**
 * Error from Claude Remote API
 */
export class ClaudeRemoteError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseText?: string
  ) {
    super(message);
    this.name = 'ClaudeRemoteError';
  }
}

/**
 * Result from title generation
 */
export interface GeneratedTitle {
  title: string;
  branch_name: string;
  source: 'dust' | 'openrouter' | 'session' | 'fallback';
}

/**
 * Configuration for title generator
 */
export interface TitleGeneratorConfig {
  /** Claude.ai browser cookies (for dust endpoint) */
  claudeCookies?: string;
  /** Organization UUID for Claude.ai */
  orgUuid?: string;
  /** OpenRouter API key (for fast title generation via Gemini) */
  openRouterApiKey?: string;
  /** Access token for API calls (for session-based generation) */
  accessToken?: string;
  /** Environment ID for session-based generation */
  environmentId?: string;
}

/**
 * Event emitted during title generation process
 */
export interface TitleGenerationEvent {
  type: 'title_generation';
  method: 'dust' | 'openrouter' | 'session' | 'local';
  status: 'trying' | 'success' | 'failed' | 'skipped';
  /** Title (only present on success) */
  title?: string;
  /** Branch name (only present on success) */
  branch_name?: string;
}

/**
 * Callback for title generation progress events
 */
export type TitleGenerationCallback = (event: TitleGenerationEvent) => void | Promise<void>;

/**
 * Response from GET /v1/sessions (list)
 */
export interface ListSessionsResponse {
  data: Session[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
}
