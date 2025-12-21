/**
 * Executor-specific error types with recovery strategies.
 *
 * This module provides typed error classes for executor failures with:
 * - Specific error codes for different failure modes
 * - Recovery strategies per error type (retry, escalate, skip, rollback)
 * - Enhanced error context with task metadata and execution state
 * - Error aggregation support for pattern analysis
 */

import {
  StructuredError,
  ErrorCode,
  type ErrorSeverity,
  type RecoveryAction,
  type ErrorContext,
} from '../utils/errors.js';

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
 * Information about a single tool call during Claude execution
 */
export interface ToolCallInfo {
  /** Name of the tool (e.g., 'Write', 'Edit', 'Bash') */
  toolName: string;
  /** Tool input parameters (sanitized for logging) */
  input: Record<string, unknown>;
  /** Timestamp when tool was called */
  timestamp: number;
  /** File path if the tool operates on a file */
  filePath?: string;
  /** Whether this tool modifies files */
  isWriteOperation: boolean;
}

/**
 * Summary of file changes attempted during Claude execution
 */
export interface FileChangesSummary {
  /** Files that were created */
  created: string[];
  /** Files that were modified */
  modified: string[];
  /** Files that were deleted */
  deleted: string[];
  /** Total number of file operations attempted */
  totalOperations: number;
}

/**
 * Comprehensive context for Claude execution errors
 * Tracks tool execution state for debugging failed executions
 */
export interface ClaudeExecutionContext {
  /** Description of the task being executed */
  taskDescription?: string;
  /** Current execution phase when error occurred */
  executionPhase: ExecutionPhase;
  /** Tool that was executing when error occurred */
  currentTool?: string;
  /** Input to the current tool when error occurred */
  currentToolInput?: Record<string, unknown>;
  /** Last N tool calls before the error (for debugging) */
  recentToolCalls: ToolCallInfo[];
  /** Summary of file changes attempted */
  fileChangesSummary: FileChangesSummary;
  /** Number of turns completed before error */
  turnsCompleted: number;
  /** Total tools used before error */
  totalToolsUsed: number;
  /** Time spent in Claude execution (ms) */
  executionDurationMs: number;
  /** Last assistant text output before error */
  lastAssistantText?: string;
  /** Whether any write operations were attempted */
  hadWriteOperations: boolean;
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
  /** Claude execution context for detailed debugging */
  claudeExecutionContext?: ClaudeExecutionContext;
}

/**
 * Execution phases for tracking progress
 */
export type ExecutionPhase =
  | 'initialization'
  | 'workspace_setup'
  | 'repository_clone'
  | 'branch_creation'
  | 'credentials_setup'
  | 'claude_execution'
  | 'change_detection'
  | 'commit'
  | 'push'
  | 'cleanup';

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
export class ExecutorError extends StructuredError {
  /** Recovery strategy for this error */
  public readonly recoveryStrategy: RecoveryStrategyConfig;
  /** Task execution state at time of error */
  public readonly executionState?: TaskExecutionState;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      severity?: ErrorSeverity;
      recoveryActions?: RecoveryAction[];
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
      isRetryable?: boolean;
    } = {}
  ) {
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
  getRecoveryStrategy(): RecoveryStrategyConfig {
    return { ...this.recoveryStrategy };
  }

  /**
   * Check if this error should be retried
   */
  shouldRetry(currentAttempt: number): boolean {
    if (this.recoveryStrategy.strategy !== 'retry') {
      return false;
    }
    const maxRetries = this.recoveryStrategy.maxRetries ?? 3;
    return currentAttempt < maxRetries;
  }

  /**
   * Get the delay for the next retry attempt
   */
  getRetryDelay(currentAttempt: number): number {
    const {
      initialDelayMs = 1000,
      maxDelayMs = 30000,
      backoffMultiplier = 2,
    } = this.recoveryStrategy;

    const delay = initialDelayMs * Math.pow(backoffMultiplier, currentAttempt);
    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, maxDelayMs);
  }

  /**
   * Convert to JSON with execution state
   */
  toJSON(): Record<string, unknown> {
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
  public readonly statusCode?: number;
  /** Network error code (ENOTFOUND, ETIMEDOUT, etc.) */
  public readonly networkErrorCode?: string;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      networkErrorCode?: string;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    } = {}
  ) {
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
  public readonly timeoutMs: number;
  /** Operation that timed out */
  public readonly operation: string;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      operation: string;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    }
  ) {
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
  public readonly field?: string;
  /** Invalid value */
  public readonly invalidValue?: unknown;
  /** Expected type or format */
  public readonly expectedFormat?: string;

  constructor(
    message: string,
    options: {
      field?: string;
      invalidValue?: unknown;
      expectedFormat?: string;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    } = {}
  ) {
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
  public readonly resourceType: 'memory' | 'cpu' | 'disk' | 'connections' | 'workers';
  /** Current usage level */
  public readonly currentUsage?: number;
  /** Threshold that was exceeded */
  public readonly threshold?: number;

  constructor(
    message: string,
    options: {
      resourceType: 'memory' | 'cpu' | 'disk' | 'connections' | 'workers';
      currentUsage?: number;
      threshold?: number;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    }
  ) {
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
  public readonly operation: 'clone' | 'checkout' | 'commit' | 'push' | 'pull' | 'merge' | 'rebase';
  /** Exit code from git command */
  public readonly exitCode?: number;
  /** Git command that was executed */
  public readonly command?: string;

  constructor(
    message: string,
    options: {
      operation: 'clone' | 'checkout' | 'commit' | 'push' | 'pull' | 'merge' | 'rebase';
      exitCode?: number;
      command?: string;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    }
  ) {
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
 * Claude API executor error with comprehensive execution context
 */
export class ClaudeExecutorError extends ExecutorError {
  /** Claude-specific error type */
  public readonly claudeErrorType: 'timeout' | 'rate_limit' | 'quota' | 'auth' | 'api' | 'invalid_response';
  /** Tools used before error */
  public readonly toolsUsed?: number;
  /** Turns completed before error */
  public readonly turnsCompleted?: number;
  /** Comprehensive Claude execution context for debugging */
  public readonly claudeExecutionContext?: ClaudeExecutionContext;

  constructor(
    message: string,
    options: {
      claudeErrorType: 'timeout' | 'rate_limit' | 'quota' | 'auth' | 'api' | 'invalid_response';
      toolsUsed?: number;
      turnsCompleted?: number;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      claudeExecutionContext?: ClaudeExecutionContext;
      cause?: Error;
    }
  ) {
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
    this.claudeExecutionContext = options.claudeExecutionContext;
  }

  /**
   * Get a formatted summary of the error context for logging
   */
  getErrorContextSummary(): string {
    const lines: string[] = [];

    lines.push(`Claude Execution Error: ${this.claudeErrorType}`);
    lines.push(`Message: ${this.message}`);

    if (this.claudeExecutionContext) {
      const ctx = this.claudeExecutionContext;

      lines.push('');
      lines.push('=== Execution Context ===');

      if (ctx.taskDescription) {
        lines.push(`Task: ${ctx.taskDescription}`);
      }

      lines.push(`Phase: ${ctx.executionPhase}`);
      lines.push(`Duration: ${ctx.executionDurationMs}ms`);
      lines.push(`Turns Completed: ${ctx.turnsCompleted}`);
      lines.push(`Total Tools Used: ${ctx.totalToolsUsed}`);

      if (ctx.currentTool) {
        lines.push('');
        lines.push('=== Tool at Error ===');
        lines.push(`Tool: ${ctx.currentTool}`);
        if (ctx.currentToolInput) {
          lines.push(`Input: ${JSON.stringify(ctx.currentToolInput, null, 2)}`);
        }
      }

      if (ctx.recentToolCalls.length > 0) {
        lines.push('');
        lines.push(`=== Recent Tool Calls (last ${ctx.recentToolCalls.length}) ===`);
        for (const call of ctx.recentToolCalls) {
          const timestamp = new Date(call.timestamp).toISOString();
          const writeMarker = call.isWriteOperation ? ' [WRITE]' : '';
          const pathInfo = call.filePath ? ` -> ${call.filePath}` : '';
          lines.push(`  ${timestamp}: ${call.toolName}${writeMarker}${pathInfo}`);
        }
      }

      if (ctx.fileChangesSummary.totalOperations > 0) {
        lines.push('');
        lines.push('=== File Changes Summary ===');
        if (ctx.fileChangesSummary.created.length > 0) {
          lines.push(`Created (${ctx.fileChangesSummary.created.length}):`);
          ctx.fileChangesSummary.created.forEach(f => lines.push(`  + ${f}`));
        }
        if (ctx.fileChangesSummary.modified.length > 0) {
          lines.push(`Modified (${ctx.fileChangesSummary.modified.length}):`);
          ctx.fileChangesSummary.modified.forEach(f => lines.push(`  ~ ${f}`));
        }
        if (ctx.fileChangesSummary.deleted.length > 0) {
          lines.push(`Deleted (${ctx.fileChangesSummary.deleted.length}):`);
          ctx.fileChangesSummary.deleted.forEach(f => lines.push(`  - ${f}`));
        }
      }

      if (ctx.lastAssistantText) {
        lines.push('');
        lines.push('=== Last Assistant Output ===');
        // Truncate to avoid huge logs
        const truncatedText = ctx.lastAssistantText.length > 500
          ? ctx.lastAssistantText.substring(0, 500) + '...'
          : ctx.lastAssistantText;
        lines.push(truncatedText);
      }
    }

    return lines.join('\n');
  }

  /**
   * Convert to JSON with execution context
   */
  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      claudeErrorType: this.claudeErrorType,
      toolsUsed: this.toolsUsed,
      turnsCompleted: this.turnsCompleted,
      claudeExecutionContext: this.claudeExecutionContext,
    };
  }
}

/**
 * Workspace/filesystem executor error
 */
export class WorkspaceExecutorError extends ExecutorError {
  /** Workspace operation that failed */
  public readonly operation: 'create' | 'cleanup' | 'read' | 'write' | 'delete';
  /** Path involved in the error */
  public readonly path?: string;

  constructor(
    message: string,
    options: {
      operation: 'create' | 'cleanup' | 'read' | 'write' | 'delete';
      path?: string;
      recoveryStrategy?: RecoveryStrategyConfig;
      context?: ExecutorErrorContext;
      executionState?: TaskExecutionState;
      cause?: Error;
    }
  ) {
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
  private errors: Array<{
    error: ExecutorError | StructuredError;
    timestamp: Date;
    taskId?: string;
    workerId?: string;
  }> = [];

  /**
   * Add an error to the aggregator
   */
  addError(
    error: ExecutorError | StructuredError,
    metadata?: { taskId?: string; workerId?: string }
  ): void {
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
  getErrorCountsByCode(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const { error } of this.errors) {
      counts[error.code] = (counts[error.code] || 0) + 1;
    }
    return counts;
  }

  /**
   * Get error counts by severity
   */
  getErrorCountsBySeverity(): Record<ErrorSeverity, number> {
    const counts: Record<ErrorSeverity, number> = {
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
  getRetryStats(): {
    totalRetryable: number;
    totalNonRetryable: number;
    byStrategy: Record<RecoveryStrategy, number>;
  } {
    let totalRetryable = 0;
    let totalNonRetryable = 0;
    const byStrategy: Record<RecoveryStrategy, number> = {
      retry: 0,
      escalate: 0,
      skip: 0,
      rollback: 0,
      manual: 0,
    };

    for (const { error } of this.errors) {
      if (error.isRetryable) {
        totalRetryable++;
      } else {
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
  getMostCommonErrors(limit: number = 5): Array<{
    code: string;
    count: number;
    percentage: number;
    examples: string[];
  }> {
    const errorsByCode = new Map<string, { count: number; messages: string[] }>();

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
  getErrorsInWindow(windowMs: number): Array<ExecutorError | StructuredError> {
    const cutoff = Date.now() - windowMs;
    return this.errors
      .filter(({ timestamp }) => timestamp.getTime() >= cutoff)
      .map(({ error }) => error);
  }

  /**
   * Get summary for reporting
   */
  getSummary(): {
    totalErrors: number;
    bySeverity: Record<ErrorSeverity, number>;
    byCode: Record<string, number>;
    retryStats: ReturnType<ErrorAggregator['getRetryStats']>;
    mostCommon: ReturnType<ErrorAggregator['getMostCommonErrors']>;
    timeSpan: { start?: Date; end?: Date };
  } {
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
  clear(): void {
    this.errors = [];
  }

  /**
   * Get all errors
   */
  getAllErrors(): Array<{
    error: ExecutorError | StructuredError;
    timestamp: Date;
    taskId?: string;
    workerId?: string;
  }> {
    return [...this.errors];
  }
}

// Helper functions

/**
 * Get default recovery strategy based on error code
 */
function getDefaultRecoveryStrategy(code: ErrorCode): RecoveryStrategyConfig {
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
function buildRecoveryActionsFromStrategy(
  strategy: RecoveryStrategyConfig,
  code: ErrorCode
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

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
function determineNetworkErrorCode(statusCode?: number, networkErrorCode?: string): ErrorCode {
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
function determineGitErrorCode(operation: string): ErrorCode {
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
function getGitRecoveryInstructions(operation: string): string[] {
  const instructions: Record<string, string[]> = {
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
function determineClaudeErrorCode(errorType: string): ErrorCode {
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
function getClaudeRecoveryInstructions(errorType: string): string[] {
  const instructions: Record<string, string[]> = {
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
export function createExecutorError(
  error: unknown,
  context?: ExecutorErrorContext
): ExecutorError {
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
  if (
    messageLower.includes('network') ||
    messageLower.includes('enotfound') ||
    messageLower.includes('econnreset') ||
    messageLower.includes('econnrefused') ||
    messageLower.includes('etimedout')
  ) {
    return new NetworkExecutorError(message, {
      context,
      cause,
    });
  }

  // Detect Claude errors
  if (
    messageLower.includes('claude') ||
    messageLower.includes('anthropic') ||
    messageLower.includes('rate limit')
  ) {
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
  if (
    messageLower.includes('git') ||
    messageLower.includes('clone') ||
    messageLower.includes('push') ||
    messageLower.includes('commit')
  ) {
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
let globalErrorAggregator: ErrorAggregator | undefined;

/**
 * Get the global error aggregator instance
 */
export function getErrorAggregator(): ErrorAggregator {
  if (!globalErrorAggregator) {
    globalErrorAggregator = new ErrorAggregator();
  }
  return globalErrorAggregator;
}

/**
 * Type guard to check if error is an ExecutorError
 */
export function isExecutorError(error: unknown): error is ExecutorError {
  return error instanceof ExecutorError;
}

/**
 * Type guard to check if error is a NetworkExecutorError
 */
export function isNetworkExecutorError(error: unknown): error is NetworkExecutorError {
  return error instanceof NetworkExecutorError;
}

/**
 * Type guard to check if error is a TimeoutExecutorError
 */
export function isTimeoutExecutorError(error: unknown): error is TimeoutExecutorError {
  return error instanceof TimeoutExecutorError;
}

/**
 * Type guard to check if error is a ClaudeExecutorError
 */
export function isClaudeExecutorError(error: unknown): error is ClaudeExecutorError {
  return error instanceof ClaudeExecutorError;
}

/**
 * Type guard to check if error is a GitExecutorError
 */
export function isGitExecutorError(error: unknown): error is GitExecutorError {
  return error instanceof GitExecutorError;
}
