import chalk from 'chalk';
import { StructuredError } from './errors.js';
import { randomUUID } from 'crypto';
import { memoryUsage } from 'process';
/**
 * Default timing threshold in ms for logging slow operations
 * Operations exceeding this threshold will be automatically logged
 */
export const DEFAULT_TIMING_THRESHOLD_MS = 100;
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
// Global correlation context for request tracing across components
let globalCorrelationContext;
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
    if (globalCorrelationContext) {
        globalCorrelationContext.correlationId = id;
    }
    else {
        globalCorrelationContext = { correlationId: id };
    }
}
/**
 * Get the current global correlation ID
 */
export function getCorrelationId() {
    return globalCorrelationContext?.correlationId;
}
/**
 * Clear the global correlation ID
 */
export function clearCorrelationId() {
    globalCorrelationContext = undefined;
}
/**
 * Set the full global correlation context (including cycle number and worker ID)
 */
export function setCorrelationContext(context) {
    globalCorrelationContext = context;
}
/**
 * Get the current global correlation context
 */
export function getCorrelationContext() {
    return globalCorrelationContext;
}
/**
 * Update the global correlation context with additional fields
 */
export function updateCorrelationContext(updates) {
    if (globalCorrelationContext) {
        globalCorrelationContext = { ...globalCorrelationContext, ...updates };
    }
    else if (updates.correlationId) {
        globalCorrelationContext = { correlationId: updates.correlationId, ...updates };
    }
}
/**
 * Set the cycle number in the global correlation context
 */
export function setCycleNumber(cycleNumber) {
    if (globalCorrelationContext) {
        globalCorrelationContext.cycleNumber = cycleNumber;
    }
}
/**
 * Get the current cycle number from the global correlation context
 */
export function getCycleNumber() {
    return globalCorrelationContext?.cycleNumber;
}
/**
 * Set the worker ID in the global correlation context
 */
export function setWorkerId(workerId) {
    if (globalCorrelationContext) {
        globalCorrelationContext.workerId = workerId;
    }
}
/**
 * Get the current worker ID from the global correlation context
 */
export function getWorkerId() {
    return globalCorrelationContext?.workerId;
}
// Request lifecycle tracking for end-to-end tracing
const requestLifecycles = new Map();
/**
 * Start tracking a request lifecycle
 */
export function startRequestLifecycle(correlationId) {
    const lifecycle = {
        correlationId,
        startTime: Date.now(),
        phases: new Map(),
    };
    requestLifecycles.set(correlationId, lifecycle);
    return lifecycle;
}
/**
 * Start a phase in the request lifecycle
 */
export function startPhase(correlationId, phase, metadata = {}) {
    const lifecycle = requestLifecycles.get(correlationId);
    if (!lifecycle) {
        // Auto-create lifecycle if not exists
        startRequestLifecycle(correlationId);
    }
    const phaseMetrics = {
        phase,
        startTime: Date.now(),
        operationCount: 0,
        errorCount: 0,
        metadata,
    };
    requestLifecycles.get(correlationId)?.phases.set(phase, phaseMetrics);
    return phaseMetrics;
}
/**
 * End a phase in the request lifecycle
 */
export function endPhase(correlationId, phase, success, additionalMetadata = {}) {
    const lifecycle = requestLifecycles.get(correlationId);
    const phaseMetrics = lifecycle?.phases.get(phase);
    if (phaseMetrics) {
        phaseMetrics.endTime = Date.now();
        phaseMetrics.duration = phaseMetrics.endTime - phaseMetrics.startTime;
        phaseMetrics.success = success;
        phaseMetrics.metadata = { ...phaseMetrics.metadata, ...additionalMetadata };
        // Log slow phases automatically
        if (phaseMetrics.duration > DEFAULT_TIMING_THRESHOLD_MS) {
            logger.debug(`Slow phase detected: ${phase}`, {
                phase,
                duration: phaseMetrics.duration,
                threshold: DEFAULT_TIMING_THRESHOLD_MS,
                correlationId,
                success,
            });
        }
    }
    return phaseMetrics;
}
/**
 * Record an operation within a phase
 */
export function recordPhaseOperation(correlationId, phase, operationName) {
    const lifecycle = requestLifecycles.get(correlationId);
    const phaseMetrics = lifecycle?.phases.get(phase);
    if (phaseMetrics) {
        phaseMetrics.operationCount++;
    }
}
/**
 * Record an error within a phase
 */
export function recordPhaseError(correlationId, phase, errorCode) {
    const lifecycle = requestLifecycles.get(correlationId);
    const phaseMetrics = lifecycle?.phases.get(phase);
    if (phaseMetrics) {
        phaseMetrics.errorCount++;
        if (errorCode) {
            phaseMetrics.metadata.lastErrorCode = errorCode;
        }
    }
}
/**
 * End the request lifecycle and return summary
 */
export function endRequestLifecycle(correlationId, success, errorCode) {
    const lifecycle = requestLifecycles.get(correlationId);
    if (lifecycle) {
        lifecycle.totalDuration = Date.now() - lifecycle.startTime;
        lifecycle.success = success;
        lifecycle.errorCode = errorCode;
        // Log lifecycle summary
        const phaseSummary = {};
        lifecycle.phases.forEach((metrics, phase) => {
            phaseSummary[phase] = {
                duration: metrics.duration || 0,
                success: metrics.success || false,
                operations: metrics.operationCount,
                errors: metrics.errorCount,
            };
        });
        logger.info('Request lifecycle completed', {
            correlationId,
            totalDuration: lifecycle.totalDuration,
            success,
            errorCode,
            phases: phaseSummary,
        });
        // Clean up after logging
        requestLifecycles.delete(correlationId);
    }
    return lifecycle;
}
/**
 * Get the current request lifecycle for a correlation ID
 */
export function getRequestLifecycle(correlationId) {
    return requestLifecycles.get(correlationId);
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
 * Automatically logs operations that exceed the timing threshold
 */
export async function timeOperation(operation, operationNameOrOptions) {
    const options = typeof operationNameOrOptions === 'string'
        ? { operationName: operationNameOrOptions }
        : operationNameOrOptions || {};
    const { operationName, component, phase, timingThreshold = DEFAULT_TIMING_THRESHOLD_MS, logSlowOperations = true, metadata = {}, } = options;
    const startMemory = getMemoryUsageMB();
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    // Record operation in phase if tracking
    if (correlationId && phase && operationName) {
        recordPhaseOperation(correlationId, phase, operationName);
    }
    try {
        const result = await operation();
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;
        // Log slow operations automatically
        if (logSlowOperations && duration > timingThreshold) {
            logger.debug(`Slow operation: ${operationName || 'unnamed'}`, {
                operation: operationName,
                component,
                phase,
                duration,
                threshold: timingThreshold,
                memoryDeltaMB: memoryDelta,
                correlationId,
                ...metadata,
            });
        }
        return {
            result,
            duration,
            memoryDelta,
            startMemory,
            endMemory,
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        // Record error in phase tracking
        if (correlationId && phase) {
            const errorCode = error instanceof StructuredError ? error.code : undefined;
            recordPhaseError(correlationId, phase, errorCode);
        }
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
 * Automatically logs operations that exceed the timing threshold
 */
export function timeOperationSync(operation, operationNameOrOptions) {
    const options = typeof operationNameOrOptions === 'string'
        ? { operationName: operationNameOrOptions }
        : operationNameOrOptions || {};
    const { operationName, component, phase, timingThreshold = DEFAULT_TIMING_THRESHOLD_MS, logSlowOperations = true, metadata = {}, } = options;
    const startMemory = getMemoryUsageMB();
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    // Record operation in phase if tracking
    if (correlationId && phase && operationName) {
        recordPhaseOperation(correlationId, phase, operationName);
    }
    try {
        const result = operation();
        const duration = Date.now() - startTime;
        const endMemory = getMemoryUsageMB();
        const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;
        // Log slow operations automatically
        if (logSlowOperations && duration > timingThreshold) {
            logger.debug(`Slow operation: ${operationName || 'unnamed'}`, {
                operation: operationName,
                component,
                phase,
                duration,
                threshold: timingThreshold,
                memoryDeltaMB: memoryDelta,
                correlationId,
                ...metadata,
            });
        }
        return {
            result,
            duration,
            memoryDelta,
            startMemory,
            endMemory,
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        // Record error in phase tracking
        if (correlationId && phase) {
            const errorCode = error instanceof StructuredError ? error.code : undefined;
            recordPhaseError(correlationId, phase, errorCode);
        }
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
    cycleNumber;
    workerId;
    includeCorrelationId;
    includeTimestamp;
    constructor(options = { level: 'info' }) {
        this.level = options.level;
        this.prefix = options.prefix || '';
        this.format = options.format || 'pretty';
        this.correlationId = options.correlationId;
        this.cycleNumber = options.cycleNumber;
        this.workerId = options.workerId;
        this.includeCorrelationId = options.includeCorrelationId ?? true;
        this.includeTimestamp = options.includeTimestamp ?? true;
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
     * Set the cycle number for this logger instance
     */
    setCycleNumber(cycleNumber) {
        this.cycleNumber = cycleNumber;
    }
    /**
     * Set the worker ID for this logger instance
     */
    setWorkerId(workerId) {
        this.workerId = workerId;
    }
    /**
     * Configure whether to include correlation ID in logs
     */
    setIncludeCorrelationId(include) {
        this.includeCorrelationId = include;
    }
    /**
     * Configure whether to include timestamp in logs
     */
    setIncludeTimestamp(include) {
        this.includeTimestamp = include;
    }
    /**
     * Get the effective correlation ID (instance or global)
     */
    getEffectiveCorrelationId() {
        if (!this.includeCorrelationId)
            return undefined;
        return this.correlationId || globalCorrelationContext?.correlationId;
    }
    /**
     * Get the effective cycle number (instance or global)
     */
    getEffectiveCycleNumber() {
        return this.cycleNumber ?? globalCorrelationContext?.cycleNumber;
    }
    /**
     * Get the effective worker ID (instance or global)
     */
    getEffectiveWorkerId() {
        return this.workerId || globalCorrelationContext?.workerId;
    }
    shouldLog(level) {
        return levelPriority[level] >= levelPriority[this.level];
    }
    /**
     * Create a structured log entry
     */
    createLogEntry(level, message, meta) {
        const entry = {
            timestamp: this.includeTimestamp ? new Date().toISOString() : '',
            level,
            message,
        };
        // Remove empty timestamp for cleaner JSON output
        if (!this.includeTimestamp) {
            delete entry.timestamp;
        }
        const correlationId = this.getEffectiveCorrelationId();
        if (correlationId) {
            entry.correlationId = correlationId;
        }
        if (this.prefix) {
            entry.component = this.prefix;
        }
        const cycleNumber = this.getEffectiveCycleNumber();
        if (cycleNumber !== undefined) {
            entry.cycleNumber = cycleNumber;
        }
        const workerId = this.getEffectiveWorkerId();
        if (workerId) {
            entry.workerId = workerId;
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
        const timestamp = this.includeTimestamp ? new Date().toISOString() : '';
        const icon = levelIcons[level];
        const colorFn = levelColors[level];
        const prefix = this.prefix ? `[${this.prefix}] ` : '';
        const correlationId = this.getEffectiveCorrelationId();
        const cycleNumber = this.getEffectiveCycleNumber();
        const workerId = this.getEffectiveWorkerId();
        // Build context string with cycle, worker, and correlation info
        const contextParts = [];
        if (cycleNumber !== undefined) {
            contextParts.push(`c${cycleNumber}`);
        }
        if (workerId) {
            contextParts.push(workerId);
        }
        if (correlationId) {
            contextParts.push(correlationId.slice(0, 8));
        }
        const contextStr = contextParts.length > 0 ? chalk.gray(` [${contextParts.join(':')}]`) : '';
        const timestampStr = timestamp ? `${chalk.gray(timestamp)} ` : '';
        let formatted = `${timestampStr}${icon} ${colorFn(level.toUpperCase().padEnd(5))} ${prefix}${message}${contextStr}`;
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
     * Create a child logger with a prefix and optionally inherit correlation context
     */
    child(prefix) {
        const child = new Logger({
            level: this.level,
            prefix,
            format: this.format,
            correlationId: this.correlationId,
            cycleNumber: this.cycleNumber,
            workerId: this.workerId,
            includeCorrelationId: this.includeCorrelationId,
            includeTimestamp: this.includeTimestamp,
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
            cycleNumber: this.cycleNumber,
            workerId: this.workerId,
            includeCorrelationId: this.includeCorrelationId,
            includeTimestamp: this.includeTimestamp,
        });
        return child;
    }
    /**
     * Create a child logger with a specific worker ID for worker context tracking
     */
    withWorkerId(workerId) {
        const child = new Logger({
            level: this.level,
            prefix: this.prefix,
            format: this.format,
            correlationId: this.correlationId,
            cycleNumber: this.cycleNumber,
            workerId,
            includeCorrelationId: this.includeCorrelationId,
            includeTimestamp: this.includeTimestamp,
        });
        return child;
    }
    /**
     * Create a child logger with a specific cycle number for cycle context tracking
     */
    withCycleNumber(cycleNumber) {
        const child = new Logger({
            level: this.level,
            prefix: this.prefix,
            format: this.format,
            correlationId: this.correlationId,
            cycleNumber,
            workerId: this.workerId,
            includeCorrelationId: this.includeCorrelationId,
            includeTimestamp: this.includeTimestamp,
        });
        return child;
    }
    /**
     * Create a child logger with full correlation context
     */
    withContext(context) {
        const child = new Logger({
            level: this.level,
            prefix: this.prefix,
            format: this.format,
            correlationId: context.correlationId ?? this.correlationId,
            cycleNumber: context.cycleNumber ?? this.cycleNumber,
            workerId: context.workerId ?? this.workerId,
            includeCorrelationId: this.includeCorrelationId,
            includeTimestamp: this.includeTimestamp,
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
/**
 * Claude execution history logger for debugging failed attempts
 */
export class ClaudeExecutionLogger {
    correlationId;
    taskId;
    attempts = [];
    currentAttempt = null;
    log;
    constructor(correlationId, taskId) {
        this.correlationId = correlationId;
        this.taskId = taskId;
        this.log = logger.child('ClaudeExecutionLogger').withCorrelationId(correlationId);
    }
    /**
     * Start a new execution attempt
     */
    startAttempt(attemptNumber) {
        this.currentAttempt = {
            attemptNumber,
            startTime: new Date().toISOString(),
            success: false,
            toolUseCount: 0,
            turnCount: 0,
            conversationHistory: [],
        };
        this.log.debug(`Starting Claude execution attempt ${attemptNumber}`, {
            taskId: this.taskId,
            attemptNumber,
        });
    }
    /**
     * Record a message in the conversation history
     */
    recordMessage(role, type, content, metadata) {
        if (!this.currentAttempt)
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            role,
            type,
            content: this.truncateContent(content),
            metadata,
        };
        this.currentAttempt.conversationHistory.push(entry);
        // Track tool use and turn counts
        if (type === 'tool_use') {
            this.currentAttempt.toolUseCount++;
        }
        if (role === 'assistant' && type === 'message') {
            this.currentAttempt.turnCount++;
        }
    }
    /**
     * Record tool use
     */
    recordToolUse(toolName, input) {
        this.recordMessage('assistant', 'tool_use', toolName, {
            tool: toolName,
            inputSummary: input ? this.summarizeInput(input) : undefined,
        });
    }
    /**
     * Record tool result
     */
    recordToolResult(toolName, success, output) {
        this.recordMessage('tool', 'tool_result', output ? this.truncateContent(output) : '', {
            tool: toolName,
            success,
        });
    }
    /**
     * Record assistant text response
     */
    recordAssistantText(text) {
        this.recordMessage('assistant', 'message', text);
    }
    /**
     * Record an error in the current attempt
     */
    recordError(code, message, isRetryable) {
        if (!this.currentAttempt)
            return;
        this.currentAttempt.error = { code, message, isRetryable };
        this.recordMessage('system', 'error', message, { code, isRetryable });
        this.log.warn(`Claude execution error in attempt ${this.currentAttempt.attemptNumber}`, {
            taskId: this.taskId,
            attemptNumber: this.currentAttempt.attemptNumber,
            errorCode: code,
            errorMessage: message,
            isRetryable,
        });
    }
    /**
     * Record a timeout in the current attempt
     */
    recordTimeout(timeoutMs) {
        if (!this.currentAttempt)
            return;
        this.recordMessage('system', 'timeout', `Execution timed out after ${timeoutMs}ms`, {
            timeoutMs,
        });
        this.currentAttempt.error = {
            code: 'CLAUDE_TIMEOUT',
            message: `Execution timed out after ${Math.round(timeoutMs / 1000)}s`,
            isRetryable: true,
        };
        this.log.warn(`Claude execution timeout in attempt ${this.currentAttempt.attemptNumber}`, {
            taskId: this.taskId,
            attemptNumber: this.currentAttempt.attemptNumber,
            timeoutMs,
        });
    }
    /**
     * End the current attempt
     */
    endAttempt(success) {
        if (!this.currentAttempt)
            return;
        this.currentAttempt.endTime = new Date().toISOString();
        this.currentAttempt.durationMs = new Date(this.currentAttempt.endTime).getTime() -
            new Date(this.currentAttempt.startTime).getTime();
        this.currentAttempt.success = success;
        this.attempts.push(this.currentAttempt);
        this.log.info(`Claude execution attempt ${this.currentAttempt.attemptNumber} ${success ? 'succeeded' : 'failed'}`, {
            taskId: this.taskId,
            attemptNumber: this.currentAttempt.attemptNumber,
            durationMs: this.currentAttempt.durationMs,
            toolUseCount: this.currentAttempt.toolUseCount,
            turnCount: this.currentAttempt.turnCount,
            success,
            errorCode: this.currentAttempt.error?.code,
        });
        this.currentAttempt = null;
    }
    /**
     * Get all execution attempts for debugging
     */
    getAttempts() {
        return [...this.attempts];
    }
    /**
     * Get a summary of all attempts for logging
     */
    getSummary() {
        const totalAttempts = this.attempts.length;
        const successfulAttempts = this.attempts.filter(a => a.success).length;
        const totalDurationMs = this.attempts.reduce((sum, a) => sum + (a.durationMs || 0), 0);
        const totalToolUses = this.attempts.reduce((sum, a) => sum + a.toolUseCount, 0);
        const totalTurns = this.attempts.reduce((sum, a) => sum + a.turnCount, 0);
        const lastFailedAttempt = this.attempts.filter(a => !a.success).pop();
        return {
            totalAttempts,
            successfulAttempts,
            totalDurationMs,
            totalToolUses,
            totalTurns,
            lastError: lastFailedAttempt?.error,
        };
    }
    /**
     * Log the full execution history for debugging
     */
    logFullHistory(level = 'debug') {
        const summary = this.getSummary();
        this.log[level]('Claude execution history', {
            taskId: this.taskId,
            correlationId: this.correlationId,
            summary,
        });
        // In debug mode, log each attempt's conversation history
        if (level === 'debug') {
            for (const attempt of this.attempts) {
                this.log.debug(`Attempt ${attempt.attemptNumber} conversation history`, {
                    attemptNumber: attempt.attemptNumber,
                    startTime: attempt.startTime,
                    endTime: attempt.endTime,
                    durationMs: attempt.durationMs,
                    success: attempt.success,
                    toolUseCount: attempt.toolUseCount,
                    turnCount: attempt.turnCount,
                    error: attempt.error,
                    conversationLength: attempt.conversationHistory.length,
                });
            }
        }
    }
    /**
     * Truncate content for logging
     */
    truncateContent(content, maxLength = 500) {
        if (content.length <= maxLength)
            return content;
        return content.slice(0, maxLength) + `... (${content.length} chars total)`;
    }
    /**
     * Summarize tool input for logging
     */
    summarizeInput(input) {
        const summary = {};
        for (const [key, value] of Object.entries(input)) {
            if (typeof value === 'string') {
                summary[key] = value.length > 100 ? `${value.slice(0, 100)}...` : value;
            }
            else if (value !== undefined && value !== null) {
                summary[key] = typeof value;
            }
        }
        return summary;
    }
}
//# sourceMappingURL=logger.js.map