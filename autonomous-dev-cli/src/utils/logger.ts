import chalk from 'chalk';
import { StructuredError, type ErrorContext, formatError } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
}

interface ErrorLogOptions {
  context?: ErrorContext;
  includeStack?: boolean;
  includeRecovery?: boolean;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const levelColors: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
};

const levelIcons: Record<LogLevel, string> = {
  debug: '🔍',
  info: '📋',
  warn: '⚠️',
  error: '❌',
};

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = { level: 'info' }) {
    this.level = options.level;
    this.prefix = options.prefix || '';
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return levelPriority[level] >= levelPriority[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: object): string {
    const timestamp = new Date().toISOString();
    const icon = levelIcons[level];
    const colorFn = levelColors[level];
    const prefix = this.prefix ? `[${this.prefix}] ` : '';

    let formatted = `${chalk.gray(timestamp)} ${icon} ${colorFn(level.toUpperCase().padEnd(5))} ${prefix}${message}`;

    if (meta && Object.keys(meta).length > 0) {
      formatted += ` ${chalk.gray(JSON.stringify(meta))}`;
    }

    return formatted;
  }

  debug(message: string, meta?: object): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: object): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: object): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: object): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }

  /**
   * Log a structured error with full context, recovery suggestions, and optional stack trace
   */
  structuredError(error: StructuredError, options: ErrorLogOptions = {}): void {
    if (!this.shouldLog('error')) return;

    const { context, includeStack = false, includeRecovery = true } = options;

    // Merge additional context if provided
    const mergedContext = context ? { ...error.context, ...context } : error.context;

    // Build comprehensive log output
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const severityColor = this.getSeverityColor(error.severity);

    console.error();
    console.error(
      chalk.gray(timestamp),
      levelIcons.error,
      levelColors.error('ERROR'),
      prefix,
      chalk.bold(`[${error.code}]`),
      error.message
    );
    console.error(chalk.gray('  Severity:'), severityColor(error.severity));
    console.error(chalk.gray('  Retryable:'), error.isRetryable ? chalk.green('yes') : chalk.red('no'));

    // Log context details
    if (Object.keys(mergedContext).length > 0) {
      console.error(chalk.gray('  Context:'));
      for (const [key, value] of Object.entries(mergedContext)) {
        if (value !== undefined && key !== 'timestamp') {
          const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
          console.error(chalk.gray(`    ${key}:`), displayValue);
        }
      }
    }

    // Log recovery suggestions
    if (includeRecovery && error.recoveryActions.length > 0) {
      console.error(chalk.yellow('  Recovery suggestions:'));
      for (const action of error.recoveryActions) {
        const actionType = action.automatic ? chalk.cyan('(auto)') : chalk.magenta('(manual)');
        console.error(`    ${actionType} ${action.description}`);
      }
    }

    // Log stack trace if requested
    if (includeStack && error.stack) {
      console.error(chalk.gray('  Stack trace:'));
      const stackLines = error.stack.split('\n').slice(1);
      for (const line of stackLines.slice(0, 5)) {
        console.error(chalk.gray(`  ${line}`));
      }
      if (stackLines.length > 5) {
        console.error(chalk.gray(`    ... ${stackLines.length - 5} more lines`));
      }
    }

    // Log cause chain if present
    if (error.cause) {
      console.error(chalk.gray('  Caused by:'), error.cause.message);
    }

    console.error();
  }

  /**
   * Log error with full context for debugging (includes config, system state)
   */
  errorWithContext(
    message: string,
    error: Error | StructuredError,
    context: ErrorContext
  ): void {
    if (!this.shouldLog('error')) return;

    if (error instanceof StructuredError) {
      this.structuredError(error, { context, includeStack: true, includeRecovery: true });
    } else {
      // Convert regular error to structured format for consistent logging
      const timestamp = new Date().toISOString();
      const prefix = this.prefix ? `[${this.prefix}] ` : '';

      console.error();
      console.error(
        chalk.gray(timestamp),
        levelIcons.error,
        levelColors.error('ERROR'),
        prefix,
        message
      );
      console.error(chalk.gray('  Error:'), error.message);

      if (Object.keys(context).length > 0) {
        console.error(chalk.gray('  Context:'));
        for (const [key, value] of Object.entries(context)) {
          if (value !== undefined) {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            console.error(chalk.gray(`    ${key}:`), displayValue);
          }
        }
      }

      if (error.stack) {
        console.error(chalk.gray('  Stack trace:'));
        const stackLines = error.stack.split('\n').slice(1, 4);
        for (const line of stackLines) {
          console.error(chalk.gray(`  ${line}`));
        }
      }

      console.error();
    }
  }

  private getSeverityColor(severity: string): (text: string) => string {
    switch (severity) {
      case 'critical':
        return chalk.red.bold;
      case 'error':
        return chalk.red;
      case 'warning':
        return chalk.yellow;
      case 'transient':
        return chalk.cyan;
      default:
        return chalk.white;
    }
  }

  // Special formatted outputs
  success(message: string): void {
    console.log(`${chalk.green('✓')} ${message}`);
  }

  failure(message: string): void {
    console.log(`${chalk.red('✗')} ${message}`);
  }

  step(step: number, total: number, message: string): void {
    console.log(`${chalk.cyan(`[${step}/${total}]`)} ${message}`);
  }

  divider(): void {
    console.log(chalk.gray('─'.repeat(60)));
  }

  header(title: string): void {
    console.log();
    console.log(chalk.bold.cyan(`═══ ${title} ${'═'.repeat(Math.max(0, 50 - title.length))}`));
    console.log();
  }

  // Create a child logger with a prefix
  child(prefix: string): Logger {
    const child = new Logger({ level: this.level, prefix });
    return child;
  }
}

export const logger = new Logger({ level: 'info' });
