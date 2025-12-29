import { ASessionEventBroadcaster } from './ASessionEventBroadcaster.js';
import { metrics } from '../utils/monitoring/metrics.js';
import { logger } from '../utils/logging/logger.js';

import type { SessionEvent } from './ASessionEventBroadcaster.js';

export type { BroadcastEvent, SessionEvent } from './ASessionEventBroadcaster.js';

const BROADCASTER_TYPE = 'session_event';
const STALE_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 10_000;
const WARN_SUBSCRIBER_COUNT = 500;
const ERROR_SUBSCRIBER_COUNT = 900;
const MAX_LISTENER_LIMIT = 1000;
const MAX_SUBSCRIBERS_PER_SESSION = 50;

interface Subscriber {
  id: string;
  callback: (event: SessionEvent) => void;
  lastActivity: number;
  createdAt: number;
}

interface SessionSubscribers {
  subscribers: Subscriber[];
  lastAccess: number;
}

class SessionEventBroadcaster extends ASessionEventBroadcaster {
  private sessions: Map<string, SessionSubscribers> = new Map();
  private activeSessions: Set<string> = new Set();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor() {
    super();
    this.startCleanupInterval();
    this.startHeartbeatInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSubscribers();
    }, CLEANUP_INTERVAL_MS);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  private startHeartbeatInterval(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, HEARTBEAT_INTERVAL_MS);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  private cleanupStaleSubscribers(): void {
    if (this.isShuttingDown) return;

    const now = Date.now();
    let totalEvicted = 0;

    for (const [sessionId, sessionData] of this.sessions.entries()) {
      const staleSubscribers = sessionData.subscribers.filter(
        sub => now - sub.lastActivity > STALE_TIMEOUT_MS
      );

      for (const staleSub of staleSubscribers) {
        this.removeSubscriber(sessionId, staleSub.id, 'timeout');
        totalEvicted++;
      }

      if (sessionData.subscribers.length === 0 && !this.activeSessions.has(sessionId)) {
        this.sessions.delete(sessionId);
      }
    }

    if (totalEvicted > 0) {
      logger.info(`Cleaned up ${totalEvicted} stale SSE subscribers`, {
        component: 'SessionEventBroadcaster',
        evictedCount: totalEvicted,
      });
    }

    this.updateMetrics();
    this.checkSubscriberLimits();
  }

  private sendHeartbeats(): void {
    if (this.isShuttingDown) return;

    const now = Date.now();
    const heartbeatEvent: SessionEvent = {
      eventType: 'heartbeat',
      data: { timestamp: now },
      timestamp: new Date(),
    };

    for (const [sessionId, sessionData] of this.sessions.entries()) {
      for (const sub of sessionData.subscribers) {
        try {
          sub.callback(heartbeatEvent);
          sub.lastActivity = now;
          metrics.recordSseHeartbeat(BROADCASTER_TYPE, true);
        } catch (err) {
          logger.warn(`Heartbeat failed for subscriber ${sub.id}, marking for cleanup`, {
            component: 'SessionEventBroadcaster',
            sessionId,
            subscriberId: sub.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          metrics.recordSseHeartbeat(BROADCASTER_TYPE, false);
          this.removeSubscriber(sessionId, sub.id, 'heartbeat_failed');
        }
      }
    }
  }

  private removeSubscriber(sessionId: string, subscriberId: string, reason: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) return;

    const index = sessionData.subscribers.findIndex(s => s.id === subscriberId);
    if (index !== -1) {
      sessionData.subscribers.splice(index, 1);
      metrics.recordSseEviction(BROADCASTER_TYPE, reason);

      logger.debug(`Subscriber ${subscriberId} removed from session ${sessionId}`, {
        component: 'SessionEventBroadcaster',
        reason,
        remainingSubscribers: sessionData.subscribers.length,
      });
    }

    if (sessionData.subscribers.length === 0 && !this.activeSessions.has(sessionId)) {
      this.sessions.delete(sessionId);
    }
  }

  private checkSubscriberLimits(): void {
    const totalSubscribers = this.getTotalSubscriberCount();

    if (totalSubscribers >= ERROR_SUBSCRIBER_COUNT) {
      logger.error(`SSE subscriber count critical: ${totalSubscribers}/${MAX_LISTENER_LIMIT}`, {
        component: 'SessionEventBroadcaster',
        subscriberCount: totalSubscribers,
        sessionCount: this.sessions.size,
      });
      this.evictLruSessions();
    } else if (totalSubscribers >= WARN_SUBSCRIBER_COUNT) {
      logger.warn(`SSE subscriber count high: ${totalSubscribers}/${MAX_LISTENER_LIMIT}`, {
        component: 'SessionEventBroadcaster',
        subscriberCount: totalSubscribers,
        sessionCount: this.sessions.size,
      });
    }
  }

  private evictLruSessions(): void {
    const sessionsToEvict: Array<{ sessionId: string; lastAccess: number }> = [];

    for (const [sessionId, sessionData] of this.sessions.entries()) {
      if (!this.activeSessions.has(sessionId)) {
        sessionsToEvict.push({ sessionId, lastAccess: sessionData.lastAccess });
      }
    }

    sessionsToEvict.sort((a, b) => a.lastAccess - b.lastAccess);

    const targetEvictions = Math.ceil(sessionsToEvict.length * 0.2);
    const evicted: string[] = [];

    for (let i = 0; i < Math.min(targetEvictions, sessionsToEvict.length); i++) {
      const { sessionId } = sessionsToEvict[i];
      const sessionData = this.sessions.get(sessionId);

      if (sessionData) {
        for (const sub of sessionData.subscribers) {
          try {
            const evictEvent: SessionEvent = {
              eventType: 'evicted',
              data: { reason: 'server_capacity', sessionId },
              timestamp: new Date(),
            };
            sub.callback(evictEvent);
          } catch {
            // Ignore errors during eviction notification
          }
          metrics.recordSseEviction(BROADCASTER_TYPE, 'lru_eviction');
        }
        this.sessions.delete(sessionId);
        evicted.push(sessionId);
      }
    }

    if (evicted.length > 0) {
      logger.info(`LRU eviction: removed ${evicted.length} inactive sessions`, {
        component: 'SessionEventBroadcaster',
        evictedSessions: evicted,
      });
    }
  }

  private updateMetrics(): void {
    metrics.updateSseSessionCount(BROADCASTER_TYPE, this.sessions.size);
  }

  private enforcePerSessionLimit(sessionId: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData || sessionData.subscribers.length <= MAX_SUBSCRIBERS_PER_SESSION) {
      return;
    }

    sessionData.subscribers.sort((a, b) => a.createdAt - b.createdAt);

    while (sessionData.subscribers.length > MAX_SUBSCRIBERS_PER_SESSION) {
      const oldest = sessionData.subscribers.shift();
      if (oldest) {
        try {
          const evictEvent: SessionEvent = {
            eventType: 'evicted',
            data: { reason: 'session_limit', sessionId },
            timestamp: new Date(),
          };
          oldest.callback(evictEvent);
        } catch {
          // Ignore errors during eviction notification
        }
        metrics.recordSseEviction(BROADCASTER_TYPE, 'session_limit');
        logger.debug(`Evicted oldest subscriber ${oldest.id} from session ${sessionId}`, {
          component: 'SessionEventBroadcaster',
        });
      }
    }
  }

  startSession(sessionId: string): void {
    this.activeSessions.add(sessionId);
    logger.info(`Session ${sessionId} started streaming`, {
      component: 'SessionEventBroadcaster',
    });
  }

  endSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      const endEvent: SessionEvent = {
        eventType: 'completed',
        data: { completed: true, sessionId },
        timestamp: new Date(),
      };

      for (const sub of sessionData.subscribers) {
        try {
          sub.callback(endEvent);
        } catch (err) {
          logger.error(`Error notifying subscriber ${sub.id} of session end`, err as Error, {
            component: 'SessionEventBroadcaster',
            sessionId,
          });
        }
        metrics.recordSseUnsubscription(BROADCASTER_TYPE);
      }

      this.sessions.delete(sessionId);
    }

    this.updateMetrics();
    logger.info(`Session ${sessionId} ended streaming, cleaned up subscribers`, {
      component: 'SessionEventBroadcaster',
    });
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  subscribe(sessionId: string, subscriberId: string, callback: (event: SessionEvent) => void): () => void {
    let totalSubscribers = this.getTotalSubscriberCount();
    if (totalSubscribers >= MAX_LISTENER_LIMIT) {
      logger.warn(`SSE at maximum capacity (${MAX_LISTENER_LIMIT}), attempting eviction`, {
        component: 'SessionEventBroadcaster',
        sessionId,
        subscriberId,
      });
      this.evictLruSessions();
      totalSubscribers = this.getTotalSubscriberCount();

      if (totalSubscribers >= MAX_LISTENER_LIMIT) {
        logger.error(`Cannot add subscriber: still at maximum capacity after eviction`, {
          component: 'SessionEventBroadcaster',
          sessionId,
          subscriberId,
          currentCount: totalSubscribers,
        });
        throw new Error('SSE subscriber limit exceeded');
      }
    }

    const now = Date.now();

    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        subscribers: [],
        lastAccess: now,
      });
    }

    const sessionData = this.sessions.get(sessionId)!;
    sessionData.lastAccess = now;

    const subscriber: Subscriber = {
      id: subscriberId,
      callback,
      lastActivity: now,
      createdAt: now,
    };

    sessionData.subscribers.push(subscriber);
    metrics.recordSseSubscription(BROADCASTER_TYPE);
    this.updateMetrics();
    this.enforcePerSessionLimit(sessionId);

    logger.info(`Subscriber ${subscriberId} subscribed to session ${sessionId}`, {
      component: 'SessionEventBroadcaster',
      subscriberCount: sessionData.subscribers.length,
      totalSubscribers: this.getTotalSubscriberCount(),
    });

    return () => {
      this.unsubscribe(sessionId, subscriberId);
    };
  }

  private unsubscribe(sessionId: string, subscriberId: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (sessionData) {
      const index = sessionData.subscribers.findIndex(s => s.id === subscriberId);
      if (index !== -1) {
        sessionData.subscribers.splice(index, 1);
        metrics.recordSseUnsubscription(BROADCASTER_TYPE);

        logger.info(`Subscriber ${subscriberId} unsubscribed from session ${sessionId}`, {
          component: 'SessionEventBroadcaster',
        });
      }

      if (sessionData.subscribers.length === 0 && !this.activeSessions.has(sessionId)) {
        this.sessions.delete(sessionId);
      }

      this.updateMetrics();
    }
  }

  broadcast(sessionId: string, eventType: string, data: unknown): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData || sessionData.subscribers.length === 0) {
      return;
    }

    const now = Date.now();
    sessionData.lastAccess = now;

    const event: SessionEvent = {
      eventType,
      data,
      timestamp: new Date(),
    };

    const failedSubscribers: string[] = [];

    for (const sub of sessionData.subscribers) {
      try {
        sub.callback(event);
        sub.lastActivity = now;
      } catch (err) {
        logger.error(`Error broadcasting to subscriber ${sub.id}`, err as Error, {
          component: 'SessionEventBroadcaster',
          sessionId,
        });
        failedSubscribers.push(sub.id);
      }
    }

    for (const subId of failedSubscribers) {
      this.removeSubscriber(sessionId, subId, 'broadcast_failed');
    }
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  getSubscriberCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.subscribers.length || 0;
  }

  getTotalSubscriberCount(): number {
    let total = 0;
    for (const sessionData of this.sessions.values()) {
      total += sessionData.subscribers.length;
    }
    return total;
  }

  shutdown(): void {
    this.isShuttingDown = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [sessionId, sessionData] of this.sessions.entries()) {
      const shutdownEvent: SessionEvent = {
        eventType: 'shutdown',
        data: { reason: 'server_shutdown' },
        timestamp: new Date(),
      };

      for (const sub of sessionData.subscribers) {
        try {
          sub.callback(shutdownEvent);
        } catch {
          // Ignore errors during shutdown
        }
      }
    }

    this.sessions.clear();
    this.activeSessions.clear();

    logger.info('SessionEventBroadcaster shutdown complete', {
      component: 'SessionEventBroadcaster',
    });
  }
}

export const sessionEventBroadcaster: ASessionEventBroadcaster = new SessionEventBroadcaster();
