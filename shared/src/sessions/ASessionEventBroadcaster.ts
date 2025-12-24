/**
 * Abstract Session Event Broadcaster Service
 *
 * Base class for pub/sub system for broadcasting SSE events from running sessions.
 *
 * @see SessionEventBroadcaster for the concrete implementation
 */
import { AService } from '../services/abstracts/AService.js';

/**
 * Event broadcast from a session via the broadcaster system.
 */
export interface BroadcastEvent {
  eventType: string;
  data: unknown;
  timestamp: Date;
}

/**
 * @deprecated Use BroadcastEvent instead.
 */
export type SessionEvent = BroadcastEvent;

/**
 * Abstract session event broadcaster service.
 */
export abstract class ASessionEventBroadcaster extends AService {
  /**
   * Mark a session as active (currently streaming from AI worker).
   */
  abstract startSession(sessionId: string): void;

  /**
   * Mark a session as inactive (streaming complete).
   */
  abstract endSession(sessionId: string): void;

  /**
   * Check if a session is currently active (streaming).
   */
  abstract isSessionActive(sessionId: string): boolean;

  /**
   * Subscribe to events for a specific session.
   */
  abstract subscribe(
    sessionId: string,
    subscriberId: string,
    callback: (event: SessionEvent) => void
  ): () => void;

  /**
   * Broadcast an event to all subscribers of a session.
   */
  abstract broadcast(sessionId: string, eventType: string, data: unknown): void;

  /**
   * Get the count of active sessions.
   */
  abstract getActiveSessionCount(): number;

  /**
   * Get subscriber count for a session.
   */
  abstract getSubscriberCount(sessionId: string): number;
}
