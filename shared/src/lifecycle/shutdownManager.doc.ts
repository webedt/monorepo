/**
 * Shutdown Manager Interface Documentation
 *
 * The ShutdownManager coordinates graceful shutdown of all background services
 * with support for priority-based ordering and timeout handling.
 */

/**
 * Priority levels for shutdown handlers.
 * Lower numbers execute first during shutdown.
 */
export enum ShutdownPriority {
  /** Stop accepting new work (reject new requests) */
  STOP_ACCEPTING = 100,
  /** Stop background sync and periodic tasks */
  STOP_BACKGROUND = 200,
  /** Notify clients of shutdown (SSE broadcasters) */
  NOTIFY_CLIENTS = 300,
  /** Close active connections */
  CLOSE_CONNECTIONS = 400,
  /** Drain in-flight requests */
  DRAIN_REQUESTS = 500,
  /** Cleanup caches and temporary resources */
  CLEANUP = 600,
  /** Close database connections (must be last) */
  CLOSE_DATABASE = 900,
}

/**
 * A service that can be registered for graceful shutdown.
 */
export interface IShutdownHandler {
  /**
   * Unique name for this handler (used for logging and debugging)
   */
  readonly name: string;

  /**
   * Priority level determining shutdown order.
   * Lower values execute first. Use ShutdownPriority enum values.
   * Default: ShutdownPriority.CLEANUP (600)
   */
  readonly priority?: number;

  /**
   * Perform graceful shutdown of this service.
   * Should clean up intervals, close connections, and release resources.
   *
   * @returns Promise that resolves when shutdown is complete
   */
  shutdown(): Promise<void>;
}

/**
 * Result of a shutdown operation
 */
export interface ShutdownResult {
  /** Whether all handlers completed successfully */
  success: boolean;
  /** Total time taken for shutdown in milliseconds */
  durationMs: number;
  /** Number of handlers that completed successfully */
  successCount: number;
  /** Number of handlers that failed */
  failureCount: number;
  /** Number of handlers that timed out */
  timeoutCount: number;
  /** Details for each handler */
  handlers: HandlerResult[];
}

/**
 * Result of shutting down a single handler
 */
export interface HandlerResult {
  name: string;
  priority: number;
  success: boolean;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
}

/**
 * Configuration for the shutdown manager
 */
export interface ShutdownManagerConfig {
  /**
   * Maximum time to wait for all handlers to complete (in milliseconds).
   * Default: 30000 (30 seconds)
   */
  totalTimeoutMs?: number;

  /**
   * Maximum time to wait for a single handler (in milliseconds).
   * Default: 5000 (5 seconds)
   */
  handlerTimeoutMs?: number;

  /**
   * Whether to continue with remaining handlers if one fails.
   * Default: true
   */
  continueOnError?: boolean;
}

/**
 * Statistics about registered handlers
 */
export interface ShutdownManagerStats {
  /** Number of registered handlers */
  handlerCount: number;
  /** Handler names grouped by priority */
  handlersByPriority: Record<number, string[]>;
  /** Whether shutdown is in progress */
  isShuttingDown: boolean;
  /** Time when shutdown started (if in progress) */
  shutdownStartTime: Date | null;
}

/**
 * Interface for ShutdownManager documentation.
 * The ShutdownManager coordinates orderly shutdown of all background services.
 */
export interface IShutdownManagerDocumentation {
  /**
   * Register a service for graceful shutdown.
   * Services are shut down in priority order (lowest first).
   *
   * @param handler - The shutdown handler to register
   */
  register(handler: IShutdownHandler): void;

  /**
   * Unregister a service from shutdown handling.
   *
   * @param name - Name of the handler to unregister
   * @returns true if handler was found and removed
   */
  unregister(name: string): boolean;

  /**
   * Execute graceful shutdown of all registered handlers.
   * Handlers are executed in priority order (lowest priority first).
   *
   * @param reason - Reason for shutdown (for logging)
   * @param config - Optional configuration overrides
   * @returns Result of the shutdown operation
   */
  shutdown(reason: string, config?: ShutdownManagerConfig): Promise<ShutdownResult>;

  /**
   * Check if shutdown is in progress.
   *
   * @returns true if shutdown has been initiated
   */
  isShuttingDown(): boolean;

  /**
   * Get statistics about registered handlers.
   *
   * @returns Statistics about the shutdown manager state
   */
  getStats(): ShutdownManagerStats;

  /**
   * Clear all registered handlers (primarily for testing).
   */
  reset(): void;
}
