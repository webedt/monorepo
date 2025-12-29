/**
 * Execution Provider Interface
 *
 * Defines the contract for AI execution providers.
 * This allows switching between different backends (Claude Remote, self-hosted workers, etc.)
 */

import type { ClaudeAuth } from '../../auth/claudeAuth.js';
import type { GeminiAuth } from '../../auth/lucia.js';

/**
 * Event types emitted during execution.
 *
 * This is a strict union type - all valid event types must be explicitly listed.
 * This enables compile-time type checking and IDE autocomplete.
 *
 * Categories:
 * - Internal events: Emitted by our execution layer (connected, message, session_created, etc.)
 * - Remote events: Pass-through from Anthropic API (assistant, user, tool_use, result, etc.)
 * - Provider-specific: Codex/Gemini specific events (message_delta, message_complete)
 */
export type ExecutionEventType =
  // Internal execution events
  | 'connected'           // Connection established to provider
  | 'message'             // Generic message/progress update
  | 'assistant_message'   // Assistant response (internal format)
  | 'session_name'        // Session name update
  | 'session_created'     // Remote session created with ID
  | 'title_generation'    // Title generation progress
  | 'completed'           // Execution completed successfully
  | 'error'               // Error occurred
  | 'input_preview'       // Preview of user input received
  | 'interrupted'         // Execution interrupted by user
  // Remote session events (Anthropic API pass-through)
  | 'user'                // User message event
  | 'assistant'           // Assistant response event
  | 'tool_use'            // Tool being used
  | 'tool_result'         // Tool execution result
  | 'result'              // Session result with cost/duration
  | 'env_manager_log'     // Environment manager log
  | 'system'              // System event
  | 'text'                // Text content event
  // Provider-specific events (Codex/Gemini)
  | 'message_start'       // Start of a new message (Codex)
  | 'message_delta'       // Streaming message delta
  | 'message_complete';   // Complete message received

// ============================================================================
// Discriminated Union Event Types
// Each event type has a specific payload shape for type-safe access
// ============================================================================

/** Base fields present on all execution events */
interface ExecutionEventBase {
  timestamp: string;
  source?: string;
  /** UUID for deduplication (from remote events) */
  uuid?: string;
  /** Request correlation ID */
  requestId?: string;
}

/** Connection established event */
export interface ConnectedEvent extends ExecutionEventBase {
  type: 'connected';
  sessionId?: string;
  provider?: string;
}

/** Generic message/progress event */
export interface MessageEvent extends ExecutionEventBase {
  type: 'message';
  stage?: string;
  message?: string;
}

/** Assistant message event (internal format) */
export interface AssistantMessageEvent extends ExecutionEventBase {
  type: 'assistant_message';
  content?: unknown;
  model?: string;
  message?: string;
}

/** Session name update event */
export interface SessionNameEvent extends ExecutionEventBase {
  type: 'session_name';
  sessionName?: string;
}

/** Remote session created event */
export interface SessionCreatedEvent extends ExecutionEventBase {
  type: 'session_created';
  remoteSessionId?: string;
  remoteWebUrl?: string;
  sessionId?: string;
}

/** Title generation progress event */
export interface TitleGenerationEvent extends ExecutionEventBase {
  type: 'title_generation';
  method?: 'dust' | 'openrouter' | 'session' | 'local';
  status?: 'trying' | 'success' | 'failed' | 'skipped';
  title?: string;
  branch_name?: string;
}

/** Execution completed event */
export interface CompletedEvent extends ExecutionEventBase {
  type: 'completed';
  branch?: string;
  totalCost?: number;
  duration_ms?: number;
  remoteSessionId?: string;
  remoteWebUrl?: string;
}

/** Error event */
export interface ErrorEvent extends ExecutionEventBase {
  type: 'error';
  error?: string;
  code?: string;
  message?: string;
}

/** Input preview event */
export interface InputPreviewEvent extends ExecutionEventBase {
  type: 'input_preview';
  message?: string;
  data?: {
    preview: string;
    originalLength: number;
    truncated: boolean;
  };
}

/** Execution interrupted event */
export interface InterruptedEvent extends ExecutionEventBase {
  type: 'interrupted';
  message?: string;
}

/** User message event (remote) */
export interface UserEvent extends ExecutionEventBase {
  type: 'user';
  message?: {
    content: string | unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Assistant response event (remote) */
export interface AssistantEvent extends ExecutionEventBase {
  type: 'assistant';
  message?: {
    id?: string;
    role?: string;
    content: string | unknown[];
    model?: string;
    stop_reason?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Tool use event */
export interface ToolUseEvent extends ExecutionEventBase {
  type: 'tool_use';
  tool_use?: {
    id?: string;
    name: string;
    input: Record<string, unknown>;
  };
  name?: string;
  [key: string]: unknown;
}

/** Tool result event */
export interface ToolResultEvent extends ExecutionEventBase {
  type: 'tool_result';
  [key: string]: unknown;
}

/** Session result event (remote) */
export interface ResultEvent extends ExecutionEventBase {
  type: 'result';
  total_cost_usd?: number;
  totalCost?: number;
  duration_ms?: number;
  result_status?: string;
  branch?: string;
  [key: string]: unknown;
}

/** Environment manager log event */
export interface EnvManagerLogEvent extends ExecutionEventBase {
  type: 'env_manager_log';
  data?: {
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** System event */
export interface SystemEvent extends ExecutionEventBase {
  type: 'system';
  [key: string]: unknown;
}

/** Text content event */
export interface TextEvent extends ExecutionEventBase {
  type: 'text';
  text?: string;
  content?: string;
  [key: string]: unknown;
}

/** Message start event (Codex) */
export interface MessageStartEvent extends ExecutionEventBase {
  type: 'message_start';
  content?: unknown;
  model?: string;
  role?: 'user' | 'assistant' | 'system';
  [key: string]: unknown;
}

/** Message delta event (Codex/Gemini streaming) */
export interface MessageDeltaEvent extends ExecutionEventBase {
  type: 'message_delta';
  content?: unknown;
  model?: string;
  [key: string]: unknown;
}

/** Message complete event (Codex/Gemini) */
export interface MessageCompleteEvent extends ExecutionEventBase {
  type: 'message_complete';
  content?: unknown;
  model?: string;
  [key: string]: unknown;
}

/**
 * Discriminated union of all execution event types.
 * Use this for type-safe event handling with exhaustive switch statements.
 */
export type TypedExecutionEvent =
  | ConnectedEvent
  | MessageEvent
  | AssistantMessageEvent
  | SessionNameEvent
  | SessionCreatedEvent
  | TitleGenerationEvent
  | CompletedEvent
  | ErrorEvent
  | InputPreviewEvent
  | InterruptedEvent
  | UserEvent
  | AssistantEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent
  | EnvManagerLogEvent
  | SystemEvent
  | TextEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageCompleteEvent;

/**
 * Event emitted during execution.
 *
 * This interface maintains backward compatibility while supporting strict typing.
 * For new code, prefer using TypedExecutionEvent for better type safety.
 *
 * Note: The [key: string]: unknown allows pass-through of additional fields
 * from remote sessions for forward compatibility with API changes.
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  source?: string;

  // Common fields for deduplication and tracing
  uuid?: string;
  requestId?: string;

  // Connected event
  sessionId?: string;
  provider?: string;

  // Message event
  stage?: string;
  message?: string;

  // Assistant message event
  content?: unknown;
  model?: string;

  // Session name event
  sessionName?: string;

  // Session created event
  remoteSessionId?: string;
  remoteWebUrl?: string;

  // Title generation event
  method?: 'dust' | 'openrouter' | 'session' | 'local';
  status?: 'trying' | 'success' | 'failed' | 'skipped';
  title?: string;
  branch_name?: string;

  // Completed event
  branch?: string;
  totalCost?: number;
  duration_ms?: number;

  // Error event
  error?: string;
  code?: string;

  // Tool use event
  tool_use?: {
    id?: string;
    name: string;
    input: Record<string, unknown>;
  };
  name?: string;
  input?: unknown;
  tool_use_id?: string;

  // Result event (metrics)
  inputTokens?: number;
  outputTokens?: number;
  total_cost_usd?: number;
  result_status?: string;

  // Environment log event
  data?: {
    message?: string;
    [key: string]: unknown;
  };

  // Text event
  text?: string;

  // Gemini-specific
  totalTokens?: number;

  // Allow additional fields from remote sessions for forward compatibility
  [key: string]: unknown;
}

/**
 * Type guard to check if an event is of a specific type.
 * Provides type narrowing for exhaustive event handling.
 *
 * @example
 * if (isEventType(event, 'title_generation')) {
 *   // event is narrowed to TitleGenerationEvent
 *   console.log(event.title);
 * }
 */
export function isEventType<T extends ExecutionEventType>(
  event: ExecutionEvent,
  type: T
): event is ExecutionEvent & { type: T } {
  return event.type === type;
}

/**
 * Helper for exhaustive event type checking in switch statements.
 * Call this in the default case to ensure all event types are handled.
 *
 * @example
 * switch (event.type) {
 *   case 'connected': // handle
 *   case 'error': // handle
 *   // ... all cases
 *   default:
 *     assertNeverEventType(event.type); // Compile error if a type is missing
 * }
 */
export function assertNeverEventType(type: never): never {
  throw new Error(`Unhandled event type: ${type}`);
}

/**
 * Content block types for multimodal messages
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

/**
 * Parameters for executing an AI request
 */
export interface ExecuteParams {
  /** User ID for tracking */
  userId: string;
  /** Chat session ID in our database */
  chatSessionId: string;
  /** User's prompt/request - can be string or content blocks with images */
  prompt: string | ContentBlock[];
  /** GitHub repository URL */
  gitUrl: string;
  /** Model to use (optional) */
  model?: string;
  /** Claude auth credentials (required for Claude provider) */
  claudeAuth?: ClaudeAuth;
  /** Gemini auth credentials (required for Gemini provider) */
  geminiAuth?: GeminiAuth;
  /** Environment ID for Claude Remote (optional, uses config default if not provided) */
  environmentId?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Parameters for resuming an existing session
 */
export interface ResumeParams {
  /** User ID for tracking */
  userId: string;
  /** Chat session ID in our database */
  chatSessionId: string;
  /** Remote session ID from provider */
  remoteSessionId: string;
  /** New prompt/message to send - can be string or content blocks with images */
  prompt: string | ContentBlock[];
  /** Claude auth credentials (required for Claude provider) */
  claudeAuth?: ClaudeAuth;
  /** Gemini auth credentials (required for Gemini provider) */
  geminiAuth?: GeminiAuth;
  /** Environment ID for Claude Remote (optional, uses config default if not provided) */
  environmentId?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result from a completed execution
 */
export interface ExecutionResult {
  /** Remote session ID from provider */
  remoteSessionId: string;
  /** URL to view session (if applicable) */
  remoteWebUrl?: string;
  /** Branch name created */
  branch?: string;
  /** Total cost in USD */
  totalCost?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Final status */
  status: 'completed' | 'failed' | 'interrupted';
}

/**
 * Callback for receiving execution events
 */
export type ExecutionEventCallback = (event: ExecutionEvent) => void | Promise<void>;

/**
 * Execution Provider Interface
 *
 * Providers implement this interface to handle AI execution.
 * Available providers:
 * - ClaudeRemoteProvider: Delegates to Anthropic's Remote Sessions API
 * - SelfHostedWorkerProvider: Connects to a self-hosted AI worker for LLM execution
 */
export interface ExecutionProvider {
  /** Provider name for logging */
  readonly name: string;

  /**
   * Execute a new AI request
   */
  execute(
    params: ExecuteParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult>;

  /**
   * Resume an existing session with a new message
   */
  resume(
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult>;

  /**
   * Interrupt a running session
   * @param remoteSessionId - The remote session ID to interrupt
   * @param auth - Authentication credentials (ClaudeAuth or GeminiAuth depending on provider)
   */
  interrupt(remoteSessionId: string, auth?: ClaudeAuth | GeminiAuth): Promise<void>;
}
