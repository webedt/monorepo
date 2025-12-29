/**
 * Abstract Cache Service
 *
 * Defines the interface for cache operations. Implementations can use
 * in-memory storage, Redis, or other backends.
 */
import { AService } from '../services/abstracts/AService.js';

import type {
  CacheConfig,
  CacheStats,
  CacheResult,
  CacheSetOptions,
  InvalidationPattern,
  CacheHealth,
} from './types.js';

export abstract class ACacheService extends AService {
  readonly order = -30; // Initialize early, after logging but before most services

  /**
   * Get a value from cache
   */
  abstract get<T>(key: string): Promise<CacheResult<T>>;

  /**
   * Get a value from cache synchronously (in-memory only)
   */
  abstract getSync<T>(key: string): CacheResult<T>;

  /**
   * Set a value in cache
   */
  abstract set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Set a value synchronously (in-memory only)
   */
  abstract setSync<T>(key: string, value: T, options?: CacheSetOptions): void;

  /**
   * Delete a specific key
   */
  abstract delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists
   */
  abstract has(key: string): Promise<boolean>;

  /**
   * Clear all entries
   */
  abstract clear(): Promise<void>;

  /**
   * Invalidate entries matching a pattern
   */
  abstract invalidate(pattern: InvalidationPattern): Promise<number>;

  /**
   * Invalidate all entries with a specific prefix
   */
  abstract invalidatePrefix(prefix: string): Promise<number>;

  /**
   * Invalidate all entries with specific tags
   */
  abstract invalidateTags(tags: string[]): Promise<number>;

  /**
   * Get or set - returns cached value or executes factory and caches result
   */
  abstract getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T>;

  /**
   * Get cache statistics
   */
  abstract getStats(): CacheStats;

  /**
   * Get cache health status
   */
  abstract getHealth(): CacheHealth;

  /**
   * Get current configuration
   */
  abstract getConfig(): CacheConfig;

  /**
   * Update configuration (partial updates allowed)
   */
  abstract updateConfig(config: Partial<CacheConfig>): void;

  /**
   * Trigger cleanup of expired entries
   */
  abstract cleanup(): Promise<number>;

  /**
   * Warm the cache with pre-computed values
   */
  abstract warmup(entries: Array<{ key: string; value: unknown; options?: CacheSetOptions }>): Promise<void>;

  /**
   * Generate a cache key from components
   */
  abstract generateKey(...components: (string | number | boolean | undefined | null)[]): string;

  /**
   * Create a scoped key with a prefix
   */
  abstract scopedKey(prefix: string, ...components: (string | number | boolean | undefined | null)[]): string;

  // ==========================================================================
  // Domain-Specific Helper Methods
  // ==========================================================================

  /**
   * Get cached session list for a user
   */
  abstract getSessionList(userId: string): Promise<CacheResult<unknown>>;

  /**
   * Cache session list for a user
   */
  abstract setSessionList(userId: string, sessions: unknown[]): Promise<void>;

  /**
   * Get cached session count for a user
   */
  abstract getSessionCount(userId: string): Promise<CacheResult<number>>;

  /**
   * Cache session count for a user
   */
  abstract setSessionCount(userId: string, count: number): Promise<void>;

  /**
   * Invalidate all session-related caches for a user
   */
  abstract invalidateUserSessions(userId: string): Promise<number>;

  /**
   * Invalidate a specific session cache
   */
  abstract invalidateSession(sessionId: string): Promise<number>;

  /**
   * Get cached GitHub repos for a user
   */
  abstract getGitHubRepos(userId: string): Promise<CacheResult<unknown>>;

  /**
   * Cache GitHub repos for a user
   */
  abstract setGitHubRepos(userId: string, repos: unknown[]): Promise<void>;

  /**
   * Get cached GitHub branches for a repository
   */
  abstract getGitHubBranches(userId: string, owner: string, repo: string): Promise<CacheResult<unknown>>;

  /**
   * Cache GitHub branches for a repository
   */
  abstract setGitHubBranches(userId: string, owner: string, repo: string, branches: unknown[]): Promise<void>;

  /**
   * Invalidate GitHub branch cache for a specific repository
   */
  abstract invalidateRepoBranches(userId: string, owner: string, repo: string): Promise<number>;

  /**
   * Invalidate all GitHub caches for a user
   */
  abstract invalidateUserGitHub(userId: string): Promise<number>;
}
