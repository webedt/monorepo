/**
 * Resilience patterns: circuit breaker, retry, recovery
 * @module utils/resilience
 */

// Abstract classes and types
export {
  ACircuitBreaker,
  ACircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerResult,
} from './ACircuitBreaker.js';

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

// Request Deduplicator
export {
  ARequestDeduplicator,
  ARequestDeduplicatorRegistry,
  type RequestDeduplicatorConfig,
  type RequestDeduplicatorStats,
  type DeduplicateOptions,
  type DeduplicateResult,
} from './ARequestDeduplicator.js';

export {
  RequestDeduplicator,
  createRequestDeduplicator,
  requestDeduplicatorRegistry,
  generateRequestKey,
  simpleHash,
} from './requestDeduplicator.js';

// External API Resilience
export {
  initializeExternalApiResilience,
  resetExternalApiResilienceForTesting,
  withGitHubResilience,
  withClaudeRemoteResilience,
  withImageGenResilience,
  withCircuitBreakerOnly,
  withRetryOnly,
  getExternalApiCircuitBreakerStatus,
  areExternalApisAvailable,
  isImageGenProviderAvailable,
  resetCircuitBreaker,
  getImageGenCircuitBreakerConfig,
  GITHUB_CIRCUIT_BREAKER_CONFIG,
  CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG,
  GITHUB_RETRY_CONFIG,
  CLAUDE_REMOTE_RETRY_CONFIG,
  IMAGE_GEN_RETRY_CONFIG,
} from './externalApiResilience.js';
export type { ImageGenProvider } from './externalApiResilience.js';

// Rate Limiter
export {
  ARateLimiter,
  ARateLimiterStore,
  ARateLimiterRegistry,
  type RateLimiterConfig,
  type RateLimitResult,
  type RateLimiterStats,
  type SlidingWindowEntry,
} from './ARateLimiter.js';

export {
  SlidingWindowRateLimiter,
  SlidingWindowStore,
  rateLimiterRegistry,
  createRateLimiter,
  createSlidingWindowStore,
} from './rateLimiter.js';
