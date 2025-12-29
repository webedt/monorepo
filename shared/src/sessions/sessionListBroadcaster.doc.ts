/**
 * Session List Broadcaster Documentation Interface
 *
 * This file contains the fully-documented interface for the Session List Broadcaster.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ASessionListBroadcaster for the abstract base class
 * @see SessionListBroadcaster for the concrete implementation
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
  /** Type of update */
  type: SessionUpdateType;
  /** Session data (partial for updates, just id for deletes) */
  session: Partial<ChatSession> & { id: string };
  /** When the update occurred */
  timestamp: Date;
}

/**
 * Interface for Session List Broadcaster with full documentation.
 *
 * A pub/sub system for broadcasting session list updates to connected clients.
 * This allows clients to receive real-time updates when sessions are created,
 * updated, or change status - eliminating the need for polling.
 *
 * ## Use Case
 *
 * When a session status changes (e.g., running -> completed),
 * all connected clients for that user receive the update immediately.
 *
 * ## Usage
 *
 * ```typescript
 * import { sessionListBroadcaster } from '@webedt/shared';
 *
 * // Subscribe to updates for a user
 * const unsubscribe = sessionListBroadcaster.subscribe(
 *   userId,
 *   'client-123',
 *   (event) => {
 *     console.log(`Session ${event.session.id} was ${event.type}`);
 *   }
 * );
 *
 * // Notify when session is created
 * sessionListBroadcaster.notifySessionCreated(userId, newSession);
 *
 * // Notify when session status changes
 * sessionListBroadcaster.notifyStatusChanged(userId, { id: sessionId, status: 'completed' });
 *
 * // Clean up
 * unsubscribe();
 * ```
 */
export interface ISessionListBroadcasterDocumentation {
  /**
   * Subscribe to session list updates for a specific user.
   *
   * The callback will be invoked for each session list update for this user.
   * Returns an unsubscribe function that should be called when the client
   * disconnects.
   *
   * @param userId - The user ID to subscribe to
   * @param subscriberId - Unique identifier for this subscriber (for logging)
   * @param callback - Function called for each update
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = sessionListBroadcaster.subscribe(
   *   userId,
   *   `client-${Date.now()}`,
   *   (event) => {
   *     res.write(`data: ${JSON.stringify(event)}\n\n`);
   *   }
   * );
   *
   * req.on('close', unsubscribe);
   * ```
   */
  subscribe(
    userId: string,
    subscriberId: string,
    callback: (event: SessionListEvent) => void
  ): () => void;

  /**
   * Broadcast a session list update to all subscribers for a user.
   *
   * @param userId - The user ID to broadcast to
   * @param type - Type of update
   * @param session - Session data
   *
   * @example
   * ```typescript
   * sessionListBroadcaster.broadcast(userId, 'updated', {
   *   id: sessionId,
   *   title: 'New Title'
   * });
   * ```
   */
  broadcast(
    userId: string,
    type: SessionUpdateType,
    session: Partial<ChatSession> & { id: string }
  ): void;

  /**
   * Notify when a session is created.
   *
   * @param userId - The user who owns the session
   * @param session - The created session data
   *
   * @example
   * ```typescript
   * sessionListBroadcaster.notifySessionCreated(userId, {
   *   id: newSession.id,
   *   title: newSession.title,
   *   status: 'running'
   * });
   * ```
   */
  notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is updated (title, branch, etc.).
   *
   * @param userId - The user who owns the session
   * @param session - The updated session data
   *
   * @example
   * ```typescript
   * sessionListBroadcaster.notifySessionUpdated(userId, {
   *   id: sessionId,
   *   title: 'Updated Title',
   *   branch: 'claude/new-feature'
   * });
   * ```
   */
  notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session status changes (running -> completed, etc.).
   *
   * @param userId - The user who owns the session
   * @param session - The session with updated status
   *
   * @example
   * ```typescript
   * sessionListBroadcaster.notifyStatusChanged(userId, {
   *   id: sessionId,
   *   status: 'completed'
   * });
   * ```
   */
  notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is deleted.
   *
   * @param userId - The user who owned the session
   * @param sessionId - The deleted session ID
   *
   * @example
   * ```typescript
   * sessionListBroadcaster.notifySessionDeleted(userId, sessionId);
   * ```
   */
  notifySessionDeleted(userId: string, sessionId: string): void;

  /**
   * Get subscriber count for a user.
   *
   * @param userId - The user ID to check
   * @returns Number of subscribers for this user
   *
   * @example
   * ```typescript
   * const count = sessionListBroadcaster.getSubscriberCount(userId);
   * ```
   */
  getSubscriberCount(userId: string): number;

  /**
   * Get total subscriber count across all users.
   *
   * @returns Total number of subscribers
   *
   * @example
   * ```typescript
   * console.log(`Total subscribers: ${sessionListBroadcaster.getTotalSubscriberCount()}`);
   * ```
   */
  getTotalSubscriberCount(): number;

  /**
   * Gracefully shutdown the broadcaster.
   *
   * Stops cleanup and heartbeat intervals and clears all internal state.
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', () => {
   *   sessionListBroadcaster.shutdown();
   * });
   * ```
   */
  shutdown(): void;
}
