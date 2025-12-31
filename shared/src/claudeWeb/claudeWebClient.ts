import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { AClaudeWebClient } from './AClaudeWebClient.js';
import { parseGitUrl } from '../utils/helpers/gitUrlHelper.js';
import type { ClaudeRemoteClientConfig } from './types.js';
import type { ClaudeWebClientConfig } from './types.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
import type { Session } from './types.js';
import type { SessionEvent } from './types.js';
import type { EventsResponse } from './types.js';
import type { ListSessionsResponse } from './types.js';
import type { SessionResult } from './types.js';
import type { EventCallback } from './types.js';
import type { PollOptions } from './types.js';
import type { RawMessageCallback } from './types.js';
import { ClaudeRemoteError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

/**
 * Fetch environment ID from existing Claude sessions.
 * This is used as a fallback when CLAUDE_ENVIRONMENT_ID is not configured.
 *
 * @returns The environment ID if found, null if no sessions exist or API is unavailable
 * @throws ClaudeRemoteError if the request fails with a non-recoverable error
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

    if (!response.ok) {
      // 401/403 are expected if token is invalid - return null to trigger re-auth flow
      if (response.status === 401 || response.status === 403) {
        return null;
      }
      // 404 means no sessions exist - this is a valid "not found" case
      if (response.status === 404) {
        return null;
      }
      // Other errors should be logged for debugging
      const text = await response.text().catch(() => 'Unable to read response');
      console.warn(`fetchEnvironmentIdFromSessions: API returned ${response.status}: ${text}`);
      return null;
    }

    const data = await response.json() as { data?: Session[] };
    const sessions = data.data || [];
    if (sessions.length > 0 && sessions[0].environment_id) {
      return sessions[0].environment_id;
    }
    return null;
  } catch (error) {
    // Network errors are expected in some environments - log and return null
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`fetchEnvironmentIdFromSessions: Failed to fetch sessions: ${message}`);
    return null;
  }
}

export class ClaudeWebClient extends AClaudeWebClient {
  private accessToken: string;
  private environmentId: string;
  private orgUuid?: string;
  private baseUrl: string;
  private model: string;

  constructor(config: ClaudeRemoteClientConfig) {
    super();
    this.accessToken = config.accessToken;
    this.environmentId = config.environmentId;
    this.orgUuid = config.orgUuid;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
  }

  configure(
    config: ClaudeWebClientConfig
  ): void {
    this.accessToken = config.accessToken;
    if (config.environmentId !== undefined) {
      this.environmentId = config.environmentId;
    }
    if (config.baseUrl !== undefined) {
      this.baseUrl = config.baseUrl;
    }
    if (config.model !== undefined) {
      this.model = config.model;
    }
  }

  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

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

  private extractTextFromPrompt(prompt: string | Array<{ type: string; text?: string }>): string {
    if (typeof prompt === 'string') {
      return prompt;
    }
    return prompt
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  }

  private generateTitle(prompt: string | Array<{ type: string; text?: string }>): string {
    const text = this.extractTextFromPrompt(prompt);
    const title = text.slice(0, 50).replace(/\n/g, ' ').trim();
    return title.length < text.length ? title + '...' : title;
  }

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
   * Extract repository name (owner/repo format) from a Git URL.
   * Uses the shared parseGitUrl utility for secure URL parsing.
   *
   * @param gitUrl - The Git URL to parse
   * @returns Repository in "owner/repo" format, or "unknown/repo" if parsing fails
   */
  private extractRepoName(gitUrl: string): string {
    const result = parseGitUrl(gitUrl);
    if (result.isValid) {
      return `${result.owner}/${result.repo}`;
    }
    // Fallback for invalid URLs (maintains backward compatibility)
    return 'unknown/repo';
  }

  async createSession(params: CreateSessionParams): Promise<CreateSessionResult> {
    const { prompt, gitUrl, model, branchPrefix, title } = params;

    const eventUuid = randomUUID();
    const sessionTitle = title || this.generateTitle(prompt);
    const sessionBranchPrefix = branchPrefix || this.generateBranchPrefix(prompt);
    const repoName = this.extractRepoName(gitUrl);
    const sessionModel = model || this.model;

    const cleanGitUrl = gitUrl.replace(/\.git$/, '');
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

  async sendMessage(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>
  ): Promise<void> {
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

  async canResume(
    sessionId: string,
    checkEvents: boolean = true
  ): Promise<{ canResume: boolean; reason?: string; status?: string; hasCompletedEvent?: boolean }> {
    const session = await this.getSession(sessionId);

    if (session.session_status === 'completed') {
      return { canResume: false, reason: 'Session is completed', status: session.session_status };
    }
    if (session.session_status === 'failed') {
      return { canResume: false, reason: 'Session has failed', status: session.session_status };
    }
    if (session.session_status === 'archived') {
      return { canResume: false, reason: 'Session is archived', status: session.session_status };
    }

    if (session.session_status === 'running' && checkEvents) {
      try {
        const events = await this.getEvents(sessionId);
        const hasCompletedEvent = events.data?.some(event => {
          const eventType = String(event.type || '').toLowerCase();
          return eventType === 'completed' || eventType === 'result';
        });

        if (hasCompletedEvent) {
          return { canResume: true, status: 'idle', hasCompletedEvent: true };
        }

        return { canResume: false, reason: 'Session is currently running', status: session.session_status };
      } catch (error) {
        // Events API may be unavailable for running sessions - treat as running
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`canResume: Failed to check events for session ${sessionId}: ${message}`);
        return { canResume: false, reason: 'Session is currently running', status: session.session_status };
      }
    }

    if (session.session_status === 'running') {
      return { canResume: false, reason: 'Session is currently running', status: session.session_status };
    }

    return { canResume: true, status: session.session_status };
  }

  async isComplete(
    sessionId: string,
    checkEvents: boolean = false
  ): Promise<{ isComplete: boolean; status?: string; hasResultEvent?: boolean }> {
    const session = await this.getSession(sessionId);
    const status = session.session_status;

    // Helper to check for result event
    const checkForResultEvent = async (): Promise<boolean | undefined> => {
      if (!checkEvents) return undefined;
      try {
        const events = await this.getEvents(sessionId);
        return events.data?.some(event => event.type === 'result') ?? false;
      } catch (error) {
        // Events API may be unavailable - log for debugging but continue
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`isComplete: Failed to check events for session ${sessionId}: ${message}`);
        return undefined;
      }
    };

    // Running sessions are not complete unless they have a result event
    if (status === 'running') {
      const hasResultEvent = await checkForResultEvent();
      if (hasResultEvent) {
        return { isComplete: true, status, hasResultEvent };
      }
      return { isComplete: false, status, hasResultEvent };
    }

    // Terminal and idle states are complete
    if (status === 'idle' || status === 'completed' || status === 'failed' || status === 'archived') {
      const hasResultEvent = await checkForResultEvent();
      return { isComplete: true, status, hasResultEvent };
    }

    // Unknown status, assume not complete
    return { isComplete: false, status };
  }

  async waitForResumable(
    sessionId: string,
    maxWaitMs: number = 30000,
    pollIntervalMs: number = 1000
  ): Promise<{ canResume: boolean; reason?: string; status?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const check = await this.canResume(sessionId);

      if (check.canResume) {
        return check;
      }

      if (check.status === 'completed' || check.status === 'failed' || check.status === 'archived') {
        return check;
      }

      await this.sleep(pollIntervalMs);
    }

    const finalCheck = await this.canResume(sessionId);
    if (!finalCheck.canResume) {
      return {
        canResume: false,
        reason: `Timeout waiting for session to become resumable (status: ${finalCheck.status})`,
        status: finalCheck.status
      };
    }
    return finalCheck;
  }

  private buildWebSocketUrl(sessionId: string): string {
    const wsBase = this.baseUrl.replace(/^https?:\/\//, 'wss://');
    let url = `${wsBase}/v1/sessions/ws/${sessionId}/subscribe`;
    if (this.orgUuid) {
      url += `?organization_uuid=${this.orgUuid}`;
    }
    return url;
  }

  private async createWebSocket(sessionId: string, timeoutMs: number = 10000): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl(sessionId);

      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'ccr-byoc-2025-07-29',
        }
      });

      let settled = false;

      const cleanup = () => {
        ws.off('open', openHandler);
        ws.off('error', errorHandler);
      };

      const openHandler = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        resolve(ws);
      };

      const errorHandler = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        reject(new ClaudeRemoteError(
          `WebSocket connection error: ${error.message}`,
          500
        ));
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.close();
        reject(new ClaudeRemoteError(
          `WebSocket connection timeout after ${timeoutMs}ms`,
          408
        ));
      }, timeoutMs);

      ws.on('open', openHandler);
      ws.on('error', errorHandler);
    });
  }

  private sendControlRequest(
    ws: WebSocket,
    subtype: string,
    additionalData: Record<string, unknown> = {},
    timeoutMs: number = 10000
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        ws.off('message', messageHandler);
      };

      const messageHandler = (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'control_response' && message.response?.request_id === requestId) {
            if (settled) return;
            settled = true;
            cleanup();

            if (message.response.subtype === 'success') {
              resolve(message.response);
            } else if (message.response.subtype === 'error') {
              reject(new ClaudeRemoteError(
                `Control request '${subtype}' failed: ${message.response.error || 'Unknown error'}`,
                400
              ));
            } else {
              resolve(message.response);
            }
          }
        } catch (error) {
          // Non-JSON messages (heartbeats, binary frames) are expected on WebSocket
          // Only log in development for debugging unusual cases
          if (process.env.NODE_ENV === 'development') {
            const msg = error instanceof Error ? error.message : 'Unknown parse error';
            console.debug(`sendControlRequest: Non-JSON message received: ${msg}`);
          }
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new ClaudeRemoteError(
          `Control request '${subtype}' timeout after ${timeoutMs}ms`,
          408
        ));
      }, timeoutMs);

      ws.on('message', messageHandler);

      const controlMessage = JSON.stringify({
        request_id: requestId,
        type: 'control_request',
        request: { subtype, ...additionalData }
      });
      ws.send(controlMessage);
    });
  }

  async sendMessageViaWebSocket(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    options: { timeoutMs?: number; parentToolUseId?: string | null } = {}
  ): Promise<void> {
    const { timeoutMs = 10000, parentToolUseId = null } = options;
    const ws = await this.createWebSocket(sessionId, timeoutMs);

    try {
      const userMessage = JSON.stringify({
        uuid: randomUUID(),
        type: 'user',
        session_id: sessionId,
        parent_tool_use_id: parentToolUseId,
        message: {
          role: 'user',
          content: message
        }
      });

      ws.send(userMessage);

      await new Promise(resolve => setTimeout(resolve, 100));
    } finally {
      ws.close();
    }
  }

  async streamEvents(
    sessionId: string,
    onEvent: EventCallback,
    options: {
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      skipExistingEvents?: boolean;
      onRawMessage?: RawMessageCallback;
    } = {}
  ): Promise<SessionResult> {
    const { timeoutMs = 10000, abortSignal, skipExistingEvents = false, onRawMessage } = options;

    const seenEventIds = new Set<string>();
    if (skipExistingEvents) {
      try {
        const existingEvents = await this.getEvents(sessionId);
        for (const event of existingEvents.data || []) {
          seenEventIds.add(event.uuid);
        }
      } catch (error) {
        // Failed to fetch existing events - continue without deduplication
        // This may result in duplicate events being processed
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`streamEvents: Failed to fetch existing events for ${sessionId}: ${message}`);
      }
    }

    const ws = await this.createWebSocket(sessionId, timeoutMs);
    let title: string | undefined;
    let branch: string | undefined;
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    let cleanedUp = false;
    let settled = false; // Prevents multiple resolve/reject calls

    return new Promise((resolve, reject) => {
      // Use mutable reference to break circular dependency between cleanup and abortHandler
      let abortHandler: (() => void) | null = null;

      // Centralized cleanup function to prevent memory leaks
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        // Clear the keep-alive interval
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }

        // Remove abort signal listener
        if (abortSignal && abortHandler) {
          abortSignal.removeEventListener('abort', abortHandler);
        }

        // Remove all WebSocket listeners to prevent memory leaks
        ws.removeAllListeners('message');
        ws.removeAllListeners('error');
        ws.removeAllListeners('close');

        // Close the WebSocket if still open
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      // Safe resolve that prevents multiple settlements
      const safeResolve = (result: SessionResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      // Safe reject that prevents multiple settlements
      const safeReject = (error: ClaudeRemoteError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      // Now define abortHandler after safeReject is available
      abortHandler = () => {
        safeReject(new ClaudeRemoteError('Streaming aborted by signal'));
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          safeReject(new ClaudeRemoteError('Streaming aborted by signal'));
          return;
        }
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      const messageHandler = async (data: Buffer | string) => {
        try {
          const rawData = data.toString();

          // Call raw message callback before any processing
          if (onRawMessage) {
            await onRawMessage(rawData);
          }

          const message = JSON.parse(rawData);

          if (message.type === 'event' && message.data) {
            const event = message.data as SessionEvent;
            if (!seenEventIds.has(event.uuid)) {
              seenEventIds.add(event.uuid);
              await onEvent(event);

              if (!branch) {
                branch = this.extractBranchName([event]);
              }

              if (event.type === 'result') {
                safeResolve({
                  sessionId,
                  status: 'completed',
                  title: title || '',
                  branch,
                  totalCost: event.total_cost_usd as number | undefined,
                  durationMs: event.duration_ms as number | undefined,
                  numTurns: event.num_turns as number | undefined,
                  result: event.result as string | undefined,
                });
              }
            }
          }

          if (message.uuid && message.type && message.type !== 'event') {
            const event = message as SessionEvent;
            if (!seenEventIds.has(event.uuid)) {
              seenEventIds.add(event.uuid);
              await onEvent(event);

              if (!branch) {
                branch = this.extractBranchName([event]);
              }

              if (event.type === 'result') {
                safeResolve({
                  sessionId,
                  status: 'completed',
                  title: title || '',
                  branch,
                  totalCost: event.total_cost_usd as number | undefined,
                  durationMs: event.duration_ms as number | undefined,
                  numTurns: event.num_turns as number | undefined,
                  result: event.result as string | undefined,
                });
              }
            }
          }

          if (message.type === 'session_status') {
            if (message.status === 'completed' || message.status === 'failed') {
              safeResolve({
                sessionId,
                status: message.status,
                title: title || '',
                branch,
              });
            }
          }
        } catch (error) {
          // Non-JSON messages (heartbeats, keep-alives) are expected on WebSocket
          // Only log in development for debugging unusual cases
          if (process.env.NODE_ENV === 'development') {
            const msg = error instanceof Error ? error.message : 'Unknown parse error';
            console.debug(`streamEvents: Non-JSON message received: ${msg}`);
          }
        }
      };

      const errorHandler = (error: Error) => {
        safeReject(new ClaudeRemoteError(
          `WebSocket error during streaming: ${error.message}`,
          500
        ));
      };

      const closeHandler = (code: number) => {
        if (code !== 1000 && code !== 1001) {
          // Abnormal close - reject (safeReject handles cleanup)
          safeReject(new ClaudeRemoteError(
            `WebSocket closed unexpectedly with code ${code}`,
            500
          ));
        } else {
          // Normal close codes - just cleanup without rejecting
          cleanup();
        }
      };

      // Register WebSocket event handlers
      ws.on('message', messageHandler);
      ws.on('error', errorHandler);
      ws.on('close', closeHandler);

      // Start keep-alive interval
      keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'keep_alive' }));
        } else if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          keepAliveInterval = null;
        }
      }, 30000);
    });
  }

  async initializeSession(sessionId: string, timeoutMs: number = 10000): Promise<void> {
    const ws = await this.createWebSocket(sessionId, timeoutMs);
    try {
      await this.sendControlRequest(ws, 'initialize', {}, timeoutMs);
    } finally {
      ws.close();
    }
  }

  async setPermissionMode(
    sessionId: string,
    mode: 'acceptEdits' | 'requireApproval' = 'acceptEdits',
    timeoutMs: number = 10000
  ): Promise<void> {
    const ws = await this.createWebSocket(sessionId, timeoutMs);
    try {
      await this.sendControlRequest(ws, 'set_permission_mode', { mode }, timeoutMs);
    } finally {
      ws.close();
    }
  }

  async interruptSession(sessionId: string, timeoutMs: number = 10000): Promise<void> {
    const ws = await this.createWebSocket(sessionId, timeoutMs);
    try {
      await this.sendControlRequest(ws, 'interrupt', {}, timeoutMs);
    } finally {
      ws.close();
    }
  }

  private extractBranchName(events: SessionEvent[]): string | undefined {
    for (const event of events) {
      const toolResult = event.tool_use_result as { stdout?: string } | undefined;
      if (toolResult?.stdout) {
        const match = toolResult.stdout.match(/claude\/[a-zA-Z0-9_-]+/);
        if (match) return match[0];
      }
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

  async pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    const {
      skipExistingEvents = false,
      existingEventIds,
      abortSignal,
      onRawMessage,
    } = options;

    const seenEventIds = existingEventIds ? new Set(existingEventIds) : new Set<string>();

    if (skipExistingEvents && !existingEventIds) {
      try {
        const existingEvents = await this.getEvents(sessionId);
        for (const event of existingEvents.data || []) {
          seenEventIds.add(event.uuid);
        }
      } catch (error) {
        // Failed to fetch existing events - continue without deduplication
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`pollSession: Failed to fetch existing events for ${sessionId}: ${message}`);
      }
    }

    return this.streamEvents(sessionId, onEvent, {
      abortSignal,
      skipExistingEvents: seenEventIds.size > 0,
      onRawMessage,
    });
  }

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

  async execute(
    params: CreateSessionParams,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    const { sessionId, title } = await this.createSession(params);
    const result = await this.pollSession(sessionId, onEvent, options);

    return {
      ...result,
      title: result.title || title,
    };
  }

  async resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options: PollOptions = {}
  ): Promise<SessionResult> {
    const resumeCheck = await this.waitForResumable(sessionId, 30000, 1000);

    if (!resumeCheck.canResume) {
      const session = await this.getSession(sessionId);
      return {
        sessionId,
        status: resumeCheck.status as 'idle' | 'running' | 'completed' | 'failed' | 'archived',
        title: session.title,
        result: `Cannot resume session: ${resumeCheck.reason}`,
      };
    }

    const existingEventIds = new Set<string>();
    try {
      const existingEvents = await this.getEvents(sessionId);
      for (const event of existingEvents.data || []) {
        existingEventIds.add(event.uuid);
      }
    } catch (error) {
      // Failed to fetch existing events - continue without deduplication
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`resume: Failed to fetch existing events for ${sessionId}: ${message}`);
    }

    await this.sendMessageViaWebSocket(sessionId, message);

    return this.streamEvents(sessionId, onEvent, {
      abortSignal: options.abortSignal,
      skipExistingEvents: existingEventIds.size > 0,
      onRawMessage: options.onRawMessage,
    });
  }
}
