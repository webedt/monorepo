/**
 * Abstract Claude Web Client Service
 *
 * Base class for interacting with Anthropic's Remote Sessions API.
 *
 * @see ClaudeWebClient for the concrete implementation
 */
import { AService } from '../services/abstracts/AService.js';
import type {
  CreateSessionParams,
  CreateSessionResult,
  Session,
  EventsResponse,
  ListSessionsResponse,
  SessionResult,
  EventCallback,
  PollOptions,
} from './types.js';

/**
 * Configuration for the Claude Web Client.
 */
export interface ClaudeWebClientConfig {
  accessToken: string;
  environmentId?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Abstract Claude Web Client service.
 *
 * Initialize order is 50 to ensure core services are ready first.
 * The concrete implementation resolves credentials in initialize().
 */
export abstract class AClaudeWebClient extends AService {
  override readonly order: number = 50;

  /**
   * Reconfigure the client with new settings.
   */
  abstract configure(config: ClaudeWebClientConfig): void;

  /**
   * Update the access token.
   */
  abstract setAccessToken(accessToken: string): void;

  /**
   * Create a new remote coding session.
   */
  abstract createSession(params: CreateSessionParams): Promise<CreateSessionResult>;

  /**
   * Get session metadata.
   */
  abstract getSession(sessionId: string): Promise<Session>;

  /**
   * List sessions with pagination.
   */
  abstract listSessions(limit?: number, before?: string): Promise<ListSessionsResponse>;

  /**
   * Get all events for a session.
   */
  abstract getEvents(sessionId: string): Promise<EventsResponse>;

  /**
   * Send a message to a session.
   */
  abstract sendMessage(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>
  ): Promise<void>;

  /**
   * Archive a session.
   */
  abstract archiveSession(sessionId: string): Promise<Session>;

  /**
   * Rename a session.
   */
  abstract renameSession(sessionId: string, newTitle: string): Promise<Session>;

  /**
   * Interrupt a running session via WebSocket.
   */
  abstract interruptSession(sessionId: string, timeoutMs?: number): Promise<void>;

  /**
   * Send a user message via WebSocket.
   */
  abstract sendMessageViaWebSocket(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    options?: { timeoutMs?: number; parentToolUseId?: string | null }
  ): Promise<void>;

  /**
   * Stream session events in real-time via WebSocket.
   */
  abstract streamEvents(
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
   */
  abstract initializeSession(sessionId: string, timeoutMs?: number): Promise<void>;

  /**
   * Set the permission mode for a session via WebSocket.
   */
  abstract setPermissionMode(
    sessionId: string,
    mode?: 'acceptEdits' | 'requireApproval',
    timeoutMs?: number
  ): Promise<void>;

  /**
   * Check if a session can be resumed.
   */
  abstract canResume(
    sessionId: string,
    checkEvents?: boolean
  ): Promise<{ canResume: boolean; reason?: string; status?: string; hasCompletedEvent?: boolean }>;

  /**
   * Wait for a session to become resumable.
   */
  abstract waitForResumable(
    sessionId: string,
    maxWaitMs?: number,
    pollIntervalMs?: number
  ): Promise<{ canResume: boolean; reason?: string; status?: string }>;

  /**
   * Poll a session until completion.
   */
  abstract pollSession(
    sessionId: string,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;

  /**
   * Execute a coding task from start to finish.
   */
  abstract execute(
    params: CreateSessionParams,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;

  /**
   * Resume a session with a follow-up message.
   */
  abstract resume(
    sessionId: string,
    message: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }>,
    onEvent: EventCallback,
    options?: PollOptions
  ): Promise<SessionResult>;
}
