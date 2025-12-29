/**
 * Caching Module
 *
 * Provides in-memory caching with LRU eviction, TTL support, and
 * domain-specific methods for sessions, GitHub, and Claude data.
 *
 * @example
 * ```typescript
 * import { cacheService, ACacheService, CACHE_TTL } from '@webedt/shared';
 *
 * // Using the global singleton
 * const result = await cacheService.getSessionList(userId);
 * if (!result.hit) {
 *   const sessions = await fetchFromDatabase();
 *   await cacheService.setSessionList(userId, sessions);
 * }
 *
 * // Using dependency injection
 * const cache = ServiceProvider.get(ACacheService);
 * await cache.set('my-key', myValue, { ttlMs: CACHE_TTL.LONG });
 * ```
 */

// Abstract class for dependency injection
export { ACacheService } from './ACacheService.js';

// Concrete implementations
export { MemoryCache } from './MemoryCache.js';
export { CacheService, cacheService } from './CacheService.js';

// Types
export {
  CacheKeyPrefix,
  CACHE_TTL,
  DEFAULT_CACHE_CONFIG,
  type CacheEntry,
  type CacheConfig,
  type CacheStats,
  type CacheResult,
  type CacheSetOptions,
  type InvalidationPattern,
  type CacheNamespace,
  type CacheFunctionOptions,
  type CacheHealth,
} from './types.js';

// Re-export cached data types
export type { CachedSessionList, CachedGitHubRepos, CachedGitHubBranches } from './CacheService.js';
