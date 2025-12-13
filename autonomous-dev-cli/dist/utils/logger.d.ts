import { StructuredError, type ErrorContext } from './errors.js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'pretty' | 'json';
interface LoggerOptions {
    level: LogLevel;
    prefix?: string;
    format?: LogFormat;
    correlationId?: string;
}
interface ErrorLogOptions {
    context?: ErrorContext;
    includeStack?: boolean;
    includeRecovery?: boolean;
}
/**
 * Structured JSON log entry schema for consistent logging
 */
export interface StructuredLogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    correlationId?: string;
    component?: string;
    meta?: Record<string, any>;
    error?: {
        code?: string;
        message: string;
        severity?: string;
        isRetryable?: boolean;
        stack?: string;
        cause?: string;
        context?: Record<string, any>;
        recoveryActions?: Array<{
            description: string;
            automatic: boolean;
        }>;
    };
}
/**
 * Generate a new correlation ID
 */
export declare function generateCorrelationId(): string;
/**
 * Set the global correlation ID for the current execution context
 */
export declare function setCorrelationId(id: string): void;
/**
 * Get the current global correlation ID
 */
export declare function getCorrelationId(): string | undefined;
/**
 * Clear the global correlation ID
 */
export declare function clearCorrelationId(): void;
declare class Logger {
    private level;
    private prefix;
    private format;
    private correlationId?;
    constructor(options?: LoggerOptions);
    setLevel(level: LogLevel): void;
    setFormat(format: LogFormat): void;
    /**
     * Set the correlation ID for this logger instance
     */
    setCorrelationId(id: string): void;
    /**
     * Get the effective correlation ID (instance or global)
     */
    private getEffectiveCorrelationId;
    private shouldLog;
    /**
     * Create a structured log entry
     */
    private createLogEntry;
    /**
     * Format a log entry as pretty output for terminal
     */
    private formatPretty;
    /**
     * Format a log entry as JSON
     */
    private formatJson;
    /**
     * Write a log entry to output
     */
    private writeLog;
    debug(message: string, meta?: object): void;
    info(message: string, meta?: object): void;
    warn(message: string, meta?: object): void;
    error(message: string, meta?: object): void;
    /**
     * Log a structured error with full context, recovery suggestions, and optional stack trace
     */
    structuredError(error: StructuredError, options?: ErrorLogOptions): void;
    /**
     * Log error with full context for debugging (includes config, system state)
     */
    errorWithContext(message: string, error: Error | StructuredError, context: ErrorContext): void;
    private getSeverityColor;
    success(message: string): void;
    failure(message: string): void;
    step(step: number, total: number, message: string): void;
    divider(): void;
    header(title: string): void;
    /**
     * Create a child logger with a prefix and optionally inherit correlation ID
     */
    child(prefix: string): Logger;
    /**
     * Create a child logger with a specific correlation ID for request tracing
     */
    withCorrelationId(correlationId: string): Logger;
    /**
     * Get the current log entry as a structured object (for testing/inspection)
     */
    getLogEntry(level: LogLevel, message: string, meta?: object): StructuredLogEntry;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map