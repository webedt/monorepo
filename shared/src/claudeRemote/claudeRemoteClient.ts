/**
 * Claude Remote Sessions Client
 *
 * TypeScript client for Anthropic's Remote Sessions API.
 * Ported from claude-web-cli/claude-session.mjs
 */

import { randomUUID } from 'crypto';
import {
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session,
  SessionEvent,
  EventsResponse,
  SessionResult,
  EventCallback,
  PollOptions,
  ClaudeRemoteError,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 300; // 10 minutes at 2s intervals

/**
 * Fetch environment ID from a user's recent sessions
 * This is used when CLAUDE_ENVIRONMENT_ID is not configured
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
 * Client for interacting with Claude Remote Sessions API
 */
export class ClaudeRemoteClient {
  private accessToken: string;
  private environmentId: string;
  private orgUuid?: string;
  private baseUrl: string;
  private model: string;

  constructor(config: ClaudeRemoteClientConfig) {
    this.accessToken = config.accessToken;
    this.environmentId = config.environmentId;
    this.orgUuid = config.orgUuid;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
  }

  /**
   * Update the access token (e.g., after refresh)
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
   * Generate a title from the prompt
   */
  private generateTitle(prompt: string): string {
    const title = prompt.slice(0, 50).replace(/\n/g, ' ').trim();
    return title.length < prompt.length ? title + '...' : title;
  }

  /**
   * Generate a branch prefix from the prompt
   */
  private generateBranchPrefix(prompt: string): string {
    const words = prompt.slice(0, 40)
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
   * Create a new remote session
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

    const payload = {
      title: sessionTitle,
      events: [{
        type: 'event',
        data: {
          uuid: eventUuid,
          session_id: '',
          type: 'user',
          parent_tool_use_id: null,
          message: { role: 'user', content: prompt }
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
   * Get session metadata
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
   * Get session events
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
   * Send a message to resume a session
   */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    const payload = {
      events: [{
        type: 'user',
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: message }
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
   * Archive a session
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
   * Rename a session
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
   * Interrupt a running session via HTTP
   * Note: WebSocket interrupt is preferred but requires 'ws' package
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
      if (event.tool_use_result?.stdout) {
        const match = event.tool_use_result.stdout.match(/claude\/[a-zA-Z0-9_-]+/);
        if (match) return match[0];
      }
      // Check data extra args
      if (event.data?.extra && typeof event.data.extra === 'object') {
        const extra = event.data.extra as Record<string, unknown>;
        if (Array.isArray(extra.args)) {
          const argsStr = extra.args.join(' ');
          const match = argsStr.match(/branch `(claude\/[a-zA-Z0-9_-]+)`/);
          if (match) return match[1];
        }
      }
    }
    return undefined;
  }

  /**
   * Poll a session until completion, calling the callback for each new event
   */
  async pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    const {
      skipExistingEvents = false,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
      maxPolls = DEFAULT_MAX_POLLS,
      abortSignal,
    } = options;

    const seenEventIds = new Set<string>();
    let pollCount = 0;
    let title: string | undefined;
    let branch: string | undefined;

    // For resume: mark existing events as seen
    if (skipExistingEvents) {
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
                totalCost: event.total_cost_usd,
                durationMs: event.duration_ms,
                numTurns: event.num_turns,
                result: event.result,
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
   * Execute a session from start to finish
   * Creates the session, polls for events, and returns the result
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
   * Resume a session with a new message
   */
  async resume(
    sessionId: string,
    message: string,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    // Send the message
    await this.sendMessage(sessionId, message);

    // Poll for new events only
    return this.pollSession(sessionId, onEvent, {
      ...options,
      skipExistingEvents: true,
    });
  }
}
