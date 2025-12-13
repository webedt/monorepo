/**
 * Enhanced retry utilities with exponential backoff and error classification.
 * Provides configurable retry behavior for API calls and network operations.
 *
 * Features:
 * - Exponential backoff with jitter
 * - Progressive timeout increases for subsequent retries
 * - Error classification (transient vs permanent)
 * - Rate limit aware retry delays (respects Retry-After and X-RateLimit headers)
 * - Detailed retry context preservation across attempts
 */
import { ErrorCode, ClaudeError, type RetryConfig } from './errors.js';
/**
 * Extended retry configuration with additional options
 */
export interface ExtendedRetryConfig extends RetryConfig {
    /** Whether to add jitter to the delay (default: true) */
    jitter?: boolean;
    /** Jitter factor as a percentage (0-1, default: 0.1 for ±10%) */
    jitterFactor?: number;
    /** Enable progressive timeout increase per retry (default: true) */
    progressiveTimeout?: boolean;
    /** Timeout increase factor per retry (default: 1.5) */
    timeoutIncreaseFactor?: number;
    /** Initial operation timeout in ms (default: 30000) */
    initialTimeoutMs?: number;
    /** Maximum operation timeout in ms (default: 300000 = 5 min) */
    maxTimeoutMs?: number;
}
/**
 * Context preserved across retry attempts
 */
export interface RetryContext {
    /** Current attempt number (0-based) */
    attempt: number;
    /** Total attempts allowed */
    maxRetries: number;
    /** Time of first attempt */
    firstAttemptAt: Date;
    /** Time of current attempt */
    currentAttemptAt: Date;
    /** Total elapsed time in ms */
    elapsedMs: number;
    /** Current timeout for operation in ms */
    currentTimeoutMs: number;
    /** History of all attempts with error details */
    attemptHistory: RetryAttemptRecord[];
    /** Whether the operation has been permanently failed */
    permanentlyFailed: boolean;
    /** The final error if permanently failed */
    finalError?: Error;
}
/**
 * Record of a single retry attempt
 */
export interface RetryAttemptRecord {
    attempt: number;
    timestamp: string;
    errorCode?: string;
    errorMessage: string;
    delayMs: number;
    timeoutMs: number;
    classification: RetryErrorClassification;
}
/**
 * Error classification result
 */
export interface RetryErrorClassification {
    isRetryable: boolean;
    retryAfterMs?: number;
    errorType: 'structured' | 'http' | 'network' | 'unknown';
    reason?: string;
}
/**
 * Options for the retry with backoff operation
 */
export interface RetryWithBackoffOptions<T> {
    /** Retry configuration */
    config?: Partial<ExtendedRetryConfig>;
    /** Callback when a retry is about to happen */
    onRetry?: (error: Error, attempt: number, delay: number, context: RetryContext) => void;
    /** Callback when all retries are exhausted */
    onExhausted?: (error: Error, context: RetryContext) => void;
    /** Custom function to determine if the error is retryable */
    shouldRetry?: (error: Error, context: RetryContext) => boolean;
    /** Operation name for logging */
    operationName?: string;
    /** Extract Retry-After delay from error (for rate limiting) */
    getRetryAfterMs?: (error: Error) => number | undefined;
    /** Abort signal for cancellation */
    abortSignal?: AbortSignal;
}
/**
 * Default retry configuration for API operations
 */
export declare const API_RETRY_CONFIG: ExtendedRetryConfig;
/**
 * Retry configuration for network-heavy operations (git clone, push)
 */
export declare const NETWORK_RETRY_CONFIG: ExtendedRetryConfig;
/**
 * Retry configuration for rate-limited APIs (respects Retry-After)
 */
export declare const RATE_LIMIT_RETRY_CONFIG: ExtendedRetryConfig;
/**
 * Retry configuration for Claude API calls
 */
export declare const CLAUDE_RETRY_CONFIG: ExtendedRetryConfig;
/**
 * Retry configuration for database operations
 */
export declare const DATABASE_RETRY_CONFIG: ExtendedRetryConfig;
/**
 * Calculate delay with exponential backoff and optional jitter
 */
export declare function calculateBackoffDelay(attempt: number, config: ExtendedRetryConfig): number;
/**
 * Check if an error code is retryable
 */
export declare function isErrorCodeRetryable(code: ErrorCode): boolean;
/**
 * Check if an HTTP status code is retryable
 */
export declare function isHttpStatusRetryable(statusCode: number): boolean;
/**
 * Check if a network error code is retryable
 */
export declare function isNetworkErrorRetryable(errorCode: string): boolean;
/**
 * Extract HTTP status code from various error types
 */
export declare function extractHttpStatus(error: unknown): number | undefined;
/**
 * Extract network error code from error
 */
export declare function extractNetworkErrorCode(error: unknown): string | undefined;
/**
 * Extract Retry-After header value from error response (in milliseconds)
 */
export declare function extractRetryAfterMs(error: unknown): number | undefined;
/**
 * Calculate progressive timeout for retry attempts
 */
export declare function calculateProgressiveTimeout(attempt: number, config: ExtendedRetryConfig): number;
/**
 * Create a new retry context
 */
export declare function createRetryContext(config: ExtendedRetryConfig): RetryContext;
/**
 * Update retry context for a new attempt
 */
export declare function updateRetryContext(context: RetryContext, config: ExtendedRetryConfig, error: Error, delayMs: number, classification: RetryErrorClassification): void;
/**
 * Mark context as permanently failed
 */
export declare function markContextFailed(context: RetryContext, error: Error): void;
/**
 * Classify an error to determine if it's retryable
 */
export declare function classifyError(error: unknown): RetryErrorClassification;
/**
 * Result of retryWithBackoff including context
 */
export interface RetryWithBackoffResult<T> {
    result: T;
    context: RetryContext;
    totalAttempts: number;
    totalDurationMs: number;
}
/**
 * Execute an operation with exponential backoff retry and full context tracking
 */
export declare function retryWithBackoff<T>(operation: (context: RetryContext) => Promise<T>, options?: RetryWithBackoffOptions<T>): Promise<T>;
/**
 * Execute an operation with retry and return full result with context
 */
export declare function retryWithBackoffDetailed<T>(operation: (context: RetryContext) => Promise<T>, options?: RetryWithBackoffOptions<T>): Promise<RetryWithBackoffResult<T>>;
/**
 * Create a Claude-specific error from an HTTP response
 */
export declare function createClaudeErrorFromResponse(error: unknown, context?: Record<string, unknown>): ClaudeError;
/**
 * Determine if a Claude API error is retryable
 */
export declare function isClaudeErrorRetryable(error: unknown): boolean;
//# sourceMappingURL=retry.d.ts.map