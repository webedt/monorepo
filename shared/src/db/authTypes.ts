/**
 * Authentication Data Type Definitions
 *
 * Shared type definitions for authentication data structures stored in the database.
 * These types are used by both the Drizzle ORM schema (encryptedColumns.ts)
 * and the sensitive data service (sensitiveDataService.ts).
 *
 * Note: This file intentionally has no imports to avoid circular dependencies.
 */

/**
 * Claude authentication data structure
 * Used for Claude OAuth tokens stored in the claudeAuth column
 */
export interface ClaudeAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Codex (OpenAI) authentication data structure
 * Can contain either an API key or OAuth tokens
 */
export interface CodexAuthData {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Gemini OAuth authentication data structure
 * Used for Google Gemini API access
 */
export interface GeminiAuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Image AI provider API keys
 * Stores API keys for various image generation providers
 */
export interface ImageAiKeysData {
  openrouter?: string;
  cometapi?: string;
  google?: string;
}
