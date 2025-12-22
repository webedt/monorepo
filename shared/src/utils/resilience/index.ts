/**
 * Resilience patterns: circuit breaker, retry, recovery
 * @module utils/resilience
 */

// Interfaces
export type {
  ICircuitBreaker,
  ICircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreakerResult,
} from './ICircuitBreaker.js';

// Circuit Breaker
export { CircuitBreaker, createCircuitBreaker, circuitBreakerRegistry } from './circuitBreaker.js';

// Retry
export {
  retryWithBackoff,
  withRetry,
  createRetryWrapper,
  calculateBackoffDelay,
  extractRetryAfterMs,
  retryWithRetryAfter,
  RETRY_CONFIGS,
} from './retry.js';
export type { RetryConfig, RetryResult } from './retry.js';

// Recovery
export {
  classifyError,
  attemptRecovery,
  withRecovery,
  createRecoverableOperation,
  deadLetterQueue,
} from './recovery.js';
export type {
  RecoveryStrategy,
  RecoveryContext,
  RecoveryResult,
  RecoveryOptions,
  DLQEntry,
} from './recovery.js';
