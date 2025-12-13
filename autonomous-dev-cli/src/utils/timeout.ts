/**
 * Comprehensive timeout management utilities with AbortController cleanup.
 * Provides configurable timeout wrappers for external operations to prevent
 * the system from hanging indefinitely.
 *
 * Features:
 * - withTimeout() wrapper for any async operation
 * - AbortController integration with proper cleanup
 * - Configurable timeouts via environment variables
 * - Clear error messages identifying which operation timed out
 * - Proper cleanup even when errors occur
 */

import { logger } from './logger.js';
import { StructuredError, ErrorCode } from './errors.js';

/**
 * Default timeout values in milliseconds
 */
export const DEFAULT_TIMEOUTS = {
  /** GitHub API operations (30 seconds) */
  GITHUB_API: 30_000,
  /** Git operations like clone/push (30 seconds) */
  GIT_OPERATION: 30_000,
  /** Database queries (10 seconds) */
  DATABASE_QUERY: 10_000,
  /** PR merge operations (30 seconds) */
  PR_MERGE: 30_000,
  /** Generic external operation (30 seconds) */
  EXTERNAL_OPERATION: 30_000,
} as const;

/**
 * Environment variable names for timeout configuration
 */
export const TIMEOUT_ENV_VARS = {
  GITHUB_API: 'TIMEOUT_GITHUB_API_MS',
  GIT_OPERATION: 'TIMEOUT_GIT_OPERATION_MS',
  DATABASE_QUERY: 'TIMEOUT_DATABASE_QUERY_MS',
  PR_MERGE: 'TIMEOUT_PR_MERGE_MS',
  EXTERNAL_OPERATION: 'TIMEOUT_EXTERNAL_OPERATION_MS',
} as const;

/**
 * Get a timeout value from environment variable or use default
 */
export function getTimeoutFromEnv(
  envVar: keyof typeof TIMEOUT_ENV_VARS,
  defaultValue: number
): number {
  const envValue = process.env[TIMEOUT_ENV_VARS[envVar]];
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    logger.warn(`Invalid timeout value for ${TIMEOUT_ENV_VARS[envVar]}: ${envValue}, using default: ${defaultValue}ms`);
  }
  return defaultValue;
}

/**
 * Get all timeout configurations (from env vars or defaults)
 */
export function getTimeoutConfig(): typeof DEFAULT_TIMEOUTS {
  return {
    GITHUB_API: getTimeoutFromEnv('GITHUB_API', DEFAULT_TIMEOUTS.GITHUB_API),
    GIT_OPERATION: getTimeoutFromEnv('GIT_OPERATION', DEFAULT_TIMEOUTS.GIT_OPERATION),
    DATABASE_QUERY: getTimeoutFromEnv('DATABASE_QUERY', DEFAULT_TIMEOUTS.DATABASE_QUERY),
    PR_MERGE: getTimeoutFromEnv('PR_MERGE', DEFAULT_TIMEOUTS.PR_MERGE),
    EXTERNAL_OPERATION: getTimeoutFromEnv('EXTERNAL_OPERATION', DEFAULT_TIMEOUTS.EXTERNAL_OPERATION),
  };
}

/**
 * Timeout error with operation context
 */
export class TimeoutError extends StructuredError {
  public readonly timeoutMs: number;
  public readonly operationName: string;

  constructor(
    operationName: string,
    timeoutMs: number,
    options: {
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(
      ErrorCode.EXEC_TIMEOUT,
      `Operation "${operationName}" timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      {
        severity: 'transient',
        isRetryable: true,
        context: {
          ...options.context,
          operationName,
          timeoutMs,
        },
        cause: options.cause,
        recoveryActions: [
          {
            description: `Retry the operation - it may succeed with better network conditions`,
            automatic: true,
          },
          {
            description: `Increase timeout via ${getEnvVarForOperation(operationName)} environment variable`,
            automatic: false,
          },
          {
            description: 'Check if the external service is experiencing issues',
            automatic: false,
          },
        ],
      }
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.operationName = operationName;
  }
}

/**
 * Get the environment variable name for a given operation type
 */
function getEnvVarForOperation(operationName: string): string {
  const lowerName = operationName.toLowerCase();
  if (lowerName.includes('github') || lowerName.includes('api')) {
    return TIMEOUT_ENV_VARS.GITHUB_API;
  }
  if (lowerName.includes('git') || lowerName.includes('clone') || lowerName.includes('push')) {
    return TIMEOUT_ENV_VARS.GIT_OPERATION;
  }
  if (lowerName.includes('database') || lowerName.includes('db') || lowerName.includes('query')) {
    return TIMEOUT_ENV_VARS.DATABASE_QUERY;
  }
  if (lowerName.includes('merge') || lowerName.includes('pr')) {
    return TIMEOUT_ENV_VARS.PR_MERGE;
  }
  return TIMEOUT_ENV_VARS.EXTERNAL_OPERATION;
}

/**
 * Options for withTimeout wrapper
 */
export interface WithTimeoutOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Name of the operation (for error messages) */
  operationName: string;
  /** Optional AbortController to use (will be created if not provided) */
  abortController?: AbortController;
  /** Additional context for error messages */
  context?: Record<string, unknown>;
  /** Callback when timeout occurs (before throwing error) */
  onTimeout?: (timeoutMs: number, operationName: string) => void;
  /** Cleanup function to call regardless of success/failure */
  cleanup?: () => void | Promise<void>;
}

/**
 * Result of withTimeout operation
 */
export interface WithTimeoutResult<T> {
  /** The result of the operation */
  result: T;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether the operation was aborted */
  aborted: boolean;
}

/**
 * Wrap an async operation with a timeout.
 * Ensures proper cleanup of timeouts and AbortController even when errors occur.
 *
 * @param operation - The async operation to execute. Receives an AbortSignal for cancellation support.
 * @param options - Timeout configuration options
 * @returns The result of the operation
 * @throws TimeoutError if the operation times out
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await withTimeout(
 *   async (signal) => {
 *     const response = await fetch(url, { signal });
 *     return response.json();
 *   },
 *   {
 *     timeoutMs: 30000,
 *     operationName: 'fetchData',
 *   }
 * );
 *
 * // With AbortController for manual cancellation
 * const abortController = new AbortController();
 * const result = await withTimeout(
 *   async (signal) => doSomething(signal),
 *   {
 *     timeoutMs: 30000,
 *     operationName: 'myOperation',
 *     abortController,
 *   }
 * );
 * // Can manually abort: abortController.abort();
 * ```
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: WithTimeoutOptions
): Promise<T> {
  const {
    timeoutMs,
    operationName,
    abortController = new AbortController(),
    context,
    onTimeout,
    cleanup,
  } = options;

  const startTime = Date.now();
  let timeoutId: NodeJS.Timeout | null = null;
  let timeoutTriggered = false;

  try {
    // Set up the timeout
    timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      abortController.abort();
      onTimeout?.(timeoutMs, operationName);

      logger.warn(`Timeout triggered for operation: ${operationName}`, {
        timeoutMs,
        operationName,
        ...context,
      });
    }, timeoutMs);

    // Execute the operation
    const result = await operation(abortController.signal);

    const durationMs = Date.now() - startTime;
    logger.debug(`Operation completed: ${operationName}`, {
      durationMs,
      operationName,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Check if this was a timeout
    if (timeoutTriggered || abortController.signal.aborted) {
      throw new TimeoutError(operationName, timeoutMs, {
        context: {
          ...context,
          durationMs,
          abortedByTimeout: timeoutTriggered,
        },
        cause: error instanceof Error ? error : undefined,
      });
    }

    // Re-throw the original error
    throw error;
  } finally {
    // Always clean up the timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Run any cleanup function
    if (cleanup) {
      try {
        await cleanup();
      } catch (cleanupError) {
        logger.warn(`Cleanup failed for operation: ${operationName}`, {
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
  }
}

/**
 * Wrap an async operation with timeout and return detailed result
 */
export async function withTimeoutDetailed<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: WithTimeoutOptions
): Promise<WithTimeoutResult<T>> {
  const startTime = Date.now();
  const abortController = options.abortController ?? new AbortController();

  try {
    const result = await withTimeout(operation, {
      ...options,
      abortController,
    });

    return {
      result,
      durationMs: Date.now() - startTime,
      aborted: false,
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw error;
    }
    // If aborted for other reasons
    if (abortController.signal.aborted) {
      return {
        result: undefined as T,
        durationMs: Date.now() - startTime,
        aborted: true,
      };
    }
    throw error;
  }
}

/**
 * Create a timeout wrapper with pre-configured defaults for GitHub API calls
 */
export function withGitHubTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  operationName: string,
  context?: Record<string, unknown>
): Promise<T> {
  return withTimeout(operation, {
    timeoutMs: getTimeoutFromEnv('GITHUB_API', DEFAULT_TIMEOUTS.GITHUB_API),
    operationName: `GitHub API: ${operationName}`,
    context,
  });
}

/**
 * Create a timeout wrapper with pre-configured defaults for Git operations
 */
export function withGitTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  operationName: string,
  context?: Record<string, unknown>
): Promise<T> {
  return withTimeout(operation, {
    timeoutMs: getTimeoutFromEnv('GIT_OPERATION', DEFAULT_TIMEOUTS.GIT_OPERATION),
    operationName: `Git: ${operationName}`,
    context,
  });
}

/**
 * Create a timeout wrapper with pre-configured defaults for database queries
 */
export function withDatabaseTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  operationName: string,
  context?: Record<string, unknown>
): Promise<T> {
  return withTimeout(operation, {
    timeoutMs: getTimeoutFromEnv('DATABASE_QUERY', DEFAULT_TIMEOUTS.DATABASE_QUERY),
    operationName: `Database: ${operationName}`,
    context,
  });
}

/**
 * Create a timeout wrapper with pre-configured defaults for PR merge operations
 */
export function withMergeTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  operationName: string,
  context?: Record<string, unknown>
): Promise<T> {
  return withTimeout(operation, {
    timeoutMs: getTimeoutFromEnv('PR_MERGE', DEFAULT_TIMEOUTS.PR_MERGE),
    operationName: `PR Merge: ${operationName}`,
    context,
  });
}

/**
 * Race a promise against a timeout, returning the first to complete
 * Unlike withTimeout, this doesn't throw on timeout but returns a discriminated result
 */
export async function raceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<{ success: true; result: T } | { success: false; timedOut: true; timeoutMs: number }> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<{ success: false; timedOut: true; timeoutMs: number }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ success: false, timedOut: true, timeoutMs });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      operation.then((result) => ({ success: true as const, result })),
      timeoutPromise,
    ]);

    return result;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create an AbortController that automatically aborts after a timeout
 * Returns both the controller and a cleanup function
 */
export function createTimedAbortController(
  timeoutMs: number,
  operationName?: string
): {
  controller: AbortController;
  cleanup: () => void;
  isTimedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: NodeJS.Timeout | null = null;

  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
    if (operationName) {
      logger.debug(`AbortController timeout for: ${operationName}`, { timeoutMs });
    }
  }, timeoutMs);

  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return {
    controller,
    cleanup,
    isTimedOut: () => timedOut,
  };
}

/**
 * Ensure a cleanup function is called even if an error occurs
 * Useful for wrapping operations that need guaranteed cleanup
 */
export async function withCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => void | Promise<void>
): Promise<T> {
  try {
    return await operation();
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      logger.warn('Cleanup function failed', {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }
}

/**
 * Execute multiple operations with individual timeouts
 * Returns results for completed operations and errors for timed out ones
 */
export async function withTimeoutAll<T>(
  operations: Array<{
    operation: (signal: AbortSignal) => Promise<T>;
    timeoutMs: number;
    operationName: string;
  }>
): Promise<Array<{ success: true; result: T } | { success: false; error: TimeoutError }>> {
  const results = await Promise.allSettled(
    operations.map(({ operation, timeoutMs, operationName }) =>
      withTimeout(operation, { timeoutMs, operationName })
    )
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return { success: true as const, result: result.value };
    }

    const error = result.reason instanceof TimeoutError
      ? result.reason
      : new TimeoutError(
          operations[index].operationName,
          operations[index].timeoutMs,
          { cause: result.reason instanceof Error ? result.reason : undefined }
        );

    return { success: false as const, error };
  });
}
