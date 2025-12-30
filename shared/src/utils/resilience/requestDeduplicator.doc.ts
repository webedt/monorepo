/**
 * Request Deduplicator - Prevents duplicate concurrent API calls
 *
 * When multiple identical requests arrive simultaneously (e.g., user double-clicking
 * a "Sync" button), the deduplicator ensures only one actual operation runs while
 * all callers receive the same result.
 *
 * @module utils/resilience/requestDeduplicator
 */

/**
 * Configuration for the RequestDeduplicator
 */
export interface RequestDeduplicatorConfig {
  /**
   * Default TTL in milliseconds for pending requests.
   * After this time, pending requests are cleaned up to prevent memory leaks.
   * Default: 60000 (1 minute)
   */
  defaultTtlMs: number;

  /**
   * Interval in milliseconds for running cleanup of expired entries.
   * Default: 30000 (30 seconds)
   */
  cleanupIntervalMs: number;

  /**
   * Maximum number of concurrent pending requests to track.
   * If exceeded, oldest entries are evicted.
   * Default: 10000
   */
  maxPendingRequests: number;

  /**
   * Name for logging and debugging purposes.
   */
  name: string;
}

/**
 * Statistics about the deduplicator's operation
 */
export interface RequestDeduplicatorStats {
  /**
   * Number of currently pending (in-flight) requests
   */
  pendingCount: number;

  /**
   * Total number of requests that were deduplicated (reused an existing promise)
   */
  deduplicatedCount: number;

  /**
   * Total number of unique requests that were executed
   */
  executedCount: number;

  /**
   * Total number of requests that completed successfully
   */
  successCount: number;

  /**
   * Total number of requests that failed
   */
  failureCount: number;

  /**
   * Number of expired entries that were cleaned up
   */
  cleanedUpCount: number;
}

/**
 * Options for a single deduplicate operation
 */
export interface DeduplicateOptions {
  /**
   * Custom TTL in milliseconds for this specific request.
   * Overrides the default TTL from config.
   */
  ttlMs?: number;
}

/**
 * Result of a deduplicate operation
 */
export interface DeduplicateResult<T> {
  /**
   * The actual result from the operation
   */
  data: T;

  /**
   * Whether this result was from a deduplicated request
   * (true if this caller reused another caller's in-flight request)
   */
  wasDeduplicated: boolean;

  /**
   * The request key that was used for deduplication
   */
  key: string;
}

/**
 * Documentation interface for RequestDeduplicator
 */
export interface IRequestDeduplicatorDocumentation {
  /**
   * Execute an operation with deduplication.
   *
   * If an identical request (same key) is already in-flight, returns the
   * pending promise instead of executing again. Otherwise, executes the
   * operation and shares the result with any concurrent callers.
   *
   * @param key - Unique key identifying this request (e.g., "userId:endpoint:bodyHash")
   * @param operation - The async operation to execute
   * @param options - Optional configuration for this specific request
   * @returns The result of the operation with deduplication metadata
   *
   * @example
   * ```typescript
   * const result = await deduplicator.deduplicate(
   *   `${userId}:sync`,
   *   async () => {
   *     return await syncUserSessions(userId);
   *   }
   * );
   *
   * if (result.wasDeduplicated) {
   *   logger.info('Request was deduplicated');
   * }
   * ```
   */
  deduplicate<T>(
    key: string,
    operation: () => Promise<T>,
    options?: DeduplicateOptions
  ): Promise<DeduplicateResult<T>>;

  /**
   * Check if a request with the given key is currently in-flight
   *
   * @param key - The request key to check
   * @returns true if a request with this key is pending
   */
  isPending(key: string): boolean;

  /**
   * Get the number of currently pending requests
   */
  getPendingCount(): number;

  /**
   * Get statistics about the deduplicator's operation
   */
  getStats(): RequestDeduplicatorStats;

  /**
   * Reset all statistics counters
   */
  resetStats(): void;

  /**
   * Manually trigger cleanup of expired entries
   * @returns Number of entries cleaned up
   */
  cleanup(): number;

  /**
   * Clear all pending requests (useful for testing or shutdown)
   */
  clear(): void;

  /**
   * Stop the automatic cleanup interval
   */
  stopCleanup(): void;

  /**
   * Start the automatic cleanup interval
   */
  startCleanup(): void;
}

/**
 * Documentation interface for RequestDeduplicatorRegistry
 */
export interface IRequestDeduplicatorRegistryDocumentation {
  /**
   * Get or create a named deduplicator instance.
   *
   * @param name - Unique name for the deduplicator
   * @param config - Optional configuration (only used when creating new instance)
   * @returns The deduplicator instance
   */
  get(name: string, config?: Partial<RequestDeduplicatorConfig>): IRequestDeduplicatorDocumentation;

  /**
   * Get statistics for all registered deduplicators
   */
  getAllStats(): Record<string, RequestDeduplicatorStats>;

  /**
   * Reset statistics for all deduplicators
   */
  resetAllStats(): void;

  /**
   * Clear all pending requests in all deduplicators
   */
  clearAll(): void;

  /**
   * Get the number of registered deduplicators
   */
  size(): number;
}
