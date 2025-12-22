/**
 * Interface for Session Event Broadcaster
 *
 * Defines the contract for a pub/sub system for broadcasting SSE events
 * from running sessions. Allows multiple clients to subscribe to the same
 * session's event stream.
 *
 * @see SessionEventBroadcaster for the implementation
 * @module interfaces/ISessionEventBroadcaster
 */

/**
 * Event broadcast from a session.
 */
export interface SessionEvent {
  eventType: string;
  data: unknown;
  timestamp: Date;
}

/**
 * Session event broadcaster interface for real-time event streaming.
 *
 * @example
 * ```typescript
 * const broadcaster: ISessionEventBroadcaster = getSessionEventBroadcaster();
 *
 * broadcaster.startSession('session-123');
 *
 * const unsubscribe = broadcaster.subscribe(
 *   'session-123',
 *   'client-1',
 *   (event) => console.log(event)
 * );
 *
 * broadcaster.broadcast('session-123', 'message', { text: 'Hello' });
 *
 * unsubscribe();
 * broadcaster.endSession('session-123');
 * ```
 */
export interface ISessionEventBroadcaster {
  /**
   * Mark a session as active (currently streaming from AI worker).
   *
   * @param sessionId - Session ID to start
   */
  startSession(sessionId: string): void;

  /**
   * Mark a session as inactive (streaming complete).
   *
   * Notifies all subscribers that the session has ended.
   *
   * @param sessionId - Session ID to end
   */
  endSession(sessionId: string): void;

  /**
   * Check if a session is currently active (streaming).
   *
   * @param sessionId - Session ID to check
   * @returns `true` if session is active
   */
  isSessionActive(sessionId: string): boolean;

  /**
   * Subscribe to events for a specific session.
   *
   * @param sessionId - Session ID to subscribe to
   * @param subscriberId - Unique subscriber ID
   * @param callback - Callback invoked for each event
   * @returns Unsubscribe function
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    callback: (event: SessionEvent) => void
  ): () => void;

  /**
   * Broadcast an event to all subscribers of a session.
   *
   * @param sessionId - Session ID to broadcast to
   * @param eventType - Type of event
   * @param data - Event data
   */
  broadcast(sessionId: string, eventType: string, data: unknown): void;

  /**
   * Get the count of active sessions.
   *
   * @returns Number of active sessions
   */
  getActiveSessionCount(): number;

  /**
   * Get subscriber count for a session.
   *
   * @param sessionId - Session ID
   * @returns Number of subscribers
   */
  getSubscriberCount(sessionId: string): number;
}
