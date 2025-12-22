/**
 * Retry Utility with Exponential Backoff
 *
 * Provides robust retry mechanisms for handling transient failures
 * with configurable backoff strategies, jitter, and recovery options.
 */

import { logger } from '../logging/logger.js';

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  useJitter: boolean;
  /** Maximum jitter as a fraction of delay (default: 0.3) */
  jitterFactor: number;
  /** Operation name for logging */
  operationName?: string;
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: Error, attempt: number) => boolean;
  /** Callback called before each retry */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void | Promise<void>;
  /** Callback called when all retries are exhausted */
  onExhausted?: (error: Error, totalAttempts: number) => void | Promise<void>;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDurationMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true,
  jitterFactor: 0.3,
};

/**
 * Default function to determine if an error is retryable
 */
function defaultIsRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();
  const errorCode = (error as any).code;
  const statusCode = (error as any).status || (error as any).statusCode;

  // Network errors are retryable
  if (errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET' || errorCode === 'ECONNREFUSED' ||
      errorCode === 'EPIPE' || errorCode === 'EHOSTUNREACH') {
    return true;
  }

  // HTTP status codes that indicate transient errors
  if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return true;
  }

  // Common transient error messages
  if (message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('rate limit') ||
      message.includes('temporarily unavailable') ||
      message.includes('service unavailable') ||
      message.includes('too many requests')) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'baseDelayMs' | 'maxDelayMs' | 'backoffMultiplier' | 'useJitter' | 'jitterFactor'>
): number {
  // Exponential backoff: baseDelay * multiplier^(attempt - 1)
  const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at maxDelay
  let delay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter if enabled
  if (config.useJitter) {
    const jitter = Math.random() * config.jitterFactor * delay;
    // Randomly add or subtract jitter
    delay = Math.random() > 0.5 ? delay + jitter : delay - jitter;
    // Ensure delay is positive
    delay = Math.max(delay, config.baseDelayMs * 0.5);
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an operation with exponential backoff retry
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const isRetryable = finalConfig.isRetryable || defaultIsRetryable;
  const startTime = Date.now();
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= finalConfig.maxRetries) {
    attempt++;

    try {
      const data = await operation();

      if (attempt > 1) {
        logger.info(`Operation succeeded after ${attempt} attempts`, {
          component: 'Retry',
          operationName: finalConfig.operationName,
          attempts: attempt,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return {
        success: true,
        data,
        attempts: attempt,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const shouldRetry = attempt <= finalConfig.maxRetries && isRetryable(lastError, attempt);

      if (!shouldRetry) {
        if (attempt > 1) {
          logger.error(`Operation failed after ${attempt} attempts (non-retryable)`, {
            component: 'Retry',
            operationName: finalConfig.operationName,
            attempts: attempt,
            totalDurationMs: Date.now() - startTime,
            error: lastError.message,
          });
        }

        // Call exhausted callback if all retries were used
        if (attempt > finalConfig.maxRetries && finalConfig.onExhausted) {
          await finalConfig.onExhausted(lastError, attempt);
        }

        return {
          success: false,
          error: lastError,
          attempts: attempt,
          totalDurationMs: Date.now() - startTime,
        };
      }

      // Calculate delay for next attempt
      const delayMs = calculateBackoffDelay(attempt, finalConfig);

      logger.warn(`Operation failed, retrying in ${delayMs}ms (attempt ${attempt}/${finalConfig.maxRetries + 1})`, {
        component: 'Retry',
        operationName: finalConfig.operationName,
        attempt,
        maxRetries: finalConfig.maxRetries,
        delayMs,
        error: lastError.message,
      });

      // Call retry callback
      if (finalConfig.onRetry) {
        await finalConfig.onRetry(lastError, attempt, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // Should not reach here, but handle it
  logger.error(`Operation exhausted all retries`, {
    component: 'Retry',
    operationName: finalConfig.operationName,
    attempts: attempt,
    totalDurationMs: Date.now() - startTime,
    error: lastError?.message,
  });

  if (finalConfig.onExhausted && lastError) {
    await finalConfig.onExhausted(lastError, attempt);
  }

  return {
    success: false,
    error: lastError,
    attempts: attempt,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Execute an operation with retry, returning the result or throwing on failure
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const result = await retryWithBackoff(operation, config);

  if (result.success && result.data !== undefined) {
    return result.data;
  }

  throw result.error || new Error('Operation failed after retries');
}

/**
 * Create a retry wrapper for a specific configuration
 */
export function createRetryWrapper(config: Partial<RetryConfig> = {}) {
  return <T>(operation: () => Promise<T>): Promise<T> => withRetry(operation, config);
}

/**
 * Preconfigured retry configs for common scenarios
 */
export const RETRY_CONFIGS = {
  /** Fast retry for quick operations (e.g., database queries) */
  fast: {
    maxRetries: 2,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
    useJitter: true,
  } satisfies Partial<RetryConfig>,

  /** Standard retry for API calls */
  standard: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    useJitter: true,
  } satisfies Partial<RetryConfig>,

  /** Aggressive retry for critical operations */
  aggressive: {
    maxRetries: 5,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    useJitter: true,
  } satisfies Partial<RetryConfig>,

  /** Rate limit aware retry (longer delays) */
  rateLimitAware: {
    maxRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    useJitter: true,
    isRetryable: (error: Error) => {
      const statusCode = (error as any).status || (error as any).statusCode;
      return statusCode === 429 || defaultIsRetryable(error);
    },
  } satisfies Partial<RetryConfig>,

  /** Network retry with longer delays */
  network: {
    maxRetries: 4,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    useJitter: true,
    isRetryable: (error: Error) => {
      const code = (error as any).code;
      return code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
             code === 'ECONNRESET' || code === 'ECONNREFUSED' ||
             defaultIsRetryable(error);
    },
  } satisfies Partial<RetryConfig>,
};

/**
 * Extract retry-after value from error headers
 */
export function extractRetryAfterMs(error: any): number | null {
  const headers = error.response?.headers || error.headers;
  if (!headers) return null;

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return null;

  // Check if it's a number (seconds) or a date
  const numValue = parseInt(retryAfter, 10);
  if (!isNaN(numValue)) {
    return numValue * 1000; // Convert seconds to milliseconds
  }

  // Try parsing as date
  const dateValue = Date.parse(retryAfter);
  if (!isNaN(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

/**
 * Retry with respect to Retry-After header
 */
export async function retryWithRetryAfter<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  return retryWithBackoff(operation, {
    ...RETRY_CONFIGS.rateLimitAware,
    ...config,
    onRetry: async (error, attempt, _delayMs) => {
      // Check for Retry-After header
      const retryAfterMs = extractRetryAfterMs(error);
      if (retryAfterMs && retryAfterMs > 0) {
        logger.info(`Respecting Retry-After header: waiting ${retryAfterMs}ms`, {
          component: 'Retry',
          operationName: config.operationName,
          retryAfterMs,
          attempt,
        });
        await sleep(retryAfterMs);
      }

      // Call original onRetry if provided
      if (config.onRetry) {
        await config.onRetry(error, attempt, _delayMs);
      }
    },
  });
}
