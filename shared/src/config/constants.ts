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
  // Retry
  RETRY_MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_JITTER_FACTOR,
  // Circuit breaker
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_SUCCESS_THRESHOLD,
  CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS,
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
  RATE_LIMIT: 60000,
  /** Delay for network errors (default: 2s) */
  NETWORK: 2000,
  /** Delay for server errors (default: 5s) */
  SERVER: 5000,
  /** Delay for conflict errors (default: 10s) */
  CONFLICT: 10000,
  /** Delay for unknown errors (default: 1s) */
  UNKNOWN: 1000,
} as const;
