/**
 * Base Service Class with Common Patterns
 *
 * Provides reusable infrastructure for service implementations:
 * - Logger auto-initialized with component name
 * - Database transaction helpers with retry logic
 * - Error handling with context enrichment
 * - Bulk operation execution with error aggregation
 * - Graceful shutdown registration
 *
 * Note: Due to TypeScript limitations with mixin patterns and anonymous classes,
 * all members must be public. Members prefixed with underscore are intended for
 * internal use only and should not be accessed directly by external code.
 *
 * @example
 * ```typescript
 * import { BaseService } from './BaseService.js';
 * import { AMyService } from './AMyService.js';
 *
 * export class MyService extends BaseService(AMyService) {
 *   async doSomething(): Promise<void> {
 *     // Logger automatically initialized with class name
 *     this.log.info('Starting operation');
 *
 *     // Transaction helper with retry
 *     const result = await this.withTransaction(async (tx) => {
 *       return tx.insert(table).values({ ... });
 *     }, { context: { operation: 'doSomething' } });
 *
 *     // Error handling helper
 *     return this.handleError(error, 'doSomething', { id: '123' });
 *   }
 * }
 * ```
 */

import { db, withTransactionOrThrow } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';
import { AService } from './abstracts/AService.js';

import type { TransactionContext, TransactionOptions } from '../db/index.js';
import type { LogContext } from '../utils/logging/logger.js';

/**
 * Result type for operations that can succeed or fail.
 */
export interface OperationResult<T = void> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

/**
 * Result type for bulk operations with aggregated stats.
 */
export interface BulkOperationResult<T> {
  successCount: number;
  failureCount: number;
  results: T[];
}

/**
 * Configuration for scheduled tasks.
 */
export interface ScheduledTaskConfig {
  /** Whether the task is enabled */
  enabled: boolean;
  /** Interval between task runs in milliseconds */
  intervalMs: number;
  /** Initial delay before first run in milliseconds */
  initialDelayMs: number;
}

/**
 * Helper interface for consistent logger access with component context.
 */
export interface ComponentLogger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, extra?: Record<string, unknown>): void;
}

/**
 * Creates a component-scoped logger that automatically includes the component name.
 */
function createComponentLogger(componentName: string): ComponentLogger {
  const addContext = (extra?: Record<string, unknown>): LogContext => ({
    component: componentName,
    ...extra,
  });

  return {
    debug: (message: string, extra?: Record<string, unknown>) => {
      logger.debug(message, addContext(extra));
    },
    info: (message: string, extra?: Record<string, unknown>) => {
      logger.info(message, addContext(extra));
    },
    warn: (message: string, extra?: Record<string, unknown>) => {
      logger.warn(message, addContext(extra));
    },
    error: (message: string, error?: Error | unknown, extra?: Record<string, unknown>) => {
      logger.error(message, error, addContext(extra));
    },
  };
}

/**
 * Mixin function that adds common service infrastructure to any abstract service class.
 *
 * This pattern allows extending any abstract service class with common functionality
 * while maintaining proper TypeScript types and instanceof checks.
 *
 * @example
 * ```typescript
 * class MyService extends BaseService(AMyService) {
 *   // Uses: this.log, this.withTransaction, etc.
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function BaseService<T extends abstract new (...args: any[]) => AService>(AbstractClass: T) {
  abstract class BaseServiceClass extends AbstractClass {
    /**
     * Component-scoped logger with automatic context enrichment.
     * Automatically includes the class name as the component.
     */
    readonly log: ComponentLogger;

    /**
     * Component name used for logging and metrics.
     */
    readonly componentName: string;

    /**
     * Shutdown handlers to be called during dispose.
     * @internal Do not access directly - use onShutdown() instead
     */
    _shutdownHandlers: Array<() => Promise<void> | void> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      // Use the concrete class name for logging
      this.componentName = this.constructor.name;
      this.log = createComponentLogger(this.componentName);
    }

    /**
     * Execute a database operation within a transaction with automatic retry.
     *
     * @param operation - The database operation to execute
     * @param options - Transaction options including retry config
     * @returns The result of the operation
     * @throws The original error if the transaction fails after all retries
     *
     * @example
     * ```typescript
     * const result = await this.withTransaction(async (tx) => {
     *   await tx.delete(events).where(eq(events.sessionId, id));
     *   await tx.delete(messages).where(eq(messages.sessionId, id));
     *   return { eventsDeleted: 10, messagesDeleted: 5 };
     * }, { context: { operation: 'deleteSession', sessionId: id } });
     * ```
     */
    withTransaction<R>(
      operation: (tx: TransactionContext) => Promise<R>,
      options?: TransactionOptions
    ): Promise<R> {
      return withTransactionOrThrow(db, operation, options);
    }

    /**
     * Execute a bulk operation on multiple items with error aggregation.
     *
     * Processes each item individually, collecting results and counting successes/failures.
     * This allows partial success where some items fail while others succeed.
     *
     * @param items - Array of items to process
     * @param processor - Async function to process each item
     * @param options - Optional configuration for logging
     * @returns Aggregated results with success/failure counts
     *
     * @example
     * ```typescript
     * const result = await this.executeBulkOperation(
     *   sessionIds,
     *   (id) => this.deleteSession(id),
     *   { operationName: 'deleteSession' }
     * );
     * // result: { successCount: 8, failureCount: 2, results: [...] }
     * ```
     */
    async executeBulkOperation<TItem, TResult extends { success: boolean }>(
      items: TItem[],
      processor: (item: TItem) => Promise<TResult>,
      options?: { operationName?: string }
    ): Promise<BulkOperationResult<TResult>> {
      if (items.length === 0) {
        return { successCount: 0, failureCount: 0, results: [] };
      }

      const results: TResult[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const item of items) {
        const result = await processor(item);
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      }

      if (options?.operationName) {
        this.log.info(
          `Bulk ${options.operationName} completed: ${successCount} succeeded, ${failureCount} failed`,
          { total: items.length }
        );
      }

      return { successCount, failureCount, results };
    }

    /**
     * Extract error message from unknown error type.
     *
     * @param error - The error to extract message from
     * @returns A string error message
     */
    getErrorMessage(error: unknown): string {
      return error instanceof Error ? error.message : 'Unknown error';
    }

    /**
     * Handle an error with consistent logging and context enrichment.
     *
     * @param error - The error that occurred
     * @param operation - Name of the operation that failed
     * @param context - Additional context to log
     * @returns A standardized OperationResult with error details
     *
     * @example
     * ```typescript
     * catch (error) {
     *   return this.handleError(error, 'deleteSession', { sessionId });
     *   // Logs: "Failed to deleteSession" with context
     *   // Returns: { success: false, message: "Session not found", error: "..." }
     * }
     * ```
     */
    handleError(
      error: unknown,
      operation: string,
      context?: Record<string, unknown>
    ): OperationResult {
      const errorMessage = this.getErrorMessage(error);
      this.log.error(`Failed to ${operation}`, error as Error, context);
      return {
        success: false,
        message: errorMessage,
        error: errorMessage,
      };
    }

    /**
     * Create a successful operation result.
     *
     * @param message - Success message
     * @param data - Optional data to include
     * @returns A standardized OperationResult
     */
    successResult<TData>(message: string, data?: TData): OperationResult<TData> {
      return {
        success: true,
        message,
        data,
      };
    }

    /**
     * Create a failed operation result.
     *
     * @param message - Error message
     * @returns A standardized OperationResult
     */
    failureResult(message: string): OperationResult {
      return {
        success: false,
        message,
        error: message,
      };
    }

    /**
     * Register a handler to be called during shutdown/dispose.
     *
     * @param handler - Async function to call during shutdown
     *
     * @example
     * ```typescript
     * async initialize(): Promise<void> {
     *   const interval = setInterval(() => this.cleanup(), 60000);
     *   this.onShutdown(() => clearInterval(interval));
     * }
     * ```
     */
    onShutdown(handler: () => Promise<void> | void): void {
      this._shutdownHandlers.push(handler);
    }

    /**
     * Default dispose implementation that calls all registered shutdown handlers.
     * Subclasses can override but should call super.dispose() to ensure cleanup.
     */
    async dispose(): Promise<void> {
      for (const handler of this._shutdownHandlers) {
        try {
          await handler();
        } catch (error) {
          this.log.error('Shutdown handler failed', error as Error);
        }
      }
      this._shutdownHandlers = [];
    }
  }

  return BaseServiceClass;
}

/**
 * Base class for services with scheduled cleanup tasks.
 *
 * Provides common infrastructure for services that run periodic cleanup operations:
 * - Timer management (initial delay + interval)
 * - Error handling for scheduled runs
 * - Proper cleanup on dispose
 * - Configurable enable/disable
 *
 * @example
 * ```typescript
 * class MyCleanupService extends ScheduledCleanupService(AMyCleanupService) {
 *   getScheduledTaskConfig(): ScheduledTaskConfig {
 *     return {
 *       enabled: MY_CLEANUP_ENABLED,
 *       intervalMs: MY_CLEANUP_INTERVAL_MS,
 *       initialDelayMs: MY_CLEANUP_INITIAL_DELAY_MS,
 *     };
 *   }
 *
 *   runScheduledTask(): Promise<void> {
 *     return this.cleanup();
 *   }
 *
 *   getTaskName(): string {
 *     return 'my cleanup';
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ScheduledCleanupService<T extends abstract new (...args: any[]) => AService>(
  AbstractClass: T
) {
  abstract class ScheduledCleanupClass extends BaseService(AbstractClass) {
    /**
     * @internal Timer ID for cleanup interval
     */
    _cleanupIntervalId: NodeJS.Timeout | null = null;

    /**
     * @internal Timer ID for initial timeout
     */
    _initialTimeoutId: NodeJS.Timeout | null = null;

    /**
     * Get the configuration for this scheduled task.
     * Override to provide service-specific configuration.
     */
    abstract getScheduledTaskConfig(): ScheduledTaskConfig;

    /**
     * The task to run on schedule.
     * Override to implement the actual cleanup logic.
     */
    abstract runScheduledTask(): Promise<void>;

    /**
     * Get a human-readable name for this task (for logging).
     * Override to provide a descriptive name.
     */
    abstract getTaskName(): string;

    /**
     * Get additional config to log when starting the scheduler.
     * Override to add service-specific config values.
     */
    getSchedulerLogConfig(): Record<string, unknown> {
      return {};
    }

    /**
     * Start the scheduled cleanup task.
     * Call this from initialize() to begin scheduling.
     */
    startScheduledCleanup(): void {
      const config = this.getScheduledTaskConfig();
      const taskName = this.getTaskName();

      if (!config.enabled) {
        this.log.info(`${taskName} is disabled`);
        return;
      }

      if (this._cleanupIntervalId) {
        this.log.warn(`${taskName} scheduler already running`);
        return;
      }

      this.log.info(`Starting ${taskName} scheduler`, {
        intervalMs: config.intervalMs,
        initialDelayMs: config.initialDelayMs,
        ...this.getSchedulerLogConfig(),
      });

      // Initial run after delay
      this._initialTimeoutId = setTimeout(() => {
        this._runWithErrorHandling();
      }, config.initialDelayMs);

      // Periodic runs
      this._cleanupIntervalId = setInterval(() => {
        this._runWithErrorHandling();
      }, config.intervalMs);

      // Allow the process to exit cleanly
      this._cleanupIntervalId.unref();

      // Register shutdown handler
      this.onShutdown(() => this.stopScheduledCleanup());
    }

    /**
     * Stop the scheduled cleanup task.
     */
    stopScheduledCleanup(): void {
      const taskName = this.getTaskName();

      if (this._initialTimeoutId) {
        clearTimeout(this._initialTimeoutId);
        this._initialTimeoutId = null;
      }

      if (this._cleanupIntervalId) {
        clearInterval(this._cleanupIntervalId);
        this._cleanupIntervalId = null;
        this.log.info(`${taskName} scheduler stopped`);
      }
    }

    /**
     * Run the scheduled task with error handling.
     * @internal
     */
    async _runWithErrorHandling(): Promise<void> {
      try {
        await this.runScheduledTask();
      } catch (error) {
        this.log.error(`Scheduled ${this.getTaskName()} failed`, error as Error);
      }
    }

    async initialize(): Promise<void> {
      this.startScheduledCleanup();
    }

    async dispose(): Promise<void> {
      this.stopScheduledCleanup();
      await super.dispose();
    }
  }

  return ScheduledCleanupClass;
}
