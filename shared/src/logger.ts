/**
 * Simple structured logger for WebEDT services
 */

import { logCapture } from './logCapture.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  component?: string;
  sessionId?: string;
  provider?: string;
  [key: string]: unknown;
}

class Logger {
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

  debug(message: string, context?: LogContext): void {
    logCapture.capture('debug', message, context);
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    logCapture.capture('info', message, context);
    console.log(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    logCapture.capture('warn', message, context);
    console.warn(this.formatMessage('warn', message, context));
  }

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

export const logger = new Logger();
export type { LogContext };
