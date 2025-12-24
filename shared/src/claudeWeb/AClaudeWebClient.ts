import { AService } from '../services/abstracts/AService.js';
import type { IClaudeWebClient, ClaudeWebClientConfig } from './claudeWebClient.doc.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
import type { Session } from './types.js';
import type { EventsResponse } from './types.js';
import type { ListSessionsResponse } from './types.js';
import type { SessionResult } from './types.js';
import type { EventCallback } from './types.js';
import type { PollOptions } from './types.js';

// Re-export for backwards compatibility
export type { ClaudeWebClientConfig } from './claudeWebClient.doc.js';

export abstract class AClaudeWebClient extends AService implements IClaudeWebClient {
  override readonly order: number = 50;

  abstract configure(
    config: ClaudeWebClientConfig
  ): void;
  
  abstract setAccessToken(
    accessToken: string
  ): void;
  
  abstract createSession(
    params: CreateSessionParams
  ): Promise<CreateSessionResult>;
  
  abstract getSession(
    sessionId: string
  ): Promise<Session>;
  
  abstract listSessions(
    limit?: number,
    before?: string
  ): Promise<ListSessionsResponse>;
  
  abstract getEvents(
    sessionId: string
  ): Promise<EventsResponse>;
  
  abstract sendMessage(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>
  ): Promise<void>;
  
  abstract archiveSession(
    sessionId: string
  ): Promise<Session>;
  
  abstract renameSession(
    sessionId: string,
    newTitle: string
  ): Promise<Session>;
  
  abstract interruptSession(
    sessionId: string,
    timeoutMs?: number
  ): Promise<void>;
  
  abstract sendMessageViaWebSocket(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    options?: { timeoutMs?: number; parentToolUseId?: string | null }
  ): Promise<void>;
  
  abstract streamEvents(
    sessionId: string,
    onEvent: EventCallback,
    options?: {
      timeoutMs?: number;
      abortSignal?: AbortSignal;
      skipExistingEvents?: boolean;
    }
  ): Promise<SessionResult>;
  
  abstract initializeSession(
    sessionId: string,
    timeoutMs?: number
  ): Promise<void>;
  
  abstract setPermissionMode(
    sessionId: string,
    mode?: 'acceptEdits' | 'requireApproval',
    timeoutMs?: number
  ): Promise<void>;
  
  abstract canResume(
    sessionId: string,
    checkEvents?: boolean
  ): Promise<{ canResume: boolean; reason?: string; status?: string; hasCompletedEvent?: boolean }>;
  
  abstract waitForResumable(
    sessionId: string,
    maxWaitMs?: number,
    pollIntervalMs?: number
  ): Promise<{ canResume: boolean; reason?: string; status?: string }>;
  
  abstract pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
  
  abstract execute(
    params: CreateSessionParams,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
  
  abstract resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
}
