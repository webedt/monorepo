/**
 * Types for Claude Remote Sessions API
 * Based on the Anthropic Sessions API used by claude.ai/code
 */

/**
 * Authentication credentials for Claude API
 */
export interface ClaudeAuth {
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
 * Assistant message content block
 */
export interface AssistantContentBlock {
  type: 'text' | 'thinking' | 'tool_use';
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Extended message type for user/assistant events
 */
export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[] | AssistantContentBlock[];
  // Assistant message fields
  id?: string;
  type?: 'message';
  model?: string;
  usage?: SessionUsage;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  context_management?: Record<string, unknown> | null;
}

/**
 * Usage information from assistant/result events
 */
export interface SessionUsage {
  input_tokens?: number;
  output_tokens?: number;
  service_tier?: string;
  cache_creation?: {
    ephemeral_1h_input_tokens?: number;
    ephemeral_5m_input_tokens?: number;
  };
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  server_tool_use?: {
    web_fetch_requests?: number;
    web_search_requests?: number;
  };
}

/**
 * Model-specific usage tracking
 */
export interface ModelUsage {
  costUSD?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  webSearchRequests?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Control response from session control commands
 */
export interface ControlResponse {
  subtype: 'success' | 'error';
  request_id: string;
  error?: string;
  response?: Record<string, unknown>;
  pending_permission_requests?: unknown[];
}

/**
 * Environment manager log data
 */
export interface EnvManagerLogData {
  type?: string;
  category?: string;
  content?: string;  // Main message content
  message?: string;  // Alternative message field
  level?: 'debug' | 'info' | 'warn' | 'error';
  extra?: Record<string, unknown>;
  timestamp?: string;  // Inner timestamp from env manager
}

/**
 * Event from the session events API
 * This interface represents all possible event types from Claude Remote sessions
 */
export interface SessionEvent {
  uuid: string;
  type: SessionEventType;
  session_id?: string;
  parent_tool_use_id?: string | null;
  timestamp?: string;

  // === User/Assistant message events ===
  message?: SessionMessage;
  isReplay?: boolean;

  // === Result event (completion) ===
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  subtype?: 'success' | 'error' | 'init';
  usage?: SessionUsage;
  modelUsage?: Record<string, ModelUsage>;
  permission_denials?: unknown[];

  // === Tool use event ===
  tool_use?: {
    name: string;
    input: Record<string, unknown>;
  };

  // === Tool result event ===
  tool_use_result?: {
    tool_use_id: string;
    stdout?: string;
    stderr?: string;
    is_error?: boolean;
    file?: {
      content?: string;
      numLines?: number;
    };
    filePath?: string;
    oldString?: string;
    newString?: string;
    structuredPatch?: unknown[];
  };

  // === Tool progress event ===
  tool_name?: string;
  tool_use_id?: string;
  elapsed_time_seconds?: number;

  // === Environment manager log ===
  data?: EnvManagerLogData;

  // === Control response ===
  response?: ControlResponse;

  // === System event ===
  cwd?: string;
  model?: string;
  tools?: string[];
  agents?: string[];
  skills?: string[];
  plugins?: unknown[];
  mcp_servers?: Array<{ name: string }>;
  apiKeySource?: string;
  output_style?: string;
  permissionMode?: string;
  slash_commands?: string[];
  claude_code_version?: string;
}

/**
 * Types of events that can be received
 */
export type SessionEventType =
  | 'user'
  | 'assistant'
  | 'result'
  | 'tool_use'
  | 'tool_result'
  | 'tool_progress'
  | 'env_manager_log'
  | 'control_response'
  | 'system'
  | 'error';

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
 * Options for polling session events
 */
export interface PollOptions {
  /** Skip events that already exist (for resume) */
  skipExistingEvents?: boolean;
  /** Polling interval in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Maximum number of polls before timeout (default: 300 = 10 min) */
  maxPolls?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
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
  /** OpenRouter API key (for fast title generation via Grok) */
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
