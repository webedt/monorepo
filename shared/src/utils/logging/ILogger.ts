/**
 * Interface for Structured Logger
 *
 * Defines the contract for a structured logging utility that provides
 * consistent log formatting across all services.
 *
 * @see Logger for the implementation
 * @module interfaces/ILogger
 */

/**
 * Context metadata attached to log entries.
 *
 * Standard fields are formatted specially in log output.
 * Additional fields are included as key=value pairs.
 */
export interface LogContext {
  /** Service component name (e.g., 'auth', 'execute', 'storage') */
  component?: string;
  /** Session identifier (displayed truncated to 8 chars) */
  sessionId?: string;
  /** AI provider name (e.g., 'claude-remote', 'codex') */
  provider?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Structured logger interface.
 *
 * Provides leveled logging with structured context and automatic capture
 * for remote viewing.
 *
 * @example
 * ```typescript
 * const logger: ILogger = getLogger();
 *
 * logger.info('Operation started');
 * logger.error('Operation failed', error, { component: 'worker' });
 * ```
 */
export interface ILogger {
  /**
   * Log a debug message.
   *
   * Debug messages are only output when `LOG_LEVEL=debug` is set.
   * They are always captured for remote viewing.
   *
   * @param message - The message to log
   * @param context - Optional context metadata
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Log an info message.
   *
   * Info messages are always output and captured.
   *
   * @param message - The message to log
   * @param context - Optional context metadata
   */
  info(message: string, context?: LogContext): void;

  /**
   * Log a warning message.
   *
   * Warnings indicate potential issues that don't prevent operation.
   *
   * @param message - The message to log
   * @param context - Optional context metadata
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Log an error message.
   *
   * Errors indicate failures that need attention.
   *
   * @param message - The message to log
   * @param error - Optional error/exception object
   * @param context - Optional context metadata
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void;
}
