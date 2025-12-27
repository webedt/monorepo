/**
 * Claude Web Client Documentation Interface
 *
 * This file contains the fully-documented interface for the Claude Web Client.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AClaudeWebClient for the abstract base class
 * @see ClaudeWebClient for the concrete implementation
 */

import type { ClaudeWebClientConfig } from './types.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
import type { Session } from './types.js';
import type { EventsResponse } from './types.js';
import type { ListSessionsResponse } from './types.js';
import type { SessionResult } from './types.js';
import type { EventCallback } from './types.js';
import type { PollOptions } from './types.js';

export type { ClaudeWebClientConfig } from './types.js';

/**
 * Interface for Claude Web Client with full documentation.
 *
 * Provides methods for interacting with Anthropic's Remote Sessions API,
 * enabling execution of Claude Code tasks on Anthropic's cloud infrastructure.
 *
 * ## Features
 *
 * - Create new coding sessions with prompts and GitHub repos
 * - Poll for streaming events (tool calls, assistant messages, etc.)
 * - Resume existing sessions with follow-up messages
 * - Support for image attachments in prompts
 * - Automatic branch name extraction from session events
 *
 * ## API Endpoints Used
 *
 * - `POST /v1/sessions` - Create session
 * - `GET /v1/sessions/{id}` - Get session metadata
 * - `GET /v1/sessions/{id}/events` - Get session events
 * - `POST /v1/sessions/{id}/events` - Send message or control request
 * - `PATCH /v1/sessions/{id}` - Update session (rename)
 * - `POST /v1/sessions/{id}/archive` - Archive session
 *
 * ## Quick Start
 *
 * ```typescript
 * const client = new ClaudeWebClient({
 *   accessToken: 'oauth-access-token',
 *   environmentId: 'env_xxx',
 * });
 *
 * // Execute a coding task
 * const result = await client.execute(
 *   {
 *     prompt: 'Add dark mode support',
 *     gitUrl: 'https://github.com/org/repo',
 *   },
 *   (event) => console.log('Event:', event.type)
 * );
 *
 * console.log(`Branch: ${result.branch}`);
 * ```
 *
 * ## Session Lifecycle
 *
 * 1. **Create** - `createSession()` or `execute()` initiates a new session
 * 2. **Poll** - `pollSession()` streams events until completion
 * 3. **Resume** - `resume()` sends follow-up messages to existing sessions
 */
export interface IClaudeWebClientDocumentation {
  /**
   * Reconfigure the client with new settings.
   *
   * Use this method to update the client configuration without creating
   * a new instance. Useful for updating tokens, environment, or model.
   *
   * @param config - New client configuration
   *
   * @example
   * ```typescript
   * client.configure({
   *   accessToken: newToken,
   *   environmentId: 'env_new',
   * });
   * ```
   */
  configure(config: ClaudeWebClientConfig): void;

  /**
   * Update the access token.
   *
   * Use this method to refresh the token when it expires without creating
   * a new client instance.
   *
   * @param accessToken - New OAuth access token
   *
   * @example
   * ```typescript
   * const newToken = await refreshClaudeToken(refreshToken);
   * client.setAccessToken(newToken);
   * ```
   */
  setAccessToken(accessToken: string): void;

  /**
   * Create a new remote coding session.
   *
   * Initiates a Claude Remote session that clones the specified GitHub repository
   * and begins executing the given prompt. Claude will create a new branch, make
   * changes, and push them to the repository.
   *
   * @param params - Session creation parameters
   * @param params.prompt - The coding task to execute (string or content blocks with images)
   * @param params.gitUrl - GitHub repository URL (HTTPS format)
   * @param params.model - Optional model override
   * @param params.branchPrefix - Optional branch prefix (defaults to `claude/{prompt-words}`)
   * @param params.title - Optional session title (defaults to first 50 chars of prompt)
   * @returns Session creation result with session ID and web URL
   * @throws {ClaudeRemoteError} If session creation fails
   *
   * @example
   * ```typescript
   * // Create a session with a text prompt
   * const result = await client.createSession({
   *   prompt: 'Add unit tests for the auth module',
   *   gitUrl: 'https://github.com/org/repo',
   * });
   *
   * console.log(`Session: ${result.sessionId}`);
   * console.log(`View at: ${result.webUrl}`);
   * ```
   *
   * @example
   * ```typescript
   * // Create a session with an image (UI mockup)
   * const result = await client.createSession({
   *   prompt: [
   *     { type: 'text', text: 'Implement this design' },
   *     {
   *       type: 'image',
   *       source: {
   *         type: 'base64',
   *         media_type: 'image/png',
   *         data: base64ImageData,
   *       },
   *     },
   *   ],
   *   gitUrl: 'https://github.com/org/repo',
   * });
   * ```
   */
  createSession(params: CreateSessionParams): Promise<CreateSessionResult>;

  /**
   * Get session metadata.
   *
   * Retrieves the current state of a session including its status, title,
   * and environment information.
   *
   * @param sessionId - The session ID to retrieve
   * @returns Session metadata object
   * @throws {ClaudeRemoteError} If the session doesn't exist or access is denied
   *
   * @example
   * ```typescript
   * const session = await client.getSession('session_abc123');
   * console.log(`Status: ${session.session_status}`);
   * console.log(`Title: ${session.title}`);
   * ```
   */
  getSession(sessionId: string): Promise<Session>;

  /**
   * List sessions with pagination.
   *
   * Retrieves a paginated list of the user's Claude Remote sessions,
   * ordered by creation date (newest first).
   *
   * @param limit - Maximum number of sessions to return (default: 20)
   * @param before - Cursor for pagination (session ID to fetch before)
   * @returns Paginated list of sessions with `data` array and `has_more` flag
   * @throws {ClaudeRemoteError} If the request fails
   *
   * @example
   * ```typescript
   * // Get first page of sessions
   * const page1 = await client.listSessions(10);
   * console.log(`Found ${page1.data.length} sessions`);
   *
   * // Get next page if available
   * if (page1.has_more && page1.data.length > 0) {
   *   const lastId = page1.data[page1.data.length - 1].id;
   *   const page2 = await client.listSessions(10, lastId);
   * }
   * ```
   */
  listSessions(limit?: number, before?: string): Promise<ListSessionsResponse>;

  /**
   * Get all events for a session.
   *
   * Retrieves the complete event history for a session, including user messages,
   * assistant responses, tool calls, and results.
   *
   * @param sessionId - The session ID to get events for
   * @returns Events response with `data` array of session events
   * @throws {ClaudeRemoteError} If the session doesn't exist or access is denied
   *
   * @example
   * ```typescript
   * const events = await client.getEvents('session_abc123');
   *
   * for (const event of events.data) {
   *   console.log(`${event.type}: ${event.uuid}`);
   * }
   * ```
   */
  getEvents(sessionId: string): Promise<EventsResponse>;

  /**
   * Send a message to a session.
   *
   * Sends a user message to an existing session. Use this for follow-up
   * instructions or to continue a conversation. Supports both text and
   * image content.
   *
   * **Note:** After sending a message, use `pollSession()` with
   * `skipExistingEvents: true` to get the response. Or use `resume()`
   * which combines both operations.
   *
   * @param sessionId - The session ID to send the message to
   * @param message - Message content (string or content blocks with images)
   * @throws {ClaudeRemoteError} If the message fails to send
   *
   * @example
   * ```typescript
   * // Send a text message
   * await client.sendMessage('session_abc123', 'Now add tests for that feature');
   *
   * // Send a message with an image
   * await client.sendMessage('session_abc123', [
   *   { type: 'text', text: 'Update the UI to match this design' },
   *   { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } },
   * ]);
   * ```
   */
  sendMessage(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>
  ): Promise<void>;

  /**
   * Archive a session.
   *
   * Marks a session as archived. Archived sessions are hidden from the
   * default session list but can still be accessed directly.
   *
   * @param sessionId - The session ID to archive
   * @returns Updated session metadata
   * @throws {ClaudeRemoteError} If archiving fails
   *
   * @example
   * ```typescript
   * await client.archiveSession('session_abc123');
   * ```
   */
  archiveSession(sessionId: string): Promise<Session>;

  /**
   * Rename a session.
   *
   * Updates the session's title. The title is displayed in the Claude.ai
   * interface and in session listings.
   *
   * @param sessionId - The session ID to rename
   * @param newTitle - New title for the session
   * @returns Updated session metadata
   * @throws {ClaudeRemoteError} If renaming fails
   *
   * @example
   * ```typescript
   * await client.renameSession('session_abc123', 'Add dark mode to settings page');
   * ```
   */
  renameSession(sessionId: string, newTitle: string): Promise<Session>;

  /**
   * Interrupt a running session via WebSocket.
   *
   * Sends an interrupt signal to stop the current operation. The session
   * will transition to an idle state and can be resumed with new instructions.
   *
   * Uses WebSocket for more responsive and reliable interrupts compared to HTTP.
   *
   * @param sessionId - The session ID to interrupt
   * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
   * @throws {ClaudeRemoteError} If the interrupt fails
   *
   * @example
   * ```typescript
   * // Stop a long-running session
   * await client.interruptSession('session_abc123');
   *
   * // Then resume with new instructions
   * await client.resume('session_abc123', 'Stop that and instead...', onEvent);
   * ```
   */
  interruptSession(sessionId: string, timeoutMs?: number): Promise<void>;

  /**
   * Send a user message via WebSocket.
   *
   * This is more responsive than HTTP POST for sending messages, especially
   * useful for resume operations after interrupt.
   *
   * @param sessionId - The session ID to send message to
   * @param message - Message content (string or content blocks with images)
   * @param options - Options for message sending
   * @param options.timeoutMs - Connection timeout (default: 10000)
   * @param options.parentToolUseId - Parent tool use ID (for tool results)
   * @throws {ClaudeRemoteError} If sending fails
   *
   * @example
   * ```typescript
   * await client.sendMessageViaWebSocket('session_abc123', 'Continue with the task');
   * ```
   */
  sendMessageViaWebSocket(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    options?: { timeoutMs?: number; parentToolUseId?: string | null }
  ): Promise<void>;

  /**
   * Stream session events in real-time via WebSocket.
   *
   * Unlike HTTP polling, this receives events as they happen without delay.
   * The callback is invoked for each new event. Returns when session completes
   * or the abort signal is triggered.
   *
   * @param sessionId - The session ID to stream events from
   * @param onEvent - Callback invoked for each event
   * @param options - Streaming options
   * @param options.timeoutMs - Initial connection timeout (default: 10000)
   * @param options.abortSignal - Signal to abort streaming
   * @param options.skipExistingEvents - Skip events that existed before streaming started
   * @returns Session result with status and metadata
   *
   * @example
   * ```typescript
   * const result = await client.streamEvents(
   *   'session_abc123',
   *   (event) => console.log('Event:', event.type),
   *   { abortSignal: controller.signal }
   * );
   * ```
   */
  streamEvents(
    sessionId: string,
    onEvent: EventCallback,
    options?: {
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      skipExistingEvents?: boolean;
    }
  ): Promise<SessionResult>;

  /**
   * Initialize a session via WebSocket.
   *
   * Sends the initialize control request that sets up the session.
   * Usually called automatically when connecting to a new session.
   *
   * @param sessionId - The session ID to initialize
   * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
   */
  initializeSession(sessionId: string, timeoutMs?: number): Promise<void>;

  /**
   * Set the permission mode for a session via WebSocket.
   *
   * Controls what actions Claude can take without explicit approval.
   *
   * @param sessionId - The session ID
   * @param mode - Permission mode ('acceptEdits' allows file edits without approval)
   * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
   */
  setPermissionMode(
    sessionId: string,
    mode?: 'acceptEdits' | 'requireApproval',
    timeoutMs?: number
  ): Promise<void>;

  /**
   * Check if a session can be resumed.
   *
   * A session can be resumed when:
   * - Status is 'idle' (not running, completed, failed, or archived)
   * - No COMPLETED or error events indicate the session has finished
   *
   * Note: The API's session_status can be stale (show "running" when session
   * actually completed). We check events as a fallback for reliability.
   *
   * Use this before sending a resume message to avoid messages being dropped.
   *
   * @param sessionId - The session ID to check
   * @param checkEvents - Also check events for completion (default: true)
   * @returns Object with `canResume` boolean and `reason` if not resumable
   *
   * @example
   * ```typescript
   * const check = await client.canResume('session_abc123');
   * if (!check.canResume) {
   *   console.log(`Cannot resume: ${check.reason}`);
   * }
   * ```
   */
  canResume(
    sessionId: string,
    checkEvents?: boolean
  ): Promise<{ canResume: boolean; reason?: string; status?: string; hasCompletedEvent?: boolean }>;

  /**
   * Check if a session is complete.
   *
   * A session is considered complete when:
   * - Status is 'idle', 'completed', 'failed', or 'archived'
   * - Optionally, has a 'result' event indicating work finished
   *
   * This is useful for determining if a session has finished all work
   * and no further processing is expected.
   *
   * @param sessionId - The session ID to check
   * @param checkEvents - Also check events for a result event (default: false).
   *   When true, makes an additional API call to fetch events.
   * @returns Object with `isComplete` boolean, session status, and optionally `hasResultEvent`
   *
   * @example
   * ```typescript
   * // Quick status check (single API call)
   * const check = await client.isComplete('session_abc123');
   * if (check.isComplete) {
   *   console.log(`Session finished with status: ${check.status}`);
   * }
   *
   * // Also check for result event (two API calls)
   * const checkWithEvents = await client.isComplete('session_abc123', true);
   * if (checkWithEvents.hasResultEvent) {
   *   console.log('Session has a result event');
   * }
   * ```
   */
  isComplete(
    sessionId: string,
    checkEvents?: boolean
  ): Promise<{ isComplete: boolean; status?: string; hasResultEvent?: boolean }>;

  /**
   * Wait for a session to become resumable.
   *
   * Polls the session status until it becomes idle and ready for resume.
   * Useful after interrupting a session to ensure it's ready for new messages.
   *
   * @param sessionId - The session ID to wait for
   * @param maxWaitMs - Maximum time to wait in milliseconds (default: 30000)
   * @param pollIntervalMs - Polling interval in milliseconds (default: 1000)
   * @returns Object with `canResume` boolean and final status
   * @throws {ClaudeRemoteError} If wait times out
   *
   * @example
   * ```typescript
   * await client.interruptSession(sessionId);
   * const ready = await client.waitForResumable(sessionId);
   * if (ready.canResume) {
   *   await client.resume(sessionId, 'Continue with...', onEvent);
   * }
   * ```
   */
  waitForResumable(
    sessionId: string,
    maxWaitMs?: number,
    pollIntervalMs?: number
  ): Promise<{ canResume: boolean; reason?: string; status?: string }>;

  /**
   * Poll a session until completion using WebSocket streaming.
   *
   * Streams session events in real-time via WebSocket. The callback is invoked
   * for each new event. Automatically handles event deduplication and tracks session state.
   *
   * Polling continues until:
   * - Session status becomes `completed` or `failed`
   * - A `result` event is received
   * - The abort signal is triggered
   *
   * @param sessionId - The session ID to poll
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options
   * @param options.skipExistingEvents - Skip events that existed before polling started
   * @param options.existingEventIds - Pre-captured event IDs to skip (for resume)
   * @param options.abortSignal - Signal to abort polling early
   * @returns Session result with status, branch, cost, and duration
   * @throws {ClaudeRemoteError} If streaming fails or is aborted
   *
   * @example
   * ```typescript
   * const result = await client.pollSession(
   *   'session_abc123',
   *   (event) => {
   *     if (event.type === 'assistant') {
   *       console.log('Claude:', event.message?.content);
   *     }
   *   }
   * );
   *
   * console.log(`Status: ${result.status}`);
   * console.log(`Branch: ${result.branch}`);
   * ```
   *
   * @example
   * ```typescript
   * // Poll with abort support
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 60000);
   *
   * try {
   *   const result = await client.pollSession(sessionId, onEvent, {
   *     abortSignal: controller.signal,
   *   });
   * } catch (error) {
   *   if (error.message.includes('aborted')) {
   *     console.log('Polling was cancelled');
   *   }
   * }
   * ```
   */
  pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;

  /**
   * Execute a coding task from start to finish.
   *
   * This is the primary high-level method for running Claude Remote sessions.
   * It creates a session, polls for events, and returns the final result.
   *
   * Claude will:
   * 1. Clone the specified GitHub repository
   * 2. Create a new branch
   * 3. Make code changes based on the prompt
   * 4. Commit and push the changes
   *
   * @param params - Session creation parameters
   * @param params.prompt - The coding task to execute
   * @param params.gitUrl - GitHub repository URL
   * @param params.model - Optional model override
   * @param params.branchPrefix - Optional branch prefix
   * @param params.title - Optional session title
   * @param onEvent - Callback invoked for each event
   * @param options - Polling options (see `pollSession`)
   * @returns Session result with branch name, cost, and duration
   * @throws {ClaudeRemoteError} If execution fails
   *
   * @example
   * ```typescript
   * const result = await client.execute(
   *   {
   *     prompt: 'Add a dark mode toggle to the settings page',
   *     gitUrl: 'https://github.com/org/repo',
   *   },
   *   (event) => {
   *     if (event.type === 'assistant') {
   *       console.log('Progress:', event.message?.content);
   *     }
   *   }
   * );
   *
   * console.log(`Done! Branch: ${result.branch}`);
   * console.log(`Cost: $${result.totalCost?.toFixed(2)}`);
   * console.log(`Duration: ${Math.round((result.durationMs || 0) / 1000)}s`);
   * ```
   */
  execute(
    params: CreateSessionParams,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;

  /**
   * Resume a session with a follow-up message.
   *
   * Sends a new message to an existing session and polls for the response.
   * Use this to continue a conversation or provide additional instructions.
   *
   * The method:
   * 1. Waits for session to be resumable (idle, not running/completed/failed)
   * 2. Captures existing event IDs to avoid duplicates
   * 3. Sends the new message
   * 4. Polls for new events only
   *
   * @param sessionId - The session ID to resume
   * @param message - Follow-up message (string or content blocks with images)
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options (see `pollSession`)
   * @returns Session result with updated status
   * @throws {ClaudeRemoteError} If resuming fails or session cannot be resumed
   *
   * @example
   * ```typescript
   * const result = await client.resume(
   *   'session_abc123',
   *   'Now add tests for the dark mode feature',
   *   (event) => console.log(event.type)
   * );
   * ```
   *
   * @example
   * ```typescript
   * // Resume with an image
   * const result = await client.resume(
   *   sessionId,
   *   [
   *     { type: 'text', text: 'Update the button to look like this' },
   *     { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } },
   *   ],
   *   onEvent
   * );
   * ```
   */
  resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
}
