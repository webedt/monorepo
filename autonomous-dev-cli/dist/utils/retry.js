/**
 * Enhanced retry utilities with exponential backoff and error classification.
 * Provides configurable retry behavior for API calls and network operations.
 */
import { logger } from './logger.js';
import { ErrorCode, StructuredError, ClaudeError, } from './errors.js';
/**
 * Default retry configuration for API operations
 */
export const API_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
    jitterFactor: 0.1,
};
/**
 * Retry configuration for network-heavy operations (git clone, push)
 */
export const NETWORK_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
    jitterFactor: 0.1,
};
/**
 * Retry configuration for rate-limited APIs (respects Retry-After)
 */
export const RATE_LIMIT_RETRY_CONFIG = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 120000, // Allow longer waits for rate limits
    backoffMultiplier: 2,
    jitter: true,
    jitterFactor: 0.05,
};
/**
 * Error types that are never retryable
 */
const NON_RETRYABLE_ERROR_CODES = new Set([
    // Auth errors - retrying won't help
    ErrorCode.GITHUB_AUTH_FAILED,
    ErrorCode.CLAUDE_AUTH_FAILED,
    ErrorCode.GITHUB_PERMISSION_DENIED,
    // Validation/Not found errors - retrying won't help
    ErrorCode.GITHUB_REPO_NOT_FOUND,
    ErrorCode.GITHUB_ISSUE_NOT_FOUND,
    ErrorCode.GITHUB_BRANCH_NOT_FOUND,
    ErrorCode.CONFIG_INVALID,
    ErrorCode.CONFIG_MISSING_REQUIRED,
    ErrorCode.CONFIG_VALIDATION_FAILED,
    ErrorCode.CLAUDE_INVALID_RESPONSE,
    // Analyzer errors - retrying won't help
    ErrorCode.ANALYZER_PATH_NOT_FOUND,
    ErrorCode.ANALYZER_PATH_NOT_READABLE,
    ErrorCode.ANALYZER_PATH_NOT_DIRECTORY,
    ErrorCode.ANALYZER_INVALID_GLOB_PATTERN,
    ErrorCode.ANALYZER_INVALID_REGEX_PATTERN,
]);
/**
 * Error types that are always retryable
 */
const RETRYABLE_ERROR_CODES = new Set([
    ErrorCode.GITHUB_RATE_LIMITED,
    ErrorCode.GITHUB_NETWORK_ERROR,
    ErrorCode.GITHUB_CIRCUIT_OPEN,
    ErrorCode.GITHUB_SERVICE_DEGRADED,
    ErrorCode.NETWORK_ERROR,
    ErrorCode.CLAUDE_TIMEOUT,
    ErrorCode.DB_CONNECTION_FAILED,
    ErrorCode.SERVICE_DEGRADED,
    ErrorCode.CIRCUIT_BREAKER_OPEN,
    ErrorCode.EXEC_CLONE_FAILED,
    ErrorCode.EXEC_PUSH_FAILED,
]);
/**
 * HTTP status codes that indicate retryable errors
 */
const RETRYABLE_HTTP_STATUS_CODES = new Set([
    408, // Request Timeout
    429, // Too Many Requests (Rate Limited)
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
    522, // Connection Timed Out
    524, // A Timeout Occurred
]);
/**
 * HTTP status codes that indicate non-retryable errors
 */
const NON_RETRYABLE_HTTP_STATUS_CODES = new Set([
    400, // Bad Request
    401, // Unauthorized
    403, // Forbidden
    404, // Not Found
    405, // Method Not Allowed
    409, // Conflict (needs user intervention)
    410, // Gone
    422, // Unprocessable Entity
]);
/**
 * Network error codes that indicate retryable errors
 */
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'ECONNABORTED',
    'ESOCKETTIMEDOUT',
]);
/**
 * Sleep for a specified duration
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoffDelay(attempt, config) {
    const baseDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
    // Add jitter if enabled
    let delay = baseDelay;
    if (config.jitter !== false) {
        const jitterFactor = config.jitterFactor ?? 0.1;
        const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);
        delay = baseDelay + jitter;
    }
    // Clamp to max delay
    return Math.min(Math.max(0, delay), config.maxDelayMs);
}
/**
 * Check if an error code is retryable
 */
export function isErrorCodeRetryable(code) {
    if (NON_RETRYABLE_ERROR_CODES.has(code)) {
        return false;
    }
    if (RETRYABLE_ERROR_CODES.has(code)) {
        return true;
    }
    // Default to not retryable for unknown codes
    return false;
}
/**
 * Check if an HTTP status code is retryable
 */
export function isHttpStatusRetryable(statusCode) {
    if (NON_RETRYABLE_HTTP_STATUS_CODES.has(statusCode)) {
        return false;
    }
    if (RETRYABLE_HTTP_STATUS_CODES.has(statusCode)) {
        return true;
    }
    // Server errors (5xx) are generally retryable
    if (statusCode >= 500 && statusCode < 600) {
        return true;
    }
    return false;
}
/**
 * Check if a network error code is retryable
 */
export function isNetworkErrorRetryable(errorCode) {
    return RETRYABLE_NETWORK_ERROR_CODES.has(errorCode.toUpperCase());
}
/**
 * Extract HTTP status code from various error types
 */
export function extractHttpStatus(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    const err = error;
    // Direct status property
    if (typeof err.status === 'number') {
        return err.status;
    }
    // Response object status
    if (err.response && typeof err.response === 'object') {
        const response = err.response;
        if (typeof response.status === 'number') {
            return response.status;
        }
    }
    // statusCode property (some HTTP libraries)
    if (typeof err.statusCode === 'number') {
        return err.statusCode;
    }
    return undefined;
}
/**
 * Extract network error code from error
 */
export function extractNetworkErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    const err = error;
    if (typeof err.code === 'string') {
        return err.code;
    }
    // Check cause chain
    if (err.cause && typeof err.cause === 'object') {
        const cause = err.cause;
        if (typeof cause.code === 'string') {
            return cause.code;
        }
    }
    return undefined;
}
/**
 * Extract Retry-After header value from error response (in milliseconds)
 */
export function extractRetryAfterMs(error) {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    const err = error;
    // Check response headers
    let headers;
    if (err.response && typeof err.response === 'object') {
        const response = err.response;
        if (response.headers && typeof response.headers === 'object') {
            headers = response.headers;
        }
    }
    if (err.headers && typeof err.headers === 'object') {
        headers = err.headers;
    }
    if (!headers) {
        return undefined;
    }
    // Look for retry-after header (case-insensitive)
    const retryAfter = headers['retry-after'] ??
        headers['Retry-After'] ??
        headers['x-ratelimit-reset-after'] ??
        headers['X-RateLimit-Reset-After'];
    if (retryAfter === undefined) {
        // Check for rate limit reset timestamp
        const resetTime = headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'];
        if (typeof resetTime === 'string' || typeof resetTime === 'number') {
            const resetTimestamp = typeof resetTime === 'string' ? parseInt(resetTime, 10) : resetTime;
            if (!isNaN(resetTimestamp)) {
                // Convert Unix timestamp to milliseconds from now
                const resetMs = resetTimestamp * 1000;
                const nowMs = Date.now();
                const delayMs = Math.max(0, resetMs - nowMs + 1000); // Add 1s buffer
                return delayMs;
            }
        }
        return undefined;
    }
    // Parse the Retry-After value
    if (typeof retryAfter === 'number') {
        return retryAfter * 1000; // Convert seconds to ms
    }
    if (typeof retryAfter === 'string') {
        // Try parsing as number (seconds)
        const seconds = parseFloat(retryAfter);
        if (!isNaN(seconds)) {
            return seconds * 1000;
        }
        // Try parsing as HTTP date
        const date = new Date(retryAfter);
        if (!isNaN(date.getTime())) {
            return Math.max(0, date.getTime() - Date.now());
        }
    }
    return undefined;
}
/**
 * Classify an error to determine if it's retryable
 */
export function classifyError(error) {
    // Handle StructuredError instances
    if (error instanceof StructuredError) {
        const retryAfterMs = extractRetryAfterMs(error);
        return {
            isRetryable: error.isRetryable || isErrorCodeRetryable(error.code),
            retryAfterMs,
            errorType: 'structured',
            reason: `StructuredError: ${error.code}`,
        };
    }
    // Check HTTP status code
    const statusCode = extractHttpStatus(error);
    if (statusCode !== undefined) {
        const retryAfterMs = extractRetryAfterMs(error);
        return {
            isRetryable: isHttpStatusRetryable(statusCode),
            retryAfterMs,
            errorType: 'http',
            reason: `HTTP ${statusCode}`,
        };
    }
    // Check network error code
    const networkCode = extractNetworkErrorCode(error);
    if (networkCode) {
        return {
            isRetryable: isNetworkErrorRetryable(networkCode),
            errorType: 'network',
            reason: `Network error: ${networkCode}`,
        };
    }
    // Check error message for common patterns
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        // Network-related patterns
        if (message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('enotfound') ||
            message.includes('etimedout') ||
            message.includes('econnreset')) {
            return {
                isRetryable: true,
                errorType: 'network',
                reason: 'Error message indicates network issue',
            };
        }
        // Rate limiting patterns
        if (message.includes('rate limit') || message.includes('too many requests')) {
            const retryAfterMs = extractRetryAfterMs(error);
            return {
                isRetryable: true,
                retryAfterMs,
                errorType: 'http',
                reason: 'Rate limited',
            };
        }
        // Auth patterns - not retryable
        if (message.includes('unauthorized') ||
            message.includes('authentication') ||
            message.includes('forbidden') ||
            message.includes('invalid token')) {
            return {
                isRetryable: false,
                errorType: 'http',
                reason: 'Authentication/authorization error',
            };
        }
    }
    // Default: not retryable for unknown errors
    return {
        isRetryable: false,
        errorType: 'unknown',
        reason: 'Unknown error type',
    };
}
/**
 * Execute an operation with exponential backoff retry
 */
export async function retryWithBackoff(operation, options = {}) {
    const config = { ...API_RETRY_CONFIG, ...options.config };
    const operationName = options.operationName ?? 'operation';
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Classify the error
            const classification = classifyError(error);
            // Check if we should retry
            const shouldRetry = options.shouldRetry?.(lastError) ?? classification.isRetryable;
            if (!shouldRetry || attempt >= config.maxRetries) {
                logger.debug(`${operationName}: Not retrying`, {
                    attempt: attempt + 1,
                    maxRetries: config.maxRetries,
                    isRetryable: shouldRetry,
                    reason: classification.reason,
                });
                throw lastError;
            }
            // Calculate delay
            let delay;
            // Respect Retry-After header for rate limits
            const retryAfterMs = options.getRetryAfterMs?.(lastError) ?? classification.retryAfterMs;
            if (retryAfterMs !== undefined && retryAfterMs > 0) {
                // Use Retry-After delay, but cap it to maxDelayMs
                delay = Math.min(retryAfterMs, config.maxDelayMs);
                logger.debug(`${operationName}: Using Retry-After delay`, {
                    retryAfterMs,
                    cappedDelay: delay,
                });
            }
            else {
                delay = calculateBackoffDelay(attempt, config);
            }
            // Log the retry
            logger.warn(`${operationName}: Retry attempt ${attempt + 1}/${config.maxRetries}`, {
                error: lastError.message,
                delayMs: Math.round(delay),
                errorType: classification.errorType,
                reason: classification.reason,
            });
            // Call onRetry callback
            options.onRetry?.(lastError, attempt + 1, delay);
            // Wait before retrying
            await sleep(delay);
        }
    }
    // This should not be reached, but TypeScript needs it
    throw lastError;
}
/**
 * Create a Claude-specific error from an HTTP response
 */
export function createClaudeErrorFromResponse(error, context) {
    const statusCode = extractHttpStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    let code;
    switch (statusCode) {
        case 401:
            code = ErrorCode.CLAUDE_AUTH_FAILED;
            break;
        case 429:
            code = ErrorCode.CLAUDE_QUOTA_EXCEEDED;
            break;
        case 408:
        case 504:
            code = ErrorCode.CLAUDE_TIMEOUT;
            break;
        default:
            // Check for network errors
            const networkCode = extractNetworkErrorCode(error);
            if (networkCode && isNetworkErrorRetryable(networkCode)) {
                code = ErrorCode.NETWORK_ERROR;
            }
            else {
                code = ErrorCode.CLAUDE_API_ERROR;
            }
    }
    return new ClaudeError(code, message, {
        context: {
            ...context,
            statusCode,
            originalError: message,
        },
        cause: error instanceof Error ? error : undefined,
    });
}
/**
 * Determine if a Claude API error is retryable
 */
export function isClaudeErrorRetryable(error) {
    const statusCode = extractHttpStatus(error);
    // 429 (rate limit) and 5xx errors are retryable
    if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
        return true;
    }
    // Network errors are retryable
    const networkCode = extractNetworkErrorCode(error);
    if (networkCode && isNetworkErrorRetryable(networkCode)) {
        return true;
    }
    // Check error message patterns
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('timeout') ||
            message.includes('network') ||
            message.includes('connection') ||
            message.includes('rate limit') ||
            message.includes('overloaded') ||
            message.includes('temporarily unavailable')) {
            return true;
        }
    }
    // Auth errors (401, 403) and validation errors (400, 422) are not retryable
    if (statusCode === 401 || statusCode === 403 || statusCode === 400 || statusCode === 422) {
        return false;
    }
    return false;
}
//# sourceMappingURL=retry.js.map