/**
 * Interface for Session List Broadcaster
 *
 * Defines the contract for a pub/sub system for broadcasting session list
 * updates to connected clients. Enables real-time updates when sessions
 * are created, updated, or change status.
 *
 * @see SessionListBroadcaster for the implementation
 * @module interfaces/ISessionListBroadcaster
 */

import type { ChatSession } from '../db/schema.js';

/**
 * Types of session updates.
 */
export type SessionUpdateType = 'created' | 'updated' | 'deleted' | 'status_changed';

/**
 * Event for session list updates.
 */
export interface SessionListEvent {
  type: SessionUpdateType;
  session: Partial<ChatSession> & { id: string };
  timestamp: Date;
}

/**
 * Session list broadcaster interface for real-time session updates.
 *
 * @example
 * ```typescript
 * const broadcaster: ISessionListBroadcaster = getSessionListBroadcaster();
 *
 * const unsubscribe = broadcaster.subscribe(
 *   'user-123',
 *   'client-1',
 *   (event) => console.log(`Session ${event.session.id} ${event.type}`)
 * );
 *
 * broadcaster.notifySessionCreated('user-123', { id: 'session-456', status: 'running' });
 *
 * unsubscribe();
 * ```
 */
export interface ISessionListBroadcaster {
  /**
   * Subscribe to session list updates for a specific user.
   *
   * @param userId - User ID to subscribe for
   * @param subscriberId - Unique subscriber ID
   * @param callback - Callback invoked for each update
   * @returns Unsubscribe function
   */
  subscribe(
    userId: string,
    subscriberId: string,
    callback: (event: SessionListEvent) => void
  ): () => void;

  /**
   * Broadcast a session list update to all subscribers for a user.
   *
   * @param userId - User ID
   * @param type - Update type
   * @param session - Session data
   */
  broadcast(
    userId: string,
    type: SessionUpdateType,
    session: Partial<ChatSession> & { id: string }
  ): void;

  /**
   * Notify when a session is created.
   *
   * @param userId - User ID
   * @param session - Created session data
   */
  notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is updated (title, branch, etc.).
   *
   * @param userId - User ID
   * @param session - Updated session data
   */
  notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session status changes (running -> completed, etc.).
   *
   * @param userId - User ID
   * @param session - Session with new status
   */
  notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is deleted.
   *
   * @param userId - User ID
   * @param sessionId - Deleted session ID
   */
  notifySessionDeleted(userId: string, sessionId: string): void;

  /**
   * Get subscriber count for a user.
   *
   * @param userId - User ID
   * @returns Number of subscribers
   */
  getSubscriberCount(userId: string): number;

  /**
   * Get total subscriber count across all users.
   *
   * @returns Total number of subscribers
   */
  getTotalSubscriberCount(): number;
}
