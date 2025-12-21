/**
 * SessionListBroadcaster
 *
 * A pub/sub system for broadcasting session list updates to connected clients.
 * This allows clients to receive real-time updates when sessions are created,
 * updated, or change status - eliminating the need for polling.
 *
 * Use case: When a session status changes (e.g., running -> completed),
 * all connected clients for that user receive the update immediately.
 */

import { EventEmitter } from 'events';
import type { ISessionListBroadcaster, SessionListEvent, SessionUpdateType } from '../interfaces/ISessionListBroadcaster.js';
import { logger } from '../logger.js';
import type { ChatSession } from '../db/schema.js';

// Re-export types from interface for backwards compatibility
export type { SessionUpdateType, SessionListEvent } from '../interfaces/ISessionListBroadcaster.js';

interface Subscriber {
  id: string;
  callback: (event: SessionListEvent) => void;
}

class SessionListBroadcaster extends EventEmitter implements ISessionListBroadcaster {
  // Map of userId -> array of subscribers
  private subscribers: Map<string, Subscriber[]> = new Map();

  constructor() {
    super();
    // Increase max listeners since we may have many users
    this.setMaxListeners(1000);
  }

  /**
   * Subscribe to session list updates for a specific user
   * Returns an unsubscribe function
   */
  subscribe(userId: string, subscriberId: string, callback: (event: SessionListEvent) => void): () => void {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, []);
    }

    const subscriber: Subscriber = { id: subscriberId, callback };
    this.subscribers.get(userId)!.push(subscriber);

    logger.info(`Subscriber ${subscriberId} subscribed to session list updates for user ${userId}`, {
      component: 'SessionListBroadcaster',
      subscriberCount: this.subscribers.get(userId)!.length
    });

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(userId);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscriberId);
        if (index !== -1) {
          subs.splice(index, 1);
          logger.info(`Subscriber ${subscriberId} unsubscribed from session list updates for user ${userId}`, {
            component: 'SessionListBroadcaster'
          });
        }
        // Clean up empty subscriber arrays
        if (subs.length === 0) {
          this.subscribers.delete(userId);
        }
      }
    };
  }

  /**
   * Broadcast a session list update to all subscribers for a user
   */
  broadcast(userId: string, type: SessionUpdateType, session: Partial<ChatSession> & { id: string }): void {
    const subscribers = this.subscribers.get(userId);
    if (!subscribers || subscribers.length === 0) {
      return; // No subscribers, skip
    }

    const event: SessionListEvent = {
      type,
      session,
      timestamp: new Date(),
    };

    logger.info(`Broadcasting session ${type} event for user ${userId}`, {
      component: 'SessionListBroadcaster',
      sessionId: session.id,
      status: session.status,
      subscriberCount: subscribers.length
    });

    subscribers.forEach(sub => {
      try {
        sub.callback(event);
      } catch (err) {
        logger.error(`Error broadcasting to subscriber ${sub.id}`, err as Error, {
          component: 'SessionListBroadcaster'
        });
      }
    });
  }

  /**
   * Notify when a session is created
   */
  notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'created', session);
  }

  /**
   * Notify when a session is updated (title, branch, etc.)
   */
  notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'updated', session);
  }

  /**
   * Notify when a session status changes (running -> completed, etc.)
   */
  notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'status_changed', session);
  }

  /**
   * Notify when a session is deleted
   */
  notifySessionDeleted(userId: string, sessionId: string): void {
    this.broadcast(userId, 'deleted', { id: sessionId });
  }

  /**
   * Get subscriber count for a user
   */
  getSubscriberCount(userId: string): number {
    return this.subscribers.get(userId)?.length || 0;
  }

  /**
   * Get total subscriber count across all users
   */
  getTotalSubscriberCount(): number {
    let total = 0;
    for (const subs of this.subscribers.values()) {
      total += subs.length;
    }
    return total;
  }
}

// Export a singleton instance
export const sessionListBroadcaster = new SessionListBroadcaster();
