/**
 * Session Event Broadcaster Documentation Interface
 *
 * This file contains the fully-documented interface for the Session Event Broadcaster.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ASessionEventBroadcaster for the abstract base class
 * @see SessionEventBroadcaster for the concrete implementation
 */

import type { ChatSession } from '../db/schema.js';

/**
 * Event broadcast from a session via the broadcaster system.
 */
export interface BroadcastEvent {
  /** Type of event (e.g., 'message', 'tool_use', 'completed') */
  eventType: string;
  /** Event payload data */
  data: unknown;
  /** When the event occurred */
  timestamp: Date;
}

/**
 * @deprecated Use BroadcastEvent instead.
 */
export type SessionEvent = BroadcastEvent;

/**
 * Interface for Session Event Broadcaster with full documentation.
 *
 * A pub/sub system for broadcasting SSE events from running sessions.
 * This allows multiple clients to subscribe to the same session's event stream.
 *
 * ## Use Case
 *
 * When a user navigates away from a running session and returns,
 * they can reconnect and receive live events without needing to submit a new request.
 *
 * ## Usage
 *
 * ```typescript
 * import { sessionEventBroadcaster } from '@webedt/shared';
 *
 * // Mark session as active when AI worker starts streaming
 * sessionEventBroadcaster.startSession(sessionId);
 *
 * // Subscribe to events
 * const unsubscribe = sessionEventBroadcaster.subscribe(
 *   sessionId,
 *   'client-123',
 *   (event) => console.log('Event:', event.eventType)
 * );
 *
 * // Broadcast events from AI worker
 * sessionEventBroadcaster.broadcast(sessionId, 'message', { content: 'Hello' });
 *
 * // Mark session as complete
 * sessionEventBroadcaster.endSession(sessionId);
 *
 * // Clean up subscription
 * unsubscribe();
 * ```
 */
export interface ISessionEventBroadcasterDocumentation {
  /**
   * Mark a session as active (currently streaming from AI worker).
   *
   * Call this when a session begins streaming events. This allows
   * clients to know they can subscribe for live updates.
   *
   * @param sessionId - The session ID to mark as active
   *
   * @example
   * ```typescript
   * sessionEventBroadcaster.startSession('session_abc123');
   * ```
   */
  startSession(sessionId: string): void;

  /**
   * Mark a session as inactive (streaming complete).
   *
   * Call this when a session finishes streaming. This notifies all
   * subscribers with a 'completed' event and cleans up subscriptions.
   *
   * @param sessionId - The session ID to mark as inactive
   *
   * @example
   * ```typescript
   * sessionEventBroadcaster.endSession('session_abc123');
   * ```
   */
  endSession(sessionId: string): void;

  /**
   * Check if a session is currently active (streaming).
   *
   * @param sessionId - The session ID to check
   * @returns `true` if the session is actively streaming
   *
   * @example
   * ```typescript
   * if (sessionEventBroadcaster.isSessionActive(sessionId)) {
   *   // Subscribe to live events
   * }
   * ```
   */
  isSessionActive(sessionId: string): boolean;

  /**
   * Subscribe to events for a specific session.
   *
   * The callback will be invoked for each event broadcast to this session.
   * Returns an unsubscribe function that should be called when the client
   * disconnects.
   *
   * @param sessionId - The session ID to subscribe to
   * @param subscriberId - Unique identifier for this subscriber (for logging)
   * @param callback - Function called for each event
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = sessionEventBroadcaster.subscribe(
   *   sessionId,
   *   `client-${Date.now()}`,
   *   (event) => {
   *     res.write(`data: ${JSON.stringify(event)}\n\n`);
   *   }
   * );
   *
   * // When client disconnects
   * req.on('close', unsubscribe);
   * ```
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    callback: (event: SessionEvent) => void
  ): () => void;

  /**
   * Broadcast an event to all subscribers of a session.
   *
   * @param sessionId - The session ID to broadcast to
   * @param eventType - Type of event (e.g., 'message', 'tool_use')
   * @param data - Event payload data
   *
   * @example
   * ```typescript
   * sessionEventBroadcaster.broadcast(sessionId, 'message', {
   *   role: 'assistant',
   *   content: 'I will help you with that.'
   * });
   * ```
   */
  broadcast(sessionId: string, eventType: string, data: unknown): void;

  /**
   * Get the count of active sessions.
   *
   * @returns Number of sessions currently streaming
   *
   * @example
   * ```typescript
   * console.log(`Active sessions: ${sessionEventBroadcaster.getActiveSessionCount()}`);
   * ```
   */
  getActiveSessionCount(): number;

  /**
   * Get subscriber count for a session.
   *
   * @param sessionId - The session ID to check
   * @returns Number of subscribers for this session
   *
   * @example
   * ```typescript
   * const count = sessionEventBroadcaster.getSubscriberCount(sessionId);
   * console.log(`${count} clients watching this session`);
   * ```
   */
  getSubscriberCount(sessionId: string): number;

  /**
   * Get total subscriber count across all sessions.
   *
   * @returns Total number of subscribers
   *
   * @example
   * ```typescript
   * const total = sessionEventBroadcaster.getTotalSubscriberCount();
   * console.log(`${total} total SSE connections`);
   * ```
   */
  getTotalSubscriberCount(): number;

  /**
   * Gracefully shutdown the broadcaster.
   *
   * Stops cleanup and heartbeat intervals, notifies all subscribers,
   * and clears all internal state.
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', () => {
   *   sessionEventBroadcaster.shutdown();
   * });
   * ```
   */
  shutdown(): void;
}
