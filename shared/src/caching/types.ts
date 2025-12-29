/**
 * Cache Types
 *
 * Type definitions for the caching layer.
 */

/**
 * Cache entry with metadata for TTL and LRU tracking
 */
export interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  accessCount: number;
  sizeBytes: number;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** Default TTL in milliseconds (default: 5 minutes) */
  defaultTtlMs: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries: number;
  /** Maximum cache size in bytes (default: 50MB) */
  maxSizeBytes: number;
  /** Cleanup interval in milliseconds (default: 60 seconds) */
  cleanupIntervalMs: number;
  /** Enable cache statistics (default: true) */
  enableStats: boolean;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 1000,
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  cleanupIntervalMs: 60 * 1000, // 1 minute
  enableStats: true,
};

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  invalidations: number;
  entryCount: number;
  sizeBytes: number;
  hitRate: number;
  avgAccessTimeMs: number;
}

/**
 * Cache key prefix for different data types
 */
export enum CacheKeyPrefix {
  SESSION_LIST = 'session:list',
  SESSION_DETAIL = 'session:detail',
  SESSION_COUNT = 'session:count',
  SESSION_SEARCH = 'session:search',
  GITHUB_REPOS = 'github:repos',
  GITHUB_BRANCHES = 'github:branches',
  GITHUB_PULLS = 'github:pulls',
  CLAUDE_SESSION = 'claude:session',
  CLAUDE_SESSIONS_LIST = 'claude:sessions',
  USER_PROFILE = 'user:profile',
}

/**
 * TTL presets for different cache categories
 */
export const CACHE_TTL = {
  /** Short-lived cache for frequently changing data (1 minute) */
  SHORT: 60 * 1000,
  /** Medium cache for session lists and counts (5 minutes) */
  MEDIUM: 5 * 60 * 1000,
  /** Long cache for repository metadata (15 minutes) */
  LONG: 15 * 60 * 1000,
  /** Extended cache for rarely changing data (1 hour) */
  EXTENDED: 60 * 60 * 1000,
  /** Static cache for essentially immutable data (24 hours) */
  STATIC: 24 * 60 * 60 * 1000,
} as const;

/**
 * Cache operation result
 */
export interface CacheResult<T> {
  value: T | undefined;
  hit: boolean;
  expired: boolean;
  accessTimeMs: number;
}

/**
 * Cache set options
 */
export interface CacheSetOptions {
  /** Override default TTL in milliseconds */
  ttlMs?: number;
  /** Tags for bulk invalidation */
  tags?: string[];
  /** Skip size calculation (for known small values) */
  skipSizeCalculation?: boolean;
}

/**
 * Cache invalidation pattern
 */
export interface InvalidationPattern {
  /** Prefix pattern to match (e.g., 'session:list:user123') */
  prefix?: string;
  /** Exact key to invalidate */
  key?: string;
  /** Tags to invalidate */
  tags?: string[];
}

/**
 * Cache namespace for logical grouping
 */
export interface CacheNamespace {
  name: string;
  config: Partial<CacheConfig>;
}

/**
 * Cached function wrapper options
 */
export interface CacheFunctionOptions<T> extends CacheSetOptions {
  /** Cache key or key generator function */
  key: string | ((...args: unknown[]) => string);
  /** Skip cache on certain conditions */
  skipIf?: (result: T) => boolean;
  /** Stale-while-revalidate: return stale data while fetching fresh */
  staleWhileRevalidate?: boolean;
  /** Grace period after TTL to allow stale-while-revalidate (default: 30s) */
  graceMs?: number;
}

/**
 * Cache health status
 */
export interface CacheHealth {
  healthy: boolean;
  entryCount: number;
  sizeBytes: number;
  hitRate: number;
  lastCleanup: Date | null;
  errors: string[];
}
