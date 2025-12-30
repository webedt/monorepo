import { ARequestDeduplicator, ARequestDeduplicatorRegistry } from './ARequestDeduplicator.js';
import type { RequestDeduplicatorConfig } from './ARequestDeduplicator.js';
import type { RequestDeduplicatorStats } from './ARequestDeduplicator.js';
import type { DeduplicateOptions } from './ARequestDeduplicator.js';
import type { DeduplicateResult } from './ARequestDeduplicator.js';
import { logger } from '../logging/logger.js';

export type {
  RequestDeduplicatorConfig,
  RequestDeduplicatorStats,
  DeduplicateOptions,
  DeduplicateResult,
} from './ARequestDeduplicator.js';

interface PendingEntry<T> {
  promise: Promise<T>;
  createdAt: number;
  ttlMs: number;
}

const DEFAULT_CONFIG: RequestDeduplicatorConfig = {
  defaultTtlMs: 60000,
  cleanupIntervalMs: 30000,
  maxPendingRequests: 10000,
  name: 'default',
};

export class RequestDeduplicator extends ARequestDeduplicator {
  private config: RequestDeduplicatorConfig;
  private pending: Map<string, PendingEntry<unknown>> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private deduplicatedCount = 0;
  private executedCount = 0;
  private successCount = 0;
  private failureCount = 0;
  private cleanedUpCount = 0;

  constructor(config: Partial<RequestDeduplicatorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  async deduplicate<T>(
    key: string,
    operation: () => Promise<T>,
    options?: DeduplicateOptions
  ): Promise<DeduplicateResult<T>> {
    const existingEntry = this.pending.get(key);

    if (existingEntry) {
      this.deduplicatedCount++;

      logger.debug(`Request deduplicated [${this.config.name}]`, {
        component: 'RequestDeduplicator',
        deduplicatorName: this.config.name,
        key: key.slice(0, 50),
        pendingCount: this.pending.size,
      });

      try {
        const data = await existingEntry.promise as T;
        return { data, wasDeduplicated: true, key };
      } catch (error) {
        throw error;
      }
    }

    this.executedCount++;
    const ttlMs = options?.ttlMs ?? this.config.defaultTtlMs;

    if (this.pending.size >= this.config.maxPendingRequests) {
      this.evictOldest();
    }

    const promise = operation();

    this.pending.set(key, {
      promise: promise as Promise<unknown>,
      createdAt: Date.now(),
      ttlMs,
    });

    logger.debug(`Request started [${this.config.name}]`, {
      component: 'RequestDeduplicator',
      deduplicatorName: this.config.name,
      key: key.slice(0, 50),
      pendingCount: this.pending.size,
    });

    try {
      const data = await promise;
      this.successCount++;
      return { data, wasDeduplicated: false, key };
    } catch (error) {
      this.failureCount++;
      throw error;
    } finally {
      this.pending.delete(key);
    }
  }

  isPending(key: string): boolean {
    return this.pending.has(key);
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  getStats(): RequestDeduplicatorStats {
    return {
      pendingCount: this.pending.size,
      deduplicatedCount: this.deduplicatedCount,
      executedCount: this.executedCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      cleanedUpCount: this.cleanedUpCount,
    };
  }

  resetStats(): void {
    this.deduplicatedCount = 0;
    this.executedCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.cleanedUpCount = 0;
  }

  cleanup(): number {
    const now = Date.now();
    let cleanedUp = 0;

    for (const [key, entry] of this.pending.entries()) {
      if (now - entry.createdAt > entry.ttlMs) {
        this.pending.delete(key);
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      this.cleanedUpCount += cleanedUp;
      logger.debug(`Cleaned up expired entries [${this.config.name}]`, {
        component: 'RequestDeduplicator',
        deduplicatorName: this.config.name,
        cleanedUp,
        remaining: this.pending.size,
      });
    }

    return cleanedUp;
  }

  clear(): void {
    this.pending.clear();
    logger.debug(`Cleared all pending requests [${this.config.name}]`, {
      component: 'RequestDeduplicator',
      deduplicatorName: this.config.name,
    });
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  startCleanup(): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  override async dispose(): Promise<void> {
    this.stopCleanup();
    this.clear();
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pending.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pending.delete(oldestKey);
      this.cleanedUpCount++;
      logger.warn(`Evicted oldest entry due to capacity [${this.config.name}]`, {
        component: 'RequestDeduplicator',
        deduplicatorName: this.config.name,
        evictedKey: oldestKey.slice(0, 50),
      });
    }
  }
}

export function createRequestDeduplicator(config: Partial<RequestDeduplicatorConfig> = {}): ARequestDeduplicator {
  return new RequestDeduplicator(config);
}

class RequestDeduplicatorRegistry extends ARequestDeduplicatorRegistry {
  private deduplicators: Map<string, ARequestDeduplicator> = new Map();

  get(name: string, config?: Partial<RequestDeduplicatorConfig>): ARequestDeduplicator {
    let deduplicator = this.deduplicators.get(name);
    if (!deduplicator) {
      deduplicator = createRequestDeduplicator({ ...config, name });
      this.deduplicators.set(name, deduplicator);
    }
    return deduplicator;
  }

  getAllStats(): Record<string, RequestDeduplicatorStats> {
    const stats: Record<string, RequestDeduplicatorStats> = {};
    for (const [name, deduplicator] of this.deduplicators) {
      stats[name] = deduplicator.getStats();
    }
    return stats;
  }

  resetAllStats(): void {
    for (const deduplicator of this.deduplicators.values()) {
      deduplicator.resetStats();
    }
  }

  clearAll(): void {
    for (const deduplicator of this.deduplicators.values()) {
      deduplicator.clear();
    }
  }

  size(): number {
    return this.deduplicators.size;
  }

  override async dispose(): Promise<void> {
    for (const deduplicator of this.deduplicators.values()) {
      await deduplicator.dispose?.();
    }
    this.deduplicators.clear();
  }
}

export const requestDeduplicatorRegistry: ARequestDeduplicatorRegistry = new RequestDeduplicatorRegistry();

/**
 * Generate a request key from components.
 * Useful for creating consistent deduplication keys.
 *
 * @param parts - Key parts to join (e.g., userId, endpoint, bodyHash)
 * @returns A colon-separated key string
 */
export function generateRequestKey(...parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((p): p is string | number => p !== undefined && p !== null)
    .map(String)
    .join(':');
}

/**
 * Create a simple hash from a string.
 * Useful for hashing request bodies for deduplication keys.
 *
 * @param str - The string to hash
 * @returns A hash string
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
