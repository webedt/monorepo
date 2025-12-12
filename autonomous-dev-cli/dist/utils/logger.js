import chalk from 'chalk';
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