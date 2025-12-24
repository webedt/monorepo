/**
 * Abstract Log Capture Service
 *
 * Base class for in-memory log capture for debugging and remote viewing.
 *
 * @see LogCapture for the concrete implementation
 */
import { AService } from '../../services/abstracts/AService.js';

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
 * Abstract log capture service.
 *
 * Initialize order is -90 to ensure it's ready before other services
 * start logging.
 */
export abstract class ALogCapture extends AService {
  override readonly order: number = -90;

  /**
   * Capture a log entry.
   */
  abstract capture(
    level: CapturedLog['level'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown
  ): void;

  /**
   * Get logs with optional filtering.
   */
  abstract getLogs(filter?: LogFilter): {
    logs: CapturedLog[];
    total: number;
    filtered: number;
  };

  /**
   * Clear all captured logs.
   */
  abstract clear(): void;

  /**
   * Set maximum number of logs to retain.
   */
  abstract setMaxLogs(max: number): void;

  /**
   * Enable or disable log capture.
   */
  abstract setEnabled(enabled: boolean): void;

  /**
   * Get capture status.
   */
  abstract getStatus(): LogCaptureStatus;
}
