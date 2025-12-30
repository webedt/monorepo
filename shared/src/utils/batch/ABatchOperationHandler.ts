/**
 * Abstract Batch Operation Handler
 * Provides type definitions and abstract interface for batch operations
 */

/**
 * Result of a single item operation within a batch
 */
export interface BatchItemResult<T, R = unknown> {
  item: T;
  success: boolean;
  result?: R;
  error?: Error;
  durationMs: number;
}

/**
 * Progress information for batch operation callbacks
 */
export interface BatchProgress<T> {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  currentItem?: T;
  percentComplete: number;
}

/**
 * Configuration for batch operations
 */
export interface BatchOperationConfig<T, R = unknown> {
  /**
   * Maximum number of concurrent operations
   * @default 5
   */
  concurrency?: number;

  /**
   * Maximum batch size allowed
   * @default 100
   */
  maxBatchSize?: number;

  /**
   * Number of failures before aborting remaining operations
   * Set to 0 for no limit (process all items regardless of failures)
   * @default 0
   */
  failureThreshold?: number;

  /**
   * Percentage of items that must fail before triggering rollback (0-100)
   * Only used when rollback is enabled
   * @default 50
   */
  rollbackThresholdPercent?: number;

  /**
   * Whether to attempt rollback on threshold failures
   * @default false
   */
  enableRollback?: boolean;

  /**
   * Function to rollback a successfully processed item
   * Required when enableRollback is true
   */
  rollbackFn?: (item: T, result: R) => Promise<void>;

  /**
   * Called when progress is made on the batch
   * Useful for streaming updates to clients
   */
  onProgress?: (progress: BatchProgress<T>) => void;

  /**
   * Called when a single item completes (success or failure)
   */
  onItemComplete?: (result: BatchItemResult<T, R>) => void;

  /**
   * Delay between progress callbacks in milliseconds
   * Used to throttle progress updates
   * @default 100
   */
  progressThrottleMs?: number;

  /**
   * Name of the operation for logging
   */
  operationName?: string;

  /**
   * Whether to continue processing remaining items after a failure
   * @default true
   */
  continueOnError?: boolean;
}

/**
 * Final result of a batch operation
 */
export interface BatchOperationResult<T, R = unknown> {
  success: boolean;
  totalItems: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  results: BatchItemResult<T, R>[];
  totalDurationMs: number;
  rolledBack: boolean;
  rollbackErrors?: Error[];
  abortedEarly: boolean;
  abortReason?: string;
}

/**
 * Abstract class defining the batch operation handler interface
 */
export abstract class ABatchOperationHandler {
  /**
   * Execute an operation on a batch of items with configurable parallelism
   * and error handling
   *
   * @param items - Array of items to process
   * @param operation - Async function to execute on each item
   * @param config - Configuration for the batch operation
   * @returns Result containing success/failure counts and individual item results
   */
  abstract executeBatch<T, R = unknown>(
    items: T[],
    operation: (item: T) => Promise<R>,
    config?: BatchOperationConfig<T, R>
  ): Promise<BatchOperationResult<T, R>>;

  /**
   * Execute an operation with automatic chunking for very large batches
   *
   * @param items - Array of items to process
   * @param operation - Async function to execute on each item
   * @param chunkSize - Size of each chunk
   * @param config - Configuration for the batch operation
   * @returns Combined result from all chunks
   */
  abstract executeBatchChunked<T, R = unknown>(
    items: T[],
    operation: (item: T) => Promise<R>,
    chunkSize: number,
    config?: BatchOperationConfig<T, R>
  ): Promise<BatchOperationResult<T, R>>;
}
