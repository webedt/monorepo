import chalk from 'chalk';
import { StructuredError } from './errors.js';
import { randomUUID } from 'crypto';
import { memoryUsage } from 'process';
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
// Global correlation ID for request tracing across components
let globalCorrelationId;
/**
 * Generate a new correlation ID
 */
export function generateCorrelationId() {
    return randomUUID();
}
/**
 * Set the global correlation ID for the current execution context
 */
export function setCorrelationId(id) {
    globalCorrelationId = id;
}
/**
 * Get the current global correlation ID
 */
export function getCorrelationId() {
    return globalCorrelationId;
}
/**
 * Clear the global correlation ID
 */
export function clearCorrelationId() {
    globalCorrelationId = undefined;
}
/**
 * Get current memory usage in megabytes
 */
export function getMemoryUsageMB() {
    const usage = memoryUsage();
    return Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
}
/**
 * Get detailed memory statistics
 */
export function getMemoryStats() {
    const usage = memoryUsage();
    return {
        heapUsedMB: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMB: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
        externalMB: Math.round((usage.external / 1024 / 1024) * 100) / 100,
        rssMB: Math.round((usage.rss / 1024 / 1024) * 100) / 100,
    };
}
/**
 * Time an async operation and return result with timing info
 */
export async function timeOperation(operation, operationName) {
    const startMemory = getMemoryUsageMB();
    const startTime = Date.now();
    try {
        const result = await operation();
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        return {
            result,
            duration,
            memoryDelta: Math.round((endMemory - startMemory) * 100) / 100,
            startMemory,
            endMemory,
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        // Re-throw with timing info attached
        if (error instanceof Error) {
            error.operationDuration = duration;
            error.operationName = operationName;
        }
        throw error;
    }
}
/**
 * Time a synchronous operation and return result with timing info
 */
export function timeOperationSync(operation, operationName) {
    const startMemory = getMemoryUsageMB();
    const startTime = Date.now();
    try {
        const result = operation();
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        return {
            result,
            duration,
            memoryDelta: Math.round((endMemory - startMemory) * 100) / 100,
            startMemory,
            endMemory,
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        if (error instanceof Error) {
            error.operationDuration = duration;
            error.operationName = operationName;
        }
        throw error;
    }
}
/**
 * Create a new operation context for tracing
 */
export function createOperationContext(component, operation, metadata = {}) {
    return {
        correlationId: getCorrelationId() || generateCorrelationId(),
        component,
        operation,
        startTime: Date.now(),
        metadata,
    };
}
/**
 * Finalize an operation context and return performance metrics
 */
export function finalizeOperationContext(context, success, additionalMetadata = {}) {
    const duration = Date.now() - context.startTime;
    const memoryUsageMB = getMemoryUsageMB();
    return {
        correlationId: context.correlationId,
        component: context.component,
        operation: context.operation,
        startTime: context.startTime,
        duration,
        memoryUsageMB,
        success,
        ...context.metadata,
        ...additionalMetadata,
    };
}
class Logger {
    level;
    prefix;
    format;
    correlationId;
    constructor(options = { level: 'info' }) {
        this.level = options.level;
        this.prefix = options.prefix || '';
        this.format = options.format || 'pretty';
        this.correlationId = options.correlationId;
    }
    setLevel(level) {
        this.level = level;
    }
    setFormat(format) {
        this.format = format;
    }
    /**
     * Set the correlation ID for this logger instance
     */
    setCorrelationId(id) {
        this.correlationId = id;
    }
    /**
     * Get the effective correlation ID (instance or global)
     */
    getEffectiveCorrelationId() {
        return this.correlationId || globalCorrelationId;
    }
    shouldLog(level) {
        return levelPriority[level] >= levelPriority[this.level];
    }
    /**
     * Create a structured log entry
     */
    createLogEntry(level, message, meta) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };
        const correlationId = this.getEffectiveCorrelationId();
        if (correlationId) {
            entry.correlationId = correlationId;
        }
        if (this.prefix) {
            entry.component = this.prefix;
        }
        if (meta && Object.keys(meta).length > 0) {
            entry.meta = meta;
        }
        return entry;
    }
    /**
     * Format a log entry as pretty output for terminal
     */
    formatPretty(level, message, meta) {
        const timestamp = new Date().toISOString();
        const icon = levelIcons[level];
        const colorFn = levelColors[level];
        const prefix = this.prefix ? `[${this.prefix}] ` : '';
        const correlationId = this.getEffectiveCorrelationId();
        const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
        let formatted = `${chalk.gray(timestamp)} ${icon} ${colorFn(level.toUpperCase().padEnd(5))} ${prefix}${message}${correlationStr}`;
        if (meta && Object.keys(meta).length > 0) {
            formatted += ` ${chalk.gray(JSON.stringify(meta))}`;
        }
        return formatted;
    }
    /**
     * Format a log entry as JSON
     */
    formatJson(entry) {
        return JSON.stringify(entry);
    }
    /**
     * Write a log entry to output
     */
    writeLog(level, message, meta) {
        if (this.format === 'json') {
            const entry = this.createLogEntry(level, message, meta);
            const output = level === 'error' ? console.error : console.log;
            output(this.formatJson(entry));
        }
        else {
            const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            output(this.formatPretty(level, message, meta));
        }
    }
    debug(message, meta) {
        if (this.shouldLog('debug')) {
            this.writeLog('debug', message, meta);
        }
    }
    info(message, meta) {
        if (this.shouldLog('info')) {
            this.writeLog('info', message, meta);
        }
    }
    warn(message, meta) {
        if (this.shouldLog('warn')) {
            this.writeLog('warn', message, meta);
        }
    }
    error(message, meta) {
        if (this.shouldLog('error')) {
            this.writeLog('error', message, meta);
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
        if (this.format === 'json') {
            const entry = this.createLogEntry('error', error.message);
            entry.error = {
                code: error.code,
                message: error.message,
                severity: error.severity,
                isRetryable: error.isRetryable,
                context: mergedContext,
            };
            if (includeStack && error.stack) {
                entry.error.stack = error.stack;
            }
            if (includeRecovery && error.recoveryActions.length > 0) {
                entry.error.recoveryActions = error.recoveryActions;
            }
            if (error.cause) {
                entry.error.cause = error.cause.message;
            }
            console.error(this.formatJson(entry));
            return;
        }
        // Pretty format
        const timestamp = new Date().toISOString();
        const prefix = this.prefix ? `[${this.prefix}] ` : '';
        const severityColor = this.getSeverityColor(error.severity);
        const correlationId = this.getEffectiveCorrelationId();
        const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
        console.error();
        console.error(chalk.gray(timestamp), levelIcons.error, levelColors.error('ERROR'), prefix, chalk.bold(`[${error.code}]`), error.message, correlationStr);
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
            if (this.format === 'json') {
                const entry = this.createLogEntry('error', message);
                entry.error = {
                    message: error.message,
                    stack: error.stack,
                    context,
                };
                console.error(this.formatJson(entry));
                return;
            }
            // Pretty format
            const timestamp = new Date().toISOString();
            const prefix = this.prefix ? `[${this.prefix}] ` : '';
            const correlationId = this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            console.error();
            console.error(chalk.gray(timestamp), levelIcons.error, levelColors.error('ERROR'), prefix, message, correlationStr);
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
    // Special formatted outputs (only in pretty mode)
    success(message) {
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', message);
            entry.meta = { status: 'success' };
            console.log(this.formatJson(entry));
        }
        else {
            console.log(`${chalk.green('✓')} ${message}`);
        }
    }
    failure(message) {
        if (this.format === 'json') {
            const entry = this.createLogEntry('error', message);
            entry.meta = { status: 'failure' };
            console.log(this.formatJson(entry));
        }
        else {
            console.log(`${chalk.red('✗')} ${message}`);
        }
    }
    step(step, total, message) {
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', message);
            entry.meta = { step, total };
            console.log(this.formatJson(entry));
        }
        else {
            console.log(`${chalk.cyan(`[${step}/${total}]`)} ${message}`);
        }
    }
    divider() {
        if (this.format !== 'json') {
            console.log(chalk.gray('─'.repeat(60)));
        }
    }
    /**
     * Log service degradation event
     */
    degraded(service, message, meta) {
        if (!this.shouldLog('warn'))
            return;
        if (this.format === 'json') {
            const entry = this.createLogEntry('warn', message);
            entry.meta = { ...meta, service, degraded: true };
            console.log(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const correlationId = this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            console.warn(chalk.gray(timestamp), chalk.yellow('⚡'), chalk.yellow('DEGRADED'), chalk.bold(`[${service}]`), message, correlationStr);
            if (meta && Object.keys(meta).length > 0) {
                console.warn(chalk.gray(`  ${JSON.stringify(meta)}`));
            }
        }
    }
    /**
     * Log service recovery event
     */
    recovered(service, message, meta) {
        if (!this.shouldLog('info'))
            return;
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', message);
            entry.meta = { ...meta, service, recovered: true };
            console.log(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const correlationId = this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            console.log(chalk.gray(timestamp), chalk.green('✓'), chalk.green('RECOVERED'), chalk.bold(`[${service}]`), message, correlationStr);
            if (meta && Object.keys(meta).length > 0) {
                console.log(chalk.gray(`  ${JSON.stringify(meta)}`));
            }
        }
    }
    /**
     * Log service health status
     */
    serviceStatus(service, status, details) {
        if (!this.shouldLog('info'))
            return;
        const statusColors = {
            healthy: chalk.green,
            degraded: chalk.yellow,
            unavailable: chalk.red,
        };
        const statusIcons = {
            healthy: '🟢',
            degraded: '🟡',
            unavailable: '🔴',
        };
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', `${service} status: ${status}`);
            entry.meta = { service, status, ...details };
            console.log(this.formatJson(entry));
        }
        else {
            const colorFn = statusColors[status] || chalk.white;
            const icon = statusIcons[status] || '⚪';
            console.log(`${icon} ${chalk.bold(service)}: ${colorFn(status)}`);
            if (details && Object.keys(details).length > 0) {
                for (const [key, value] of Object.entries(details)) {
                    console.log(chalk.gray(`   ${key}: ${JSON.stringify(value)}`));
                }
            }
        }
    }
    /**
     * Log an operation completion with timing and memory metrics
     */
    operationComplete(component, operation, success, metadata) {
        if (!this.shouldLog('info'))
            return;
        const level = success ? 'info' : 'error';
        const message = `${operation} ${success ? 'completed' : 'failed'}`;
        if (this.format === 'json') {
            const entry = this.createLogEntry(level, message);
            entry.meta = {
                type: 'operation',
                component,
                operation,
                success,
                ...metadata,
            };
            const output = level === 'error' ? console.error : console.log;
            output(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const icon = success ? '✓' : '✗';
            const colorFn = success ? chalk.green : chalk.red;
            const correlationId = metadata.correlationId || this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            const durationStr = metadata.duration ? chalk.cyan(`${metadata.duration}ms`) : '';
            const memoryStr = metadata.memoryUsageMB ? chalk.gray(`${metadata.memoryUsageMB}MB`) : '';
            const metricsStr = [durationStr, memoryStr].filter(Boolean).join(' | ');
            console.log(chalk.gray(timestamp), colorFn(icon), chalk.bold(`[${component}]`), message, metricsStr ? `(${metricsStr})` : '', correlationStr);
        }
    }
    /**
     * Log an API call with request/response details
     */
    apiCall(service, endpoint, method, metadata) {
        if (!this.shouldLog('debug'))
            return;
        const level = metadata.success ? 'debug' : 'warn';
        const message = `${method} ${endpoint}`;
        if (this.format === 'json') {
            const entry = this.createLogEntry(level, message);
            entry.meta = {
                type: 'api_call',
                service,
                endpoint,
                method,
                ...metadata,
            };
            const output = level === 'warn' ? console.warn : console.log;
            output(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const icon = metadata.success ? '→' : '✗';
            const colorFn = metadata.success ? chalk.cyan : chalk.red;
            const correlationId = metadata.correlationId || this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            const statusStr = metadata.statusCode ? `[${metadata.statusCode}]` : '';
            const durationStr = metadata.duration ? `${metadata.duration}ms` : '';
            const output = metadata.success ? console.log : console.warn;
            output(chalk.gray(timestamp), colorFn(icon), chalk.bold(`[${service}]`), message, statusStr, durationStr ? chalk.gray(durationStr) : '', correlationStr);
            if (metadata.error) {
                output(chalk.red(`  Error: ${metadata.error}`));
            }
        }
    }
    /**
     * Log memory usage snapshot
     */
    memorySnapshot(component, context) {
        if (!this.shouldLog('debug'))
            return;
        const stats = getMemoryStats();
        const message = context ? `Memory snapshot: ${context}` : 'Memory snapshot';
        if (this.format === 'json') {
            const entry = this.createLogEntry('debug', message);
            entry.meta = {
                type: 'memory_snapshot',
                component,
                ...stats,
            };
            console.log(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const correlationId = this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            console.log(chalk.gray(timestamp), chalk.magenta('📊'), chalk.bold(`[${component}]`), message, chalk.gray(`heap: ${stats.heapUsedMB}/${stats.heapTotalMB}MB, rss: ${stats.rssMB}MB`), correlationStr);
        }
    }
    /**
     * Log performance metrics for a batch of operations
     */
    performanceSummary(component, metrics) {
        if (!this.shouldLog('info'))
            return;
        const successRate = metrics.totalOperations > 0
            ? Math.round((metrics.successCount / metrics.totalOperations) * 100)
            : 0;
        const message = `Performance summary: ${metrics.totalOperations} operations, ${successRate}% success rate`;
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', message);
            entry.meta = {
                type: 'performance_summary',
                component,
                ...metrics,
                successRate,
            };
            console.log(this.formatJson(entry));
        }
        else {
            const timestamp = new Date().toISOString();
            const correlationId = this.getEffectiveCorrelationId();
            const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';
            console.log(chalk.gray(timestamp), chalk.cyan('📈'), chalk.bold(`[${component}]`), 'Performance Summary', correlationStr);
            console.log(chalk.gray(`  Total: ${metrics.totalOperations} ops`));
            console.log(chalk.green(`  Success: ${metrics.successCount}`), chalk.red(`Failures: ${metrics.failureCount}`));
            console.log(chalk.gray(`  Duration: ${metrics.totalDuration}ms total, ${metrics.averageDuration}ms avg`));
            console.log(chalk.gray(`  Memory: ${metrics.memoryUsageMB}MB`));
        }
    }
    header(title) {
        if (this.format === 'json') {
            const entry = this.createLogEntry('info', title);
            entry.meta = { type: 'header' };
            console.log(this.formatJson(entry));
        }
        else {
            console.log();
            console.log(chalk.bold.cyan(`═══ ${title} ${'═'.repeat(Math.max(0, 50 - title.length))}`));
            console.log();
        }
    }
    /**
     * Create a child logger with a prefix and optionally inherit correlation ID
     */
    child(prefix) {
        const child = new Logger({
            level: this.level,
            prefix,
            format: this.format,
            correlationId: this.correlationId,
        });
        return child;
    }
    /**
     * Create a child logger with a specific correlation ID for request tracing
     */
    withCorrelationId(correlationId) {
        const child = new Logger({
            level: this.level,
            prefix: this.prefix,
            format: this.format,
            correlationId,
        });
        return child;
    }
    /**
     * Get the current log entry as a structured object (for testing/inspection)
     */
    getLogEntry(level, message, meta) {
        return this.createLogEntry(level, message, meta);
    }
}
export const logger = new Logger({ level: 'info' });
//# sourceMappingURL=logger.js.map