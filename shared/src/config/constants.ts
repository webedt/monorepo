/**
 * Centralized Constants Configuration
 *
 * This module provides namespaced access to all configurable timeouts, limits,
 * and intervals used throughout the application. All values are environment-
 * overridable via the corresponding environment variables in env.ts.
 *
 * Usage:
 *   import { TIMEOUTS, LIMITS, INTERVALS, RETRY, CIRCUIT_BREAKER } from '../config/constants.js';
 *
 *   setTimeout(callback, TIMEOUTS.HTTP.REQUEST);
 *   if (subscribers > LIMITS.SSE.MAX_LISTENERS) { ... }
 */

import {
  // Timeouts
  HTTP_REQUEST_TIMEOUT_MS,
  HTTP_HEAD_TIMEOUT_MS,
  HTTP_HEALTH_CHECK_TIMEOUT_MS,
  SSE_STALE_TIMEOUT_MS,
  DB_CONNECTION_TIMEOUT_MS,
  DB_IDLE_TIMEOUT_MS,
  DB_STATEMENT_TIMEOUT_MS,
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  WORKER_EXECUTION_TIMEOUT_MS,
  WORKER_HEALTH_CHECK_TIMEOUT_MS,
  // Intervals
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_CLEANUP_INTERVAL_MS,
  HEALTH_CHECK_INTERVAL_MS,
  DB_HEALTH_CHECK_INTERVAL_MS,
  CRDT_SYNC_INTERVAL_MS,
  // Limits
  SSE_MAX_LISTENERS,
  SSE_MAX_SUBSCRIBERS_PER_SESSION,
  SSE_MAX_SUBSCRIBERS_PER_USER,
  SSE_WARN_SUBSCRIBER_COUNT,
  SSE_ERROR_SUBSCRIBER_COUNT,
  DB_MAX_CONNECTIONS,
  DB_MIN_CONNECTIONS,
  IMPORT_MAX_FILE_SIZE_BYTES,
  CRDT_MAX_BATCH_SIZE,
  MAX_CONCURRENT_API_CALLS,
  LRU_EVICTION_RATE,
  // Operational limits
  SESSION_CONCURRENCY_LIMIT,
  SESSION_MAX_BATCH_SIZE,
  SESSION_MAX_ARCHIVE_BATCH_SIZE,
  DATALOADER_MAX_BATCH_SIZE,
  SEARCH_GAMES_LIMIT,
  SEARCH_USERS_LIMIT,
  SEARCH_SESSIONS_LIMIT,
  SEARCH_POSTS_LIMIT,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_SUGGESTIONS_DEFAULT_LIMIT,
  SEARCH_SUGGESTIONS_MAX_LIMIT,
  LIVE_CHAT_MESSAGES_DEFAULT_LIMIT,
  LIVE_CHAT_HISTORY_LIMIT,
  LIVE_CHAT_CONTEXT_MESSAGES,
  BATCH_DEFAULT_CONCURRENCY,
  BATCH_MAX_BATCH_SIZE,
  // Retry
  RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_JITTER_FACTOR,
  // Context-specific retry
  CRDT_RETRY_MAX_DELAY_MS,
  DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS,
  DB_CONNECTION_MAX_RETRIES,
  // Circuit breaker
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
  CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS,
  // Recovery delays
  RECOVERY_DELAY_RATE_LIMIT_MS,
  RECOVERY_DELAY_NETWORK_MS,
  RECOVERY_DELAY_SERVER_MS,
  RECOVERY_DELAY_CONFLICT_MS,
  RECOVERY_DELAY_UNKNOWN_MS,
} from './env.js';

/**
 * TIMEOUTS - All timeout values in milliseconds
 *
 * These values control how long operations wait before timing out.
 * Adjust based on network conditions and performance requirements.
 *
 * Safe ranges:
 * - HTTP requests: 5000-60000ms (5s-60s)
 * - Health checks: 2000-10000ms (2s-10s)
 * - Database: 5000-60000ms (5s-60s)
 * - SSE stale: 15000-120000ms (15s-2min)
 */
export const TIMEOUTS = {
  /**
   * HTTP timeout configuration
   */
  HTTP: {
    /** Default timeout for HTTP requests (default: 30s) */
    REQUEST: HTTP_REQUEST_TIMEOUT_MS,
    /** Timeout for HEAD validation requests (default: 10s) */
    HEAD: HTTP_HEAD_TIMEOUT_MS,
    /** Timeout for health check endpoints (default: 5s) */
    HEALTH_CHECK: HTTP_HEALTH_CHECK_TIMEOUT_MS,
  },

  /**
   * SSE/WebSocket timeout configuration
   */
  SSE: {
    /** Time before subscriber is considered stale (default: 30s) */
    STALE: SSE_STALE_TIMEOUT_MS,
  },

  /**
   * Database timeout configuration
   */
  DATABASE: {
    /** Timeout for new connections (default: 5s) */
    CONNECTION: DB_CONNECTION_TIMEOUT_MS,
    /** Time before idle connections are closed (default: 30s) */
    IDLE: DB_IDLE_TIMEOUT_MS,
    /** Maximum query execution time (default: 30s) */
    STATEMENT: DB_STATEMENT_TIMEOUT_MS,
  },

  /**
   * Circuit breaker timeout configuration
   */
  CIRCUIT_BREAKER: {
    /** Time before circuit breaker resets from open to half-open (default: 30s) */
    RESET: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  },

  /**
   * Worker/execution timeout configuration
   */
  WORKER: {
    /** Maximum time for worker execution (default: 30 min) */
    EXECUTION: WORKER_EXECUTION_TIMEOUT_MS,
    /** Timeout for worker health checks (default: 5s) */
    HEALTH_CHECK: WORKER_HEALTH_CHECK_TIMEOUT_MS,
  },
} as const;

/**
 * INTERVALS - All interval values in milliseconds
 *
 * These values control how frequently periodic operations run.
 * Adjust based on desired responsiveness vs resource usage.
 *
 * Safe ranges:
 * - SSE heartbeat: 5000-30000ms (5s-30s)
 * - Cleanup: 5000-60000ms (5s-1min)
 * - Health checks: 10000-120000ms (10s-2min)
 * - Sync: 500-5000ms (0.5s-5s)
 */
export const INTERVALS = {
  /**
   * SSE interval configuration
   */
  SSE: {
    /** Frequency of SSE heartbeats (default: 15s) */
    HEARTBEAT: SSE_HEARTBEAT_INTERVAL_MS,
    /** Frequency of stale subscriber cleanup (default: 10s) */
    CLEANUP: SSE_CLEANUP_INTERVAL_MS,
  },

  /**
   * Health check interval configuration
   */
  HEALTH: {
    /** Frequency of periodic health checks (default: 30s) */
    CHECK: HEALTH_CHECK_INTERVAL_MS,
    /** Frequency of database health checks (default: 30s) */
    DATABASE: DB_HEALTH_CHECK_INTERVAL_MS,
  },

  /**
   * Sync interval configuration
   */
  SYNC: {
    /** Frequency of CRDT sync operations (default: 1s) */
    CRDT: CRDT_SYNC_INTERVAL_MS,
  },
} as const;

/**
 * LIMITS - Capacity and resource limits
 *
 * These values control maximum capacities and thresholds.
 * Adjust based on available resources and expected load.
 *
 * Safe ranges:
 * - SSE listeners: 100-10000
 * - DB connections: 5-100
 * - File size: 1MB-100MB
 * - Batch size: 10-500
 */
export const LIMITS = {
  /**
   * SSE subscriber limits
   */
  SSE: {
    /** Maximum total SSE listeners across all sessions (default: 1000) */
    MAX_LISTENERS: SSE_MAX_LISTENERS,
    /** Maximum subscribers per session (default: 50) */
    MAX_PER_SESSION: SSE_MAX_SUBSCRIBERS_PER_SESSION,
    /** Maximum subscribers per user (default: 10) */
    MAX_PER_USER: SSE_MAX_SUBSCRIBERS_PER_USER,
    /** Subscriber count that triggers warning logs (default: 500) */
    WARN_THRESHOLD: SSE_WARN_SUBSCRIBER_COUNT,
    /** Subscriber count that triggers error/eviction (default: 900) */
    ERROR_THRESHOLD: SSE_ERROR_SUBSCRIBER_COUNT,
  },

  /**
   * Database pool limits
   */
  DATABASE: {
    /** Maximum connections in pool (default: 20) */
    MAX_CONNECTIONS: DB_MAX_CONNECTIONS,
    /** Minimum connections to maintain (default: 2) */
    MIN_CONNECTIONS: DB_MIN_CONNECTIONS,
  },

  /**
   * Import/fetch limits
   */
  IMPORT: {
    /** Maximum file size for URL imports in bytes (default: 10MB) */
    MAX_FILE_SIZE: IMPORT_MAX_FILE_SIZE_BYTES,
  },

  /**
   * Batch processing limits
   */
  BATCH: {
    /** Maximum operations per CRDT sync batch (default: 50) */
    CRDT_SIZE: CRDT_MAX_BATCH_SIZE,
    /** Maximum parallel API calls for sync (default: 5) */
    CONCURRENT_API_CALLS: MAX_CONCURRENT_API_CALLS,
  },

  /**
   * Eviction configuration
   */
  EVICTION: {
    /** Percentage of LRU entries to evict when at capacity (default: 0.2 = 20%) */
    LRU_RATE: LRU_EVICTION_RATE,
  },

  /**
   * Session operation limits
   *
   * Controls concurrency and batch sizes for bulk session operations.
   * Adjust based on API rate limits and server capacity.
   *
   * Environment overrides:
   * - SESSION_CONCURRENCY_LIMIT: Parallel operations per bulk request
   * - SESSION_MAX_BATCH_SIZE: Maximum sessions per bulk operation
   * - SESSION_MAX_ARCHIVE_BATCH_SIZE: Maximum sessions per archive batch
   */
  SESSION: {
    /** Default concurrency for session operations (default: 3) */
    CONCURRENCY: SESSION_CONCURRENCY_LIMIT,
    /** Maximum sessions per bulk operation (default: 100) */
    MAX_BATCH_SIZE: SESSION_MAX_BATCH_SIZE,
    /** Maximum sessions per archive batch (default: 50) */
    MAX_ARCHIVE_BATCH_SIZE: SESSION_MAX_ARCHIVE_BATCH_SIZE,
  },

  /**
   * DataLoader limits
   *
   * Controls batch sizes for DataLoader-style query batching.
   * Larger batches reduce N+1 queries but increase memory usage.
   *
   * Environment overrides:
   * - DATALOADER_MAX_BATCH_SIZE: Maximum items per batch
   */
  DATALOADER: {
    /** Maximum items per DataLoader batch (default: 100) */
    MAX_BATCH_SIZE: DATALOADER_MAX_BATCH_SIZE,
  },

  /**
   * Search and query limits
   *
   * Controls result limits for search operations across different entity types.
   * Larger limits improve user experience but increase query time and memory.
   *
   * Environment overrides:
   * - SEARCH_GAMES_LIMIT: Maximum game results
   * - SEARCH_USERS_LIMIT: Maximum user results
   * - SEARCH_SESSIONS_LIMIT: Maximum session results
   * - SEARCH_POSTS_LIMIT: Maximum post results
   * - SEARCH_DEFAULT_LIMIT: Default result limit
   * - SEARCH_MAX_LIMIT: Maximum allowed limit
   */
  SEARCH: {
    /** Maximum games returned from search (default: 50) */
    GAMES: SEARCH_GAMES_LIMIT,
    /** Maximum users returned from search (default: 20) */
    USERS: SEARCH_USERS_LIMIT,
    /** Maximum sessions returned from search (default: 30) */
    SESSIONS: SEARCH_SESSIONS_LIMIT,
    /** Maximum posts returned from search (default: 30) */
    POSTS: SEARCH_POSTS_LIMIT,
    /** Default search results limit (default: 10) */
    DEFAULT: SEARCH_DEFAULT_LIMIT,
    /** Maximum allowed search results limit (default: 50) */
    MAX: SEARCH_MAX_LIMIT,
    /** Default suggestions limit (default: 5) */
    SUGGESTIONS_DEFAULT: SEARCH_SUGGESTIONS_DEFAULT_LIMIT,
    /** Maximum suggestions limit (default: 10) */
    SUGGESTIONS_MAX: SEARCH_SUGGESTIONS_MAX_LIMIT,
  },

  /**
   * Live chat limits
   *
   * Controls message history and context sizes for live chat features.
   * Larger values provide more context but increase memory and API costs.
   *
   * Environment overrides:
   * - LIVE_CHAT_MESSAGES_DEFAULT_LIMIT: Default messages to fetch
   * - LIVE_CHAT_HISTORY_LIMIT: Messages for execution context
   * - LIVE_CHAT_CONTEXT_MESSAGES: Messages for conversation context
   */
  LIVE_CHAT: {
    /** Default messages to fetch (default: 100) */
    MESSAGES_DEFAULT: LIVE_CHAT_MESSAGES_DEFAULT_LIMIT,
    /** Messages for execution context (default: 50) */
    HISTORY: LIVE_CHAT_HISTORY_LIMIT,
    /** Messages for conversation context (default: 10) */
    CONTEXT_MESSAGES: LIVE_CHAT_CONTEXT_MESSAGES,
  },

  /**
   * Generic batch operation limits
   *
   * Default concurrency and batch sizes for batch operations not specific to a domain.
   *
   * Environment overrides:
   * - BATCH_DEFAULT_CONCURRENCY: Default parallel operations
   * - BATCH_MAX_BATCH_SIZE: Maximum items per batch operation
   */
  BATCH_OPERATIONS: {
    /** Default concurrency for batch operations (default: 5) */
    DEFAULT_CONCURRENCY: BATCH_DEFAULT_CONCURRENCY,
    /** Maximum items per generic batch operation (default: 100) */
    MAX_BATCH_SIZE: BATCH_MAX_BATCH_SIZE,
  },
} as const;

/**
 * RETRY - Retry and backoff configuration
 *
 * These values control retry behavior for failed operations.
 * Adjust based on operation criticality and expected failure patterns.
 *
 * Safe ranges:
 * - Max attempts: 1-10
 * - Base delay: 100-5000ms
 * - Max delay: 1000-120000ms
 * - Backoff multiplier: 1.5-3
 * - Jitter factor: 0.1-0.5
 */
export const RETRY = {
  /**
   * Default retry configuration
   */
  DEFAULT: {
    /** Maximum retry attempts (default: 3) */
    MAX_ATTEMPTS: RETRY_MAX_ATTEMPTS,
    /** Base delay between retries in ms (default: 1000) */
    BASE_DELAY_MS: RETRY_BASE_DELAY_MS,
    /** Maximum delay between retries in ms (default: 30000) */
    MAX_DELAY_MS: RETRY_MAX_DELAY_MS,
    /** Exponential backoff multiplier (default: 2) */
    BACKOFF_MULTIPLIER: RETRY_BACKOFF_MULTIPLIER,
    /** Jitter factor for delay randomization (default: 0.3 = 30%) */
    JITTER_FACTOR: RETRY_JITTER_FACTOR,
  },

  /**
   * Pre-configured retry profiles for common use cases
   */
  PROFILES: {
    /** Fast retries for low-latency operations */
    FAST: {
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      useJitter: true,
      jitterFactor: RETRY_JITTER_FACTOR,
    },
    /** Standard retries for typical operations */
    STANDARD: {
      maxRetries: RETRY_MAX_ATTEMPTS,
      baseDelayMs: RETRY_BASE_DELAY_MS,
      maxDelayMs: 10000,
      backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
      useJitter: true,
      jitterFactor: RETRY_JITTER_FACTOR,
    },
    /** Aggressive retries for critical operations */
    AGGRESSIVE: {
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: RETRY_MAX_DELAY_MS,
      backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
      useJitter: true,
      jitterFactor: RETRY_JITTER_FACTOR,
    },
    /** Rate-limit aware retries with longer delays */
    RATE_LIMIT: {
      maxRetries: RETRY_MAX_ATTEMPTS,
      baseDelayMs: 5000,
      maxDelayMs: 60000,
      backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
      useJitter: true,
      jitterFactor: RETRY_JITTER_FACTOR,
    },
    /** Network retries with moderate delays */
    NETWORK: {
      maxRetries: 4,
      baseDelayMs: 2000,
      maxDelayMs: RETRY_MAX_DELAY_MS,
      backoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
      useJitter: true,
      jitterFactor: RETRY_JITTER_FACTOR,
    },
  },
} as const;

/**
 * CIRCUIT_BREAKER - Circuit breaker configuration
 *
 * These values control circuit breaker behavior for fault tolerance.
 * Adjust based on service reliability and recovery patterns.
 *
 * Safe ranges:
 * - Failure threshold: 2-10
 * - Success threshold: 1-5
 * - Half-open attempts: 1-5
 */
export const CIRCUIT_BREAKER = {
  /**
   * Default circuit breaker configuration
   */
  DEFAULT: {
    /** Failures before opening circuit (default: 5) */
    FAILURE_THRESHOLD: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    /** Successes in half-open state to close circuit (default: 3) */
    SUCCESS_THRESHOLD: CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
    /** Maximum attempts allowed in half-open state (default: 3) */
    HALF_OPEN_MAX_ATTEMPTS: CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS,
    /** Time before circuit breaker resets from open to half-open (default: 30s) */
    RESET_TIMEOUT_MS: CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
  },
} as const;

/**
 * Recovery delay suggestions for different error types
 * Used by recovery strategies to determine appropriate wait times
 */
export const RECOVERY_DELAYS = {
  /** Delay for rate limit errors (default: 60s) */
  RATE_LIMIT: RECOVERY_DELAY_RATE_LIMIT_MS,
  /** Delay for network errors (default: 2s) */
  NETWORK: RECOVERY_DELAY_NETWORK_MS,
  /** Delay for server errors (default: 5s) */
  SERVER: RECOVERY_DELAY_SERVER_MS,
  /** Delay for conflict errors (default: 10s) */
  CONFLICT: RECOVERY_DELAY_CONFLICT_MS,
  /** Delay for unknown errors (default: 1s) */
  UNKNOWN: RECOVERY_DELAY_UNKNOWN_MS,
} as const;

/**
 * Context-specific retry configuration
 *
 * These values override defaults for specific use cases where
 * different retry behavior is needed.
 */
export const CONTEXT_RETRY = {
  /**
   * CRDT sync retry configuration
   * Shorter max delay for responsive real-time sync
   */
  CRDT: {
    MAX_DELAY_MS: CRDT_RETRY_MAX_DELAY_MS,
  },

  /**
   * Database health check retry configuration
   * Shorter max delay for quick health status updates
   */
  DB_HEALTH_CHECK: {
    MAX_DELAY_MS: DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS,
  },

  /**
   * Database connection retry configuration
   * More retries for critical database connections
   */
  DB_CONNECTION: {
    MAX_RETRIES: DB_CONNECTION_MAX_RETRIES,
  },
} as const;
