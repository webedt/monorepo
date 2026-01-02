/**
 * Execution Provider Documentation Interface
 *
 * This file contains the fully-documented interface for Execution Providers.
 * Implementation classes should extend AExecutionProvider to inherit
 * common functionality and implement the abstract methods.
 *
 * @see AExecutionProvider for the abstract base class
 * @see ClaudeRemoteProvider for the Claude Remote implementation
 * @see GeminiProvider for the Gemini implementation
 */

import type { ClaudeAuth } from '../../auth/claudeAuth.js';
import type { GeminiAuth } from '../../auth/lucia.js';
import type { ExecuteParams } from './types.js';
import type { ExecutionEvent } from './types.js';
import type { ExecutionEventCallback } from './types.js';
import type { ExecutionResult } from './types.js';
import type { ProviderCapabilities } from './types.js';
import type { ResumeParams } from './types.js';

export type { ExecuteParams } from './types.js';
export type { ExecutionEvent } from './types.js';
export type { ExecutionEventCallback } from './types.js';
export type { ExecutionResult } from './types.js';
export type { ProviderCapabilities } from './types.js';
export type { ResumeParams } from './types.js';

/**
 * Interface for Execution Provider with full documentation.
 *
 * Execution providers handle the actual AI execution for coding tasks.
 * They abstract the differences between various AI backends (Claude Remote,
 * Gemini, self-hosted workers) behind a common interface.
 *
 * ## Available Providers
 *
 * - **ClaudeRemoteProvider**: Anthropic's Remote Sessions API (recommended)
 * - **GeminiProvider**: Google's Gemini API
 * - **CodexRemoteProvider**: OpenAI's API
 * - **SelfHostedWorkerProvider**: Custom worker for local LLM execution
 *
 * ## Event-Driven Architecture
 *
 * All providers emit events during execution via the `onEvent` callback.
 * This enables:
 * - Real-time progress updates in the UI
 * - Persistent storage of all events for replay
 * - Consistent event format across providers
 *
 * ## Provider Selection
 *
 * Use `ProviderCapabilities` to determine which features a provider supports
 * before selecting it for a task:
 *
 * ```typescript
 * if (provider.capabilities.supportsImages) {
 *   // Can include image content blocks in prompt
 * }
 *
 * if (provider.capabilities.supportsResume) {
 *   // Can resume existing sessions with follow-up messages
 * }
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const provider = new ClaudeRemoteProvider(config);
 *
 * const result = await provider.execute(
 *   {
 *     userId: 'user-123',
 *     chatSessionId: 'chat-456',
 *     prompt: 'Add dark mode support',
 *     gitUrl: 'https://github.com/org/repo',
 *     claudeAuth: userClaudeAuth,
 *   },
 *   (event) => {
 *     console.log(`[${event.type}]`, event);
 *     // Store event, update UI, etc.
 *   }
 * );
 *
 * console.log(`Completed: ${result.status}`);
 * console.log(`Branch: ${result.branch}`);
 * ```
 */
export interface IExecutionProviderDocumentation {
  /**
   * Provider name for logging and identification.
   *
   * Used in log messages, error reports, and UI displays.
   *
   * @example
   * ```typescript
   * console.log(`Using provider: ${provider.name}`);
   * // Output: "Using provider: ClaudeRemoteProvider"
   * ```
   */
  readonly name: string;

  /**
   * Provider capabilities for feature discovery.
   *
   * Query this to determine what features the provider supports before
   * using them. Enables UI to show/hide features based on provider.
   *
   * @example
   * ```typescript
   * const caps = provider.capabilities;
   *
   * // Check image support before allowing image upload
   * if (!caps.supportsImages) {
   *   showWarning('This provider does not support image attachments');
   * }
   *
   * // Disable resume button if not supported
   * resumeButton.disabled = !caps.supportsResume;
   *
   * // Show session link if provider has persistent sessions
   * if (caps.hasPersistentSessions && result.remoteWebUrl) {
   *   showLink('View on Claude.ai', result.remoteWebUrl);
   * }
   * ```
   */
  readonly capabilities: ProviderCapabilities;

  /**
   * Execute a new AI request.
   *
   * Creates a new execution session and processes the given prompt.
   * Events are emitted throughout execution via the callback.
   *
   * The execution lifecycle:
   * 1. **connected** event - Connection established
   * 2. **session_created** event - Remote session created (if applicable)
   * 3. **user** event - User message received
   * 4. **assistant** events - AI responses
   * 5. **tool_use** events - Tool calls (file edits, bash commands, etc.)
   * 6. **result** event - Final result with cost/duration
   * 7. **completed** event - Execution finished
   *
   * @param params - Execution parameters
   * @param params.userId - User ID for tracking and authorization
   * @param params.chatSessionId - Chat session ID in our database
   * @param params.prompt - The coding task (string or content blocks with images)
   * @param params.gitUrl - GitHub repository URL
   * @param params.model - Optional model override
   * @param params.claudeAuth - Claude auth credentials (required for Claude provider)
   * @param params.geminiAuth - Gemini auth credentials (required for Gemini provider)
   * @param params.environmentId - Environment ID for Claude Remote
   * @param params.abortSignal - Signal to abort execution
   * @param onEvent - Callback invoked for each event
   * @returns Execution result with session ID, branch, cost, and status
   * @throws Error if execution fails (also emits 'error' event)
   *
   * @example
   * ```typescript
   * // Basic execution
   * const result = await provider.execute(
   *   {
   *     userId: 'user-123',
   *     chatSessionId: 'chat-456',
   *     prompt: 'Add unit tests for the auth module',
   *     gitUrl: 'https://github.com/org/repo',
   *     claudeAuth: userAuth,
   *   },
   *   (event) => {
   *     console.log(`Event: ${event.type}`);
   *   }
   * );
   * ```
   *
   * @example
   * ```typescript
   * // With abort signal for cancellation
   * const controller = new AbortController();
   *
   * // Cancel after 5 minutes
   * setTimeout(() => controller.abort(), 300000);
   *
   * try {
   *   const result = await provider.execute(
   *     { ...params, abortSignal: controller.signal },
   *     onEvent
   *   );
   * } catch (error) {
   *   if (error.name === 'AbortError') {
   *     console.log('Execution was cancelled');
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // With image content blocks
   * const result = await provider.execute(
   *   {
   *     userId: 'user-123',
   *     chatSessionId: 'chat-456',
   *     prompt: [
   *       { type: 'text', text: 'Implement this UI design' },
   *       {
   *         type: 'image',
   *         source: {
   *           type: 'base64',
   *           media_type: 'image/png',
   *           data: base64ImageData,
   *         },
   *       },
   *     ],
   *     gitUrl: 'https://github.com/org/repo',
   *     claudeAuth: userAuth,
   *   },
   *   onEvent
   * );
   * ```
   */
  execute(
    params: ExecuteParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult>;

  /**
   * Resume an existing session with a new message.
   *
   * Sends a follow-up message to an existing session and continues execution.
   * Requires the remote session ID from the original execution.
   *
   * Resume is useful for:
   * - Multi-turn conversations with Claude
   * - Providing additional instructions after initial execution
   * - Correcting or refining previous work
   *
   * @param params - Resume parameters
   * @param params.userId - User ID for tracking
   * @param params.chatSessionId - Chat session ID in our database
   * @param params.remoteSessionId - Remote session ID from original execution
   * @param params.prompt - Follow-up message (string or content blocks)
   * @param params.claudeAuth - Claude auth credentials
   * @param params.geminiAuth - Gemini auth credentials
   * @param params.environmentId - Environment ID for Claude Remote
   * @param params.abortSignal - Signal to abort
   * @param onEvent - Callback for events
   * @returns Execution result
   * @throws Error if provider doesn't support resume or session not found
   *
   * @example
   * ```typescript
   * // Check if resume is supported
   * if (!provider.capabilities.supportsResume) {
   *   throw new Error('Provider does not support resume');
   * }
   *
   * const result = await provider.resume(
   *   {
   *     userId: 'user-123',
   *     chatSessionId: 'chat-456',
   *     remoteSessionId: 'session_abc123',
   *     prompt: 'Now add tests for that feature',
   *     claudeAuth: userAuth,
   *   },
   *   onEvent
   * );
   * ```
   *
   * @example
   * ```typescript
   * // Resume with image attachment
   * const result = await provider.resume(
   *   {
   *     userId: 'user-123',
   *     chatSessionId: 'chat-456',
   *     remoteSessionId: originalResult.remoteSessionId,
   *     prompt: [
   *       { type: 'text', text: 'Update the button to match this design' },
   *       { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } },
   *     ],
   *     claudeAuth: userAuth,
   *   },
   *   onEvent
   * );
   * ```
   */
  resume(
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult>;

  /**
   * Interrupt a running session.
   *
   * Sends an interrupt signal to stop the current operation. The session
   * transitions to an idle state and can be resumed with new instructions.
   *
   * Use this when:
   * - User wants to stop a long-running operation
   * - Need to change direction mid-execution
   * - Session appears stuck
   *
   * @param remoteSessionId - The remote session ID to interrupt
   * @param auth - Authentication credentials (provider-specific)
   * @throws Error if interrupt fails or provider doesn't support it
   *
   * @example
   * ```typescript
   * // Check if interrupt is supported
   * if (!provider.capabilities.supportsInterrupt) {
   *   throw new Error('Provider does not support interrupt');
   * }
   *
   * // Interrupt the session
   * await provider.interrupt('session_abc123', userAuth);
   *
   * // Wait a moment for session to become idle
   * await sleep(1000);
   *
   * // Resume with new instructions
   * await provider.resume(
   *   { ...params, prompt: 'Actually, do this instead...' },
   *   onEvent
   * );
   * ```
   *
   * @example
   * ```typescript
   * // Interrupt with timeout handling
   * try {
   *   await Promise.race([
   *     provider.interrupt(sessionId, auth),
   *     sleep(10000).then(() => { throw new Error('Interrupt timeout'); }),
   *   ]);
   * } catch (error) {
   *   console.error('Failed to interrupt:', error.message);
   * }
   * ```
   */
  interrupt(
    remoteSessionId: string,
    auth?: ClaudeAuth | GeminiAuth
  ): Promise<void>;
}
