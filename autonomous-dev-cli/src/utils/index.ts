// Re-export utilities for convenient importing
export { logger, type LogLevel } from './logger.js';
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
