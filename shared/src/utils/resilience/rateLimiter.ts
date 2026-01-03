/**
 * Sliding Window Rate Limiter Implementation
 *
 * Implements a sliding window algorithm that provides smoother rate limiting
 * compared to fixed windows. Uses weighted counts from current and previous
 * windows for more accurate rate limiting.
 *
 * Features:
 * - Sliding window algorithm for smooth rate limiting
 * - In-memory storage with automatic cleanup
 * - Express-rate-limit compatible store
 * - Circuit breaker integration support
 */

import {
  ARateLimiter,
  ARateLimiterStore,
  ARateLimiterRegistry,
} from './ARateLimiter.js';
import type {
  RateLimiterConfig,
  RateLimitResult,
  RateLimiterStats,
  SlidingWindowEntry,
} from './ARateLimiter.js';
import { logger } from '../logging/logger.js';
import { TimerManager } from '../lifecycle/timerManager.js';

import type { ITimerManager } from '../lifecycle/timerManager.js';

export type {
  RateLimiterConfig,
  RateLimitResult,
  RateLimiterStats,
  SlidingWindowEntry,
} from './ARateLimiter.js';

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  name: 'default',
  keyPrefix: 'rl:',
};

/**
 * Sliding Window Rate Limiter
 *
 * Uses a sliding window algorithm that combines counts from the current
 * and previous windows with weighted averaging for smoother rate limiting.
 */
export class SlidingWindowRateLimiter extends ARateLimiter {
  private config: RateLimiterConfig;
  private store: Map<string, SlidingWindowEntry> = new Map();
  private stats: RateLimiterStats = {
    totalRequests: 0,
    totalBlocked: 0,
    activeKeys: 0,
    lastCleanup: null,
  };
  private timerManager: ITimerManager;
  private cleanupIntervalId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.timerManager = new TimerManager();

    // Start automatic cleanup every window period using timerManager for lifecycle tracking
    this.cleanupIntervalId = this.timerManager.setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error('Rate limiter cleanup failed', err as Error, {
          component: 'RateLimiter',
          name: this.config.name,
        });
      });
    }, this.config.windowMs, true);
  }

  getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  /**
   * Calculate the weighted request count using sliding window
   */
  private calculateSlidingWindowCount(entry: SlidingWindowEntry, now: number): number {
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;
    const windowProgress = (now - windowStart) / this.config.windowMs;

    // If we're in a new window compared to stored entry, adjust counts
    if (windowStart > entry.windowStart) {
      // Previous window becomes the one we had, current is new
      const windowsBetween = Math.floor((windowStart - entry.windowStart) / this.config.windowMs);

      if (windowsBetween === 1) {
        // Normal case: moved to next window
        return entry.currentCount * (1 - windowProgress);
      } else {
        // Skipped windows: previous data is too old
        return 0;
      }
    }

    // Same window: combine previous and current with weighting
    const previousWeight = 1 - windowProgress;
    return entry.previousCount * previousWeight + entry.currentCount;
  }

  async check(key: string): Promise<RateLimitResult> {
    const prefixedKey = `${this.config.keyPrefix}${key}`;
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;

    let entry = this.store.get(prefixedKey);

    if (!entry) {
      // No existing entry
      return {
        allowed: true,
        current: 0,
        limit: this.config.maxRequests,
        resetMs: windowStart + this.config.windowMs - now,
        retryAfter: Math.ceil((windowStart + this.config.windowMs - now) / 1000),
        remaining: this.config.maxRequests,
      };
    }

    // Rotate windows if needed
    if (windowStart > entry.windowStart) {
      const windowsBetween = Math.floor((windowStart - entry.windowStart) / this.config.windowMs);

      if (windowsBetween === 1) {
        // Normal rotation
        entry = {
          windowStart,
          currentCount: 0,
          previousCount: entry.currentCount,
          previousWindowStart: entry.windowStart,
        };
      } else {
        // Skipped windows - reset
        entry = {
          windowStart,
          currentCount: 0,
          previousCount: 0,
          previousWindowStart: windowStart - this.config.windowMs,
        };
      }
      this.store.set(prefixedKey, entry);
    }

    const currentCount = this.calculateSlidingWindowCount(entry, now);
    const allowed = currentCount < this.config.maxRequests;
    const remaining = Math.max(0, Math.floor(this.config.maxRequests - currentCount));
    const resetMs = windowStart + this.config.windowMs - now;

    return {
      allowed,
      current: Math.ceil(currentCount),
      limit: this.config.maxRequests,
      resetMs,
      retryAfter: Math.ceil(resetMs / 1000),
      remaining,
    };
  }

  async increment(key: string): Promise<RateLimitResult> {
    const prefixedKey = `${this.config.keyPrefix}${key}`;
    const now = Date.now();
    const windowStart = Math.floor(now / this.config.windowMs) * this.config.windowMs;

    this.stats.totalRequests++;

    let entry = this.store.get(prefixedKey);

    if (!entry) {
      // Create new entry
      entry = {
        windowStart,
        currentCount: 1,
        previousCount: 0,
        previousWindowStart: windowStart - this.config.windowMs,
      };
      this.store.set(prefixedKey, entry);
      this.stats.activeKeys = this.store.size;

      return {
        allowed: true,
        current: 1,
        limit: this.config.maxRequests,
        resetMs: this.config.windowMs,
        retryAfter: Math.ceil(this.config.windowMs / 1000),
        remaining: this.config.maxRequests - 1,
      };
    }

    // Rotate windows if needed
    if (windowStart > entry.windowStart) {
      const windowsBetween = Math.floor((windowStart - entry.windowStart) / this.config.windowMs);

      if (windowsBetween === 1) {
        // Normal rotation
        entry = {
          windowStart,
          currentCount: 0,
          previousCount: entry.currentCount,
          previousWindowStart: entry.windowStart,
        };
      } else {
        // Skipped windows - reset
        entry = {
          windowStart,
          currentCount: 0,
          previousCount: 0,
          previousWindowStart: windowStart - this.config.windowMs,
        };
      }
    }

    // Check before incrementing
    const currentCount = this.calculateSlidingWindowCount(entry, now);

    if (currentCount >= this.config.maxRequests) {
      this.stats.totalBlocked++;
      const resetMs = windowStart + this.config.windowMs - now;

      return {
        allowed: false,
        current: Math.ceil(currentCount),
        limit: this.config.maxRequests,
        resetMs,
        retryAfter: Math.ceil(resetMs / 1000),
        remaining: 0,
      };
    }

    // Increment and store
    entry.currentCount++;
    this.store.set(prefixedKey, entry);

    const newCount = this.calculateSlidingWindowCount(entry, now);
    const remaining = Math.max(0, Math.floor(this.config.maxRequests - newCount));
    const resetMs = windowStart + this.config.windowMs - now;

    return {
      allowed: true,
      current: Math.ceil(newCount),
      limit: this.config.maxRequests,
      resetMs,
      retryAfter: Math.ceil(resetMs / 1000),
      remaining,
    };
  }

  async reset(key: string): Promise<void> {
    const prefixedKey = `${this.config.keyPrefix}${key}`;
    this.store.delete(prefixedKey);
    this.stats.activeKeys = this.store.size;
  }

  getStats(): RateLimiterStats {
    return {
      ...this.stats,
      activeKeys: this.store.size,
    };
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const twoWindowsAgo = now - this.config.windowMs * 2;
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.windowStart < twoWindowsAgo) {
        this.store.delete(key);
        cleaned++;
      }
    }

    this.stats.lastCleanup = new Date();
    this.stats.activeKeys = this.store.size;

    if (cleaned > 0) {
      logger.debug(`Rate limiter [${this.config.name}] cleaned ${cleaned} expired entries`, {
        component: 'RateLimiter',
        name: this.config.name,
        cleaned,
        remaining: this.store.size,
      });
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    // Dispose all timers via timerManager
    this.timerManager.dispose();
    this.cleanupIntervalId = null;
    this.store.clear();
  }
}

/**
 * Sliding Window Store for express-rate-limit
 *
 * Provides a sliding window implementation compatible with express-rate-limit's
 * Store interface.
 */
export class SlidingWindowStore extends ARateLimiterStore {
  private store: Map<string, { hits: number; resetTime: Date; previousHits: number }> = new Map();
  private windowMs: number;
  private stats = { keys: 0, hits: 0, blocked: 0 };
  private timerManager: ITimerManager;
  private cleanupIntervalId: ReturnType<typeof setTimeout> | null = null;

  constructor(windowMs: number = 60000) {
    super();
    this.windowMs = windowMs;
    this.timerManager = new TimerManager();

    // Cleanup expired entries periodically using timerManager for lifecycle tracking
    this.cleanupIntervalId = this.timerManager.setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.store.entries()) {
        if (value.resetTime.getTime() < now - this.windowMs) {
          this.store.delete(key);
        }
      }
      this.stats.keys = this.store.size;
    }, this.windowMs, true);
  }

  async get(key: string): Promise<{ totalHits: number; resetTime: Date } | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    const resetTime = entry.resetTime.getTime();

    // Check if we need to rotate windows
    if (now >= resetTime) {
      const windowsPassed = Math.floor((now - resetTime) / this.windowMs) + 1;

      if (windowsPassed === 1) {
        // Normal rotation: current becomes previous
        entry.previousHits = entry.hits;
        entry.hits = 0;
        entry.resetTime = new Date(resetTime + this.windowMs);
      } else {
        // Multiple windows passed: reset everything
        entry.previousHits = 0;
        entry.hits = 0;
        entry.resetTime = new Date(now + this.windowMs);
      }
      this.store.set(key, entry);
    }

    // Calculate weighted hits using sliding window
    const windowProgress = (entry.resetTime.getTime() - now) / this.windowMs;
    const totalHits = Math.ceil(entry.hits + entry.previousHits * windowProgress);

    return { totalHits, resetTime: entry.resetTime };
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry) {
      entry = {
        hits: 1,
        resetTime: new Date(now + this.windowMs),
        previousHits: 0,
      };
      this.store.set(key, entry);
      this.stats.keys = this.store.size;
      this.stats.hits++;
      return { totalHits: 1, resetTime: entry.resetTime };
    }

    const resetTime = entry.resetTime.getTime();

    // Check if we need to rotate windows
    if (now >= resetTime) {
      const windowsPassed = Math.floor((now - resetTime) / this.windowMs) + 1;

      if (windowsPassed === 1) {
        // Normal rotation
        entry.previousHits = entry.hits;
        entry.hits = 0;
        entry.resetTime = new Date(resetTime + this.windowMs);
      } else {
        // Multiple windows passed
        entry.previousHits = 0;
        entry.hits = 0;
        entry.resetTime = new Date(now + this.windowMs);
      }
    }

    entry.hits++;
    this.store.set(key, entry);
    this.stats.hits++;

    // Calculate weighted hits
    const windowProgress = (entry.resetTime.getTime() - now) / this.windowMs;
    const totalHits = Math.ceil(entry.hits + entry.previousHits * windowProgress);

    return { totalHits, resetTime: entry.resetTime };
  }

  async decrement(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry && entry.hits > 0) {
      entry.hits--;
      this.store.set(key, entry);
    }
  }

  async resetKey(key: string): Promise<void> {
    this.store.delete(key);
    this.stats.keys = this.store.size;
  }

  getStats(): { keys: number; hits: number; blocked: number } {
    return { ...this.stats, keys: this.store.size };
  }

  recordBlocked(): void {
    this.stats.blocked++;
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    // Dispose all timers via timerManager
    this.timerManager.dispose();
    this.cleanupIntervalId = null;
    this.store.clear();
  }
}

/**
 * Rate Limiter Registry
 *
 * Manages multiple rate limiters and provides centralized stats collection.
 */
class RateLimiterRegistry extends ARateLimiterRegistry {
  private limiters: Map<string, SlidingWindowRateLimiter> = new Map();

  get(name: string, config?: Partial<RateLimiterConfig>): ARateLimiter {
    let limiter = this.limiters.get(name);
    if (!limiter) {
      limiter = new SlidingWindowRateLimiter({ ...config, name });
      this.limiters.set(name, limiter);
    }
    return limiter;
  }

  getAllStats(): Record<string, RateLimiterStats> {
    const stats: Record<string, RateLimiterStats> = {};
    for (const [name, limiter] of this.limiters) {
      stats[name] = limiter.getStats();
    }
    return stats;
  }

  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.destroy();
    }
    this.limiters.clear();
  }

  size(): number {
    return this.limiters.size;
  }
}

export const rateLimiterRegistry: ARateLimiterRegistry = new RateLimiterRegistry();

/**
 * Create a new sliding window rate limiter
 */
export function createRateLimiter(config: Partial<RateLimiterConfig> = {}): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter(config);
}

/**
 * Create a sliding window store for express-rate-limit
 */
export function createSlidingWindowStore(windowMs: number = 60000): SlidingWindowStore {
  return new SlidingWindowStore(windowMs);
}
