/**
 * Abstract Gemini Client
 *
 * Defines the interface for Gemini API client implementations.
 * Following the same pattern as AClaudeWebClient.
 */

import type { GeminiClientConfig } from './types.js';
import type { GenerateContentParams } from './types.js';
import type { GeminiSessionEvent } from './types.js';
import type { GeminiSessionResult } from './types.js';
import type { StreamOptions } from './types.js';

export type GeminiEventCallback = (event: GeminiSessionEvent) => void | Promise<void>;

export abstract class AGeminiClient {
  abstract configure(
    config: GeminiClientConfig
  ): void;

  abstract generateContent(
    params: GenerateContentParams,
    onEvent: GeminiEventCallback,
    options?: StreamOptions
  ): Promise<GeminiSessionResult>;

  abstract generateContentStream(
    params: GenerateContentParams,
    onEvent: GeminiEventCallback,
    options?: StreamOptions
  ): Promise<GeminiSessionResult>;
}
