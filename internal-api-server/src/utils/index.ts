/**
 * Utilities Module
 *
 * Exports all utility functions and classes for:
 * - Circuit breaker pattern
 * - Exponential backoff retry
 * - Metrics collection
 * - Health monitoring
 * - Automatic recovery mechanisms
 */

// Circuit Breaker
export {
  CircuitBreaker,
  createCircuitBreaker,
  circuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerResult,
} from './circuitBreaker.js';

// Retry utilities
export {
  retryWithBackoff,
  withRetry,
  createRetryWrapper,
  calculateBackoffDelay,
  extractRetryAfterMs,
  retryWithRetryAfter,
  RETRY_CONFIGS,
  type RetryConfig,
  type RetryResult,
} from './retry.js';

// Metrics
export {
  metrics,
  type MetricLabels,
} from './metrics.js';

// Health Monitoring
export {
  healthMonitor,
  createDatabaseHealthCheck,
  createStorageHealthCheck,
  createServiceHealthCheck,
  type HealthCheckResult,
  type ServiceHealth,
  type DetailedHealthStatus,
} from './healthMonitor.js';

// Recovery Mechanisms
export {
  classifyError,
  attemptRecovery,
  withRecovery,
  createRecoverableOperation,
  deadLetterQueue,
  type RecoveryStrategy,
  type RecoveryContext,
  type RecoveryResult,
  type RecoveryOptions,
  type DLQEntry,
} from './recovery.js';
