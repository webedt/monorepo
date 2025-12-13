import { StructuredError, type ErrorContext } from './errors.js';
import { type CyclePhase, type ProgressManager } from './progress.js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/**
 * Default timing threshold in ms for logging slow operations
 * Operations exceeding this threshold will be automatically logged
 */
export declare const DEFAULT_TIMING_THRESHOLD_MS = 100;
/**
 * Debug mode configuration for enhanced logging
 */
export interface DebugModeConfig {
    /** Master debug mode toggle */
    enabled: boolean;
    /** Log detailed Claude SDK interactions (tool use, responses, timing) */
    logClaudeInteractions: boolean;
    /** Log GitHub API request/response details including headers */
    logApiDetails: boolean;
}
/**
 * Check if debug mode is enabled (via config or environment variable)
 */
export declare function isDebugModeEnabled(): boolean;
/**
 * Check if Claude interaction logging is enabled
 */
export declare function isClaudeLoggingEnabled(): boolean;
/**
 * Check if API detail logging is enabled
 */
export declare function isApiLoggingEnabled(): boolean;
/**
 * Set the global debug mode configuration
 */
export declare function setDebugMode(config: Partial<DebugModeConfig>): void;
/**
 * Get the current debug mode configuration
 */
export declare function getDebugModeConfig(): DebugModeConfig;
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
/**
 * Get current memory usage in megabytes
 * This is a utility function for monitoring memory consumption
 */
export declare function getMemoryUsageMB(): number;
/**
 * Get detailed memory usage statistics
 */
export declare function getDetailedMemoryUsage(): {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    rssMB: number;
    arrayBuffersMB: number;
};
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
 * Log rotation policy type
 */
export type LogRotationPolicy = 'size' | 'time' | 'both';
/**
 * Time-based rotation interval
 */
export type LogRotationInterval = 'hourly' | 'daily' | 'weekly';
/**
 * Configuration for structured file logging
 */
export interface StructuredFileLoggerConfig {
    /** Directory path for log files */
    logDir: string;
    /** Maximum file size in bytes before rotation (default: 10MB) */
    maxFileSizeBytes: number;
    /** Number of rotated files to keep (default: 5) */
    maxFiles: number;
    /** Include performance metrics in logs (default: true) */
    includeMetrics: boolean;
    /** Log rotation policy: 'size', 'time', or 'both' (default: 'size') */
    rotationPolicy: LogRotationPolicy;
    /** Time-based rotation interval (default: 'daily') */
    rotationInterval: LogRotationInterval;
    /** Maximum age of log files in days for cleanup (default: 30) */
    maxAgeDays: number;
    /** Enable compression of rotated files (default: false) */
    compressRotated: boolean;
}
/**
 * Aggregated metrics for tracking operational statistics
 */
export interface AggregatedMetrics {
    /** Total number of cycles executed */
    totalCycles: number;
    /** Successful cycles count */
    successfulCycles: number;
    /** Failed cycles count */
    failedCycles: number;
    /** Total tasks discovered */
    totalTasksDiscovered: number;
    /** Total tasks completed */
    totalTasksCompleted: number;
    /** Total tasks failed */
    totalTasksFailed: number;
    /** Total errors recorded */
    totalErrors: number;
    /** Total PRs merged */
    totalPRsMerged: number;
    /** Array of cycle durations for average calculation */
    cycleDurations: number[];
    /** Timestamp when tracking started */
    startTime: number;
    /** Last cycle timestamp */
    lastCycleTime?: number;
    /** Error counts by error code */
    errorsByCode: Record<string, number>;
    /** Success rate percentage (0-100) */
    successRate: number;
    /** Average cycle duration in ms */
    avgCycleDurationMs: number;
    /** Cycles per hour rate */
    cyclesPerHour: number;
}
/**
 * Structured log entry with extended fields for file logging
 */
export interface ExtendedLogEntry extends StructuredLogEntry {
    /** Operation type for categorization */
    operationType?: 'cycle' | 'task' | 'discovery' | 'evaluation' | 'merge' | 'api' | 'system';
    /** Duration of operation in ms */
    durationMs?: number;
    /** Issue number if applicable */
    issueNumber?: number;
    /** Memory usage at time of log */
    memoryUsageMB?: number;
    /** Performance metrics snapshot */
    metrics?: Partial<AggregatedMetrics>;
}
/**
 * Aggregated metrics tracker for observability
 */
export declare class MetricsAggregator {
    private metrics;
    constructor();
    private createInitialMetrics;
    /**
     * Record a cycle completion
     */
    recordCycle(success: boolean, durationMs: number, tasksDiscovered: number, tasksCompleted: number, tasksFailed: number, prsMerged: number): void;
    /**
     * Record an error occurrence
     */
    recordError(errorCode: string): void;
    /**
     * Recalculate derived metrics
     */
    private recalculateRates;
    /**
     * Get current aggregated metrics
     */
    getMetrics(): AggregatedMetrics;
    /**
     * Get a summary suitable for logging
     */
    getMetricsSummary(): Record<string, any>;
    /**
     * Reset metrics (useful for testing)
     */
    reset(): void;
}
/**
 * Structured file logger that writes JSON logs to files with rotation
 */
export declare class StructuredFileLogger {
    private config;
    private currentLogFile;
    private metricsAggregator;
    private enabled;
    private lastRotationTime;
    private rotationCheckInterval;
    constructor(config?: Partial<StructuredFileLoggerConfig>);
    /**
     * Enable structured file logging
     */
    enable(): void;
    /**
     * Disable structured file logging
     */
    disable(): void;
    /**
     * Start periodic rotation check for time-based rotation
     */
    private startRotationCheck;
    /**
     * Stop periodic rotation check
     */
    private stopRotationCheck;
    /**
     * Check if time-based rotation is needed
     */
    private needsTimeBasedRotation;
    /**
     * Cleanup log files older than maxAgeDays
     */
    private cleanupOldLogFiles;
    /**
     * Check if structured file logging is enabled
     */
    isEnabled(): boolean;
    /**
     * Get the metrics aggregator for recording metrics
     */
    getMetricsAggregator(): MetricsAggregator;
    /**
     * Get current log file path
     */
    private getLogFilePath;
    /**
     * Ensure log directory exists
     */
    private ensureLogDirectory;
    /**
     * Check if log rotation is needed based on rotation policy
     */
    private needsRotation;
    /**
     * Rotate log files
     */
    private rotateLogFiles;
    /**
     * Write a structured log entry to file
     */
    writeLog(entry: ExtendedLogEntry): void;
    /**
     * Write a cycle completion log with all metrics
     */
    writeCycleLog(cycleNumber: number, correlationId: string, success: boolean, tasksDiscovered: number, tasksCompleted: number, tasksFailed: number, prsMerged: number, durationMs: number, errors: string[]): void;
    /**
     * Write a task completion log
     */
    writeTaskLog(issueNumber: number, correlationId: string, workerId: string, success: boolean, durationMs: number, branchName?: string, commitSha?: string, error?: string): void;
    /**
     * Write a discovery log
     */
    writeDiscoveryLog(correlationId: string, cycleNumber: number, tasksFound: number, durationMs: number, existingIssues: number): void;
    /**
     * Write an API call log
     */
    writeApiLog(service: 'github' | 'claude', endpoint: string, correlationId: string, success: boolean, durationMs: number, statusCode?: number, error?: string): void;
    /**
     * Write a system event log
     */
    writeSystemLog(level: LogLevel, message: string, meta?: Record<string, any>): void;
    /**
     * Get list of log files in the log directory
     */
    getLogFiles(): string[];
    /**
     * Get current metrics summary
     */
    getMetricsSummary(): Record<string, any>;
}
/**
 * Get or create the global structured file logger
 */
export declare function getStructuredFileLogger(): StructuredFileLogger;
/**
 * Initialize structured file logging with config
 */
export declare function initStructuredFileLogging(config: Partial<StructuredFileLoggerConfig>): StructuredFileLogger;
/**
 * Get the metrics aggregator from the structured logger
 */
export declare function getMetricsAggregator(): MetricsAggregator;
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
    success(message: string, meta?: object): void;
    failure(message: string): void;
    step(step: number, total: number, message: string): void;
    /**
     * Show a progress bar for batch operations
     */
    progressBar(current: number, total: number, label: string, etaMs?: number): void;
    /**
     * Clear the current progress line
     */
    clearProgress(): void;
    /**
     * Log cycle phase change with visual indicator
     */
    cyclePhase(phase: CyclePhase, step: number, total: number): void;
    /**
     * Log worker execution progress
     */
    workerProgress(workerId: string, issueNumber: number, status: 'starting' | 'running' | 'completed' | 'failed', progress?: number, message?: string): void;
    /**
     * Log estimated time remaining
     */
    estimatedTime(label: string, etaMs: number): void;
    /**
     * Log waiting state with countdown
     */
    waitingCountdown(remainingMs: number): void;
    /**
     * Get the progress manager for advanced progress tracking
     */
    getProgressManager(): ProgressManager;
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
     * Log Claude SDK tool invocation (debug mode)
     * Only logs when debug mode or Claude interaction logging is enabled
     */
    claudeToolUse(toolName: string, input: Record<string, unknown>, metadata?: {
        correlationId?: string;
        workerId?: string;
        issueNumber?: number;
        attemptNumber?: number;
        turnCount?: number;
        toolCount?: number;
    }): void;
    /**
     * Log Claude SDK tool result (debug mode)
     * Only logs when debug mode or Claude interaction logging is enabled
     */
    claudeToolResult(toolName: string, success: boolean, durationMs?: number, output?: string, metadata?: {
        correlationId?: string;
        workerId?: string;
    }): void;
    /**
     * Log GitHub API request details (debug mode)
     * Only logs when debug mode or API detail logging is enabled
     */
    githubApiRequest(method: string, endpoint: string, metadata?: {
        correlationId?: string;
        requestId?: string;
        headers?: Record<string, string>;
        body?: Record<string, unknown>;
    }): void;
    /**
     * Log GitHub API response details (debug mode)
     * Only logs when debug mode or API detail logging is enabled
     */
    githubApiResponse(method: string, endpoint: string, statusCode: number, durationMs: number, metadata?: {
        correlationId?: string;
        requestId?: string;
        rateLimitRemaining?: number;
        rateLimitReset?: Date;
        responseSize?: number;
    }): void;
    /**
     * Log internal state snapshot for debugging decision points
     * Only logs when debug mode is enabled
     */
    debugState(component: string, label: string, state: Record<string, unknown>): void;
    /**
     * Sanitize input for logging (truncate long strings, remove sensitive data)
     */
    private sanitizeInput;
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
/**
 * Conversation history entry for Claude SDK debugging
 */
export interface ConversationHistoryEntry {
    timestamp: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    type: 'message' | 'tool_use' | 'tool_result' | 'error' | 'timeout';
    content: string;
    metadata?: Record<string, unknown>;
}
/**
 * Claude execution attempt record for retry debugging
 */
export interface ClaudeExecutionAttempt {
    attemptNumber: number;
    startTime: string;
    endTime?: string;
    durationMs?: number;
    success: boolean;
    error?: {
        code: string;
        message: string;
        isRetryable: boolean;
    };
    toolUseCount: number;
    turnCount: number;
    conversationHistory: ConversationHistoryEntry[];
}
/**
 * Claude execution history logger for debugging failed attempts
 */
export declare class ClaudeExecutionLogger {
    private correlationId;
    private taskId;
    private attempts;
    private currentAttempt;
    private log;
    constructor(correlationId: string, taskId: string);
    /**
     * Start a new execution attempt
     */
    startAttempt(attemptNumber: number): void;
    /**
     * Record a message in the conversation history
     */
    recordMessage(role: ConversationHistoryEntry['role'], type: ConversationHistoryEntry['type'], content: string, metadata?: Record<string, unknown>): void;
    /**
     * Record tool use
     */
    recordToolUse(toolName: string, input?: Record<string, unknown>): void;
    /**
     * Record tool result
     */
    recordToolResult(toolName: string, success: boolean, output?: string): void;
    /**
     * Record assistant text response
     */
    recordAssistantText(text: string): void;
    /**
     * Record an error in the current attempt
     */
    recordError(code: string, message: string, isRetryable: boolean): void;
    /**
     * Record a timeout in the current attempt
     */
    recordTimeout(timeoutMs: number): void;
    /**
     * End the current attempt
     */
    endAttempt(success: boolean): void;
    /**
     * Get all execution attempts for debugging
     */
    getAttempts(): ClaudeExecutionAttempt[];
    /**
     * Get a summary of all attempts for logging
     */
    getSummary(): {
        totalAttempts: number;
        successfulAttempts: number;
        totalDurationMs: number;
        totalToolUses: number;
        totalTurns: number;
        lastError?: {
            code: string;
            message: string;
        };
    };
    /**
     * Log the full execution history for debugging
     */
    logFullHistory(level?: LogLevel): void;
    /**
     * Truncate content for logging
     */
    private truncateContent;
    /**
     * Summarize tool input for logging
     */
    private summarizeInput;
}
export {};
//# sourceMappingURL=logger.d.ts.map