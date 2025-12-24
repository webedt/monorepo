/**
 * Log Capture Documentation Interface
 *
 * This file contains the fully-documented interface for the Log Capture service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ALogCapture for the abstract base class
 * @see LogCapture for the concrete implementation
 */

/**
 * A captured log entry.
 */
export interface CapturedLog {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Log severity level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Log message */
  message: string;
  /** Optional context metadata */
  context?: Record<string, unknown>;
  /** Optional error details */
  error?: {
    message: string;
    stack?: string;
  };
}

/**
 * Filter options for retrieving logs.
 */
export interface LogFilter {
  /** Filter by log level */
  level?: string;
  /** Filter by component name */
  component?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Only logs after this ISO timestamp */
  since?: string;
  /** Maximum logs to return (default: 100, max: 1000) */
  limit?: number;
}

/**
 * Log capture status.
 */
export interface LogCaptureStatus {
  /** Whether capture is enabled */
  enabled: boolean;
  /** Current number of captured logs */
  count: number;
  /** Maximum logs to retain */
  maxLogs: number;
}

/**
 * Interface for Log Capture with full documentation.
 *
 * An in-memory log capture service for debugging and remote viewing.
 * Captures logs in a circular buffer for retrieval via API.
 *
 * ## Features
 *
 * - **Circular buffer** - Automatically removes oldest logs when limit reached
 * - **Filtering** - Query logs by level, component, session, or time range
 * - **Remote viewing** - Logs accessible via `/api/logs` endpoint
 *
 * ## Usage
 *
 * ```typescript
 * import { logCapture } from '@webedt/shared';
 *
 * // Capture is automatic via logger, but can be called directly
 * logCapture.capture('info', 'Manual log entry', { component: 'test' });
 *
 * // Get recent logs
 * const { logs, total } = logCapture.getLogs({ limit: 50 });
 *
 * // Get filtered logs
 * const errors = logCapture.getLogs({ level: 'error', limit: 20 });
 *
 * // Clear logs
 * logCapture.clear();
 * ```
 */
export interface ILogCapture {
  /**
   * Capture a log entry.
   *
   * Adds a log entry to the circular buffer. Oldest entries are removed
   * when the buffer exceeds `maxLogs`.
   *
   * @param level - Log severity level
   * @param message - Log message
   * @param context - Optional context metadata
   * @param error - Optional error object
   *
   * @example
   * ```typescript
   * logCapture.capture('error', 'Request failed', { component: 'api' }, err);
   * ```
   */
  capture(
    level: CapturedLog['level'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown
  ): void;

  /**
   * Get logs with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Object with logs array, total count, and filtered count
   *
   * @example
   * ```typescript
   * // Get last 100 logs (default)
   * const { logs } = logCapture.getLogs();
   *
   * // Get errors from a specific component
   * const { logs } = logCapture.getLogs({
   *   level: 'error',
   *   component: 'auth',
   *   limit: 50
   * });
   *
   * // Get logs since a timestamp
   * const { logs } = logCapture.getLogs({
   *   since: '2025-01-15T10:00:00.000Z'
   * });
   * ```
   */
  getLogs(filter?: LogFilter): {
    logs: CapturedLog[];
    total: number;
    filtered: number;
  };

  /**
   * Clear all captured logs.
   *
   * @example
   * ```typescript
   * logCapture.clear();
   * ```
   */
  clear(): void;

  /**
   * Set maximum number of logs to retain.
   *
   * If current log count exceeds the new limit, oldest logs are removed.
   *
   * @param max - Maximum logs to retain
   *
   * @example
   * ```typescript
   * logCapture.setMaxLogs(10000);
   * ```
   */
  setMaxLogs(max: number): void;

  /**
   * Enable or disable log capture.
   *
   * When disabled, new logs are not captured but existing logs are preserved.
   *
   * @param enabled - Whether to capture logs
   *
   * @example
   * ```typescript
   * // Disable capture for performance
   * logCapture.setEnabled(false);
   * ```
   */
  setEnabled(enabled: boolean): void;

  /**
   * Get capture status.
   *
   * @returns Current capture status
   *
   * @example
   * ```typescript
   * const status = logCapture.getStatus();
   * console.log(`Captured ${status.count} of ${status.maxLogs} logs`);
   * ```
   */
  getStatus(): LogCaptureStatus;
}
