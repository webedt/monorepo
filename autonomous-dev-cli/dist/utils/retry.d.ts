/**
 * Enhanced retry utilities with exponential backoff and error classification.
 * Provides configurable retry behavior for API calls and network operations.
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
}
/**
 * Options for the retry with backoff operation
 */
export interface RetryWithBackoffOptions<T> {
    /** Retry configuration */
    config?: Partial<ExtendedRetryConfig>;
    /** Callback when a retry is about to happen */
    onRetry?: (error: Error, attempt: number, delay: number) => void;
    /** Custom function to determine if the error is retryable */
    shouldRetry?: (error: Error) => boolean;
    /** Operation name for logging */
    operationName?: string;
    /** Extract Retry-After delay from error (for rate limiting) */
    getRetryAfterMs?: (error: Error) => number | undefined;
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
 * Classify an error to determine if it's retryable
 */
export declare function classifyError(error: unknown): {
    isRetryable: boolean;
    retryAfterMs?: number;
    errorType: 'structured' | 'http' | 'network' | 'unknown';
    reason?: string;
};
/**
 * Execute an operation with exponential backoff retry
 */
export declare function retryWithBackoff<T>(operation: () => Promise<T>, options?: RetryWithBackoffOptions<T>): Promise<T>;
/**
 * Create a Claude-specific error from an HTTP response
 */
export declare function createClaudeErrorFromResponse(error: unknown, context?: Record<string, unknown>): ClaudeError;
/**
 * Determine if a Claude API error is retryable
 */
export declare function isClaudeErrorRetryable(error: unknown): boolean;
//# sourceMappingURL=retry.d.ts.map