/**
 * Claude Web Sessions API Client
 *
 * TypeScript client for Anthropic's Remote Sessions API, allowing execution of
 * Claude Code tasks on Anthropic's cloud infrastructure without local compute.
 *
 * ## Overview
 *
 * Claude Web Sessions enables running Claude Code (the AI coding assistant) via API,
 * where Anthropic hosts the execution environment. You provide:
 * - OAuth credentials (access token)
 * - An environment ID (from your Claude.ai account)
 * - A GitHub repository URL
 * - A prompt describing what you want Claude to do
 *
 * Claude then clones the repo, makes changes, and pushes to a new branch.
 *
 * ## Authentication
 *
 * Requires OAuth 2.0 credentials from Claude.ai. See `auth/claudeAuth.ts` for
 * helpers to manage token refresh.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ClaudeWebClient } from '@webedt/shared';
 *
 * // Create client with OAuth credentials
 * const client = new ClaudeWebClient({
 *   accessToken: 'your-oauth-access-token',
 *   environmentId: 'env_xxx', // From Claude.ai settings
 * });
 *
 * // Execute a task
 * const result = await client.execute(
 *   {
 *     prompt: 'Add a dark mode toggle to the settings page',
 *     gitUrl: 'https://github.com/your-org/your-repo',
 *   },
 *   (event) => {
 *     // Handle streaming events (progress updates, tool calls, etc.)
 *     console.log('Event:', event.type);
 *   }
 * );
 *
 * console.log(`Done! Branch: ${result.branch}`);
 * console.log(`Cost: $${result.totalCost}`);
 * ```
 *
 * ## Session Lifecycle
 *
 * 1. **Create** - `createSession()` initiates a new session with your prompt
 * 2. **Poll** - `pollSession()` streams events as Claude works
 * 3. **Complete** - Session ends with status 'completed' or 'failed'
 *
 * Or use `execute()` which handles the full lifecycle.
 *
 * ## Resuming Sessions
 *
 * ```typescript
 * // Resume an existing session with a follow-up message
 * const result = await client.resume(
 *   'session_xxx',
 *   'Now add tests for the dark mode toggle',
 *   (event) => console.log(event.type)
 * );
 * ```
 *
 * ## Image Support
 *
 * Prompts can include base64-encoded images:
 *
 * ```typescript
 * const result = await client.execute({
 *   prompt: [
 *     { type: 'text', text: 'Implement this UI design' },
 *     { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }
 *   ],
 *   gitUrl: 'https://github.com/your-org/your-repo',
 * }, onEvent);
 * ```
 *
 * @module claudeWeb
 */

// Abstract class
export { AClaudeWebClient } from './AClaudeWebClient.js';

// Implementation
export { ClaudeWebClient, fetchEnvironmentIdFromSessions } from './claudeWebClient.js';
export { generateTitle, generateTitleSync } from './titleGenerator.js';

// Types
export type {
  ClaudeRemoteAuth,
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session,
  SessionStatus,
  SessionEvent,
  ToolUseInfo,
  MessageInfo,
  MessageContentBlock,
  ContentBlock,
  EventsResponse,
  ListSessionsResponse,
  ResumeSessionParams,
  EventCallback,
  RawMessageCallback,
  PollOptions,
  SessionResult,
  GitOutcomeInfo,
  GeneratedTitle,
  TitleGeneratorConfig,
  TitleGenerationEvent,
  TitleGenerationCallback,
} from './types.js';
export { ClaudeRemoteError } from './types.js';
