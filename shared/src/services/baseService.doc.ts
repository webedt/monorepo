/**
 * Base Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Base Service mixin.
 * The BaseService function adds common infrastructure to any abstract service class,
 * providing logging, transaction handling, error management, and lifecycle utilities.
 *
 * @see BaseService for the mixin function
 * @see ScheduledCleanupService for the scheduled task mixin
 * @see AService for the fundamental service base class
 */

import type { TransactionContext, TransactionOptions } from '../db/index.js';

/**
 * Result type for operations that can succeed or fail.
 *
 * A standardized result type for service operations, providing
 * consistent success/failure reporting with optional data.
 *
 * @example
 * ```typescript
 * async deleteSession(id: string): Promise<OperationResult> {
 *   try {
 *     await this.withTransaction(async (tx) => {
 *       await tx.delete(sessions).where(eq(sessions.id, id));
 *     });
 *     return { success: true, message: 'Session deleted' };
 *   } catch (error) {
 *     return this.handleError(error, 'deleteSession', { id });
 *   }
 * }
 * ```
 */
export interface OperationResult<T = void> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Human-readable result message */
  message: string;
  /** Optional result data (only on success) */
  data?: T;
  /** Error message (only on failure) */
  error?: string;
}

/**
 * Result type for bulk operations with aggregated stats.
 *
 * Reports success/failure counts when processing multiple items,
 * allowing partial success scenarios.
 *
 * @example
 * ```typescript
 * const result = await service.deleteMultipleSessions(sessionIds);
 * console.log(`Deleted ${result.successCount} of ${sessionIds.length}`);
 * if (result.failureCount > 0) {
 *   const failed = result.results.filter(r => !r.success);
 *   console.log('Failed:', failed.map(r => r.error));
 * }
 * ```
 */
export interface BulkOperationResult<T> {
  /** Number of successfully processed items */
  successCount: number;
  /** Number of failed items */
  failureCount: number;
  /** Individual results for each item */
  results: T[];
}

/**
 * Configuration for scheduled tasks.
 *
 * Defines timing parameters for background cleanup or maintenance tasks.
 *
 * @example
 * ```typescript
 * getScheduledTaskConfig(): ScheduledTaskConfig {
 *   return {
 *     enabled: process.env.CLEANUP_ENABLED === 'true',
 *     intervalMs: 60 * 60 * 1000, // 1 hour
 *     initialDelayMs: 5 * 60 * 1000, // 5 minutes
 *   };
 * }
 * ```
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
 *
 * Provides logging methods that automatically include the component name.
 */
export interface ComponentLogger {
  /** Log a debug message */
  debug(message: string, extra?: Record<string, unknown>): void;
  /** Log an info message */
  info(message: string, extra?: Record<string, unknown>): void;
  /** Log a warning message */
  warn(message: string, extra?: Record<string, unknown>): void;
  /** Log an error message with optional error object */
  error(message: string, error?: Error | unknown, extra?: Record<string, unknown>): void;
}

/**
 * Interface for BaseService mixin with full documentation.
 *
 * The BaseService mixin adds common service infrastructure to any abstract
 * service class. It provides:
 *
 * - **Auto-initialized logger**: Logger with component name context
 * - **Transaction helpers**: Database operations with retry logic
 * - **Error handling**: Consistent error reporting and logging
 * - **Bulk operations**: Process multiple items with error aggregation
 * - **Lifecycle management**: Shutdown handler registration
 *
 * ## Usage Pattern
 *
 * Create a service by extending BaseService with your abstract class:
 *
 * ```typescript
 * // 1. Define abstract service interface
 * export abstract class ASessionManager extends AService {
 *   abstract deleteSession(id: string): Promise<OperationResult>;
 *   abstract archiveSessions(ids: string[]): Promise<BulkOperationResult<OperationResult>>;
 * }
 *
 * // 2. Implement using BaseService mixin
 * export class SessionManager extends BaseService(ASessionManager) {
 *   async deleteSession(id: string): Promise<OperationResult> {
 *     try {
 *       await this.withTransaction(async (tx) => {
 *         await tx.delete(sessions).where(eq(sessions.id, id));
 *       });
 *       return this.successResult('Session deleted');
 *     } catch (error) {
 *       return this.handleError(error, 'deleteSession', { id });
 *     }
 *   }
 *
 *   async archiveSessions(ids: string[]): Promise<BulkOperationResult<OperationResult>> {
 *     return this.executeBulkOperation(
 *       ids,
 *       (id) => this.archiveSession(id),
 *       { operationName: 'archive sessions' }
 *     );
 *   }
 * }
 *
 * // 3. Register with ServiceProvider
 * ServiceProvider.register(ASessionManager, new SessionManager());
 * ```
 *
 * ## Logger Auto-Initialization
 *
 * The `log` property is automatically initialized with the class name as context:
 *
 * ```typescript
 * class MyService extends BaseService(AMyService) {
 *   async doSomething(): Promise<void> {
 *     this.log.info('Starting operation');
 *     // Logs: [MyService] Starting operation
 *
 *     this.log.error('Operation failed', error, { userId: '123' });
 *     // Logs: [MyService] Operation failed { userId: '123', error: ... }
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Complete service implementation example
 * export class UserService extends BaseService(AUserService) {
 *   readonly order = 10; // Initialize after database
 *
 *   async initialize(): Promise<void> {
 *     this.log.info('UserService initializing');
 *
 *     // Register cleanup handler
 *     this.onShutdown(async () => {
 *       this.log.info('Flushing user cache...');
 *       await this.flushCache();
 *     });
 *   }
 *
 *   async createUser(email: string): Promise<OperationResult<User>> {
 *     try {
 *       const user = await this.withTransaction(async (tx) => {
 *         const [created] = await tx
 *           .insert(users)
 *           .values({ email })
 *           .returning();
 *         return created;
 *       });
 *
 *       this.log.info('User created', { userId: user.id });
 *       return this.successResult('User created', user);
 *     } catch (error) {
 *       return this.handleError(error, 'createUser', { email });
 *     }
 *   }
 *
 *   async deleteUsers(ids: string[]): Promise<BulkOperationResult<OperationResult>> {
 *     return this.executeBulkOperation(
 *       ids,
 *       (id) => this.deleteUser(id),
 *       { operationName: 'delete users' }
 *     );
 *   }
 * }
 * ```
 */
export interface IBaseServiceDocumentation {
  /**
   * Component-scoped logger with automatic context enrichment.
   *
   * Automatically includes the class name as the component in all log messages.
   * Initialized in the constructor based on `this.constructor.name`.
   *
   * @example
   * ```typescript
   * class SessionCleanup extends BaseService(ASessionCleanup) {
   *   async cleanup(): Promise<void> {
   *     this.log.info('Starting cleanup');
   *     // Output: [SessionCleanup] Starting cleanup
   *
   *     this.log.debug('Processing batch', { size: 100 });
   *     // Output: [SessionCleanup] Processing batch { component: 'SessionCleanup', size: 100 }
   *   }
   * }
   * ```
   */
  readonly log: ComponentLogger;

  /**
   * Component name used for logging and metrics.
   *
   * Set to the concrete class name (from `this.constructor.name`).
   *
   * @example
   * ```typescript
   * class MyService extends BaseService(AMyService) {
   *   showName(): void {
   *     console.log(this.componentName); // "MyService"
   *   }
   * }
   * ```
   */
  readonly componentName: string;

  /**
   * Execute a database operation within a transaction with automatic retry.
   *
   * Wraps the operation in a database transaction with retry logic for
   * transient failures (deadlocks, connection issues).
   *
   * @param operation - The database operation to execute
   * @param options - Transaction options including retry config
   * @returns The result of the operation
   * @throws The original error if the transaction fails after all retries
   *
   * @example
   * ```typescript
   * // Simple transaction
   * const result = await this.withTransaction(async (tx) => {
   *   await tx.delete(events).where(eq(events.sessionId, id));
   *   await tx.delete(messages).where(eq(messages.sessionId, id));
   *   return { deleted: true };
   * });
   * ```
   *
   * @example
   * ```typescript
   * // With context for debugging
   * const result = await this.withTransaction(
   *   async (tx) => {
   *     const [session] = await tx
   *       .update(sessions)
   *       .set({ status: 'completed' })
   *       .where(eq(sessions.id, id))
   *       .returning();
   *     return session;
   *   },
   *   {
   *     context: { operation: 'completeSession', sessionId: id },
   *     maxRetries: 3,
   *   }
   * );
   * ```
   */
  withTransaction<R>(
    operation: (tx: TransactionContext) => Promise<R>,
    options?: TransactionOptions
  ): Promise<R>;

  /**
   * Execute a bulk operation on multiple items with error aggregation.
   *
   * Processes each item individually, collecting results and counting
   * successes/failures. Allows partial success where some items fail
   * while others succeed.
   *
   * Note: Items are processed sequentially to ensure graceful error handling.
   *
   * @param items - Array of items to process
   * @param processor - Async function to process each item
   * @param options - Optional configuration for logging
   * @returns Aggregated results with success/failure counts
   *
   * @example
   * ```typescript
   * // Delete multiple sessions
   * const result = await this.executeBulkOperation(
   *   sessionIds,
   *   (id) => this.deleteSession(id),
   *   { operationName: 'deleteSession' }
   * );
   *
   * console.log(`Deleted: ${result.successCount}`);
   * console.log(`Failed: ${result.failureCount}`);
   *
   * // Process individual results
   * result.results.forEach((r, i) => {
   *   if (!r.success) {
   *     console.log(`Session ${sessionIds[i]} failed: ${r.error}`);
   *   }
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Archive with custom processor
   * const result = await this.executeBulkOperation(
   *   files,
   *   async (file) => {
   *     try {
   *       await archiveFile(file.path);
   *       return { success: true, message: 'Archived' };
   *     } catch (error) {
   *       return { success: false, message: this.getErrorMessage(error) };
   *     }
   *   },
   *   { operationName: 'archive files' }
   * );
   * // Logs: Bulk archive files completed: 8 succeeded, 2 failed
   * ```
   */
  executeBulkOperation<TItem, TResult extends { success: boolean }>(
    items: TItem[],
    processor: (item: TItem) => Promise<TResult>,
    options?: { operationName?: string }
  ): Promise<BulkOperationResult<TResult>>;

  /**
   * Extract error message from unknown error type.
   *
   * Safely handles Error instances and unknown types by extracting
   * the message or returning a default.
   *
   * @param error - The error to extract message from
   * @returns A string error message
   *
   * @example
   * ```typescript
   * try {
   *   await riskyOperation();
   * } catch (error) {
   *   const message = this.getErrorMessage(error);
   *   console.log(`Failed: ${message}`);
   * }
   * ```
   */
  getErrorMessage(error: unknown): string;

  /**
   * Handle an error with consistent logging and context enrichment.
   *
   * Logs the error with context and returns a standardized failure result.
   * Use this in catch blocks for consistent error reporting.
   *
   * @param error - The error that occurred
   * @param operation - Name of the operation that failed
   * @param context - Additional context to log
   * @returns A standardized OperationResult with error details
   *
   * @example
   * ```typescript
   * async deleteSession(id: string): Promise<OperationResult> {
   *   try {
   *     await this.withTransaction(/* ... *\/);
   *     return this.successResult('Session deleted');
   *   } catch (error) {
   *     return this.handleError(error, 'deleteSession', { sessionId: id });
   *     // Logs: [ServiceName] Failed to deleteSession { sessionId: '...' }
   *     // Returns: { success: false, message: '...', error: '...' }
   *   }
   * }
   * ```
   */
  handleError(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): OperationResult;

  /**
   * Create a successful operation result.
   *
   * Helper for creating consistent success responses.
   *
   * @param message - Success message
   * @param data - Optional data to include
   * @returns A standardized OperationResult
   *
   * @example
   * ```typescript
   * return this.successResult('User created', { id: user.id });
   * // Returns: { success: true, message: 'User created', data: { id: '...' } }
   * ```
   */
  successResult<TData>(message: string, data?: TData): OperationResult<TData>;

  /**
   * Create a failed operation result.
   *
   * Helper for creating consistent failure responses without throwing.
   *
   * @param message - Error message
   * @returns A standardized OperationResult
   *
   * @example
   * ```typescript
   * if (!session) {
   *   return this.failureResult('Session not found');
   *   // Returns: { success: false, message: 'Session not found', error: '...' }
   * }
   * ```
   */
  failureResult(message: string): OperationResult;

  /**
   * Register a handler to be called during shutdown/dispose.
   *
   * Handlers are called in registration order during `dispose()`.
   * Use this to register cleanup callbacks in `initialize()`.
   *
   * @param handler - Async function to call during shutdown
   *
   * @example
   * ```typescript
   * async initialize(): Promise<void> {
   *   // Start background task
   *   const interval = setInterval(() => this.syncData(), 60000);
   *
   *   // Register cleanup
   *   this.onShutdown(() => {
   *     clearInterval(interval);
   *   });
   *
   *   // Another cleanup with async operation
   *   this.onShutdown(async () => {
   *     await this.flushPendingWrites();
   *   });
   * }
   * ```
   */
  onShutdown(handler: () => Promise<void> | void): void;

  /**
   * Default dispose implementation that calls all registered shutdown handlers.
   *
   * Subclasses can override but should call `super.dispose()` to ensure cleanup.
   *
   * @example
   * ```typescript
   * async dispose(): Promise<void> {
   *   // Custom cleanup
   *   await this.closeConnections();
   *
   *   // Call base to run shutdown handlers
   *   await super.dispose();
   * }
   * ```
   */
  dispose(): Promise<void>;
}

/**
 * Interface for ScheduledCleanupService mixin with full documentation.
 *
 * Extends BaseService with infrastructure for scheduled background tasks.
 * Use this for services that need to run periodic cleanup or maintenance.
 *
 * ## Usage Pattern
 *
 * ```typescript
 * class SessionCleanupService extends ScheduledCleanupService(ASessionCleanupService) {
 *   getScheduledTaskConfig(): ScheduledTaskConfig {
 *     return {
 *       enabled: process.env.CLEANUP_ENABLED === 'true',
 *       intervalMs: 60 * 60 * 1000, // 1 hour
 *       initialDelayMs: 5 * 60 * 1000, // 5 minutes
 *     };
 *   }
 *
 *   getTaskName(): string {
 *     return 'session cleanup';
 *   }
 *
 *   async runScheduledTask(): Promise<void> {
 *     const orphans = await this.findOrphanSessions();
 *     for (const session of orphans) {
 *       await this.cleanupSession(session.id);
 *     }
 *   }
 * }
 * ```
 *
 * The task automatically:
 * - Starts on `initialize()` after initial delay
 * - Runs periodically at the configured interval
 * - Handles errors without crashing
 * - Stops on `dispose()`
 */
export interface IScheduledCleanupServiceDocumentation extends IBaseServiceDocumentation {
  /**
   * Get the configuration for this scheduled task.
   *
   * Override to provide service-specific configuration.
   *
   * @returns Task configuration with enable flag and timing
   *
   * @example
   * ```typescript
   * getScheduledTaskConfig(): ScheduledTaskConfig {
   *   return {
   *     enabled: config.trashCleanupEnabled,
   *     intervalMs: config.trashCleanupIntervalMs,
   *     initialDelayMs: config.trashCleanupInitialDelayMs,
   *   };
   * }
   * ```
   */
  getScheduledTaskConfig(): ScheduledTaskConfig;

  /**
   * The task to run on schedule.
   *
   * Override to implement the actual cleanup/maintenance logic.
   * Errors are caught and logged, won't stop the scheduler.
   *
   * @example
   * ```typescript
   * async runScheduledTask(): Promise<void> {
   *   this.log.info('Running scheduled cleanup');
   *
   *   const staleItems = await this.findStale();
   *   const result = await this.executeBulkOperation(
   *     staleItems,
   *     (item) => this.cleanup(item),
   *     { operationName: 'cleanup' }
   *   );
   *
   *   this.log.info('Cleanup complete', {
   *     processed: staleItems.length,
   *     success: result.successCount,
   *     failed: result.failureCount,
   *   });
   * }
   * ```
   */
  runScheduledTask(): Promise<void>;

  /**
   * Get a human-readable name for this task (for logging).
   *
   * Override to provide a descriptive name.
   *
   * @returns Task name for log messages
   *
   * @example
   * ```typescript
   * getTaskName(): string {
   *   return 'orphan session cleanup';
   * }
   * // Logs: "Starting orphan session cleanup scheduler..."
   * // Logs: "orphan session cleanup is disabled"
   * ```
   */
  getTaskName(): string;

  /**
   * Get additional config to log when starting the scheduler.
   *
   * Override to add service-specific config values.
   *
   * @returns Additional config for logging
   *
   * @example
   * ```typescript
   * getSchedulerLogConfig(): Record<string, unknown> {
   *   return {
   *     retentionDays: this.config.retentionDays,
   *     batchSize: this.config.batchSize,
   *   };
   * }
   * ```
   */
  getSchedulerLogConfig(): Record<string, unknown>;

  /**
   * Start the scheduled cleanup task.
   *
   * Called automatically from `initialize()`. Can be called manually
   * if you need to start after custom initialization.
   *
   * @example
   * ```typescript
   * async initialize(): Promise<void> {
   *   await this.loadConfig();
   *   this.startScheduledCleanup(); // Start after config loaded
   * }
   * ```
   */
  startScheduledCleanup(): void;

  /**
   * Stop the scheduled cleanup task.
   *
   * Called automatically from `dispose()`. Can be called manually
   * to pause the scheduler.
   *
   * @example
   * ```typescript
   * async pauseForMaintenance(): Promise<void> {
   *   this.stopScheduledCleanup();
   *   await this.runMaintenance();
   *   this.startScheduledCleanup();
   * }
   * ```
   */
  stopScheduledCleanup(): void;
}
