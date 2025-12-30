import { logger } from '../logging/logger.js';
import { getErrorCode, getStatusCode, asNetworkError } from '../errorTypes.js';
import { RETRY } from '../../config/constants.js';
import { sleep, calculateBackoffDelay as calculateBackoff } from '../timing.js';

import type { BackoffConfig } from '../timing.js';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  useJitter: boolean;
  jitterFactor: number;
  operationName?: string;
  isRetryable?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void | Promise<void>;
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
  maxRetries: RETRY.DEFAULT.MAX_ATTEMPTS,
  baseDelayMs: RETRY.DEFAULT.BASE_DELAY_MS,
  maxDelayMs: RETRY.DEFAULT.MAX_DELAY_MS,
  backoffMultiplier: RETRY.DEFAULT.BACKOFF_MULTIPLIER,
  useJitter: true,
  jitterFactor: RETRY.DEFAULT.JITTER_FACTOR,
};

function defaultIsRetryable(error: Error): boolean {
  const message = error.message.toLowerCase();
  const errorCode = getErrorCode(error);
  const statusCode = getStatusCode(error);

  if (errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET' || errorCode === 'ECONNREFUSED' ||
      errorCode === 'EPIPE' || errorCode === 'EHOSTUNREACH') {
    return true;
  }

  if (statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return true;
  }

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
 * Calculate exponential backoff delay with optional jitter.
 * Delegates to the centralized timing module.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'baseDelayMs' | 'maxDelayMs' | 'backoffMultiplier' | 'useJitter' | 'jitterFactor'>
): number {
  return calculateBackoff(attempt, config);
}

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

      const delayMs = calculateBackoffDelay(attempt, finalConfig);

      logger.warn(`Operation failed, retrying in ${delayMs}ms (attempt ${attempt}/${finalConfig.maxRetries + 1})`, {
        component: 'Retry',
        operationName: finalConfig.operationName,
        attempt,
        maxRetries: finalConfig.maxRetries,
        delayMs,
        error: lastError.message,
      });

      if (finalConfig.onRetry) {
        await finalConfig.onRetry(lastError, attempt, delayMs);
      }

      await sleep(delayMs);
    }
  }

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

export function createRetryWrapper(config: Partial<RetryConfig> = {}) {
  return <T>(operation: () => Promise<T>): Promise<T> => withRetry(operation, config);
}

export const RETRY_CONFIGS = {
  fast: {
    ...RETRY.PROFILES.FAST,
  } satisfies Partial<RetryConfig>,

  standard: {
    ...RETRY.PROFILES.STANDARD,
  } satisfies Partial<RetryConfig>,

  aggressive: {
    ...RETRY.PROFILES.AGGRESSIVE,
  } satisfies Partial<RetryConfig>,

  rateLimitAware: {
    ...RETRY.PROFILES.RATE_LIMIT,
    isRetryable: (error: Error) => {
      const statusCode = getStatusCode(error);
      return statusCode === 429 || defaultIsRetryable(error);
    },
  } satisfies Partial<RetryConfig>,

  network: {
    ...RETRY.PROFILES.NETWORK,
    isRetryable: (error: Error) => {
      const code = getErrorCode(error);
      return code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
             code === 'ECONNRESET' || code === 'ECONNREFUSED' ||
             defaultIsRetryable(error);
    },
  } satisfies Partial<RetryConfig>,
};

/**
 * Extract the retry-after delay from an error's response headers.
 * Supports both numeric (seconds) and date string formats.
 */
export function extractRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const networkErr = asNetworkError(error);
  const headers = networkErr.response?.headers;
  if (!headers) return null;

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return null;

  const numValue = parseInt(retryAfter, 10);
  if (!isNaN(numValue)) {
    return numValue * 1000;
  }

  const dateValue = Date.parse(retryAfter);
  if (!isNaN(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

export async function retryWithRetryAfter<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  return retryWithBackoff(operation, {
    ...RETRY_CONFIGS.rateLimitAware,
    ...config,
    onRetry: async (error, attempt, _delayMs) => {
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

      if (config.onRetry) {
        await config.onRetry(error, attempt, _delayMs);
      }
    },
  });
}
