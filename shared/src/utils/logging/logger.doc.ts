/**
 * Logger Documentation Interface
 *
 * This file contains the fully-documented interface for the Logger service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ALogger for the abstract base class
 * @see Logger for the concrete implementation
 */

/**
 * Context metadata attached to log entries.
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
 * Interface for Logger with full documentation.
 *
 * A structured logging utility that provides consistent log formatting
 * across all WebEDT services. Logs are captured in memory for remote viewing
 * via the `/api/logs` endpoint.
 *
 * ## Features
 *
 * - **Structured context** - Attach component, session, provider metadata
 * - **Log levels** - debug, info, warn, error with appropriate console methods
 * - **Automatic capture** - All logs stored for remote viewing via API
 * - **Timestamp formatting** - ISO 8601 timestamps for easy parsing
 *
 * ## Log Format
 *
 * ```
 * 2025-01-15T10:30:00.000Z INFO  [component=auth, session=abc12345] User logged in
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { logger } from '@webedt/shared';
 *
 * // Simple logging
 * logger.info('Server started');
 * logger.warn('Rate limit approaching');
 *
 * // With context
 * logger.info('Session created', {
 *   component: 'execute',
 *   sessionId: 'session_abc123',
 *   provider: 'claude-remote',
 * });
 *
 * // Error with exception
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logger.error('Operation failed', error, { component: 'worker' });
 * }
 * ```
 *
 * ## Environment Variables
 *
 * - `LOG_LEVEL=debug` - Enable debug-level logging (disabled by default)
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
   *
   * @example
   * ```typescript
   * logger.debug('Cache hit', { component: 'storage', key: 'user:123' });
   * ```
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Log an info message.
   *
   * Info messages are always output and captured.
   *
   * @param message - The message to log
   * @param context - Optional context metadata
   *
   * @example
   * ```typescript
   * logger.info('Session created', { sessionId: 'sess_123' });
   * ```
   */
  info(message: string, context?: LogContext): void;

  /**
   * Log a warning message.
   *
   * Warnings indicate potential issues that don't prevent operation.
   *
   * @param message - The message to log
   * @param context - Optional context metadata
   *
   * @example
   * ```typescript
   * logger.warn('Rate limit approaching', { remaining: 10 });
   * ```
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Log an error message.
   *
   * Errors indicate failures that need attention. Can include an exception
   * for additional context. Stack traces are shown when `LOG_LEVEL=debug`.
   *
   * @param message - The message to log
   * @param error - Optional error/exception object
   * @param context - Optional context metadata
   *
   * @example
   * ```typescript
   * // Simple error
   * logger.error('Database connection failed');
   *
   * // Error with exception
   * try {
   *   await db.connect();
   * } catch (err) {
   *   logger.error('Database connection failed', err, { component: 'db' });
   * }
   * ```
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void;
}
