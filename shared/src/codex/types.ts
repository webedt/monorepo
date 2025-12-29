/**
 * Types for OpenAI Codex/Responses API
 * Based on OpenAI's Responses API for code generation tasks
 */

import type { CodexAuth } from '../auth/codexAuth.js';

/**
 * Configuration for CodexClient
 */
export interface CodexClientConfig {
  /** API key or OAuth access token */
  auth: CodexAuth;
  /** Base URL for API (default: https://api.openai.com) */
  baseUrl?: string;
  /** Default model to use (default: gpt-4o) */
  model?: string;
  /** Organization ID (optional) */
  organizationId?: string;
  /** Project ID (optional) */
  projectId?: string;
}

/**
 * Parameters for creating a new Codex session
 */
export interface CreateCodexSessionParams {
  /** User's prompt/request - can be string or content blocks with images */
  prompt: string | CodexContentBlock[];
  /** GitHub repository URL (e.g., https://github.com/owner/repo) */
  gitUrl: string;
  /** Model to use (overrides default) */
  model?: string;
  /** Branch prefix (e.g., 'codex/feature-name') */
  branchPrefix?: string;
  /** Custom title for the session */
  title?: string;
  /** System instructions for the model */
  systemInstructions?: string;
}

/**
 * Text content block for messages
 */
export interface CodexTextContent {
  type: 'text';
  text: string;
}

/**
 * Image content block for messages
 */
export interface CodexImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * Content block types
 */
export type CodexContentBlock = CodexTextContent | CodexImageContent;

/**
 * Message in a Codex conversation
 */
export interface CodexMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | CodexContentBlock[];
}

/**
 * Codex session status
 */
export type CodexSessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Result of creating a Codex session
 */
export interface CreateCodexSessionResult {
  /** Session ID */
  sessionId: string;
  /** Session title */
  title: string;
  /** Initial response ID from OpenAI */
  responseId?: string;
}

/**
 * Codex session metadata
 */
export interface CodexSession {
  id: string;
  title: string;
  status: CodexSessionStatus;
  createdAt: string;
  updatedAt: string;
  model?: string;
  gitUrl?: string;
  branch?: string;
  totalCost?: number;
  messages: CodexMessage[];
}

/**
 * Tool call in a Codex response
 */
export interface CodexToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tool result to send back
 */
export interface CodexToolResult {
  tool_call_id: string;
  output: string;
}

/**
 * Event types emitted during Codex execution
 */
export type CodexEventType =
  | 'session_created'
  | 'message_start'
  | 'message_delta'
  | 'message_complete'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'result';

/**
 * Event emitted during Codex execution
 */
export interface CodexEvent {
  /** Unique event identifier */
  uuid: string;
  /** Event type */
  type: CodexEventType;
  /** Event timestamp */
  timestamp: string;
  /** Session ID */
  sessionId?: string;

  // Message events
  /** Message content (delta or complete) */
  content?: string;
  /** Message role */
  role?: 'user' | 'assistant' | 'system';
  /** Model used */
  model?: string;

  // Tool events
  /** Tool call information */
  toolCall?: CodexToolCall;
  /** Tool result */
  toolResult?: CodexToolResult;

  // Result events
  /** Total cost in USD */
  totalCostUsd?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Final status */
  resultStatus?: 'completed' | 'failed' | 'cancelled';
  /** Branch name created */
  branch?: string;

  // Error events
  /** Error message */
  error?: string;
  /** Error code */
  errorCode?: string;

  // Allow additional properties
  [key: string]: unknown;
}

/**
 * Callback for receiving events during execution
 */
export type CodexEventCallback = (event: CodexEvent) => void | Promise<void>;

/**
 * Options for polling/streaming
 */
export interface CodexPollOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs?: number;
}

/**
 * Result from a completed Codex session
 */
export interface CodexSessionResult {
  /** Session ID */
  sessionId: string;
  /** Final session status */
  status: CodexSessionStatus;
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
  /** Final result/output */
  result?: string;
}

/**
 * Error from Codex API
 */
export class CodexError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseText?: string,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'CodexError';
  }
}

/**
 * OpenAI Responses API request format
 */
export interface OpenAIResponsesRequest {
  model: string;
  input: string | OpenAIInputItem[];
  instructions?: string;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'required' | 'none';
  stream?: boolean;
  metadata?: Record<string, string>;
  previous_response_id?: string;
}

/**
 * Input item for OpenAI Responses API
 */
export interface OpenAIInputItem {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

/**
 * Content part for OpenAI messages
 */
export interface OpenAIContentPart {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
  detail?: 'auto' | 'low' | 'high';
}

/**
 * Tool definition for OpenAI
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI Responses API response format
 */
export interface OpenAIResponse {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled';
  output: OpenAIOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  model: string;
  metadata?: Record<string, string>;
}

/**
 * Output item from OpenAI response
 */
export interface OpenAIOutputItem {
  type: 'message' | 'function_call' | 'function_call_output';
  id?: string;
  role?: 'assistant';
  content?: OpenAIOutputContent[];
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: string;
}

/**
 * Output content from OpenAI
 */
export interface OpenAIOutputContent {
  type: 'output_text';
  text: string;
}

/**
 * Streaming event from OpenAI Responses API
 */
export interface OpenAIStreamEvent {
  type: string;
  response?: OpenAIResponse;
  item?: OpenAIOutputItem;
  delta?: string;
  error?: {
    message: string;
    code?: string;
  };
}
