import { logCapture } from './logCapture.js';
import { ALogger } from './ALogger.js';
import { isVerbose, isDebugLevel, VERBOSE_TIMING, LOG_LEVEL } from '../../config/env.js';
import type { LogContext } from './ALogger.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type { LogContext } from './ALogger.js';

/**
 * Extended context for verbose mode logging
 */
export interface VerboseContext extends LogContext {
  operation?: string;
  durationMs?: number;
  requestId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

class Logger extends ALogger {
  private operationTimers = new Map<string, number>();

  /**
   * Start timing an operation (for verbose mode timing)
   */
  startOperation(operationId: string): void {
    if (VERBOSE_TIMING) {
      this.operationTimers.set(operationId, Date.now());
    }
  }

  /**
   * End timing an operation and return duration
   */
  endOperation(operationId: string): number | undefined {
    if (!VERBOSE_TIMING) return undefined;
    const startTime = this.operationTimers.get(operationId);
    if (startTime) {
      this.operationTimers.delete(operationId);
      return Date.now() - startTime;
    }
    return undefined;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext | VerboseContext
  ): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let contextStr = '';
    if (context) {
      const parts: string[] = [];

      // Standard context fields
      if (context.component) parts.push(`component=${context.component}`);
      if (context.sessionId) parts.push(`session=${String(context.sessionId).substring(0, 8)}`);
      if (context.provider) parts.push(`provider=${context.provider}`);

      // Verbose-specific fields
      const verboseCtx = context as VerboseContext;
      if (verboseCtx.operation) parts.push(`op=${verboseCtx.operation}`);
      if (verboseCtx.durationMs !== undefined) parts.push(`duration=${verboseCtx.durationMs}ms`);
      if (verboseCtx.requestId) parts.push(`reqId=${verboseCtx.requestId.substring(0, 8)}`);
      if (verboseCtx.traceId) parts.push(`trace=${verboseCtx.traceId.substring(0, 8)}`);

      // Other custom fields
      Object.keys(context).forEach(key => {
        if (!['component', 'sessionId', 'provider', 'operation', 'durationMs', 'requestId', 'traceId', 'metadata'].includes(key)) {
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
   * Format verbose metadata for detailed output
   */
  private formatVerboseMetadata(context?: VerboseContext): string {
    if (!isVerbose() || !context?.metadata) return '';
    try {
      return `\n  Metadata: ${JSON.stringify(context.metadata, null, 2).split('\n').join('\n  ')}`;
    } catch {
      return '';
    }
  }

  debug(message: string, context?: LogContext | VerboseContext): void {
    logCapture.capture('debug', message, context);
    if (isDebugLevel() || LOG_LEVEL === 'debug') {
      console.log(this.formatMessage('debug', message, context));
      const verboseData = this.formatVerboseMetadata(context as VerboseContext);
      if (verboseData) console.log(verboseData);
    }
  }

  info(message: string, context?: LogContext | VerboseContext): void {
    logCapture.capture('info', message, context);
    console.log(this.formatMessage('info', message, context));
    if (isVerbose()) {
      const verboseData = this.formatVerboseMetadata(context as VerboseContext);
      if (verboseData) console.log(verboseData);
    }
  }

  warn(message: string, context?: LogContext | VerboseContext): void {
    logCapture.capture('warn', message, context);
    console.warn(this.formatMessage('warn', message, context));
    if (isVerbose()) {
      const verboseData = this.formatVerboseMetadata(context as VerboseContext);
      if (verboseData) console.warn(verboseData);
    }
  }

  error(
    message: string,
    error?: Error | unknown,
    context?: LogContext | VerboseContext
  ): void {
    logCapture.capture('error', message, context, error);
    console.error(this.formatMessage('error', message, context));
    if (error) {
      if (error instanceof Error) {
        console.error(`  Error: ${error.message}`);
        // In verbose mode or debug level, always show stack traces
        if (error.stack && (isVerbose() || isDebugLevel())) {
          console.error(`  Stack: ${error.stack}`);
        }
        // Show cause chain if available (verbose mode)
        if (isVerbose() && (error as any).cause) {
          console.error(`  Cause: ${JSON.stringify((error as any).cause, null, 2)}`);
        }
      } else {
        console.error(`  Details: ${JSON.stringify(error, null, 2)}`);
      }
    }
    if (isVerbose()) {
      const verboseData = this.formatVerboseMetadata(context as VerboseContext);
      if (verboseData) console.error(verboseData);
    }
  }

  /**
   * Log with timing information (verbose mode)
   */
  timed(
    level: LogLevel,
    message: string,
    operationId: string,
    context?: LogContext | VerboseContext
  ): void {
    const durationMs = this.endOperation(operationId);
    const verboseCtx: VerboseContext = {
      ...context,
      durationMs,
    };

    switch (level) {
      case 'debug':
        this.debug(message, verboseCtx);
        break;
      case 'info':
        this.info(message, verboseCtx);
        break;
      case 'warn':
        this.warn(message, verboseCtx);
        break;
      case 'error':
        this.error(message, undefined, verboseCtx);
        break;
    }
  }

  /**
   * Log verbose-only message (only outputs in verbose mode)
   */
  verbose(message: string, context?: VerboseContext): void {
    if (!isVerbose()) return;
    logCapture.capture('debug', `[VERBOSE] ${message}`, context);
    console.log(this.formatMessage('debug', `[VERBOSE] ${message}`, context));
    const verboseData = this.formatVerboseMetadata(context);
    if (verboseData) console.log(verboseData);
  }
}

export const logger: ALogger = new Logger();

// Export the extended logger type for verbose operations
export const verboseLogger = logger as Logger;
