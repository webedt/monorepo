/**
 * Database Transaction Utilities
 *
 * Provides transaction wrapper for multi-step database operations:
 * - Automatic rollback on failure
 * - Error logging with context
 * - Retry support for transient failures
 * - Type-safe transaction scoped operations
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { logger } from '../utils/logging/logger.js';
import { sleep, calculateBackoffDelay } from '../utils/timing.js';
import * as schema from './schema.js';

import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Transaction context type - the transaction-scoped database client.
 * This type represents what Drizzle provides inside a transaction callback.
 */
export type TransactionContext = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Options for transaction execution.
 */
export interface TransactionOptions {
  /** Maximum retry attempts for transient failures (default: 0 = no retry) */
  maxRetries?: number;
  /** Base delay in ms between retries (default: 100ms) */
  retryDelayMs?: number;
  /** Logging context for error messages */
  context?: {
    operation: string;
    [key: string]: unknown;
  };
}

/**
 * Result of a transaction execution.
 */
export interface TransactionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  retriesAttempted: number;
}

/**
 * Check if an error is a transient database error that can be retried.
 * These are typically connection issues, deadlocks, or serialization failures.
 */
function isTransientError(error: unknown): boolean {
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
 * Execute a database operation within a transaction.
 *
 * The transaction automatically rolls back on any error, ensuring atomicity
 * of multi-step operations. Use this for operations that must either all
 * succeed or all fail together.
 *
 * @example
 * ```typescript
 * // Simple transaction
 * const result = await withTransaction(db, async (tx) => {
 *   await tx.insert(sessions).values({ ... });
 *   await tx.insert(messages).values({ ... });
 *   return { sessionId: '123' };
 * });
 *
 * // With retry support for transient failures
 * const result = await withTransaction(db, async (tx) => {
 *   await tx.delete(events).where(eq(events.sessionId, id));
 *   await tx.delete(messages).where(eq(messages.sessionId, id));
 *   await tx.delete(sessions).where(eq(sessions.id, id));
 * }, {
 *   maxRetries: 2,
 *   context: { operation: 'deleteSession', sessionId: id }
 * });
 * ```
 */
export async function withTransaction<T>(
  db: NodePgDatabase<typeof schema>,
  operation: (tx: TransactionContext) => Promise<T>,
  options: TransactionOptions = {}
): Promise<TransactionResult<T>> {
  const { maxRetries = 0, retryDelayMs = 100, context } = options;
  let retriesAttempted = 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await db.transaction(operation);
      return { success: true, data, retriesAttempted };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retriesAttempted = attempt;

      const logContext = {
        component: 'Transaction',
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        ...context,
      };

      if (attempt < maxRetries && isTransientError(lastError)) {
        const delay = calculateBackoffDelay(attempt + 1, {
          baseDelayMs: retryDelayMs,
          jitterMode: 'positive',
        });
        logger.warn(`Transaction failed with transient error, retrying in ${delay}ms`, {
          ...logContext,
          error: lastError.message,
          retryDelay: delay,
        });
        await sleep(delay);
      } else {
        logger.error('Transaction failed', lastError, logContext);
        break;
      }
    }
  }

  return { success: false, error: lastError || undefined, retriesAttempted };
}

/**
 * Execute a database operation within a transaction, throwing on failure.
 *
 * This is a convenience wrapper around withTransaction that throws the error
 * instead of returning a result object. Use this when you want errors to
 * propagate up the call stack.
 *
 * @throws The original error if the transaction fails
 *
 * @example
 * ```typescript
 * try {
 *   const result = await withTransactionOrThrow(db, async (tx) => {
 *     await tx.insert(sessions).values({ ... });
 *     await tx.insert(messages).values({ ... });
 *     return { sessionId: '123' };
 *   });
 * } catch (error) {
 *   // Handle error
 * }
 * ```
 */
export async function withTransactionOrThrow<T>(
  db: NodePgDatabase<typeof schema>,
  operation: (tx: TransactionContext) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const result = await withTransaction(db, operation, options);

  if (!result.success) {
    throw result.error || new Error('Transaction failed');
  }

  return result.data as T;
}

/**
 * Create a transaction wrapper bound to a specific database instance.
 *
 * This is useful when you want to reuse the same database connection
 * for multiple transaction operations without passing the db instance each time.
 *
 * @example
 * ```typescript
 * const tx = createTransactionHelper(db);
 *
 * // Later in your code
 * await tx(async (t) => {
 *   await t.insert(sessions).values({ ... });
 * });
 * ```
 */
export function createTransactionHelper(db: NodePgDatabase<typeof schema>) {
  return {
    /**
     * Execute operation in transaction, returning result object.
     */
    run: <T>(
      operation: (tx: TransactionContext) => Promise<T>,
      options?: TransactionOptions
    ): Promise<TransactionResult<T>> => {
      return withTransaction(db, operation, options);
    },

    /**
     * Execute operation in transaction, throwing on failure.
     */
    runOrThrow: <T>(
      operation: (tx: TransactionContext) => Promise<T>,
      options?: TransactionOptions
    ): Promise<T> => {
      return withTransactionOrThrow(db, operation, options);
    },
  };
}
