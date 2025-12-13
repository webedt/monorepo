import { StructuredError, type ErrorContext } from './errors.js';
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
declare class Logger {
    private level;
    private prefix;
    constructor(options?: LoggerOptions);
    setLevel(level: LogLevel): void;
    private shouldLog;
    private formatMessage;
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
    child(prefix: string): Logger;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map