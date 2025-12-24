import { EventEmitter } from 'events';
import { ASessionListBroadcaster } from './ASessionListBroadcaster.js';
import { logger } from '../utils/logging/logger.js';
import type { SessionListEvent } from './ASessionListBroadcaster.js';
import type { SessionUpdateType } from './ASessionListBroadcaster.js';
import type { ChatSession } from '../db/schema.js';

export type { SessionUpdateType, SessionListEvent } from './ASessionListBroadcaster.js';

interface Subscriber {
  id: string;
  callback: (event: SessionListEvent) => void;
}

class SessionListBroadcaster extends ASessionListBroadcaster {
  private emitter = new EventEmitter();
  private subscribers: Map<string, Subscriber[]> = new Map();

  constructor() {
    super();
    this.emitter.setMaxListeners(1000);
  }

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
        if (subs.length === 0) {
          this.subscribers.delete(userId);
        }
      }
    };
  }

  broadcast(userId: string, type: SessionUpdateType, session: Partial<ChatSession> & { id: string }): void {
    const subscribers = this.subscribers.get(userId);
    if (!subscribers || subscribers.length === 0) {
      return;
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

  notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'created', session);
  }

  notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'updated', session);
  }

  notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void {
    this.broadcast(userId, 'status_changed', session);
  }

  notifySessionDeleted(userId: string, sessionId: string): void {
    this.broadcast(userId, 'deleted', { id: sessionId });
  }

  getSubscriberCount(userId: string): number {
    return this.subscribers.get(userId)?.length || 0;
  }

  getTotalSubscriberCount(): number {
    let total = 0;
    for (const subs of this.subscribers.values()) {
      total += subs.length;
    }
    return total;
  }
}

export const sessionListBroadcaster: ASessionListBroadcaster = new SessionListBroadcaster();
