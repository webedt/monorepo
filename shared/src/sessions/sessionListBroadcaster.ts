import { ASessionListBroadcaster } from './ASessionListBroadcaster.js';
import { logger } from '../utils/logging/logger.js';
import { metrics } from '../utils/monitoring/metrics.js';

import type { SessionListEvent } from './ASessionListBroadcaster.js';
import type { SessionUpdateType } from './ASessionListBroadcaster.js';
import type { ChatSession } from '../db/schema.js';

export type { SessionUpdateType, SessionListEvent } from './ASessionListBroadcaster.js';

const BROADCASTER_TYPE = 'session_list';
const STALE_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 10_000;
const WARN_SUBSCRIBER_COUNT = 500;
const ERROR_SUBSCRIBER_COUNT = 900;
const MAX_LISTENER_LIMIT = 1000;
const MAX_SUBSCRIBERS_PER_USER = 10;

interface Subscriber {
  id: string;
  callback: (event: SessionListEvent) => void;
  lastActivity: number;
  createdAt: number;
}

interface UserSubscribers {
  subscribers: Subscriber[];
  lastAccess: number;
}

class SessionListBroadcaster extends ASessionListBroadcaster {
  private users: Map<string, UserSubscribers> = new Map();
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

    for (const [userId, userData] of this.users.entries()) {
      const staleSubscribers = userData.subscribers.filter(
        sub => now - sub.lastActivity > STALE_TIMEOUT_MS
      );

      for (const staleSub of staleSubscribers) {
        this.removeSubscriber(userId, staleSub.id, 'timeout');
        totalEvicted++;
      }

      if (userData.subscribers.length === 0) {
        this.users.delete(userId);
      }
    }

    if (totalEvicted > 0) {
      logger.info(`Cleaned up ${totalEvicted} stale SSE subscribers`, {
        component: 'SessionListBroadcaster',
        evictedCount: totalEvicted,
      });
    }

    this.updateMetrics();
    this.checkSubscriberLimits();
  }

  private sendHeartbeats(): void {
    if (this.isShuttingDown) return;

    const now = Date.now();
    // Use a UUID-format sentinel that cannot be a real session ID
    // The '00000000-0000-0000-0000-000000000000' format is reserved
    const heartbeatEvent: SessionListEvent = {
      type: 'updated' as SessionUpdateType,
      session: { id: '00000000-0000-0000-0000-000000000000', _heartbeat: true } as Partial<ChatSession> & { id: string },
      timestamp: new Date(),
    };

    for (const [userId, userData] of this.users.entries()) {
      for (const sub of userData.subscribers) {
        try {
          sub.callback(heartbeatEvent);
          sub.lastActivity = now;
          metrics.recordSseHeartbeat(BROADCASTER_TYPE, true);
        } catch (err) {
          logger.warn(`Heartbeat failed for subscriber ${sub.id}, marking for cleanup`, {
            component: 'SessionListBroadcaster',
            userId,
            subscriberId: sub.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
          metrics.recordSseHeartbeat(BROADCASTER_TYPE, false);
          this.removeSubscriber(userId, sub.id, 'heartbeat_failed');
        }
      }
    }
  }

  private removeSubscriber(userId: string, subscriberId: string, reason: string): void {
    const userData = this.users.get(userId);
    if (!userData) return;

    const index = userData.subscribers.findIndex(s => s.id === subscriberId);
    if (index !== -1) {
      userData.subscribers.splice(index, 1);
      metrics.recordSseEviction(BROADCASTER_TYPE, reason);

      logger.debug(`Subscriber ${subscriberId} removed from user ${userId}`, {
        component: 'SessionListBroadcaster',
        reason,
        remainingSubscribers: userData.subscribers.length,
      });
    }

    if (userData.subscribers.length === 0) {
      this.users.delete(userId);
    }
  }

  private checkSubscriberLimits(): void {
    const totalSubscribers = this.getTotalSubscriberCount();

    if (totalSubscribers >= ERROR_SUBSCRIBER_COUNT) {
      logger.error(`SSE subscriber count critical: ${totalSubscribers}/${MAX_LISTENER_LIMIT}`, {
        component: 'SessionListBroadcaster',
        subscriberCount: totalSubscribers,
        userCount: this.users.size,
      });
      this.evictLruUsers();
    } else if (totalSubscribers >= WARN_SUBSCRIBER_COUNT) {
      logger.warn(`SSE subscriber count high: ${totalSubscribers}/${MAX_LISTENER_LIMIT}`, {
        component: 'SessionListBroadcaster',
        subscriberCount: totalSubscribers,
        userCount: this.users.size,
      });
    }
  }

  private evictLruUsers(): void {
    const usersToEvict: Array<{ userId: string; lastAccess: number }> = [];

    for (const [userId, userData] of this.users.entries()) {
      usersToEvict.push({ userId, lastAccess: userData.lastAccess });
    }

    usersToEvict.sort((a, b) => a.lastAccess - b.lastAccess);

    const targetEvictions = Math.ceil(usersToEvict.length * 0.2);
    const evicted: string[] = [];

    for (let i = 0; i < Math.min(targetEvictions, usersToEvict.length); i++) {
      const { userId } = usersToEvict[i];
      const userData = this.users.get(userId);

      if (userData) {
        // Notify subscribers before eviction
        const evictEvent: SessionListEvent = {
          type: 'updated' as SessionUpdateType,
          session: { id: '00000000-0000-0000-0000-000000000000', _evicted: true, _reason: 'server_capacity' } as Partial<ChatSession> & { id: string },
          timestamp: new Date(),
        };

        for (const sub of userData.subscribers) {
          try {
            sub.callback(evictEvent);
          } catch {
            // Ignore errors during eviction notification
          }
          metrics.recordSseEviction(BROADCASTER_TYPE, 'lru_eviction');
        }
        this.users.delete(userId);
        evicted.push(userId);
      }
    }

    if (evicted.length > 0) {
      logger.info(`LRU eviction: removed ${evicted.length} inactive users`, {
        component: 'SessionListBroadcaster',
        evictedCount: evicted.length,
      });
    }
  }

  private updateMetrics(): void {
    metrics.updateSseSessionCount(BROADCASTER_TYPE, this.users.size);
  }

  private enforcePerUserLimit(userId: string): void {
    const userData = this.users.get(userId);
    if (!userData || userData.subscribers.length <= MAX_SUBSCRIBERS_PER_USER) {
      return;
    }

    userData.subscribers.sort((a, b) => a.createdAt - b.createdAt);

    while (userData.subscribers.length > MAX_SUBSCRIBERS_PER_USER) {
      const oldest = userData.subscribers.shift();
      if (oldest) {
        metrics.recordSseEviction(BROADCASTER_TYPE, 'user_limit');
        logger.debug(`Evicted oldest subscriber ${oldest.id} from user ${userId}`, {
          component: 'SessionListBroadcaster',
        });
      }
    }
  }

  subscribe(userId: string, subscriberId: string, callback: (event: SessionListEvent) => void): () => void {
    let totalSubscribers = this.getTotalSubscriberCount();
    if (totalSubscribers >= MAX_LISTENER_LIMIT) {
      logger.warn(`SSE at maximum capacity (${MAX_LISTENER_LIMIT}), attempting eviction`, {
        component: 'SessionListBroadcaster',
        userId,
        subscriberId,
      });
      this.evictLruUsers();
      totalSubscribers = this.getTotalSubscriberCount();

      if (totalSubscribers >= MAX_LISTENER_LIMIT) {
        logger.error(`Cannot add subscriber: still at maximum capacity after eviction`, {
          component: 'SessionListBroadcaster',
          userId,
          subscriberId,
          currentCount: totalSubscribers,
        });
        throw new Error('SSE subscriber limit exceeded');
      }
    }

    const now = Date.now();

    if (!this.users.has(userId)) {
      this.users.set(userId, {
        subscribers: [],
        lastAccess: now,
      });
    }

    const userData = this.users.get(userId)!;
    userData.lastAccess = now;

    const subscriber: Subscriber = {
      id: subscriberId,
      callback,
      lastActivity: now,
      createdAt: now,
    };

    userData.subscribers.push(subscriber);
    metrics.recordSseSubscription(BROADCASTER_TYPE);
    this.updateMetrics();
    this.enforcePerUserLimit(userId);

    logger.info(`Subscriber ${subscriberId} subscribed to session list updates for user ${userId}`, {
      component: 'SessionListBroadcaster',
      subscriberCount: userData.subscribers.length,
      totalSubscribers: this.getTotalSubscriberCount(),
    });

    return () => {
      this.unsubscribe(userId, subscriberId);
    };
  }

  private unsubscribe(userId: string, subscriberId: string): void {
    const userData = this.users.get(userId);
    if (userData) {
      const index = userData.subscribers.findIndex(s => s.id === subscriberId);
      if (index !== -1) {
        userData.subscribers.splice(index, 1);
        metrics.recordSseUnsubscription(BROADCASTER_TYPE);

        logger.info(`Subscriber ${subscriberId} unsubscribed from session list updates for user ${userId}`, {
          component: 'SessionListBroadcaster',
        });
      }

      if (userData.subscribers.length === 0) {
        this.users.delete(userId);
      }

      this.updateMetrics();
    }
  }

  broadcast(userId: string, type: SessionUpdateType, session: Partial<ChatSession> & { id: string }): void {
    const userData = this.users.get(userId);
    if (!userData || userData.subscribers.length === 0) {
      return;
    }

    const now = Date.now();
    userData.lastAccess = now;

    const event: SessionListEvent = {
      type,
      session,
      timestamp: new Date(),
    };

    logger.info(`Broadcasting session ${type} event for user ${userId}`, {
      component: 'SessionListBroadcaster',
      sessionId: session.id,
      status: session.status,
      subscriberCount: userData.subscribers.length,
    });

    const failedSubscribers: string[] = [];

    for (const sub of userData.subscribers) {
      try {
        sub.callback(event);
        sub.lastActivity = now;
      } catch (err) {
        logger.error(`Error broadcasting to subscriber ${sub.id}`, err as Error, {
          component: 'SessionListBroadcaster',
          userId,
        });
        failedSubscribers.push(sub.id);
      }
    }

    for (const subId of failedSubscribers) {
      this.removeSubscriber(userId, subId, 'broadcast_failed');
    }
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
    return this.users.get(userId)?.subscribers.length || 0;
  }

  getTotalSubscriberCount(): number {
    let total = 0;
    for (const userData of this.users.values()) {
      total += userData.subscribers.length;
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

    this.users.clear();

    logger.info('SessionListBroadcaster shutdown complete', {
      component: 'SessionListBroadcaster',
    });
  }
}

export const sessionListBroadcaster: ASessionListBroadcaster = new SessionListBroadcaster();
