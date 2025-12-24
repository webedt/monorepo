/**
 * Abstract Logger Service
 *
 * Base class for structured logging services. Initializes first to ensure
 * other services can log during their initialization.
 *
 * @see Logger for the concrete implementation
 */
import { AService } from '../../services/abstracts/AService.js';

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
 * Abstract logger service.
 *
 * Provides leveled logging with structured context. Initialize order is -100
 * to ensure logging is available before other services initialize.
 */
export abstract class ALogger extends AService {
  override readonly order: number = -100; // Initialize first - other services need logging

  /**
   * Log a debug message.
   */
  abstract debug(message: string, context?: LogContext): void;

  /**
   * Log an info message.
   */
  abstract info(message: string, context?: LogContext): void;

  /**
   * Log a warning message.
   */
  abstract warn(message: string, context?: LogContext): void;

  /**
   * Log an error message.
   */
  abstract error(message: string, error?: Error | unknown, context?: LogContext): void;
}
