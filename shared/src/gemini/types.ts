/**
 * Types for Gemini AI API
 * Based on Google's Gemini API for generative AI
 */

/**
 * Configuration for GeminiClient
 */
export interface GeminiClientConfig {
  /** OAuth access token from Gemini CLI */
  accessToken: string;
  /** Base URL for API (default: https://generativelanguage.googleapis.com/v1beta) */
  baseUrl?: string;
  /** Default model to use (default: gemini-2.0-flash-exp) */
  model?: string;
}

/**
 * Content part types for Gemini messages
 */
export interface TextPart {
  text: string;
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

export type Part = TextPart | InlineDataPart;

/**
 * Message content for Gemini
 */
export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

/**
 * Parameters for generating content
 */
export interface GenerateContentParams {
  /** User's prompt/request */
  prompt: string | Part[];
  /** Conversation history for context */
  history?: Content[];
  /** Model to use (overrides default) */
  model?: string;
  /** System instruction */
  systemInstruction?: string;
}

/**
 * Streaming response candidate
 */
export interface Candidate {
  content: Content;
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  index: number;
}

/**
 * Usage metadata in response
 */
export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

/**
 * Streaming response chunk
 */
export interface GenerateContentStreamChunk {
  candidates: Candidate[];
  usageMetadata?: UsageMetadata;
}

/**
 * Final response from generation
 */
export interface GenerateContentResponse {
  candidates: Candidate[];
  usageMetadata: UsageMetadata;
}

/**
 * Callback for receiving streaming chunks
 */
export type StreamCallback = (chunk: GenerateContentStreamChunk) => void | Promise<void>;

/**
 * Session event emitted during Gemini execution
 * Mirrors the structure of Claude session events for compatibility
 */
export interface GeminiSessionEvent {
  /** Unique event identifier */
  uuid: string;
  /** Event type */
  type: 'assistant' | 'user' | 'result' | 'error' | 'system';
  /** Event timestamp */
  timestamp?: string;
  /** Message content (for assistant/user events) */
  message?: {
    role: 'user' | 'model';
    content: string | Part[];
    model?: string;
  };
  /** Total token usage */
  totalTokens?: number;
  /** Error message */
  error?: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Options for streaming generation
 */
export interface StreamOptions {
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result from a Gemini session
 */
export interface GeminiSessionResult {
  /** Generated session ID */
  sessionId: string;
  /** Final status */
  status: 'completed' | 'failed' | 'interrupted';
  /** Total tokens used */
  totalTokens?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Final response text */
  response?: string;
}

/**
 * Error from Gemini API
 */
export class GeminiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseText?: string
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}
