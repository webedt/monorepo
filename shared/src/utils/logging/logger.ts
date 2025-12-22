/**
 * Structured Logger for WebEDT Services
 *
 * A simple, structured logging utility that provides consistent log formatting
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
 *
 * @module logger
 */

import { logCapture } from './logCapture.js';
import type { LogContext as ILogContext } from './ILogger.js';

/**
 * Log severity levels.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Context metadata attached to log entries.
 *
 * Standard fields are formatted specially in log output.
 * Additional fields are included as key=value pairs.
 *
 * @example
 * ```typescript
 * const context: LogContext = {
 *   component: 'execute',     // Service component name
 *   sessionId: 'sess_123',    // Session identifier (truncated to 8 chars)
 *   provider: 'claude-remote', // AI provider name
 *   duration: 1500,           // Custom field: operation duration
 * };
 * ```
 */
interface LogContext {
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
 * Structured logger class.
 *
 * Provides leveled logging with structured context and automatic capture
 * for remote viewing. Use the exported `logger` singleton instance.
 *
 * @see {@link logger} - The singleton instance to use
 */
class Logger {
  /**
   * Format a log message with timestamp, level, and context.
   * @internal
   */
  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let contextStr = '';
    if (context) {
      const parts: string[] = [];
      if (context.component) parts.push(`component=${context.component}`);
      if (context.sessionId) parts.push(`session=${String(context.sessionId).substring(0, 8)}`);
      if (context.provider) parts.push(`provider=${context.provider}`);

      // Add any other context fields
      Object.keys(context).forEach(key => {
        if (!['component', 'sessionId', 'provider'].includes(key)) {
          parts.push(`${key}=${String(context[key])}`);
        }
      });

      if (parts.length > 0) {
        contextStr = ` [${parts.join(', ')}]`;
      }
    }

    return `${timestamp} ${levelStr}${contextStr} ${message}`;
  }

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
  debug(message: string, context?: LogContext): void {
    logCapture.capture('debug', message, context);
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(this.formatMessage('debug', message, context));
    }
  }

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
  info(message: string, context?: LogContext): void {
    logCapture.capture('info', message, context);
    console.log(this.formatMessage('info', message, context));
  }

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
  warn(message: string, context?: LogContext): void {
    logCapture.capture('warn', message, context);
    console.warn(this.formatMessage('warn', message, context));
  }

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
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    logCapture.capture('error', message, context, error);
    console.error(this.formatMessage('error', message, context));
    if (error) {
      if (error instanceof Error) {
        console.error(`  Error: ${error.message}`);
        if (error.stack && process.env.LOG_LEVEL === 'debug') {
          console.error(`  Stack: ${error.stack}`);
        }
      } else {
        console.error(`  Details: ${JSON.stringify(error, null, 2)}`);
      }
    }
  }
}

/**
 * Singleton logger instance.
 *
 * Use this for all logging throughout WebEDT services.
 *
 * @example
 * ```typescript
 * import { logger } from '@webedt/shared';
 *
 * logger.info('Operation started');
 * logger.error('Operation failed', error);
 * ```
 */
export const logger = new Logger();

export type { LogContext };
