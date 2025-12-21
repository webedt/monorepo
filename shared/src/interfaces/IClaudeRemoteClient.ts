/**
 * Interface for Claude Remote Sessions Client
 *
 * Defines the contract for interacting with Anthropic's Remote Sessions API.
 * Enables execution of Claude Code tasks on Anthropic's cloud infrastructure.
 *
 * @see ClaudeRemoteClient for the implementation
 * @module interfaces/IClaudeRemoteClient
 */

import type {
  CreateSessionParams,
  CreateSessionResult,
  Session,
  EventsResponse,
  ListSessionsResponse,
  SessionResult,
  EventCallback,
  PollOptions,
} from '../claudeRemote/types.js';

/**
 * Client interface for interacting with the Claude Remote Sessions API.
 *
 * Provides a high-level interface for executing Claude Code tasks on Anthropic's
 * cloud infrastructure. Handles session creation, event polling, and message sending.
 *
 * @example
 * ```typescript
 * const client: IClaudeRemoteClient = new ClaudeRemoteClient({
 *   accessToken: 'oauth-access-token',
 *   environmentId: 'env_xxx',
 * });
 *
 * const result = await client.execute(
 *   { prompt: 'Add dark mode', gitUrl: 'https://github.com/org/repo' },
 *   (event) => console.log(event.type)
 * );
 * ```
 */
export interface IClaudeRemoteClient {
  /**
   * Update the access token.
   *
   * Use this method to refresh the token when it expires without creating
   * a new client instance.
   *
   * @param accessToken - New OAuth access token
   */
  setAccessToken(accessToken: string): void;

  /**
   * Create a new remote coding session.
   *
   * Initiates a Claude Remote session that clones the specified GitHub repository
   * and begins executing the given prompt.
   *
   * @param params - Session creation parameters
   * @returns Session creation result with session ID and web URL
   * @throws {ClaudeRemoteError} If session creation fails
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
   */
  getEvents(sessionId: string): Promise<EventsResponse>;

  /**
   * Send a message to a session.
   *
   * Sends a user message to an existing session. Use this for follow-up
   * instructions or to continue a conversation.
   *
   * @param sessionId - The session ID to send the message to
   * @param message - Message content (string or content blocks with images)
   * @throws {ClaudeRemoteError} If the message fails to send
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
   */
  archiveSession(sessionId: string): Promise<Session>;

  /**
   * Rename a session.
   *
   * Updates the session's title.
   *
   * @param sessionId - The session ID to rename
   * @param newTitle - New title for the session
   * @returns Updated session metadata
   * @throws {ClaudeRemoteError} If renaming fails
   */
  renameSession(sessionId: string, newTitle: string): Promise<Session>;

  /**
   * Interrupt a running session via WebSocket.
   *
   * Sends an interrupt signal to stop the current operation. The session
   * will transition to an idle state and can be resumed with new instructions.
   *
   * @param sessionId - The session ID to interrupt
   * @param timeoutMs - Connection timeout in milliseconds (default: 10000)
   * @throws {ClaudeRemoteError} If the interrupt fails
   */
  interruptSession(sessionId: string, timeoutMs?: number): Promise<void>;

  /**
   * Send a user message via WebSocket.
   *
   * More responsive than HTTP POST for sending messages, especially
   * useful for resume operations after interrupt.
   *
   * @param sessionId - The session ID to send message to
   * @param message - Message content (string or content blocks with images)
   * @param options - Options for message sending
   * @throws {ClaudeRemoteError} If sending fails
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
   *
   * @param sessionId - The session ID to stream events from
   * @param onEvent - Callback invoked for each event
   * @param options - Streaming options
   * @returns Session result with status and metadata
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
   * A session can be resumed when its status is 'idle'.
   *
   * @param sessionId - The session ID to check
   * @param checkEvents - Also check events for completion (default: true)
   * @returns Object with `canResume` boolean and `reason` if not resumable
   */
  canResume(
    sessionId: string,
    checkEvents?: boolean
  ): Promise<{ canResume: boolean; reason?: string; status?: string; hasCompletedEvent?: boolean }>;

  /**
   * Wait for a session to become resumable.
   *
   * Polls the session status until it becomes idle and ready for resume.
   *
   * @param sessionId - The session ID to wait for
   * @param maxWaitMs - Maximum time to wait in milliseconds (default: 30000)
   * @param pollIntervalMs - Polling interval in milliseconds (default: 1000)
   * @returns Object with `canResume` boolean and final status
   */
  waitForResumable(
    sessionId: string,
    maxWaitMs?: number,
    pollIntervalMs?: number
  ): Promise<{ canResume: boolean; reason?: string; status?: string }>;

  /**
   * Poll a session until completion.
   *
   * Continuously fetches session events and calls the callback for each new event.
   *
   * @param sessionId - The session ID to poll
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options
   * @returns Session result with status, branch, cost, and duration
   * @throws {ClaudeRemoteError} If polling times out or is aborted
   */
  pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;

  /**
   * Execute a coding task from start to finish.
   *
   * Creates a session, polls for events, and returns the final result.
   *
   * @param params - Session creation parameters
   * @param onEvent - Callback invoked for each event
   * @param options - Polling options
   * @returns Session result with branch name, cost, and duration
   * @throws {ClaudeRemoteError} If execution fails
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
   *
   * @param sessionId - The session ID to resume
   * @param message - Follow-up message
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options
   * @returns Session result with updated status
   * @throws {ClaudeRemoteError} If resuming fails
   */
  resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
}
