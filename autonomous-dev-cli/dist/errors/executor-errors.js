/**
 * Executor-specific error types with recovery strategies.
 *
 * This module provides typed error classes for executor failures with:
 * - Specific error codes for different failure modes
 * - Recovery strategies per error type (retry, escalate, skip, rollback)
 * - Enhanced error context with task metadata and execution state
 * - Error aggregation support for pattern analysis
 */
import { StructuredError, ErrorCode, } from '../utils/errors.js';
/**
 * Base class for executor-specific errors with recovery strategies
 */
export class ExecutorError extends StructuredError {
    /** Recovery strategy for this error */
    recoveryStrategy;
    /** Task execution state at time of error */
    executionState;
    constructor(code, message, options = {}) {
        const recoveryStrategy = options.recoveryStrategy ?? getDefaultRecoveryStrategy(code);
        const recoveryActions = options.recoveryActions ??
            buildRecoveryActionsFromStrategy(recoveryStrategy, code);
        super(code, message, {
            severity: options.severity,
            recoveryActions,
            context: {
                ...options.context,
                executionState: options.executionState,
            },
            cause: options.cause,
            isRetryable: options.isRetryable ?? recoveryStrategy.strategy === 'retry',
        });
        this.name = 'ExecutorError';
        this.recoveryStrategy = recoveryStrategy;
        this.executionState = options.executionState;
    }
    /**
     * Get the recovery strategy for this error
     */
    getRecoveryStrategy() {
        return { ...this.recoveryStrategy };
    }
    /**
     * Check if this error should be retried
     */
    shouldRetry(currentAttempt) {
        if (this.recoveryStrategy.strategy !== 'retry') {
            return false;
        }
        const maxRetries = this.recoveryStrategy.maxRetries ?? 3;
        return currentAttempt < maxRetries;
    }
    /**
     * Get the delay for the next retry attempt
     */
    getRetryDelay(currentAttempt) {
        const { initialDelayMs = 1000, maxDelayMs = 30000, backoffMultiplier = 2, } = this.recoveryStrategy;
        const delay = initialDelayMs * Math.pow(backoffMultiplier, currentAttempt);
        // Add jitter (±10%)
        const jitter = delay * 0.1 * (Math.random() * 2 - 1);
        return Math.min(delay + jitter, maxDelayMs);
    }
    /**
     * Convert to JSON with execution state
     */
    toJSON() {
        return {
            ...super.toJSON(),
            recoveryStrategy: this.recoveryStrategy,
            executionState: this.executionState,
        };
    }
}
/**
 * Network-related executor error
 */
export class NetworkExecutorError extends ExecutorError {
    /** HTTP status code if available */
    statusCode;
    /** Network error code (ENOTFOUND, ETIMEDOUT, etc.) */
    networkErrorCode;
    constructor(message, options = {}) {
        const code = determineNetworkErrorCode(options.statusCode, options.networkErrorCode);
        super(code, message, {
            severity: 'transient',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: 'retry',
                maxRetries: 3,
                initialDelayMs: 2000,
                maxDelayMs: 60000,
                backoffMultiplier: 2,
                escalateAfterRetries: true,
            },
            context: {
                ...options.context,
                statusCode: options.statusCode,
                networkErrorCode: options.networkErrorCode,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable: true,
        });
        this.name = 'NetworkExecutorError';
        this.statusCode = options.statusCode;
        this.networkErrorCode = options.networkErrorCode;
    }
}
/**
 * Timeout-related executor error
 */
export class TimeoutExecutorError extends ExecutorError {
    /** Timeout duration that was exceeded */
    timeoutMs;
    /** Operation that timed out */
    operation;
    constructor(message, options) {
        super(ErrorCode.EXEC_TIMEOUT, message, {
            severity: 'transient',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: 'retry',
                maxRetries: 2,
                initialDelayMs: 5000,
                maxDelayMs: 30000,
                backoffMultiplier: 1.5,
                escalateAfterRetries: true,
                manualInstructions: [
                    'Consider breaking the task into smaller subtasks',
                    'Increase timeout configuration if tasks consistently timeout',
                    'Check for infinite loops or expensive operations in the task',
                ],
            },
            context: {
                ...options.context,
                timeoutMs: options.timeoutMs,
                operation: options.operation,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable: true,
        });
        this.name = 'TimeoutExecutorError';
        this.timeoutMs = options.timeoutMs;
        this.operation = options.operation;
    }
}
/**
 * Configuration-related executor error
 */
export class ConfigurationExecutorError extends ExecutorError {
    /** Configuration field that is invalid */
    field;
    /** Invalid value */
    invalidValue;
    /** Expected type or format */
    expectedFormat;
    constructor(message, options = {}) {
        super(ErrorCode.CONFIG_INVALID, message, {
            severity: 'critical',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: 'manual',
                manualInstructions: [
                    options.field
                        ? `Review and correct the "${options.field}" configuration`
                        : 'Review configuration for errors',
                    'Run "autonomous-dev help-config" for documentation',
                    'Ensure all required fields are provided',
                ],
            },
            context: {
                ...options.context,
                field: options.field,
                invalidValue: options.invalidValue,
                expectedFormat: options.expectedFormat,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable: false,
        });
        this.name = 'ConfigurationExecutorError';
        this.field = options.field;
        this.invalidValue = options.invalidValue;
        this.expectedFormat = options.expectedFormat;
    }
}
/**
 * Resource exhaustion executor error
 */
export class ResourceExhaustionError extends ExecutorError {
    /** Type of resource exhausted */
    resourceType;
    /** Current usage level */
    currentUsage;
    /** Threshold that was exceeded */
    threshold;
    constructor(message, options) {
        super(ErrorCode.SERVICE_DEGRADED, message, {
            severity: 'transient',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: 'retry',
                maxRetries: 3,
                initialDelayMs: 5000,
                maxDelayMs: 60000,
                backoffMultiplier: 2,
                escalateAfterRetries: true,
                manualInstructions: [
                    `${options.resourceType} resources are exhausted`,
                    'Consider reducing concurrent operations',
                    'Check for resource leaks',
                ],
            },
            context: {
                ...options.context,
                resourceType: options.resourceType,
                currentUsage: options.currentUsage,
                threshold: options.threshold,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable: true,
        });
        this.name = 'ResourceExhaustionError';
        this.resourceType = options.resourceType;
        this.currentUsage = options.currentUsage;
        this.threshold = options.threshold;
    }
}
/**
 * Git operation executor error
 */
export class GitExecutorError extends ExecutorError {
    /** Git operation that failed */
    operation;
    /** Exit code from git command */
    exitCode;
    /** Git command that was executed */
    command;
    constructor(message, options) {
        const code = determineGitErrorCode(options.operation);
        const isRetryable = ['clone', 'push', 'pull'].includes(options.operation);
        super(code, message, {
            severity: isRetryable ? 'transient' : 'error',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: isRetryable ? 'retry' : 'manual',
                maxRetries: isRetryable ? 3 : 0,
                initialDelayMs: 2000,
                maxDelayMs: 30000,
                backoffMultiplier: 2,
                rollbackActions: options.operation === 'commit' ? ['git reset HEAD~1'] : undefined,
                manualInstructions: getGitRecoveryInstructions(options.operation),
            },
            context: {
                ...options.context,
                gitOperation: options.operation,
                exitCode: options.exitCode,
                command: options.command,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable,
        });
        this.name = 'GitExecutorError';
        this.operation = options.operation;
        this.exitCode = options.exitCode;
        this.command = options.command;
    }
}
/**
 * Claude API executor error
 */
export class ClaudeExecutorError extends ExecutorError {
    /** Claude-specific error type */
    claudeErrorType;
    /** Tools used before error */
    toolsUsed;
    /** Turns completed before error */
    turnsCompleted;
    constructor(message, options) {
        const code = determineClaudeErrorCode(options.claudeErrorType);
        const isRetryable = ['timeout', 'rate_limit', 'api'].includes(options.claudeErrorType);
        super(code, message, {
            severity: isRetryable ? 'transient' : 'critical',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: isRetryable ? 'retry' : 'escalate',
                maxRetries: isRetryable ? 3 : 0,
                initialDelayMs: options.claudeErrorType === 'rate_limit' ? 30000 : 2000,
                maxDelayMs: options.claudeErrorType === 'rate_limit' ? 120000 : 60000,
                backoffMultiplier: 2,
                escalateAfterRetries: true,
                manualInstructions: getClaudeRecoveryInstructions(options.claudeErrorType),
            },
            context: {
                ...options.context,
                claudeErrorType: options.claudeErrorType,
                toolsUsed: options.toolsUsed,
                turnsCompleted: options.turnsCompleted,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable,
        });
        this.name = 'ClaudeExecutorError';
        this.claudeErrorType = options.claudeErrorType;
        this.toolsUsed = options.toolsUsed;
        this.turnsCompleted = options.turnsCompleted;
    }
}
/**
 * Workspace/filesystem executor error
 */
export class WorkspaceExecutorError extends ExecutorError {
    /** Workspace operation that failed */
    operation;
    /** Path involved in the error */
    path;
    constructor(message, options) {
        super(ErrorCode.EXEC_WORKSPACE_FAILED, message, {
            severity: 'error',
            recoveryStrategy: options.recoveryStrategy ?? {
                strategy: 'retry',
                maxRetries: 2,
                initialDelayMs: 1000,
                maxDelayMs: 5000,
                backoffMultiplier: 2,
                rollbackActions: options.operation !== 'cleanup'
                    ? ['Clean up workspace directory', 'Retry with fresh workspace']
                    : undefined,
                manualInstructions: [
                    'Check filesystem permissions',
                    'Ensure sufficient disk space',
                    'Verify the path is accessible',
                ],
            },
            context: {
                ...options.context,
                workspaceOperation: options.operation,
                path: options.path,
            },
            executionState: options.executionState,
            cause: options.cause,
            isRetryable: true,
        });
        this.name = 'WorkspaceExecutorError';
        this.operation = options.operation;
        this.path = options.path;
    }
}
/**
 * Error aggregator for collecting and analyzing multiple errors
 */
export class ErrorAggregator {
    errors = [];
    /**
     * Add an error to the aggregator
     */
    addError(error, metadata) {
        this.errors.push({
            error,
            timestamp: new Date(),
            taskId: metadata?.taskId,
            workerId: metadata?.workerId,
        });
    }
    /**
     * Get error counts by code
     */
    getErrorCountsByCode() {
        const counts = {};
        for (const { error } of this.errors) {
            counts[error.code] = (counts[error.code] || 0) + 1;
        }
        return counts;
    }
    /**
     * Get error counts by severity
     */
    getErrorCountsBySeverity() {
        const counts = {
            critical: 0,
            error: 0,
            warning: 0,
            transient: 0,
        };
        for (const { error } of this.errors) {
            counts[error.severity]++;
        }
        return counts;
    }
    /**
     * Get retry statistics
     */
    getRetryStats() {
        let totalRetryable = 0;
        let totalNonRetryable = 0;
        const byStrategy = {
            retry: 0,
            escalate: 0,
            skip: 0,
            rollback: 0,
            manual: 0,
        };
        for (const { error } of this.errors) {
            if (error.isRetryable) {
                totalRetryable++;
            }
            else {
                totalNonRetryable++;
            }
            if (error instanceof ExecutorError) {
                byStrategy[error.recoveryStrategy.strategy]++;
            }
        }
        return { totalRetryable, totalNonRetryable, byStrategy };
    }
    /**
     * Get most common error patterns
     */
    getMostCommonErrors(limit = 5) {
        const errorsByCode = new Map();
        for (const { error } of this.errors) {
            const existing = errorsByCode.get(error.code) || { count: 0, messages: [] };
            existing.count++;
            if (existing.messages.length < 3) {
                existing.messages.push(error.message);
            }
            errorsByCode.set(error.code, existing);
        }
        const total = this.errors.length;
        return Array.from(errorsByCode.entries())
            .map(([code, data]) => ({
            code,
            count: data.count,
            percentage: Math.round((data.count / total) * 100),
            examples: data.messages,
        }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }
    /**
     * Get errors within a time window
     */
    getErrorsInWindow(windowMs) {
        const cutoff = Date.now() - windowMs;
        return this.errors
            .filter(({ timestamp }) => timestamp.getTime() >= cutoff)
            .map(({ error }) => error);
    }
    /**
     * Get summary for reporting
     */
    getSummary() {
        const timestamps = this.errors.map(e => e.timestamp);
        return {
            totalErrors: this.errors.length,
            bySeverity: this.getErrorCountsBySeverity(),
            byCode: this.getErrorCountsByCode(),
            retryStats: this.getRetryStats(),
            mostCommon: this.getMostCommonErrors(),
            timeSpan: {
                start: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))) : undefined,
                end: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))) : undefined,
            },
        };
    }
    /**
     * Clear all collected errors
     */
    clear() {
        this.errors = [];
    }
    /**
     * Get all errors
     */
    getAllErrors() {
        return [...this.errors];
    }
}
// Helper functions
/**
 * Get default recovery strategy based on error code
 */
function getDefaultRecoveryStrategy(code) {
    // Network and transient errors - retry
    const retryableCodes = new Set([
        ErrorCode.NETWORK_ERROR,
        ErrorCode.GITHUB_NETWORK_ERROR,
        ErrorCode.GITHUB_RATE_LIMITED,
        ErrorCode.CLAUDE_TIMEOUT,
        ErrorCode.CLAUDE_RATE_LIMITED,
        ErrorCode.CLAUDE_NETWORK_ERROR,
        ErrorCode.EXEC_CLONE_FAILED,
        ErrorCode.EXEC_PUSH_FAILED,
        ErrorCode.DB_CONNECTION_FAILED,
        ErrorCode.DB_QUERY_TIMEOUT,
        ErrorCode.DB_POOL_EXHAUSTED,
        ErrorCode.SERVICE_DEGRADED,
        ErrorCode.CIRCUIT_BREAKER_OPEN,
    ]);
    if (retryableCodes.has(code)) {
        return {
            strategy: 'retry',
            maxRetries: 3,
            initialDelayMs: 2000,
            maxDelayMs: 60000,
            backoffMultiplier: 2,
            escalateAfterRetries: true,
        };
    }
    // Configuration and auth errors - manual intervention
    const manualCodes = new Set([
        ErrorCode.CONFIG_INVALID,
        ErrorCode.CONFIG_MISSING_REQUIRED,
        ErrorCode.GITHUB_AUTH_FAILED,
        ErrorCode.CLAUDE_AUTH_FAILED,
        ErrorCode.GITHUB_PERMISSION_DENIED,
    ]);
    if (manualCodes.has(code)) {
        return {
            strategy: 'manual',
            manualInstructions: ['Review and correct configuration', 'Verify credentials'],
        };
    }
    // Conflict errors - may need rollback
    const rollbackCodes = new Set([
        ErrorCode.CONFLICT_MERGE_FAILED,
        ErrorCode.CONFLICT_BRANCH_DIVERGED,
        ErrorCode.EXEC_COMMIT_FAILED,
    ]);
    if (rollbackCodes.has(code)) {
        return {
            strategy: 'rollback',
            rollbackActions: ['Reset to clean state', 'Retry with fresh branch'],
        };
    }
    // Default to escalate for unknown errors
    return {
        strategy: 'escalate',
        escalateAfterRetries: false,
        manualInstructions: ['Review error logs', 'Contact support if issue persists'],
    };
}
/**
 * Build recovery actions from strategy configuration
 */
function buildRecoveryActionsFromStrategy(strategy, code) {
    const actions = [];
    switch (strategy.strategy) {
        case 'retry':
            actions.push({
                description: `Retry operation with exponential backoff (max ${strategy.maxRetries ?? 3} attempts)`,
                automatic: true,
            });
            if (strategy.escalateAfterRetries) {
                actions.push({
                    description: 'Escalate to manual review if retries exhausted',
                    automatic: true,
                });
            }
            break;
        case 'rollback':
            if (strategy.rollbackActions) {
                for (const action of strategy.rollbackActions) {
                    actions.push({
                        description: action,
                        automatic: true,
                    });
                }
            }
            break;
        case 'escalate':
            actions.push({
                description: 'Add task to dead letter queue for manual review',
                automatic: true,
            });
            break;
        case 'skip':
            actions.push({
                description: 'Skip this task and continue with remaining tasks',
                automatic: true,
            });
            break;
        case 'manual':
            // Manual instructions added below
            break;
    }
    // Add manual instructions
    if (strategy.manualInstructions) {
        for (const instruction of strategy.manualInstructions) {
            actions.push({
                description: instruction,
                automatic: false,
            });
        }
    }
    return actions;
}
/**
 * Determine network error code from status/error code
 */
function determineNetworkErrorCode(statusCode, networkErrorCode) {
    if (statusCode === 429) {
        return ErrorCode.GITHUB_RATE_LIMITED;
    }
    if (statusCode && statusCode >= 500) {
        return ErrorCode.GITHUB_API_ERROR;
    }
    if (networkErrorCode) {
        const networkErrors = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
        if (networkErrors.some(code => networkErrorCode.includes(code))) {
            return ErrorCode.NETWORK_ERROR;
        }
    }
    return ErrorCode.NETWORK_ERROR;
}
/**
 * Determine git error code from operation
 */
function determineGitErrorCode(operation) {
    switch (operation) {
        case 'clone':
            return ErrorCode.EXEC_CLONE_FAILED;
        case 'checkout':
            return ErrorCode.EXEC_BRANCH_FAILED;
        case 'commit':
            return ErrorCode.EXEC_COMMIT_FAILED;
        case 'push':
            return ErrorCode.EXEC_PUSH_FAILED;
        default:
            return ErrorCode.INTERNAL_ERROR;
    }
}
/**
 * Get git operation recovery instructions
 */
function getGitRecoveryInstructions(operation) {
    const instructions = {
        clone: [
            'Verify network connectivity',
            'Check repository URL is correct',
            'Ensure GitHub token has repo access',
        ],
        checkout: [
            'Verify branch exists',
            'Ensure working directory is clean',
        ],
        commit: [
            'Check for staged changes',
            'Verify git user configuration',
        ],
        push: [
            'Check for branch protection rules',
            'Verify push permissions',
            'Pull latest changes if behind',
        ],
        pull: [
            'Resolve any merge conflicts',
            'Ensure local changes are committed or stashed',
        ],
        merge: [
            'Resolve merge conflicts manually',
            'Consider using rebase instead',
        ],
        rebase: [
            'Resolve conflicts during rebase',
            'Consider using merge instead',
        ],
    };
    return instructions[operation] || ['Review git operation logs'];
}
/**
 * Determine Claude error code from type
 */
function determineClaudeErrorCode(errorType) {
    switch (errorType) {
        case 'timeout':
            return ErrorCode.CLAUDE_TIMEOUT;
        case 'rate_limit':
            return ErrorCode.CLAUDE_RATE_LIMITED;
        case 'quota':
            return ErrorCode.CLAUDE_QUOTA_EXCEEDED;
        case 'auth':
            return ErrorCode.CLAUDE_AUTH_FAILED;
        case 'invalid_response':
            return ErrorCode.CLAUDE_INVALID_RESPONSE;
        default:
            return ErrorCode.CLAUDE_API_ERROR;
    }
}
/**
 * Get Claude error recovery instructions
 */
function getClaudeRecoveryInstructions(errorType) {
    const instructions = {
        timeout: [
            'Break down the task into smaller subtasks',
            'Increase timeout configuration',
            'Check for infinite loops in prompts',
        ],
        rate_limit: [
            'Wait for rate limit reset',
            'Reduce request frequency',
            'Check https://status.anthropic.com for issues',
        ],
        quota: [
            'Upgrade subscription for higher limits',
            'Wait for quota reset',
            'Reduce token usage per request',
        ],
        auth: [
            'Verify Claude API credentials',
            'Re-authenticate with Claude',
            'Check token expiration',
        ],
        invalid_response: [
            'Review prompt for clarity',
            'Simplify the task description',
            'Check for API version compatibility',
        ],
        api: [
            'Check https://status.anthropic.com',
            'Retry the operation',
            'Review request parameters',
        ],
    };
    return instructions[errorType] || ['Review Claude API logs'];
}
/**
 * Create an executor error from a generic error
 */
export function createExecutorError(error, context) {
    if (error instanceof ExecutorError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;
    const messageLower = message.toLowerCase();
    // Detect timeout errors
    if (messageLower.includes('timeout') || messageLower.includes('timed out')) {
        return new TimeoutExecutorError(message, {
            timeoutMs: 0,
            operation: context?.operation ?? 'unknown',
            context,
            cause,
        });
    }
    // Detect network errors
    if (messageLower.includes('network') ||
        messageLower.includes('enotfound') ||
        messageLower.includes('econnreset') ||
        messageLower.includes('econnrefused') ||
        messageLower.includes('etimedout')) {
        return new NetworkExecutorError(message, {
            context,
            cause,
        });
    }
    // Detect Claude errors
    if (messageLower.includes('claude') ||
        messageLower.includes('anthropic') ||
        messageLower.includes('rate limit')) {
        const claudeType = messageLower.includes('timeout')
            ? 'timeout'
            : messageLower.includes('rate limit')
                ? 'rate_limit'
                : 'api';
        return new ClaudeExecutorError(message, {
            claudeErrorType: claudeType,
            context,
            cause,
        });
    }
    // Detect git errors
    if (messageLower.includes('git') ||
        messageLower.includes('clone') ||
        messageLower.includes('push') ||
        messageLower.includes('commit')) {
        const gitOp = messageLower.includes('clone')
            ? 'clone'
            : messageLower.includes('push')
                ? 'push'
                : messageLower.includes('commit')
                    ? 'commit'
                    : 'checkout';
        return new GitExecutorError(message, {
            operation: gitOp,
            context,
            cause,
        });
    }
    // Default to generic executor error
    return new ExecutorError(ErrorCode.INTERNAL_ERROR, message, {
        context,
        cause,
    });
}
// Create singleton error aggregator for the application
let globalErrorAggregator;
/**
 * Get the global error aggregator instance
 */
export function getErrorAggregator() {
    if (!globalErrorAggregator) {
        globalErrorAggregator = new ErrorAggregator();
    }
    return globalErrorAggregator;
}
/**
 * Type guard to check if error is an ExecutorError
 */
export function isExecutorError(error) {
    return error instanceof ExecutorError;
}
/**
 * Type guard to check if error is a NetworkExecutorError
 */
export function isNetworkExecutorError(error) {
    return error instanceof NetworkExecutorError;
}
/**
 * Type guard to check if error is a TimeoutExecutorError
 */
export function isTimeoutExecutorError(error) {
    return error instanceof TimeoutExecutorError;
}
/**
 * Type guard to check if error is a ClaudeExecutorError
 */
export function isClaudeExecutorError(error) {
    return error instanceof ClaudeExecutorError;
}
/**
 * Type guard to check if error is a GitExecutorError
 */
export function isGitExecutorError(error) {
    return error instanceof GitExecutorError;
}
//# sourceMappingURL=executor-errors.js.map