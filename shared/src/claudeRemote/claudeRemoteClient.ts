/**
 * Claude Remote Sessions Client
 *
 * TypeScript client for Anthropic's Remote Sessions API, enabling execution of
 * Claude Code tasks on Anthropic's cloud infrastructure.
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
 * @see {@link ClaudeRemoteClient} for the main client class
 * @see {@link fetchEnvironmentIdFromSessions} for environment ID discovery
 */

import { randomUUID } from 'crypto';
import {
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session,
  SessionEvent,
  EventsResponse,
  ListSessionsResponse,
  SessionResult,
  EventCallback,
  PollOptions,
  ClaudeRemoteError,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-opus-4-5-20251101';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 300; // 10 minutes at 2s intervals

/**
 * Fetch environment ID from a user's recent sessions.
 *
 * This utility discovers a user's environment ID by querying their existing sessions.
 * Useful when `CLAUDE_ENVIRONMENT_ID` is not configured in the environment.
 *
 * The environment ID is required for creating new Claude Remote sessions and can be
 * found in the Claude.ai account settings.
 *
 * @param accessToken - OAuth access token for the Claude API
 * @param baseUrl - API base URL (defaults to `https://api.anthropic.com`)
 * @param orgUuid - Optional organization UUID for enterprise accounts
 * @returns The environment ID if found, or `null` if no sessions exist
 *
 * @example
 * ```typescript
 * // Discover environment ID from existing sessions
 * const envId = await fetchEnvironmentIdFromSessions(accessToken);
 *
 * if (envId) {
 *   const client = new ClaudeRemoteClient({
 *     accessToken,
 *     environmentId: envId,
 *   });
 * } else {
 *   console.log('No environment ID found - check Claude.ai settings');
 * }
 * ```
 */
export async function fetchEnvironmentIdFromSessions(
  accessToken: string,
  baseUrl: string = DEFAULT_BASE_URL,
  orgUuid?: string
): Promise<string | null> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'Content-Type': 'application/json',
  };
  if (orgUuid) {
    headers['x-organization-uuid'] = orgUuid;
  }

  try {
    const response = await fetch(`${baseUrl}/v1/sessions?limit=1`, {
      headers
    });
    if (!response.ok) return null;

    const data = await response.json() as { data?: Session[] };
    const sessions = data.data || [];
    if (sessions.length > 0 && sessions[0].environment_id) {
      return sessions[0].environment_id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Client for interacting with the Claude Remote Sessions API.
 *
 * Provides a high-level interface for executing Claude Code tasks on Anthropic's
 * cloud infrastructure. Handles session creation, event polling, and message sending.
 *
 * ## Quick Start
 *
 * ```typescript
 * const client = new ClaudeRemoteClient({
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
 *
 * @see {@link CreateSessionParams} for session creation options
 * @see {@link SessionResult} for execution results
 */
export class ClaudeRemoteClient {
  private accessToken: string;
  private environmentId: string;
  private orgUuid?: string;
  private baseUrl: string;
  private model: string;

  /**
   * Create a new Claude Remote client.
   *
   * @param config - Client configuration options
   * @param config.accessToken - OAuth access token from Claude.ai
   * @param config.environmentId - Environment ID from Claude.ai settings
   * @param config.orgUuid - Optional organization UUID for enterprise accounts
   * @param config.baseUrl - API base URL (defaults to `https://api.anthropic.com`)
   * @param config.model - Model to use (defaults to `claude-opus-4-5-20251101`)
   *
   * @example
   * ```typescript
   * const client = new ClaudeRemoteClient({
   *   accessToken: process.env.CLAUDE_ACCESS_TOKEN!,
   *   environmentId: process.env.CLAUDE_ENVIRONMENT_ID!,
   * });
   * ```
   */
  constructor(config: ClaudeRemoteClientConfig) {
    this.accessToken = config.accessToken;
    this.environmentId = config.environmentId;
    this.orgUuid = config.orgUuid;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
  }

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
   * // Refresh token before it expires
   * const newToken = await refreshClaudeToken(refreshToken);
   * client.setAccessToken(newToken);
   * ```
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * Build headers for API requests
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'Content-Type': 'application/json',
    };
    if (this.orgUuid) {
      headers['x-organization-uuid'] = this.orgUuid;
    }
    return headers;
  }

  /**
   * Extract text from prompt (handles both string and content blocks)
   */
  private extractTextFromPrompt(prompt: string | Array<{ type: string; text?: string }>): string {
    if (typeof prompt === 'string') {
      return prompt;
    }
    // Extract text from content blocks
    return prompt
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  }

  /**
   * Generate a title from the prompt
   */
  private generateTitle(prompt: string | Array<{ type: string; text?: string }>): string {
    const text = this.extractTextFromPrompt(prompt);
    const title = text.slice(0, 50).replace(/\n/g, ' ').trim();
    return title.length < text.length ? title + '...' : title;
  }

  /**
   * Generate a branch prefix from the prompt
   */
  private generateBranchPrefix(prompt: string | Array<{ type: string; text?: string }>): string {
    const text = this.extractTextFromPrompt(prompt);
    const words = text.slice(0, 40)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-');
    return `claude/${words || 'session'}`;
  }

  /**
   * Extract repo name from git URL (e.g., "owner/repo")
   */
  private extractRepoName(gitUrl: string): string {
    const match = gitUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
    return match ? match[1].replace(/\.git$/, '') : 'unknown/repo';
  }

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
  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    const { prompt, gitUrl, model, branchPrefix, title } = params;

    const eventUuid = randomUUID();
    const sessionTitle = title || this.generateTitle(prompt);
    const sessionBranchPrefix = branchPrefix || this.generateBranchPrefix(prompt);
    const repoName = this.extractRepoName(gitUrl);
    const sessionModel = model || this.model;

    // Claude API requires git URLs without .git suffix
    const cleanGitUrl = gitUrl.replace(/\.git$/, '');

    // Handle both string prompts and content blocks (for images)
    // The API expects content to be either a string or an array of content blocks
    const messageContent = prompt;

    const payload = {
      title: sessionTitle,
      events: [{
        type: 'event',
        data: {
          uuid: eventUuid,
          session_id: '',
          type: 'user',
          parent_tool_use_id: null,
          message: { role: 'user', content: messageContent }
        }
      }],
      environment_id: this.environmentId,
      session_context: {
        sources: [{ type: 'git_repository', url: cleanGitUrl }],
        outcomes: [{
          type: 'git_repository',
          git_info: {
            type: 'github',
            repo: repoName,
            branches: [sessionBranchPrefix]
          }
        }],
        model: sessionModel
      }
    };

    const response = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to create session: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    const session = await response.json() as Session;

    return {
      sessionId: session.id,
      environmentId: session.environment_id,
      webUrl: `https://claude.ai/code/${session.id}`,
      title: session.title,
    };
  }

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
  async getSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to get session: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    return response.json() as Promise<Session>;
  }

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
  async listSessions(limit: number = 20, before?: string): Promise<ListSessionsResponse> {
    const url = new URL(`${this.baseUrl}/v1/sessions`);
    url.searchParams.set('limit', String(limit));
    if (before) {
      url.searchParams.set('before', before);
    }

    const response = await fetch(url.toString(), {
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to list sessions: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    return response.json() as Promise<ListSessionsResponse>;
  }

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
  async getEvents(sessionId: string): Promise<EventsResponse> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/events`, {
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to get events: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    return response.json() as Promise<EventsResponse>;
  }

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
  async sendMessage(sessionId: string, message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>): Promise<void> {
    // The API accepts content as either a string or an array of content blocks
    const messageContent = message;

    const payload = {
      events: [{
        type: 'user',
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: messageContent }
      }]
    };

    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to send message: ${response.status} ${text}`,
        response.status,
        text
      );
    }
  }

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
   * // Archive a completed session
   * await client.archiveSession('session_abc123');
   * ```
   */
  async archiveSession(sessionId: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/archive`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to archive session: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    return response.json() as Promise<Session>;
  }

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
   * // Give the session a descriptive name
   * await client.renameSession('session_abc123', 'Add dark mode to settings page');
   * ```
   */
  async renameSession(sessionId: string, newTitle: string): Promise<Session> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: this.buildHeaders(),
      body: JSON.stringify({ title: newTitle })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to rename session: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    return response.json() as Promise<Session>;
  }

  /**
   * Interrupt a running session.
   *
   * Sends an interrupt signal to stop the current operation. The session
   * will transition to an idle state and can be resumed with new instructions.
   *
   * **Note:** This uses HTTP. WebSocket-based interrupts are more responsive
   * but require the `ws` package.
   *
   * @param sessionId - The session ID to interrupt
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
  async interruptSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        events: [{
          type: 'control_request',
          action: 'interrupt',
          uuid: randomUUID()
        }]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ClaudeRemoteError(
        `Failed to interrupt session: ${response.status} ${text}`,
        response.status,
        text
      );
    }
  }

  /**
   * Extract branch name from events
   */
  private extractBranchName(events: SessionEvent[]): string | undefined {
    for (const event of events) {
      // Check tool result stdout
      const toolResult = event.tool_use_result as { stdout?: string } | undefined;
      if (toolResult?.stdout) {
        const match = toolResult.stdout.match(/claude\/[a-zA-Z0-9_-]+/);
        if (match) return match[0];
      }
      // Check data extra args
      const data = event.data as { extra?: Record<string, unknown> } | undefined;
      if (data?.extra && typeof data.extra === 'object') {
        const extra = data.extra;
        if (Array.isArray(extra.args)) {
          const argsStr = (extra.args as string[]).join(' ');
          const match = argsStr.match(/branch `(claude\/[a-zA-Z0-9_-]+)`/);
          if (match) return match[1];
        }
      }
    }
    return undefined;
  }

  /**
   * Poll a session until completion.
   *
   * Continuously fetches session events and calls the callback for each new event.
   * Automatically handles event deduplication and tracks session state.
   *
   * Polling continues until:
   * - Session status becomes `completed` or `failed`
   * - A `result` event is received
   * - The abort signal is triggered
   * - Maximum polls is reached (default: 300 = ~10 minutes)
   *
   * @param sessionId - The session ID to poll
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options
   * @param options.skipExistingEvents - Skip events that existed before polling started
   * @param options.existingEventIds - Pre-captured event IDs to skip (for resume)
   * @param options.pollIntervalMs - Interval between polls (default: 2000ms)
   * @param options.maxPolls - Maximum number of polls (default: 300)
   * @param options.abortSignal - Signal to abort polling early
   * @returns Session result with status, branch, cost, and duration
   * @throws {ClaudeRemoteError} If polling times out or is aborted
   *
   * @example
   * ```typescript
   * // Poll with event logging
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
   *
   * setTimeout(() => controller.abort(), 60000); // 1 minute timeout
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
  async pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    const {
      skipExistingEvents = false,
      existingEventIds,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      maxPolls = DEFAULT_MAX_POLLS,
      abortSignal,
    } = options;

    // Use pre-captured event IDs if provided (from resume()), otherwise create new set
    const seenEventIds = existingEventIds ? new Set(existingEventIds) : new Set<string>();
    let pollCount = 0;
    let title: string | undefined;
    let branch: string | undefined;

    // For resume: mark existing events as seen (only if not already provided)
    if (skipExistingEvents && !existingEventIds) {
      try {
        const existingEvents = await this.getEvents(sessionId);
        for (const event of existingEvents.data || []) {
          seenEventIds.add(event.uuid);
        }
      } catch {
        // Ignore errors fetching existing events
      }
    }

    while (pollCount < maxPolls) {
      // Check for abort
      if (abortSignal?.aborted) {
        throw new ClaudeRemoteError('Polling aborted by signal');
      }

      try {
        // Get session status
        const session = await this.getSession(sessionId);
        if (session.title && session.title !== title) {
          title = session.title;
        }

        // Get events
        const eventsResponse = await this.getEvents(sessionId);
        const events = eventsResponse.data || [];

        // Extract branch if not found yet
        if (!branch) {
          branch = this.extractBranchName(events);
        }

        // Process new events
        for (const event of events) {
          if (!seenEventIds.has(event.uuid)) {
            seenEventIds.add(event.uuid);
            await onEvent(event);

            // Check for completion
            if (event.type === 'result') {
              return {
                sessionId,
                status: 'completed',
                title: title || session.title,
                branch,
                totalCost: event.total_cost_usd as number | undefined,
                durationMs: event.duration_ms as number | undefined,
                numTurns: event.num_turns as number | undefined,
                result: event.result as string | undefined,
              };
            }
          }
        }

        // Check if session is done
        if (session.session_status === 'completed' || session.session_status === 'failed') {
          return {
            sessionId,
            status: session.session_status,
            title: title || session.title,
            branch,
          };
        }

        // For resume: exit if session goes idle
        if (skipExistingEvents && session.session_status === 'idle') {
          return {
            sessionId,
            status: 'idle',
            title: title || session.title,
            branch,
          };
        }

        // Wait before next poll
        await this.sleep(pollIntervalMs, abortSignal);
        pollCount++;

      } catch (error) {
        // Don't throw on polling errors, just continue
        if (error instanceof ClaudeRemoteError && error.message.includes('aborted')) {
          throw error;
        }
        await this.sleep(pollIntervalMs, abortSignal);
        pollCount++;
      }
    }

    // Timeout
    throw new ClaudeRemoteError(`Polling timeout after ${maxPolls} polls (${Math.round(maxPolls * pollIntervalMs / 1000 / 60)} minutes)`);
  }

  /**
   * Sleep helper that respects abort signal
   */
  private sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (abortSignal?.aborted) {
        reject(new ClaudeRemoteError('Sleep aborted by signal'));
        return;
      }

      const timeout = setTimeout(resolve, ms);

      if (abortSignal) {
        const abortHandler = () => {
          clearTimeout(timeout);
          reject(new ClaudeRemoteError('Sleep aborted by signal'));
        };
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }

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
  async execute(
    params: CreateSessionParams,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    // Create session
    const { sessionId, title } = await this.createSession(params);

    // Poll until completion
    const result = await this.pollSession(sessionId, onEvent, options);

    return {
      ...result,
      title: result.title || title,
    };
  }

  /**
   * Resume a session with a follow-up message.
   *
   * Sends a new message to an existing session and polls for the response.
   * Use this to continue a conversation or provide additional instructions.
   *
   * The method:
   * 1. Captures existing event IDs to avoid duplicates
   * 2. Sends the new message
   * 3. Polls for new events only
   *
   * @param sessionId - The session ID to resume
   * @param message - Follow-up message (string or content blocks with images)
   * @param onEvent - Callback invoked for each new event
   * @param options - Polling options (see `pollSession`)
   * @returns Session result with updated status
   * @throws {ClaudeRemoteError} If resuming fails
   *
   * @example
   * ```typescript
   * // Continue with additional instructions
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
  async resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    // IMPORTANT: Capture existing event IDs BEFORE sending the message
    // This ensures we can properly filter out old events during polling
    const existingEventIds = new Set<string>();
    try {
      const existingEvents = await this.getEvents(sessionId);
      for (const event of existingEvents.data || []) {
        existingEventIds.add(event.uuid);
      }
    } catch {
      // Ignore errors fetching existing events
    }

    // Send the message
    await this.sendMessage(sessionId, message);

    // Poll for new events only, passing the pre-captured event IDs
    return this.pollSession(sessionId, onEvent, {
      ...options,
      skipExistingEvents: true,
      existingEventIds, // Pass pre-captured IDs
    });
  }
}
