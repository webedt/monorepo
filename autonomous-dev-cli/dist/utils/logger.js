import chalk from 'chalk';
import { StructuredError } from './errors.js';
const levelPriority = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
const levelColors = {
    debug: chalk.gray,
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
};
const levelIcons = {
    debug: '🔍',
    info: '📋',
    warn: '⚠️',
    error: '❌',
};
class Logger {
    level;
    prefix;
    constructor(options = { level: 'info' }) {
        this.level = options.level;
        this.prefix = options.prefix || '';
    }
    setLevel(level) {
        this.level = level;
    }
    shouldLog(level) {
        return levelPriority[level] >= levelPriority[this.level];
    }
    formatMessage(level, message, meta) {
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
    debug(message, meta) {
        if (this.shouldLog('debug')) {
            console.log(this.formatMessage('debug', message, meta));
        }
    }
    info(message, meta) {
        if (this.shouldLog('info')) {
            console.log(this.formatMessage('info', message, meta));
        }
    }
    warn(message, meta) {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, meta));
        }
    }
    error(message, meta) {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, meta));
        }
    }
    /**
     * Log a structured error with full context, recovery suggestions, and optional stack trace
     */
    structuredError(error, options = {}) {
        if (!this.shouldLog('error'))
            return;
        const { context, includeStack = false, includeRecovery = true } = options;
        // Merge additional context if provided
        const mergedContext = context ? { ...error.context, ...context } : error.context;
        // Build comprehensive log output
        const timestamp = new Date().toISOString();
        const prefix = this.prefix ? `[${this.prefix}] ` : '';
        const severityColor = this.getSeverityColor(error.severity);
        console.error();
        console.error(chalk.gray(timestamp), levelIcons.error, levelColors.error('ERROR'), prefix, chalk.bold(`[${error.code}]`), error.message);
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
    errorWithContext(message, error, context) {
        if (!this.shouldLog('error'))
            return;
        if (error instanceof StructuredError) {
            this.structuredError(error, { context, includeStack: true, includeRecovery: true });
        }
        else {
            // Convert regular error to structured format for consistent logging
            const timestamp = new Date().toISOString();
            const prefix = this.prefix ? `[${this.prefix}] ` : '';
            console.error();
            console.error(chalk.gray(timestamp), levelIcons.error, levelColors.error('ERROR'), prefix, message);
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
    getSeverityColor(severity) {
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
    success(message) {
        console.log(`${chalk.green('✓')} ${message}`);
    }
    failure(message) {
        console.log(`${chalk.red('✗')} ${message}`);
    }
    step(step, total, message) {
        console.log(`${chalk.cyan(`[${step}/${total}]`)} ${message}`);
    }
    divider() {
        console.log(chalk.gray('─'.repeat(60)));
    }
    header(title) {
        console.log();
        console.log(chalk.bold.cyan(`═══ ${title} ${'═'.repeat(Math.max(0, 50 - title.length))}`));
        console.log();
    }
    // Create a child logger with a prefix
    child(prefix) {
        const child = new Logger({ level: this.level, prefix });
        return child;
    }
}
export const logger = new Logger({ level: 'info' });
//# sourceMappingURL=logger.js.map