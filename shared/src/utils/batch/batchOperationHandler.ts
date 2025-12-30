/**
 * Batch Operation Handler Implementation
 * Provides reusable batch processing with parallelism, error handling, and rollback support
 */

import { logger } from '../logging/logger.js';
import { LIMITS } from '../../config/constants.js';

import type {
  ABatchOperationHandler,
  BatchOperationConfig,
  BatchOperationResult,
  BatchItemResult,
  BatchProgress,
} from './ABatchOperationHandler.js';

// Use centralized config for batch operation defaults
const DEFAULT_CONCURRENCY = LIMITS.BATCH_OPERATIONS.DEFAULT_CONCURRENCY;
const DEFAULT_MAX_BATCH_SIZE = LIMITS.BATCH_OPERATIONS.MAX_BATCH_SIZE;
const DEFAULT_FAILURE_THRESHOLD = 0;
const DEFAULT_ROLLBACK_THRESHOLD_PERCENT = 50;
const DEFAULT_PROGRESS_THROTTLE_MS = 100;

/**
 * Simple semaphore for controlling concurrent operations
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

/**
 * Throttled callback helper to prevent excessive updates
 */
class ThrottledCallback<T> {
  private lastCall = 0;
  private pending: T | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private callback: (value: T) => void,
    private throttleMs: number
  ) {}

  call(value: T): void {
    const now = Date.now();
    const elapsed = now - this.lastCall;

    if (elapsed >= this.throttleMs) {
      this.lastCall = now;
      this.callback(value);
      this.pending = null;
    } else {
      this.pending = value;
      if (!this.timeoutId) {
        this.timeoutId = setTimeout(() => {
          this.timeoutId = null;
          if (this.pending !== null) {
            this.lastCall = Date.now();
            this.callback(this.pending);
            this.pending = null;
          }
        }, this.throttleMs - elapsed);
      }
    }
  }

  flush(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.pending !== null) {
      this.callback(this.pending);
      this.pending = null;
    }
  }
}

/**
 * Implementation of batch operation handler
 */
export class BatchOperationHandler implements ABatchOperationHandler {
  async executeBatch<T, R = unknown>(
    items: T[],
    operation: (item: T) => Promise<R>,
    config: BatchOperationConfig<T, R> = {}
  ): Promise<BatchOperationResult<T, R>> {
    const startTime = Date.now();
    const {
      concurrency = DEFAULT_CONCURRENCY,
      maxBatchSize = DEFAULT_MAX_BATCH_SIZE,
      failureThreshold = DEFAULT_FAILURE_THRESHOLD,
      rollbackThresholdPercent = DEFAULT_ROLLBACK_THRESHOLD_PERCENT,
      enableRollback = false,
      rollbackFn,
      onProgress,
      onItemComplete,
      progressThrottleMs = DEFAULT_PROGRESS_THROTTLE_MS,
      operationName = 'batch-operation',
      continueOnError = true,
    } = config;

    // Validate configuration
    if (enableRollback && !rollbackFn) {
      throw new Error('rollbackFn is required when enableRollback is true');
    }

    // Check batch size limit
    if (items.length > maxBatchSize) {
      return {
        success: false,
        totalItems: items.length,
        successCount: 0,
        failureCount: 0,
        skippedCount: items.length,
        results: [],
        totalDurationMs: Date.now() - startTime,
        rolledBack: false,
        abortedEarly: true,
        abortReason: `Batch size ${items.length} exceeds maximum ${maxBatchSize}`,
      };
    }

    if (items.length === 0) {
      return {
        success: true,
        totalItems: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        results: [],
        totalDurationMs: Date.now() - startTime,
        rolledBack: false,
        abortedEarly: false,
      };
    }

    const semaphore = new Semaphore(concurrency);
    const results: BatchItemResult<T, R>[] = [];
    const successfulItems: Array<{ item: T; result: R }> = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    let abortRequested = false;
    let abortReason: string | undefined;

    // Setup throttled progress callback
    const throttledProgress = onProgress
      ? new ThrottledCallback<BatchProgress<T>>(onProgress, progressThrottleMs)
      : null;

    const emitProgress = (currentItem?: T) => {
      if (throttledProgress) {
        throttledProgress.call({
          total: items.length,
          completed: successCount + failureCount + skippedCount,
          succeeded: successCount,
          failed: failureCount,
          currentItem,
          percentComplete: Math.round(
            ((successCount + failureCount + skippedCount) / items.length) * 100
          ),
        });
      }
    };

    logger.info(`Starting batch operation`, {
      component: 'BatchOperationHandler',
      operationName,
      totalItems: items.length,
      concurrency,
      failureThreshold,
      enableRollback,
    });

    // Process items with controlled concurrency
    const processItem = async (item: T, index: number): Promise<void> => {
      // Check if we should skip due to abort
      if (abortRequested) {
        skippedCount++;
        results[index] = {
          item,
          success: false,
          error: new Error('Skipped due to batch abort'),
          durationMs: 0,
        };
        return;
      }

      await semaphore.acquire();

      // Double-check abort after acquiring semaphore
      if (abortRequested) {
        semaphore.release();
        skippedCount++;
        results[index] = {
          item,
          success: false,
          error: new Error('Skipped due to batch abort'),
          durationMs: 0,
        };
        return;
      }

      const itemStartTime = Date.now();
      emitProgress(item);

      try {
        const result = await operation(item);
        const durationMs = Date.now() - itemStartTime;

        results[index] = {
          item,
          success: true,
          result,
          durationMs,
        };

        successCount++;
        successfulItems.push({ item, result });

        if (onItemComplete) {
          onItemComplete(results[index]);
        }
      } catch (error) {
        const durationMs = Date.now() - itemStartTime;
        const err = error as Error;

        results[index] = {
          item,
          success: false,
          error: err,
          durationMs,
        };

        failureCount++;

        logger.warn(`Batch item failed`, {
          component: 'BatchOperationHandler',
          operationName,
          itemIndex: index,
          error: err.message,
          durationMs,
        });

        if (onItemComplete) {
          onItemComplete(results[index]);
        }

        // Check failure threshold
        if (failureThreshold > 0 && failureCount >= failureThreshold) {
          abortRequested = true;
          abortReason = `Failure threshold reached: ${failureCount}/${failureThreshold}`;

          logger.warn(`Batch operation aborting due to failure threshold`, {
            component: 'BatchOperationHandler',
            operationName,
            failureCount,
            failureThreshold,
          });
        }

        // Check if we should continue on error
        if (!continueOnError) {
          abortRequested = true;
          abortReason = `Stopped on first error: ${err.message}`;
        }
      } finally {
        semaphore.release();
        emitProgress();
      }
    };

    // Start all operations (semaphore controls actual concurrency)
    const promises = items.map((item, index) => processItem(item, index));
    await Promise.all(promises);

    // Flush any pending progress updates
    if (throttledProgress) {
      throttledProgress.flush();
    }

    // Check if rollback is needed
    let rolledBack = false;
    let rollbackErrors: Error[] | undefined;

    if (enableRollback && rollbackFn && successfulItems.length > 0) {
      const failurePercent = (failureCount / items.length) * 100;

      if (failurePercent >= rollbackThresholdPercent) {
        logger.info(`Rolling back ${successfulItems.length} successful operations`, {
          component: 'BatchOperationHandler',
          operationName,
          failurePercent,
          rollbackThresholdPercent,
          itemsToRollback: successfulItems.length,
        });

        rollbackErrors = [];

        for (const { item, result } of successfulItems) {
          try {
            await rollbackFn(item, result);
          } catch (error) {
            const err = error as Error;
            rollbackErrors.push(err);

            logger.error(`Rollback failed for item`, err, {
              component: 'BatchOperationHandler',
              operationName,
            });
          }
        }

        rolledBack = true;

        if (rollbackErrors.length === 0) {
          rollbackErrors = undefined;
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const success = failureCount === 0 && !abortRequested;

    logger.info(`Batch operation completed`, {
      component: 'BatchOperationHandler',
      operationName,
      success,
      successCount,
      failureCount,
      skippedCount,
      totalDurationMs,
      rolledBack,
      abortedEarly: abortRequested,
    });

    return {
      success,
      totalItems: items.length,
      successCount,
      failureCount,
      skippedCount,
      results,
      totalDurationMs,
      rolledBack,
      rollbackErrors,
      abortedEarly: abortRequested,
      abortReason,
    };
  }

  async executeBatchChunked<T, R = unknown>(
    items: T[],
    operation: (item: T) => Promise<R>,
    chunkSize: number,
    config: BatchOperationConfig<T, R> = {}
  ): Promise<BatchOperationResult<T, R>> {
    const startTime = Date.now();
    const operationName = config.operationName || 'chunked-batch-operation';

    if (chunkSize <= 0) {
      throw new Error('chunkSize must be greater than 0');
    }

    if (items.length === 0) {
      return {
        success: true,
        totalItems: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        results: [],
        totalDurationMs: 0,
        rolledBack: false,
        abortedEarly: false,
      };
    }

    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    logger.info(`Starting chunked batch operation`, {
      component: 'BatchOperationHandler',
      operationName,
      totalItems: items.length,
      chunkSize,
      totalChunks: chunks.length,
    });

    const allResults: BatchItemResult<T, R>[] = [];
    let totalSuccessCount = 0;
    let totalFailureCount = 0;
    let totalSkippedCount = 0;
    let rolledBack = false;
    let allRollbackErrors: Error[] = [];
    let abortedEarly = false;
    let abortReason: string | undefined;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];

      // Create a modified config for this chunk with progress offset
      const chunkConfig: BatchOperationConfig<T, R> = {
        ...config,
        // Override maxBatchSize for chunks
        maxBatchSize: Math.max(chunkSize, config.maxBatchSize || DEFAULT_MAX_BATCH_SIZE),
        operationName: `${operationName}[chunk ${chunkIndex + 1}/${chunks.length}]`,
        onProgress: config.onProgress
          ? (progress) => {
              const baseCompleted = allResults.length;
              config.onProgress!({
                ...progress,
                total: items.length,
                completed: baseCompleted + progress.completed,
                succeeded: totalSuccessCount + progress.succeeded,
                failed: totalFailureCount + progress.failed,
                percentComplete: Math.round(
                  ((baseCompleted + progress.completed) / items.length) * 100
                ),
              });
            }
          : undefined,
      };

      const chunkResult = await this.executeBatch(chunk, operation, chunkConfig);

      allResults.push(...chunkResult.results);
      totalSuccessCount += chunkResult.successCount;
      totalFailureCount += chunkResult.failureCount;
      totalSkippedCount += chunkResult.skippedCount;

      if (chunkResult.rolledBack) {
        rolledBack = true;
      }

      if (chunkResult.rollbackErrors) {
        allRollbackErrors.push(...chunkResult.rollbackErrors);
      }

      // If this chunk aborted, stop processing remaining chunks
      if (chunkResult.abortedEarly) {
        abortedEarly = true;
        abortReason = chunkResult.abortReason;

        // Mark remaining items as skipped
        for (let i = chunkIndex + 1; i < chunks.length; i++) {
          for (const item of chunks[i]) {
            totalSkippedCount++;
            allResults.push({
              item,
              success: false,
              error: new Error('Skipped due to previous chunk abort'),
              durationMs: 0,
            });
          }
        }
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const success = totalFailureCount === 0 && !abortedEarly;

    logger.info(`Chunked batch operation completed`, {
      component: 'BatchOperationHandler',
      operationName,
      success,
      totalSuccessCount,
      totalFailureCount,
      totalSkippedCount,
      totalDurationMs,
      rolledBack,
      abortedEarly,
    });

    return {
      success,
      totalItems: items.length,
      successCount: totalSuccessCount,
      failureCount: totalFailureCount,
      skippedCount: totalSkippedCount,
      results: allResults,
      totalDurationMs,
      rolledBack,
      rollbackErrors: allRollbackErrors.length > 0 ? allRollbackErrors : undefined,
      abortedEarly,
      abortReason,
    };
  }
}

// Singleton instance
let batchOperationHandlerInstance: BatchOperationHandler | null = null;

/**
 * Get or create the batch operation handler singleton
 */
export function getBatchOperationHandler(): BatchOperationHandler {
  if (!batchOperationHandlerInstance) {
    batchOperationHandlerInstance = new BatchOperationHandler();
  }
  return batchOperationHandlerInstance;
}

/**
 * Convenience function to execute a batch operation
 */
export async function executeBatch<T, R = unknown>(
  items: T[],
  operation: (item: T) => Promise<R>,
  config?: BatchOperationConfig<T, R>
): Promise<BatchOperationResult<T, R>> {
  return getBatchOperationHandler().executeBatch(items, operation, config);
}

/**
 * Convenience function to execute a chunked batch operation
 */
export async function executeBatchChunked<T, R = unknown>(
  items: T[],
  operation: (item: T) => Promise<R>,
  chunkSize: number,
  config?: BatchOperationConfig<T, R>
): Promise<BatchOperationResult<T, R>> {
  return getBatchOperationHandler().executeBatchChunked(items, operation, chunkSize, config);
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetBatchOperationHandlerForTesting(): void {
  batchOperationHandlerInstance = null;
}
