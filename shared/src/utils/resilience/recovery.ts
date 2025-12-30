import { logger } from '../logging/logger.js';
import { retryWithBackoff, RETRY_CONFIGS } from './retry.js';
import { sleep } from '../timing.js';
import { circuitBreakerRegistry } from './circuitBreaker.js';
import { metrics } from '../monitoring/metrics.js';
import { getErrorCode, getStatusCode, getRetryAfterHeader } from '../errorTypes.js';

import type { RetryConfig } from './retry.js';
import type { CircuitBreaker } from './circuitBreaker.js';

export type RecoveryStrategy =
  | 'retry'
  | 'circuit_breaker'
  | 'token_refresh'
  | 'backoff'
  | 'fallback'
  | 'skip';

export interface RecoveryContext {
  operation: string;
  error: Error;
  attempt: number;
  totalDurationMs: number;
}

export interface RecoveryResult {
  recovered: boolean;
  strategy: RecoveryStrategy;
  message: string;
  shouldRetry: boolean;
  retryDelayMs?: number;
  data?: unknown;
}

export interface RecoveryOptions {
  maxAttempts?: number;
  onRecoveryAttempt?: (context: RecoveryContext, strategy: RecoveryStrategy) => void;
  tokenRefreshFn?: () => Promise<string>;
  fallbackValue?: unknown;
}

export function classifyError(error: Error): {
  type: string;
  strategy: RecoveryStrategy;
  isRetryable: boolean;
  suggestedDelayMs: number;
} {
  const message = error.message.toLowerCase();
  const errorCode = getErrorCode(error);
  const statusCode = getStatusCode(error);

  if (statusCode === 401 || message.includes('unauthorized') ||
      message.includes('token expired') || message.includes('invalid token')) {
    return {
      type: 'auth_error',
      strategy: 'token_refresh',
      isRetryable: true,
      suggestedDelayMs: 0,
    };
  }

  if (statusCode === 429 || message.includes('rate limit') ||
      message.includes('too many requests')) {
    return {
      type: 'rate_limit',
      strategy: 'backoff',
      isRetryable: true,
      suggestedDelayMs: 60000,
    };
  }

  if (errorCode === 'ENOTFOUND' || errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNRESET' || errorCode === 'ECONNREFUSED' ||
      message.includes('network') || message.includes('timeout') ||
      message.includes('connection')) {
    return {
      type: 'network_error',
      strategy: 'retry',
      isRetryable: true,
      suggestedDelayMs: 2000,
    };
  }

  if (statusCode !== undefined && statusCode >= 500 && statusCode < 600) {
    return {
      type: 'server_error',
      strategy: 'circuit_breaker',
      isRetryable: true,
      suggestedDelayMs: 5000,
    };
  }

  if ((statusCode !== undefined && (statusCode === 409 || statusCode === 423)) ||
      message.includes('locked') || message.includes('conflict')) {
    return {
      type: 'conflict_error',
      strategy: 'backoff',
      isRetryable: true,
      suggestedDelayMs: 10000,
    };
  }

  if (statusCode === 404) {
    return {
      type: 'not_found',
      strategy: 'skip',
      isRetryable: false,
      suggestedDelayMs: 0,
    };
  }

  if (statusCode === 400 || statusCode === 422) {
    return {
      type: 'validation_error',
      strategy: 'skip',
      isRetryable: false,
      suggestedDelayMs: 0,
    };
  }

  return {
    type: 'unknown_error',
    strategy: 'retry',
    isRetryable: true,
    suggestedDelayMs: 1000,
  };
}

export async function attemptRecovery(
  error: Error,
  context: Omit<RecoveryContext, 'error'>,
  options: RecoveryOptions = {}
): Promise<RecoveryResult> {
  const classification = classifyError(error);
  const fullContext: RecoveryContext = { ...context, error };

  logger.info(`Attempting recovery for ${classification.type}`, {
    component: 'Recovery',
    operation: context.operation,
    errorType: classification.type,
    strategy: classification.strategy,
    attempt: context.attempt,
  });

  if (options.onRecoveryAttempt) {
    options.onRecoveryAttempt(fullContext, classification.strategy);
  }

  metrics.recordRetryAttempt(
    context.operation,
    context.attempt,
    false
  );

  switch (classification.strategy) {
    case 'token_refresh':
      return handleTokenRefresh(fullContext, options);

    case 'circuit_breaker':
      return handleCircuitBreaker(fullContext, options);

    case 'backoff':
      return handleBackoff(fullContext, classification.suggestedDelayMs);

    case 'retry':
      return {
        recovered: false,
        strategy: 'retry',
        message: `Will retry after ${classification.suggestedDelayMs}ms`,
        shouldRetry: classification.isRetryable && context.attempt < (options.maxAttempts || 3),
        retryDelayMs: classification.suggestedDelayMs,
      };

    case 'fallback':
      if (options.fallbackValue !== undefined) {
        return {
          recovered: true,
          strategy: 'fallback',
          message: 'Using fallback value',
          shouldRetry: false,
          data: options.fallbackValue,
        };
      }
      // No fallback value provided, fall through to skip behavior
      return {
        recovered: false,
        strategy: 'skip',
        message: `Error is not recoverable: ${classification.type}`,
        shouldRetry: false,
      };

    case 'skip':
    default:
      return {
        recovered: false,
        strategy: 'skip',
        message: `Error is not recoverable: ${classification.type}`,
        shouldRetry: false,
      };
  }
}

async function handleTokenRefresh(
  context: RecoveryContext,
  options: RecoveryOptions
): Promise<RecoveryResult> {
  if (!options.tokenRefreshFn) {
    return {
      recovered: false,
      strategy: 'token_refresh',
      message: 'No token refresh function provided',
      shouldRetry: false,
    };
  }

  try {
    const newToken = await options.tokenRefreshFn();
    logger.info('Token refresh successful', {
      component: 'Recovery',
      operation: context.operation,
    });

    return {
      recovered: true,
      strategy: 'token_refresh',
      message: 'Token refreshed successfully',
      shouldRetry: true,
      retryDelayMs: 0,
      data: { token: newToken },
    };
  } catch (refreshError) {
    logger.error('Token refresh failed', refreshError, {
      component: 'Recovery',
      operation: context.operation,
    });

    return {
      recovered: false,
      strategy: 'token_refresh',
      message: `Token refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
      shouldRetry: false,
    };
  }
}

async function handleCircuitBreaker(
  context: RecoveryContext,
  options: RecoveryOptions
): Promise<RecoveryResult> {
  const breaker = circuitBreakerRegistry.get(context.operation, {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 2,
  });

  if (breaker.isOpen()) {
    return {
      recovered: false,
      strategy: 'circuit_breaker',
      message: 'Circuit breaker is open - service unavailable',
      shouldRetry: false,
    };
  }

  return {
    recovered: false,
    strategy: 'circuit_breaker',
    message: 'Error recorded in circuit breaker',
    shouldRetry: context.attempt < (options.maxAttempts || 3),
    retryDelayMs: 5000,
  };
}

async function handleBackoff(
  context: RecoveryContext,
  suggestedDelayMs: number
): Promise<RecoveryResult> {
  const retryAfter = getRetryAfterHeader(context.error);
  let delayMs = suggestedDelayMs;

  if (retryAfter) {
    const parsedDelay = parseInt(retryAfter, 10);
    if (!isNaN(parsedDelay)) {
      delayMs = parsedDelay * 1000;
    }
  }

  delayMs = delayMs * Math.pow(1.5, context.attempt - 1);

  logger.info(`Backing off for ${delayMs}ms`, {
    component: 'Recovery',
    operation: context.operation,
    attempt: context.attempt,
    delayMs,
  });

  return {
    recovered: false,
    strategy: 'backoff',
    message: `Backing off for ${Math.round(delayMs / 1000)}s`,
    shouldRetry: true,
    retryDelayMs: delayMs,
  };
}

export async function withRecovery<T>(
  operation: () => Promise<T>,
  operationName: string,
  options: RecoveryOptions & { retryConfig?: Partial<RetryConfig> } = {}
): Promise<T> {
  const startTime = Date.now();
  const maxAttempts = options.maxAttempts || 3;
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      const result = await operation();

      if (attempt > 1) {
        metrics.recordRetryAttempt(operationName, attempt, true);
        logger.info(`Operation succeeded after ${attempt} attempts`, {
          component: 'Recovery',
          operation: operationName,
          totalDurationMs: Date.now() - startTime,
        });
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const recoveryResult = await attemptRecovery(
        lastError,
        {
          operation: operationName,
          attempt,
          totalDurationMs: Date.now() - startTime,
        },
        options
      );

      if (recoveryResult.recovered && recoveryResult.data !== undefined) {
        return recoveryResult.data as T;
      }

      if (!recoveryResult.shouldRetry) {
        break;
      }

      if (recoveryResult.retryDelayMs && recoveryResult.retryDelayMs > 0) {
        await sleep(recoveryResult.retryDelayMs);
      }
    }
  }

  metrics.recordError('recovery_exhausted', operationName);
  logger.error(`Operation failed after ${attempt} attempts`, lastError, {
    component: 'Recovery',
    operation: operationName,
    totalDurationMs: Date.now() - startTime,
  });

  throw lastError || new Error('Operation failed with unknown error');
}

export function createRecoverableOperation<T extends (...args: any[]) => Promise<any>>(
  operation: T,
  operationName: string,
  options: RecoveryOptions = {}
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    return withRecovery(() => operation(...args), operationName, options);
  }) as T;
}

export interface DLQEntry {
  id: string;
  operation: string;
  error: string;
  errorType: string;
  context: Record<string, unknown>;
  timestamp: Date;
  attempts: number;
  lastAttempt: Date;
  isRetryable: boolean;
}

class DeadLetterQueue {
  private entries: Map<string, DLQEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  add(entry: Omit<DLQEntry, 'id' | 'timestamp' | 'lastAttempt'>): DLQEntry {
    const id = `${entry.operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();

    const dlqEntry: DLQEntry = {
      ...entry,
      id,
      timestamp: now,
      lastAttempt: now,
    };

    if (this.entries.size >= this.maxSize) {
      const oldest = Array.from(this.entries.keys())[0];
      this.entries.delete(oldest);
    }

    this.entries.set(id, dlqEntry);
    metrics.recordError('dlq_entry', entry.operation);

    logger.warn('Added entry to DLQ', {
      component: 'DLQ',
      operation: entry.operation,
      errorType: entry.errorType,
      entryId: id,
    });

    return dlqEntry;
  }

  getAll(): DLQEntry[] {
    return Array.from(this.entries.values());
  }

  getRetryable(): DLQEntry[] {
    return Array.from(this.entries.values()).filter(e => e.isRetryable);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  updateAttempt(id: string, error?: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.attempts++;
      entry.lastAttempt = new Date();
      if (error) {
        entry.error = error;
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export const deadLetterQueue = new DeadLetterQueue();
