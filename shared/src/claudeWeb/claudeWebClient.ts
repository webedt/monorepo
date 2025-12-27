import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { AClaudeWebClient } from './AClaudeWebClient.js';
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
import type { IsCompleteResult } from './types.js';
import { ClaudeRemoteError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

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

  private extractRepoName(gitUrl: string): string {
    const match = gitUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
    return match ? match[1].replace(/\.git$/, '') : 'unknown/repo';
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
      } catch {
        return { canResume: false, reason: 'Session is currently running', status: session.session_status };
      }
    }

    if (session.session_status === 'running') {
      return { canResume: false, reason: 'Session is currently running', status: session.session_status };
    }

    return { canResume: true, status: session.session_status };
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

      const timeout = setTimeout(() => {
        ws.close();
        reject(new ClaudeRemoteError(
          `WebSocket connection timeout after ${timeoutMs}ms`,
          408
        ));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timeout);
        resolve(ws);
      });

      ws.on('error', (error: Error) => {
        clearTimeout(timeout);
        reject(new ClaudeRemoteError(
          `WebSocket connection error: ${error.message}`,
          500
        ));
      });
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

      const timeout = setTimeout(() => {
        reject(new ClaudeRemoteError(
          `Control request '${subtype}' timeout after ${timeoutMs}ms`,
          408
        ));
      }, timeoutMs);

      const messageHandler = (data: Buffer | string) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'control_response' && message.response?.request_id === requestId) {
            clearTimeout(timeout);
            ws.off('message', messageHandler);

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
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      };

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
      } catch {
        // Ignore errors fetching existing events
      }
    }

    const ws = await this.createWebSocket(sessionId, timeoutMs);
    let title: string | undefined;
    let branch: string | undefined;

    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        ws.close();
        reject(new ClaudeRemoteError('Streaming aborted by signal'));
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          ws.close();
          reject(new ClaudeRemoteError('Streaming aborted by signal'));
          return;
        }
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      ws.on('message', async (data: Buffer | string) => {
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
                if (abortSignal) {
                  abortSignal.removeEventListener('abort', abortHandler);
                }
                ws.close();
                resolve({
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
                if (abortSignal) {
                  abortSignal.removeEventListener('abort', abortHandler);
                }
                ws.close();
                resolve({
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
              if (abortSignal) {
                abortSignal.removeEventListener('abort', abortHandler);
              }
              ws.close();
              resolve({
                sessionId,
                status: message.status,
                title: title || '',
                branch,
              });
            }
          }
        } catch {
          // Ignore parse errors for non-JSON messages
        }
      });

      ws.on('error', (error: Error) => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
        reject(new ClaudeRemoteError(
          `WebSocket error during streaming: ${error.message}`,
          500
        ));
      });

      ws.on('close', (code: number) => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', abortHandler);
        }
        if (code !== 1000 && code !== 1001) {
          reject(new ClaudeRemoteError(
            `WebSocket closed unexpectedly with code ${code}`,
            500
          ));
        }
      });

      const keepAliveInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'keep_alive' }));
        } else {
          clearInterval(keepAliveInterval);
        }
      }, 30000);

      ws.on('close', () => {
        clearInterval(keepAliveInterval);
      });
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
      } catch {
        // Ignore errors fetching existing events
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
    } catch {
      // Ignore errors fetching existing events
    }

    await this.sendMessageViaWebSocket(sessionId, message);

    return this.streamEvents(sessionId, onEvent, {
      abortSignal: options.abortSignal,
      skipExistingEvents: existingEventIds.size > 0,
      onRawMessage: options.onRawMessage,
    });
  }

  async isComplete(
    sessionId: string,
    checkEvents: boolean = true
  ): Promise<IsCompleteResult> {
    const session = await this.getSession(sessionId);
    const status = session.session_status;

    // Terminal states are always complete
    if (status === 'completed') {
      return { isComplete: true, status, reason: 'Session completed successfully' };
    }
    if (status === 'failed') {
      return { isComplete: true, status, reason: 'Session failed' };
    }
    if (status === 'archived') {
      return { isComplete: true, status, reason: 'Session is archived' };
    }

    // For running/idle sessions, optionally check events for result
    if (checkEvents) {
      try {
        const events = await this.getEvents(sessionId);
        const hasResultEvent = events.data?.some(event =>
          event.type?.toLowerCase() === 'result'
        );

        if (hasResultEvent) {
          return {
            isComplete: true,
            status,
            reason: 'Session has result event (status may be stale)',
            hasResultEvent: true
          };
        }

        return { isComplete: false, status, hasResultEvent: false };
      } catch {
        // Event fetch can fail for various transient reasons (network issues, rate limits).
        // Fall back to status-based check rather than failing the entire isComplete call.
        return { isComplete: false, status };
      }
    }

    return { isComplete: false, status };
  }
}
