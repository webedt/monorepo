import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
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
