import { EventEmitter } from 'events';
import { ASessionEventBroadcaster } from './ASessionEventBroadcaster.js';
import type { SessionEvent } from './ASessionEventBroadcaster.js';

export type { BroadcastEvent, SessionEvent } from './ASessionEventBroadcaster.js';

interface Subscriber {
  id: string;
  callback: (event: SessionEvent) => void;
}

class SessionEventBroadcaster extends ASessionEventBroadcaster {
  private emitter = new EventEmitter();
  private subscribers: Map<string, Subscriber[]> = new Map();
  private activeSessions: Set<string> = new Set();

  constructor() {
    super();
    this.emitter.setMaxListeners(1000);
  }

  startSession(sessionId: string): void {
    this.activeSessions.add(sessionId);
    console.log(`[SessionBroadcaster] Session ${sessionId} started streaming`);
  }

  endSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    const subscribers = this.subscribers.get(sessionId);
    if (subscribers) {
      const endEvent: SessionEvent = {
        eventType: 'completed',
        data: { completed: true, sessionId },
        timestamp: new Date(),
      };
      subscribers.forEach(sub => {
        try {
          sub.callback(endEvent);
        } catch (err) {
          console.error(`[SessionBroadcaster] Error notifying subscriber ${sub.id} of session end:`, err);
        }
      });
    }

    this.subscribers.delete(sessionId);
    console.log(`[SessionBroadcaster] Session ${sessionId} ended streaming, cleaned up subscribers`);
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  subscribe(sessionId: string, subscriberId: string, callback: (event: SessionEvent) => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, []);
    }

    const subscriber: Subscriber = { id: subscriberId, callback };
    this.subscribers.get(sessionId)!.push(subscriber);

    console.log(`[SessionBroadcaster] Subscriber ${subscriberId} subscribed to session ${sessionId}`);

    return () => {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscriberId);
        if (index !== -1) {
          subs.splice(index, 1);
          console.log(`[SessionBroadcaster] Subscriber ${subscriberId} unsubscribed from session ${sessionId}`);
        }
        if (subs.length === 0) {
          this.subscribers.delete(sessionId);
        }
      }
    };
  }

  broadcast(sessionId: string, eventType: string, data: unknown): void {
    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers || subscribers.length === 0) {
      return;
    }

    const event: SessionEvent = {
      eventType,
      data,
      timestamp: new Date(),
    };

    subscribers.forEach(sub => {
      try {
        sub.callback(event);
      } catch (err) {
        console.error(`[SessionBroadcaster] Error broadcasting to subscriber ${sub.id}:`, err);
      }
    });
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  getSubscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.length || 0;
  }
}

export const sessionEventBroadcaster: ASessionEventBroadcaster = new SessionEventBroadcaster();
