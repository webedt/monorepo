/**
 * Executor-specific error types with recovery strategies.
 *
 * This module provides typed error classes for executor failures with:
 * - Specific error codes for different failure modes
 * - Recovery strategies per error type (retry, escalate, skip, rollback)
 * - Enhanced error context with task metadata and execution state
 * - Error aggregation support for pattern analysis
 */
import { StructuredError, ErrorCode, type ErrorSeverity, type RecoveryAction, type ErrorContext } from '../utils/errors.js';
/**
 * Recovery strategy types for executor errors
 */
export type RecoveryStrategy = 'retry' | 'escalate' | 'skip' | 'rollback' | 'manual';
/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategyConfig {
    /** Primary recovery strategy */
    strategy: RecoveryStrategy;
    /** Maximum retries if strategy is 'retry' */
    maxRetries?: number;
    /** Backoff multiplier for retries */
    backoffMultiplier?: number;
    /** Initial delay in ms for retries */
    initialDelayMs?: number;
    /** Maximum delay in ms for retries */
    maxDelayMs?: number;
    /** Whether the error should trigger escalation after retries exhausted */
    escalateAfterRetries?: boolean;
    /** Rollback actions to execute */
    rollbackActions?: string[];
    /** Manual intervention instructions */
    manualInstructions?: string[];
}
/**
 * Task execution state preserved in error context
 */
export interface TaskExecutionState {
    /** Task ID */
    taskId?: string;
    /** Issue number being processed */
    issueNumber?: number;
    /** Branch name for the task */
    branchName?: string;
    /** Worker ID processing the task */
    workerId?: string;
    /** Current execution phase */
    phase?: ExecutionPhase;
    /** Duration in ms at time of error */
    durationMs?: number;
    /** Number of tools used before error */
    toolsUsed?: number;
    /** Memory usage in MB at time of error */
    memoryUsageMB?: number;
    /** Retry attempt number */
    retryAttempt?: number;
    /** Maximum retries allowed */
    maxRetries?: number;
    /** Files modified before error */
    modifiedFiles?: string[];
    /** Git commit SHA if any changes were committed */
    commitSha?: string;
    /** Whether cleanup is required */
    requiresCleanup?: boolean;
}
/**
 * Execution phases for tracking progress
 */
export type ExecutionPhase = 'initialization' | 'workspace_setup' | 'repository_clone' | 'branch_creation' | 'credentials_setup' | 'claude_execution' | 'change_detection' | 'commit' | 'push' | 'cleanup';
/**
 * Extended error context with task metadata
 */
export interface ExecutorErrorContext extends ErrorContext {
    /** Task execution state */
    executionState?: TaskExecutionState;
    /** Repository URL */
    repoUrl?: string;
    /** Base branch */
    baseBranch?: string;
    /** Correlation ID for request tracing */
    correlationId?: string;
    /** Chat session ID for database logging */
    chatSessionId?: string;
    /** Circuit breaker state at time of error */
    circuitBreakerState?: 'closed' | 'open' | 'half_open';
    /** Resource usage at time of error */
    resourceUsage?: {
        cpuPercent?: number;
        memoryPercent?: number;
        diskUsagePercent?: number;
    };
}
/**
 * Base class for executor-specific errors with recovery strategies
 */
export declare class ExecutorError extends StructuredError {
    /** Recovery strategy for this error */
    readonly recoveryStrategy: RecoveryStrategyConfig;
    /** Task execution state at time of error */
    readonly executionState?: TaskExecutionState;
    constructor(code: ErrorCode, message: string, options?: {
        severity?: ErrorSeverity;
        recoveryActions?: RecoveryAction[];
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
        isRetryable?: boolean;
    });
    /**
     * Get the recovery strategy for this error
     */
    getRecoveryStrategy(): RecoveryStrategyConfig;
    /**
     * Check if this error should be retried
     */
    shouldRetry(currentAttempt: number): boolean;
    /**
     * Get the delay for the next retry attempt
     */
    getRetryDelay(currentAttempt: number): number;
    /**
     * Convert to JSON with execution state
     */
    toJSON(): Record<string, unknown>;
}
/**
 * Network-related executor error
 */
export declare class NetworkExecutorError extends ExecutorError {
    /** HTTP status code if available */
    readonly statusCode?: number;
    /** Network error code (ENOTFOUND, ETIMEDOUT, etc.) */
    readonly networkErrorCode?: string;
    constructor(message: string, options?: {
        statusCode?: number;
        networkErrorCode?: string;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Timeout-related executor error
 */
export declare class TimeoutExecutorError extends ExecutorError {
    /** Timeout duration that was exceeded */
    readonly timeoutMs: number;
    /** Operation that timed out */
    readonly operation: string;
    constructor(message: string, options: {
        timeoutMs: number;
        operation: string;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Configuration-related executor error
 */
export declare class ConfigurationExecutorError extends ExecutorError {
    /** Configuration field that is invalid */
    readonly field?: string;
    /** Invalid value */
    readonly invalidValue?: unknown;
    /** Expected type or format */
    readonly expectedFormat?: string;
    constructor(message: string, options?: {
        field?: string;
        invalidValue?: unknown;
        expectedFormat?: string;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Resource exhaustion executor error
 */
export declare class ResourceExhaustionError extends ExecutorError {
    /** Type of resource exhausted */
    readonly resourceType: 'memory' | 'cpu' | 'disk' | 'connections' | 'workers';
    /** Current usage level */
    readonly currentUsage?: number;
    /** Threshold that was exceeded */
    readonly threshold?: number;
    constructor(message: string, options: {
        resourceType: 'memory' | 'cpu' | 'disk' | 'connections' | 'workers';
        currentUsage?: number;
        threshold?: number;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Git operation executor error
 */
export declare class GitExecutorError extends ExecutorError {
    /** Git operation that failed */
    readonly operation: 'clone' | 'checkout' | 'commit' | 'push' | 'pull' | 'merge' | 'rebase';
    /** Exit code from git command */
    readonly exitCode?: number;
    /** Git command that was executed */
    readonly command?: string;
    constructor(message: string, options: {
        operation: 'clone' | 'checkout' | 'commit' | 'push' | 'pull' | 'merge' | 'rebase';
        exitCode?: number;
        command?: string;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Claude API executor error
 */
export declare class ClaudeExecutorError extends ExecutorError {
    /** Claude-specific error type */
    readonly claudeErrorType: 'timeout' | 'rate_limit' | 'quota' | 'auth' | 'api' | 'invalid_response';
    /** Tools used before error */
    readonly toolsUsed?: number;
    /** Turns completed before error */
    readonly turnsCompleted?: number;
    constructor(message: string, options: {
        claudeErrorType: 'timeout' | 'rate_limit' | 'quota' | 'auth' | 'api' | 'invalid_response';
        toolsUsed?: number;
        turnsCompleted?: number;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Workspace/filesystem executor error
 */
export declare class WorkspaceExecutorError extends ExecutorError {
    /** Workspace operation that failed */
    readonly operation: 'create' | 'cleanup' | 'read' | 'write' | 'delete';
    /** Path involved in the error */
    readonly path?: string;
    constructor(message: string, options: {
        operation: 'create' | 'cleanup' | 'read' | 'write' | 'delete';
        path?: string;
        recoveryStrategy?: RecoveryStrategyConfig;
        context?: ExecutorErrorContext;
        executionState?: TaskExecutionState;
        cause?: Error;
    });
}
/**
 * Error aggregator for collecting and analyzing multiple errors
 */
export declare class ErrorAggregator {
    private errors;
    /**
     * Add an error to the aggregator
     */
    addError(error: ExecutorError | StructuredError, metadata?: {
        taskId?: string;
        workerId?: string;
    }): void;
    /**
     * Get error counts by code
     */
    getErrorCountsByCode(): Record<string, number>;
    /**
     * Get error counts by severity
     */
    getErrorCountsBySeverity(): Record<ErrorSeverity, number>;
    /**
     * Get retry statistics
     */
    getRetryStats(): {
        totalRetryable: number;
        totalNonRetryable: number;
        byStrategy: Record<RecoveryStrategy, number>;
    };
    /**
     * Get most common error patterns
     */
    getMostCommonErrors(limit?: number): Array<{
        code: string;
        count: number;
        percentage: number;
        examples: string[];
    }>;
    /**
     * Get errors within a time window
     */
    getErrorsInWindow(windowMs: number): Array<ExecutorError | StructuredError>;
    /**
     * Get summary for reporting
     */
    getSummary(): {
        totalErrors: number;
        bySeverity: Record<ErrorSeverity, number>;
        byCode: Record<string, number>;
        retryStats: ReturnType<ErrorAggregator['getRetryStats']>;
        mostCommon: ReturnType<ErrorAggregator['getMostCommonErrors']>;
        timeSpan: {
            start?: Date;
            end?: Date;
        };
    };
    /**
     * Clear all collected errors
     */
    clear(): void;
    /**
     * Get all errors
     */
    getAllErrors(): Array<{
        error: ExecutorError | StructuredError;
        timestamp: Date;
        taskId?: string;
        workerId?: string;
    }>;
}
/**
 * Create an executor error from a generic error
 */
export declare function createExecutorError(error: unknown, context?: ExecutorErrorContext): ExecutorError;
/**
 * Get the global error aggregator instance
 */
export declare function getErrorAggregator(): ErrorAggregator;
/**
 * Type guard to check if error is an ExecutorError
 */
export declare function isExecutorError(error: unknown): error is ExecutorError;
/**
 * Type guard to check if error is a NetworkExecutorError
 */
export declare function isNetworkExecutorError(error: unknown): error is NetworkExecutorError;
/**
 * Type guard to check if error is a TimeoutExecutorError
 */
export declare function isTimeoutExecutorError(error: unknown): error is TimeoutExecutorError;
/**
 * Type guard to check if error is a ClaudeExecutorError
 */
export declare function isClaudeExecutorError(error: unknown): error is ClaudeExecutorError;
/**
 * Type guard to check if error is a GitExecutorError
 */
export declare function isGitExecutorError(error: unknown): error is GitExecutorError;
//# sourceMappingURL=executor-errors.d.ts.map