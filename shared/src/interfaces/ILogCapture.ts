/**
 * Interface for Log Capture
 *
 * Defines the contract for in-memory log capture for debugging.
 * Captures logs in a circular buffer for retrieval via API.
 *
 * @see LogCapture for the implementation
 * @module interfaces/ILogCapture
 */

/**
 * A captured log entry.
 */
export interface CapturedLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
  };
}

/**
 * Filter options for retrieving logs.
 */
export interface LogFilter {
  level?: string;
  component?: string;
  sessionId?: string;
  since?: string;
  limit?: number;
}

/**
 * Log capture status.
 */
export interface LogCaptureStatus {
  enabled: boolean;
  count: number;
  maxLogs: number;
}

/**
 * Log capture interface for in-memory log storage.
 *
 * @example
 * ```typescript
 * const capture: ILogCapture = getLogCapture();
 *
 * capture.capture('info', 'Server started', { port: 3000 });
 *
 * const { logs, total } = capture.getLogs({ level: 'error', limit: 50 });
 * ```
 */
export interface ILogCapture {
  /**
   * Capture a log entry.
   *
   * @param level - Log level
   * @param message - Log message
   * @param context - Optional context metadata
   * @param error - Optional error object
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
   */
  getLogs(filter?: LogFilter): {
    logs: CapturedLog[];
    total: number;
    filtered: number;
  };

  /**
   * Clear all captured logs.
   */
  clear(): void;

  /**
   * Set maximum number of logs to retain.
   *
   * @param max - Maximum log count
   */
  setMaxLogs(max: number): void;

  /**
   * Enable or disable log capture.
   *
   * @param enabled - Whether capture is enabled
   */
  setEnabled(enabled: boolean): void;

  /**
   * Get capture status.
   *
   * @returns Status with enabled flag, count, and max
   */
  getStatus(): LogCaptureStatus;
}
