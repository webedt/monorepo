/**
 * Abstract Session class
 *
 * Provides unified interface for session lifecycle management:
 * - execute: Start a new session with DB persistence + Claude Remote execution
 * - resume: Continue an existing session with a follow-up message
 * - sync: Sync session state with remote (import events, update status)
 */

import type {
  SessionExecuteParams,
  SessionResumeParams,
  SessionSyncParams,
  SessionResult,
  SessionInfo,
  SessionEventCallback,
} from './types.js';

export abstract class ASession {
  readonly order: number = 0;

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}

  /**
   * Execute a new session
   * Creates database record, calls Claude Remote, stores events
   */
  abstract execute(
    params: SessionExecuteParams,
    onEvent?: SessionEventCallback
  ): Promise<SessionResult>;

  /**
   * Resume an existing session with a follow-up message
   */
  abstract resume(
    sessionId: string,
    params: SessionResumeParams,
    onEvent?: SessionEventCallback
  ): Promise<SessionResult>;

  /**
   * Sync a session with remote state
   * Imports missing events, updates status
   */
  abstract sync(
    sessionId: string,
    params: SessionSyncParams
  ): Promise<SessionInfo>;

  /**
   * Get session info from database
   */
  abstract get(sessionId: string): Promise<SessionInfo | null>;

  /**
   * List sessions for a user
   */
  abstract list(userId: string, limit?: number): Promise<SessionInfo[]>;

  /**
   * Delete a session and its events
   */
  abstract delete(sessionId: string): Promise<void>;
}
