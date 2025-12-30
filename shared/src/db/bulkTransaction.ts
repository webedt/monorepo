/**
 * Bulk Database Transaction Utilities
 *
 * Provides transaction-wrapped bulk operations with:
 * - Atomic (all-or-nothing) or partial success modes
 * - Per-item success/failure tracking
 * - Retry support for transient failures
 * - Structured error reporting
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { logger } from '../utils/logging/logger.js';
import { sleep, calculateBackoffDelay } from '../utils/timing.js';
import { withTransaction, type TransactionContext, type TransactionOptions } from './transaction.js';
import * as schema from './schema.js';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Result of a single item in a bulk operation
 */
export interface BulkItemResult<T, R = unknown> {
  /** The original item */
  item: T;
  /** Whether this item succeeded */
  success: boolean;
  /** Result data if successful */
  result?: R;
  /** Error if failed */
  error?: Error;
  /** Processing duration in ms */
  durationMs: number;
}

/**
 * Overall result of a bulk database operation
 */
export interface BulkTransactionResult<T, R = unknown> {
  /** Whether the overall operation succeeded */
  success: boolean;
  /** Total items processed */
  totalItems: number;
  /** Number of successful items */
  successCount: number;
  /** Number of failed items */
  failureCount: number;
  /** Per-item results */
  results: BulkItemResult<T, R>[];
  /** Total operation duration in ms */
  durationMs: number;
  /** Whether a rollback occurred (atomic mode) */
  rolledBack: boolean;
  /** Reason for rollback if applicable */
  rollbackReason?: string;
  /** Number of retries attempted */
  retriesAttempted: number;
}

/**
 * Operation mode for bulk transactions
 */
export type BulkTransactionMode = 'atomic' | 'partial';

/**
 * Configuration for bulk transaction operations
 */
export interface BulkTransactionConfig<T> {
  /**
   * Transaction mode:
   * - 'atomic': All operations succeed or all fail (rollback on any error)
   * - 'partial': Continue processing and track individual failures
   * @default 'partial'
   */
  mode?: BulkTransactionMode;

  /**
   * Maximum retry attempts for transient failures
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay in ms between retries
   * @default 100
   */
  retryDelayMs?: number;

  /**
   * Operation name for logging
   */
  operationName?: string;

  /**
   * Additional context for logging
   */
  context?: Record<string, unknown>;

  /**
   * Function to determine which items to process from a transaction result
   * Used for filtering validated items
   */
  itemFilter?: (item: T) => boolean;
}

/**
 * Check if an error is a transient database error that can be retried
 */
function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const transientPatterns = [
    'deadlock',
    'serialization failure',
    'could not serialize',
    'connection refused',
    'connection terminated',
    'econnreset',
    'econnrefused',
    'timeout',
    'too many connections',
    'connection pool',
    'lock wait timeout',
  ];

  return transientPatterns.some(pattern => message.includes(pattern));
}

/**
 * Execute a bulk database operation within a transaction.
 *
 * Supports two modes:
 * - **Atomic**: All operations must succeed or the entire transaction rolls back.
 *   Use this when data consistency is critical and partial updates are unacceptable.
 * - **Partial**: Continue processing items even if some fail. Failed items are tracked
 *   in the results. Use this when you want to process as many items as possible.
 *
 * @example
 * ```typescript
 * // Atomic mode - all or nothing
 * const result = await executeBulkTransaction(
 *   db,
 *   sessionIds,
 *   async (tx, sessionId) => {
 *     await tx.delete(events).where(eq(events.sessionId, sessionId));
 *     await tx.delete(messages).where(eq(messages.sessionId, sessionId));
 *     await tx.delete(sessions).where(eq(sessions.id, sessionId));
 *     return { deleted: true };
 *   },
 *   { mode: 'atomic', operationName: 'bulk-delete-sessions' }
 * );
 *
 * // Partial success mode - process as many as possible
 * const result = await executeBulkTransaction(
 *   db,
 *   sessionIds,
 *   async (tx, sessionId) => {
 *     await tx.update(sessions).set({ deletedAt: new Date() }).where(eq(sessions.id, sessionId));
 *     return { softDeleted: true };
 *   },
 *   { mode: 'partial', operationName: 'bulk-soft-delete' }
 * );
 * ```
 */
export async function executeBulkTransaction<T, R = unknown>(
  db: NodePgDatabase<typeof schema>,
  items: T[],
  operation: (tx: TransactionContext, item: T, index: number) => Promise<R>,
  config: BulkTransactionConfig<T> = {}
): Promise<BulkTransactionResult<T, R>> {
  const startTime = Date.now();
  const {
    mode = 'partial',
    maxRetries = 3,
    retryDelayMs = 100,
    operationName = 'bulk-transaction',
    context = {},
    itemFilter,
  } = config;

  const logContext = {
    component: 'BulkTransaction',
    operationName,
    mode,
    totalItems: items.length,
    ...context,
  };

  // Filter items if filter provided
  const itemsToProcess = itemFilter ? items.filter(itemFilter) : items;

  if (itemsToProcess.length === 0) {
    return {
      success: true,
      totalItems: 0,
      successCount: 0,
      failureCount: 0,
      results: [],
      durationMs: Date.now() - startTime,
      rolledBack: false,
      retriesAttempted: 0,
    };
  }

  logger.info(`Starting bulk transaction`, {
    ...logContext,
    itemsToProcess: itemsToProcess.length,
  });

  if (mode === 'atomic') {
    return executeAtomicBulk(db, itemsToProcess, operation, {
      maxRetries,
      retryDelayMs,
      operationName,
      startTime,
      logContext,
    });
  } else {
    return executePartialBulk(db, itemsToProcess, operation, {
      maxRetries,
      retryDelayMs,
      operationName,
      startTime,
      logContext,
    });
  }
}

interface InternalConfig {
  maxRetries: number;
  retryDelayMs: number;
  operationName: string;
  startTime: number;
  logContext: Record<string, unknown>;
}

/**
 * Execute atomic bulk operation - all succeed or all fail
 */
async function executeAtomicBulk<T, R>(
  db: NodePgDatabase<typeof schema>,
  items: T[],
  operation: (tx: TransactionContext, item: T, index: number) => Promise<R>,
  config: InternalConfig
): Promise<BulkTransactionResult<T, R>> {
  const { maxRetries, retryDelayMs, operationName, startTime, logContext } = config;
  let retriesAttempted = 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const results: BulkItemResult<T, R>[] = [];

      // Execute all operations within a single transaction
      await db.transaction(async (tx) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const itemStart = Date.now();

          try {
            const result = await operation(tx, item, i);
            results.push({
              item,
              success: true,
              result,
              durationMs: Date.now() - itemStart,
            });
          } catch (error) {
            // In atomic mode, any failure causes rollback
            const err = error instanceof Error ? error : new Error(String(error));
            results.push({
              item,
              success: false,
              error: err,
              durationMs: Date.now() - itemStart,
            });
            // Throw to trigger transaction rollback
            throw error;
          }
        }
      });

      // All succeeded
      const durationMs = Date.now() - startTime;
      logger.info(`Bulk transaction completed successfully`, {
        ...logContext,
        successCount: results.length,
        durationMs,
        retriesAttempted,
      });

      return {
        success: true,
        totalItems: items.length,
        successCount: results.length,
        failureCount: 0,
        results,
        durationMs,
        rolledBack: false,
        retriesAttempted,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retriesAttempted = attempt;

      if (attempt < maxRetries && isTransientDbError(lastError)) {
        const delay = calculateBackoffDelay(attempt + 1, {
          baseDelayMs: retryDelayMs,
          jitterMode: 'positive',
        });

        logger.warn(`Atomic bulk transaction failed with transient error, retrying`, {
          ...logContext,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          error: lastError.message,
          retryDelay: delay,
        });

        await sleep(delay);
      } else {
        break;
      }
    }
  }

  // Transaction failed and was rolled back
  const durationMs = Date.now() - startTime;

  logger.error(`Atomic bulk transaction failed - rolled back`, lastError, {
    ...logContext,
    durationMs,
    retriesAttempted,
  });

  // Return results with all items marked as failed due to rollback
  const results: BulkItemResult<T, R>[] = items.map(item => ({
    item,
    success: false,
    error: new Error(`Transaction rolled back: ${lastError?.message}`),
    durationMs: 0,
  }));

  return {
    success: false,
    totalItems: items.length,
    successCount: 0,
    failureCount: items.length,
    results,
    durationMs,
    rolledBack: true,
    rollbackReason: lastError?.message,
    retriesAttempted,
  };
}

/**
 * Execute partial bulk operation - continue on failures
 */
async function executePartialBulk<T, R>(
  db: NodePgDatabase<typeof schema>,
  items: T[],
  operation: (tx: TransactionContext, item: T, index: number) => Promise<R>,
  config: InternalConfig
): Promise<BulkTransactionResult<T, R>> {
  const { maxRetries, retryDelayMs, operationName, startTime, logContext } = config;

  const results: BulkItemResult<T, R>[] = [];
  let successCount = 0;
  let failureCount = 0;
  let totalRetries = 0;

  // Process each item in its own transaction
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemStart = Date.now();
    let itemRetries = 0;
    let itemSuccess = false;
    let itemResult: R | undefined;
    let itemError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries && !itemSuccess; attempt++) {
      try {
        // Each item gets its own transaction
        await db.transaction(async (tx) => {
          itemResult = await operation(tx, item, i);
        });
        itemSuccess = true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        itemError = err;
        itemRetries = attempt;

        if (attempt < maxRetries && isTransientDbError(err)) {
          const delay = calculateBackoffDelay(attempt + 1, {
            baseDelayMs: retryDelayMs,
            jitterMode: 'positive',
          });

          logger.warn(`Item transaction failed with transient error, retrying`, {
            ...logContext,
            itemIndex: i,
            attempt: attempt + 1,
            error: err.message,
            retryDelay: delay,
          });

          await sleep(delay);
        } else {
          logger.warn(`Item transaction failed`, {
            ...logContext,
            itemIndex: i,
            error: err.message,
            attempts: attempt + 1,
          });
          break;
        }
      }
    }

    totalRetries += itemRetries;

    if (itemSuccess) {
      successCount++;
      results.push({
        item,
        success: true,
        result: itemResult,
        durationMs: Date.now() - itemStart,
      });
    } else {
      failureCount++;
      results.push({
        item,
        success: false,
        error: itemError,
        durationMs: Date.now() - itemStart,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  const success = failureCount === 0;

  logger.info(`Partial bulk transaction completed`, {
    ...logContext,
    success,
    successCount,
    failureCount,
    durationMs,
    totalRetries,
  });

  return {
    success,
    totalItems: items.length,
    successCount,
    failureCount,
    results,
    durationMs,
    rolledBack: false,
    retriesAttempted: totalRetries,
  };
}

/**
 * Execute a bulk database write operation (insert, update, delete) in a single transaction.
 *
 * This is optimized for cases where the same operation is applied to multiple items
 * and can be batched into fewer database calls using `inArray` or similar constructs.
 *
 * @example
 * ```typescript
 * // Bulk update in single transaction
 * const result = await executeBulkWrite(
 *   db,
 *   async (tx) => {
 *     await tx.update(sessions)
 *       .set({ deletedAt: new Date() })
 *       .where(inArray(sessions.id, sessionIds));
 *     return { updated: sessionIds.length };
 *   },
 *   {
 *     operationName: 'bulk-soft-delete',
 *     maxRetries: 2,
 *   }
 * );
 * ```
 */
export async function executeBulkWrite<R>(
  db: NodePgDatabase<typeof schema>,
  operation: (tx: TransactionContext) => Promise<R>,
  config: Omit<BulkTransactionConfig<never>, 'mode' | 'itemFilter'> = {}
): Promise<{
  success: boolean;
  result?: R;
  error?: Error;
  durationMs: number;
  retriesAttempted: number;
}> {
  const startTime = Date.now();
  const {
    maxRetries = 3,
    retryDelayMs = 100,
    operationName = 'bulk-write',
    context = {},
  } = config;

  const txOptions: TransactionOptions = {
    maxRetries,
    retryDelayMs,
    context: {
      operation: operationName,
      ...context,
    },
  };

  const txResult = await withTransaction(db, operation, txOptions);

  return {
    success: txResult.success,
    result: txResult.data,
    error: txResult.error,
    durationMs: Date.now() - startTime,
    retriesAttempted: txResult.retriesAttempted,
  };
}

/**
 * Response format for bulk API endpoints
 */
export interface BulkApiResponse<R = unknown> {
  success: boolean;
  data: {
    processed: number;
    succeeded: number;
    failed: number;
    results: Array<{
      id: string;
      success: boolean;
      message?: string;
      error?: string;
    }>;
    stats: {
      durationMs: number;
      retriesAttempted: number;
      rolledBack: boolean;
    };
  };
  error?: string;
}

/**
 * Create a standardized API response from a bulk transaction result
 */
export function createBulkApiResponse<T extends { id: string }, R>(
  result: BulkTransactionResult<T, R>,
  getSuccessMessage?: (item: T, result: R) => string
): BulkApiResponse<R> {
  const results = result.results.map(itemResult => ({
    id: itemResult.item.id,
    success: itemResult.success,
    message: itemResult.success && getSuccessMessage
      ? getSuccessMessage(itemResult.item, itemResult.result as R)
      : undefined,
    error: itemResult.error?.message,
  }));

  return {
    success: result.success,
    data: {
      processed: result.totalItems,
      succeeded: result.successCount,
      failed: result.failureCount,
      results,
      stats: {
        durationMs: result.durationMs,
        retriesAttempted: result.retriesAttempted,
        rolledBack: result.rolledBack,
      },
    },
    error: result.rollbackReason,
  };
}
