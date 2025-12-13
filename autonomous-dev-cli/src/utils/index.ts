// Re-export utilities for convenient importing
export {
  logger,
  type LogLevel,
  type LogFormat,
  type StructuredLogEntry,
  type OperationMetadata,
  type TimedOperationResult,
  type PerformanceMetrics,
  type OperationContext,
  // Correlation ID management
  generateCorrelationId,
  setCorrelationId,
  getCorrelationId,
  clearCorrelationId,
  // Memory and timing utilities
  getMemoryUsageMB,
  getMemoryStats,
  timeOperation,
  timeOperationSync,
  // Operation context utilities
  createOperationContext,
  finalizeOperationContext,
} from './logger.js';
export {
  // Error classes
  StructuredError,
  GitHubError,
  ClaudeError,
  ConfigError,
  ExecutionError,
  // Error codes and types
  ErrorCode,
  type ErrorSeverity,
  type RecoveryAction,
  type ErrorContext,
  type RetryConfig,
  // Utility functions
  withRetry,
  wrapError,
  createGitHubErrorFromResponse,
  formatError,
  DEFAULT_RETRY_CONFIG,
} from './errors.js';

// Re-export enhanced retry utilities
export {
  // Configuration
  type ExtendedRetryConfig,
  type RetryWithBackoffOptions,
  API_RETRY_CONFIG,
  NETWORK_RETRY_CONFIG,
  RATE_LIMIT_RETRY_CONFIG,
  // Core retry function
  retryWithBackoff,
  calculateBackoffDelay,
  // Error classification
  classifyError,
  isErrorCodeRetryable,
  isHttpStatusRetryable,
  isNetworkErrorRetryable,
  isClaudeErrorRetryable,
  // Error extraction
  extractHttpStatus,
  extractNetworkErrorCode,
  extractRetryAfterMs,
  // Error creation
  createClaudeErrorFromResponse,
} from './retry.js';

// Re-export metrics utilities
export {
  metrics,
  type MetricLabels,
  type CounterMetric,
  type GaugeMetric,
  type HistogramMetric,
  type HistogramBucket,
  type Metric,
  type ErrorContext as MetricsErrorContext,
  Counter,
  Gauge,
  Histogram,
} from './metrics.js';

// Re-export circuit breaker utilities
export {
  CircuitBreaker,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
  type CircuitBreakerHealth,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  getClaudeCircuitBreaker,
  getClaudeSDKCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerHealth,
} from './circuit-breaker.js';
