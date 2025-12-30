/**
 * Abstract Rate Limiter
 *
 * Provides a sliding window rate limiting algorithm with support for
 * different storage backends (in-memory, Redis) and configurable limits.
 */

/**
 * Configuration for rate limiting
 */
export interface RateLimiterConfig {
  /** Maximum requests per window */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /** Name for this rate limiter (for logging/metrics) */
  name: string;

  /** Optional prefix for storage keys */
  keyPrefix?: string;
}

/**
 * Result from checking rate limit
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;

  /** Current number of requests in window */
  current: number;

  /** Maximum allowed requests */
  limit: number;

  /** Time in ms until the window resets */
  resetMs: number;

  /** Time in seconds until the rate limit resets (for Retry-After header) */
  retryAfter: number;

  /** Remaining requests in window */
  remaining: number;
}

/**
 * Rate limiter statistics
 */
export interface RateLimiterStats {
  /** Total requests processed */
  totalRequests: number;

  /** Total requests blocked */
  totalBlocked: number;

  /** Current number of unique keys being tracked */
  activeKeys: number;

  /** Time of last cleanup */
  lastCleanup: Date | null;
}

/**
 * Entry in the sliding window
 */
export interface SlidingWindowEntry {
  /** Timestamp of window start */
  windowStart: number;

  /** Count in current window */
  currentCount: number;

  /** Count in previous window (for sliding calculation) */
  previousCount: number;

  /** Timestamp of previous window start */
  previousWindowStart: number;
}

/**
 * Abstract rate limiter interface
 */
export abstract class ARateLimiter {
  /**
   * Check if a request should be rate limited
   * @param key - Unique identifier for the requester (e.g., IP, user ID)
   * @returns Rate limit result
   */
  abstract check(key: string): Promise<RateLimitResult>;

  /**
   * Increment the counter for a key
   * @param key - Unique identifier for the requester
   * @returns Updated rate limit result
   */
  abstract increment(key: string): Promise<RateLimitResult>;

  /**
   * Reset the counter for a key
   * @param key - Unique identifier for the requester
   */
  abstract reset(key: string): Promise<void>;

  /**
   * Get current statistics
   */
  abstract getStats(): RateLimiterStats;

  /**
   * Clean up expired entries
   */
  abstract cleanup(): Promise<void>;

  /**
   * Get the configuration
   */
  abstract getConfig(): RateLimiterConfig;
}

/**
 * Abstract rate limiter store interface for express-rate-limit compatibility
 */
export abstract class ARateLimiterStore {
  /**
   * Get the current hit count for a key
   * @param key - The client identifier
   */
  abstract get(key: string): Promise<{ totalHits: number; resetTime: Date } | undefined>;

  /**
   * Increment the hit count for a key
   * @param key - The client identifier
   * @returns Updated count and reset time
   */
  abstract increment(key: string): Promise<{ totalHits: number; resetTime: Date }>;

  /**
   * Decrement the hit count for a key
   * @param key - The client identifier
   */
  abstract decrement(key: string): Promise<void>;

  /**
   * Reset the count for a key
   * @param key - The client identifier
   */
  abstract resetKey(key: string): Promise<void>;

  /**
   * Get statistics about the store
   */
  abstract getStats(): { keys: number; hits: number; blocked: number };
}

/**
 * Registry for managing multiple rate limiters
 */
export abstract class ARateLimiterRegistry {
  /**
   * Get or create a rate limiter by name
   */
  abstract get(
    name: string,
    config?: Partial<RateLimiterConfig>
  ): ARateLimiter;

  /**
   * Get all rate limiters' stats
   */
  abstract getAllStats(): Record<string, RateLimiterStats>;

  /**
   * Reset all rate limiters
   */
  abstract resetAll(): void;

  /**
   * Get number of registered rate limiters
   */
  abstract size(): number;
}
