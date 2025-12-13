import { StructuredError, type ErrorContext } from './errors.js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/**
 * Default timing threshold in ms for logging slow operations
 * Operations exceeding this threshold will be automatically logged
 */
export declare const DEFAULT_TIMING_THRESHOLD_MS = 100;
/**
 * Request lifecycle phase for tracking request flow
 */
export type RequestPhase = 'discovery' | 'execution' | 'evaluation' | 'github' | 'claude';
/**
 * Request lifecycle tracking for end-to-end tracing
 */
export interface RequestLifecycle {
    correlationId: string;
    startTime: number;
    phases: Map<RequestPhase, PhaseMetrics>;
    totalDuration?: number;
    success?: boolean;
    errorCode?: string;
}
/**
 * Metrics for a specific phase in the request lifecycle
 */
export interface PhaseMetrics {
    phase: RequestPhase;
    startTime: number;
    endTime?: number;
    duration?: number;
    success?: boolean;
    operationCount: number;
    errorCount: number;
    metadata: Record<string, any>;
}
/**
 * Operation metadata for tracking execution context
 */
export interface OperationMetadata {
    correlationId?: string;
    component?: string;
    operation?: string;
    startTime?: number;
    duration?: number;
    memoryUsageMB?: number;
    success?: boolean;
    error?: string;
    phase?: RequestPhase;
    [key: string]: any;
}
/**
 * Timed operation result with metadata
 */
export interface TimedOperationResult<T> {
    result: T;
    duration: number;
    memoryDelta: number;
    startMemory: number;
    endMemory: number;
}
/**
 * Performance metrics for an operation
 */
export interface PerformanceMetrics {
    duration: number;
    memoryUsageMB: number;
    memoryDeltaMB: number;
    timestamp: string;
}
export type LogFormat = 'pretty' | 'json';
interface LoggerOptions {
    level: LogLevel;
    prefix?: string;
    format?: LogFormat;
    correlationId?: string;
    cycleNumber?: number;
    workerId?: string;
    includeCorrelationId?: boolean;
    includeTimestamp?: boolean;
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
    cycleNumber?: number;
    workerId?: string;
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
 * Correlation context for tracking requests across the daemon lifecycle
 */
export interface CorrelationContext {
    correlationId: string;
    cycleNumber?: number;
    workerId?: string;
    component?: string;
    startTime?: number;
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
/**
 * Set the full global correlation context (including cycle number and worker ID)
 */
export declare function setCorrelationContext(context: CorrelationContext): void;
/**
 * Get the current global correlation context
 */
export declare function getCorrelationContext(): CorrelationContext | undefined;
/**
 * Update the global correlation context with additional fields
 */
export declare function updateCorrelationContext(updates: Partial<CorrelationContext>): void;
/**
 * Set the cycle number in the global correlation context
 */
export declare function setCycleNumber(cycleNumber: number): void;
/**
 * Get the current cycle number from the global correlation context
 */
export declare function getCycleNumber(): number | undefined;
/**
 * Set the worker ID in the global correlation context
 */
export declare function setWorkerId(workerId: string): void;
/**
 * Get the current worker ID from the global correlation context
 */
export declare function getWorkerId(): string | undefined;
/**
 * Start tracking a request lifecycle
 */
export declare function startRequestLifecycle(correlationId: string): RequestLifecycle;
/**
 * Start a phase in the request lifecycle
 */
export declare function startPhase(correlationId: string, phase: RequestPhase, metadata?: Record<string, any>): PhaseMetrics;
/**
 * End a phase in the request lifecycle
 */
export declare function endPhase(correlationId: string, phase: RequestPhase, success: boolean, additionalMetadata?: Record<string, any>): PhaseMetrics | undefined;
/**
 * Record an operation within a phase
 */
export declare function recordPhaseOperation(correlationId: string, phase: RequestPhase, operationName: string): void;
/**
 * Record an error within a phase
 */
export declare function recordPhaseError(correlationId: string, phase: RequestPhase, errorCode?: string): void;
/**
 * End the request lifecycle and return summary
 */
export declare function endRequestLifecycle(correlationId: string, success: boolean, errorCode?: string): RequestLifecycle | undefined;
/**
 * Get the current request lifecycle for a correlation ID
 */
export declare function getRequestLifecycle(correlationId: string): RequestLifecycle | undefined;
/**
 * Get current memory usage in megabytes
 */
export declare function getMemoryUsageMB(): number;
/**
 * Get detailed memory statistics
 */
export declare function getMemoryStats(): {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    rssMB: number;
};
/**
 * Options for timed operations
 */
export interface TimedOperationOptions {
    /** Operation name for logging */
    operationName?: string;
    /** Component name for structured logging */
    component?: string;
    /** Request phase for lifecycle tracking */
    phase?: RequestPhase;
    /** Custom timing threshold in ms (defaults to DEFAULT_TIMING_THRESHOLD_MS) */
    timingThreshold?: number;
    /** Whether to log slow operations automatically (default: true) */
    logSlowOperations?: boolean;
    /** Additional metadata to include in logs */
    metadata?: Record<string, any>;
}
/**
 * Time an async operation and return result with timing info
 * Automatically logs operations that exceed the timing threshold
 */
export declare function timeOperation<T>(operation: () => Promise<T>, operationNameOrOptions?: string | TimedOperationOptions): Promise<TimedOperationResult<T>>;
/**
 * Time a synchronous operation and return result with timing info
 * Automatically logs operations that exceed the timing threshold
 */
export declare function timeOperationSync<T>(operation: () => T, operationNameOrOptions?: string | TimedOperationOptions): TimedOperationResult<T>;
/**
 * Create a scoped operation context for structured logging
 */
export interface OperationContext {
    correlationId: string;
    component: string;
    operation: string;
    startTime: number;
    metadata: Record<string, any>;
}
/**
 * Create a new operation context for tracing
 */
export declare function createOperationContext(component: string, operation: string, metadata?: Record<string, any>): OperationContext;
/**
 * Finalize an operation context and return performance metrics
 */
export declare function finalizeOperationContext(context: OperationContext, success: boolean, additionalMetadata?: Record<string, any>): OperationMetadata;
declare class Logger {
    private level;
    private prefix;
    private format;
    private correlationId?;
    private cycleNumber?;
    private workerId?;
    private includeCorrelationId;
    private includeTimestamp;
    constructor(options?: LoggerOptions);
    setLevel(level: LogLevel): void;
    setFormat(format: LogFormat): void;
    /**
     * Set the correlation ID for this logger instance
     */
    setCorrelationId(id: string): void;
    /**
     * Set the cycle number for this logger instance
     */
    setCycleNumber(cycleNumber: number): void;
    /**
     * Set the worker ID for this logger instance
     */
    setWorkerId(workerId: string): void;
    /**
     * Configure whether to include correlation ID in logs
     */
    setIncludeCorrelationId(include: boolean): void;
    /**
     * Configure whether to include timestamp in logs
     */
    setIncludeTimestamp(include: boolean): void;
    /**
     * Get the effective correlation ID (instance or global)
     */
    private getEffectiveCorrelationId;
    /**
     * Get the effective cycle number (instance or global)
     */
    private getEffectiveCycleNumber;
    /**
     * Get the effective worker ID (instance or global)
     */
    private getEffectiveWorkerId;
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
    /**
     * Log service degradation event
     */
    degraded(service: string, message: string, meta?: object): void;
    /**
     * Log service recovery event
     */
    recovered(service: string, message: string, meta?: object): void;
    /**
     * Log service health status
     */
    serviceStatus(service: string, status: 'healthy' | 'degraded' | 'unavailable', details?: object): void;
    /**
     * Log an operation completion with timing and memory metrics
     */
    operationComplete(component: string, operation: string, success: boolean, metadata: OperationMetadata): void;
    /**
     * Log an API call with request/response details
     */
    apiCall(service: string, endpoint: string, method: string, metadata: {
        statusCode?: number;
        duration?: number;
        success: boolean;
        error?: string;
        requestId?: string;
        correlationId?: string;
    }): void;
    /**
     * Log memory usage snapshot
     */
    memorySnapshot(component: string, context?: string): void;
    /**
     * Log performance metrics for a batch of operations
     */
    performanceSummary(component: string, metrics: {
        totalOperations: number;
        successCount: number;
        failureCount: number;
        totalDuration: number;
        averageDuration: number;
        memoryUsageMB: number;
    }): void;
    header(title: string): void;
    /**
     * Create a child logger with a prefix and optionally inherit correlation context
     */
    child(prefix: string): Logger;
    /**
     * Create a child logger with a specific correlation ID for request tracing
     */
    withCorrelationId(correlationId: string): Logger;
    /**
     * Create a child logger with a specific worker ID for worker context tracking
     */
    withWorkerId(workerId: string): Logger;
    /**
     * Create a child logger with a specific cycle number for cycle context tracking
     */
    withCycleNumber(cycleNumber: number): Logger;
    /**
     * Create a child logger with full correlation context
     */
    withContext(context: {
        correlationId?: string;
        cycleNumber?: number;
        workerId?: string;
    }): Logger;
    /**
     * Get the current log entry as a structured object (for testing/inspection)
     */
    getLogEntry(level: LogLevel, message: string, meta?: object): StructuredLogEntry;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map