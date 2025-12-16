/**
 * Execution Provider Interface
 *
 * Defines the contract for AI execution providers.
 * This allows switching between different backends (Claude Remote, self-hosted workers, etc.)
 */

import type { ClaudeAuth } from '../../lib/claudeAuth.js';

/**
 * Event types emitted during execution
 */
export type ExecutionEventType =
  | 'connected'
  | 'message'
  | 'assistant_message'
  | 'session_name'
  | 'session_created'
  | 'completed'
  | 'error'
  | 'raw_event';

/**
 * Event emitted during execution
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: string;
  source?: string;

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

  // Completed event
  branch?: string;
  totalCost?: number;
  duration_ms?: number;

  // Error event
  error?: string;
  code?: string;

  // Raw event from provider (for debugging/pass-through)
  rawEvent?: unknown;
}

/**
 * Parameters for executing an AI request
 */
export interface ExecuteParams {
  /** User ID for tracking */
  userId: string;
  /** Chat session ID in our database */
  chatSessionId: string;
  /** User's prompt/request */
  prompt: string;
  /** GitHub repository URL */
  gitUrl: string;
  /** Model to use (optional) */
  model?: string;
  /** Claude auth credentials */
  claudeAuth: ClaudeAuth;
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
  /** New prompt/message to send */
  prompt: string;
  /** Claude auth credentials */
  claudeAuth: ClaudeAuth;
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
 * Currently supports: ClaudeRemoteProvider
 * Future: SelfHostedWorkerProvider
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
   */
  interrupt(remoteSessionId: string, claudeAuth: ClaudeAuth): Promise<void>;
}
