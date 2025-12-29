/**
 * Gemini AI Client
 *
 * TypeScript client for Google's Gemini API with streaming support.
 *
 * ## Overview
 *
 * This module provides a client for interacting with Google's Gemini API,
 * supporting both regular and streaming content generation.
 *
 * ## Authentication
 *
 * Uses OAuth 2.0 credentials from Gemini CLI. Users authenticate with:
 * ```bash
 * gemini auth login
 * ```
 *
 * Credentials are stored in ~/.gemini/oauth_creds.json
 *
 * ## Quick Start
 *
 * ```typescript
 * import { GeminiClient } from '@webedt/shared';
 *
 * const client = new GeminiClient();
 * client.configure({
 *   accessToken: 'your-oauth-access-token',
 * });
 *
 * const result = await client.generateContentStream(
 *   {
 *     prompt: 'Explain how to implement a binary search tree',
 *     systemInstruction: 'You are a helpful coding assistant.',
 *   },
 *   (event) => {
 *     if (event.type === 'assistant') {
 *       console.log('Response:', event.message?.content);
 *     }
 *   }
 * );
 * ```
 *
 * @module gemini
 */

// Abstract class
export { AGeminiClient } from './AGeminiClient.js';
export type { GeminiEventCallback } from './AGeminiClient.js';

// Implementation
export { GeminiClient } from './geminiClient.js';

// Types
export type {
  GeminiClientConfig,
  TextPart,
  InlineDataPart,
  Part,
  Content,
  GenerateContentParams,
  Candidate,
  UsageMetadata,
  GenerateContentStreamChunk,
  GenerateContentResponse,
  StreamCallback,
  GeminiSessionEvent,
  StreamOptions,
  GeminiSessionResult,
} from './types.js';
export { GeminiError } from './types.js';
