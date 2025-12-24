/**
 * SessionEventBroadcaster
 *
 * A pub/sub system for broadcasting SSE events from running sessions.
 * This allows multiple clients to subscribe to the same session's event stream.
 *
 * Use case: When a user navigates away from a running session and returns,
 * they can reconnect and receive live events without needing to submit a new request.
 */

import { EventEmitter } from 'events';
import { ASessionEventBroadcaster, type SessionEvent } from './ASessionEventBroadcaster.js';

// Re-export types from abstract for backwards compatibility
export type { BroadcastEvent, SessionEvent } from './ASessionEventBroadcaster.js';

interface Subscriber {
  id: string;
  callback: (event: SessionEvent) => void;
}

class SessionEventBroadcaster extends ASessionEventBroadcaster {
  private emitter = new EventEmitter();
  // Map of sessionId -> array of subscribers
  private subscribers: Map<string, Subscriber[]> = new Map();

  // Track which sessions are currently active (streaming from AI worker)
  private activeSessions: Set<string> = new Set();

  constructor() {
    super();
    // Increase max listeners since we may have many sessions
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Mark a session as active (currently streaming from AI worker)
   */
  startSession(sessionId: string): void {
    this.activeSessions.add(sessionId);
    console.log(`[SessionBroadcaster] Session ${sessionId} started streaming`);
  }

  /**
   * Mark a session as inactive (streaming complete)
   */
  endSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    // Notify all subscribers that the session has ended
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

    // Clean up subscribers for this session
    this.subscribers.delete(sessionId);
    console.log(`[SessionBroadcaster] Session ${sessionId} ended streaming, cleaned up subscribers`);
  }

  /**
   * Check if a session is currently active (streaming)
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Subscribe to events for a specific session
   * Returns an unsubscribe function
   */
  subscribe(sessionId: string, subscriberId: string, callback: (event: SessionEvent) => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, []);
    }

    const subscriber: Subscriber = { id: subscriberId, callback };
    this.subscribers.get(sessionId)!.push(subscriber);

    console.log(`[SessionBroadcaster] Subscriber ${subscriberId} subscribed to session ${sessionId}`);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscriberId);
        if (index !== -1) {
          subs.splice(index, 1);
          console.log(`[SessionBroadcaster] Subscriber ${subscriberId} unsubscribed from session ${sessionId}`);
        }
        // Clean up empty subscriber arrays
        if (subs.length === 0) {
          this.subscribers.delete(sessionId);
        }
      }
    };
  }

  /**
   * Broadcast an event to all subscribers of a session
   */
  broadcast(sessionId: string, eventType: string, data: unknown): void {
    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers || subscribers.length === 0) {
      return; // No subscribers, skip
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

  /**
   * Get the count of active sessions
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get subscriber count for a session
   */
  getSubscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.length || 0;
  }
}

// Export a singleton instance
export const sessionEventBroadcaster: ASessionEventBroadcaster = new SessionEventBroadcaster();
