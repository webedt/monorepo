/**
 * Abstract Session List Broadcaster Service
 *
 * Base class for pub/sub system for broadcasting session list updates.
 *
 * @see SessionListBroadcaster for the concrete implementation
 */
import { AService } from '../services/abstracts/AService.js';
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
 * Abstract session list broadcaster service.
 */
export abstract class ASessionListBroadcaster extends AService {
  /**
   * Subscribe to session list updates for a specific user.
   */
  abstract subscribe(
    userId: string,
    subscriberId: string,
    callback: (event: SessionListEvent) => void
  ): () => void;

  /**
   * Broadcast a session list update to all subscribers for a user.
   */
  abstract broadcast(
    userId: string,
    type: SessionUpdateType,
    session: Partial<ChatSession> & { id: string }
  ): void;

  /**
   * Notify when a session is created.
   */
  abstract notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is updated.
   */
  abstract notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session status changes.
   */
  abstract notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void;

  /**
   * Notify when a session is deleted.
   */
  abstract notifySessionDeleted(userId: string, sessionId: string): void;

  /**
   * Get subscriber count for a user.
   */
  abstract getSubscriberCount(userId: string): number;

  /**
   * Get total subscriber count across all users.
   */
  abstract getTotalSubscriberCount(): number;
}
