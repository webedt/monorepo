/**
 * Structured error handling system with error codes, severity levels, and recovery suggestions.
 */
/**
 * Error severity levels
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'transient';
/**
 * Error codes for all known error types
 */
export declare enum ErrorCode {
    GITHUB_AUTH_FAILED = "GITHUB_AUTH_FAILED",
    GITHUB_RATE_LIMITED = "GITHUB_RATE_LIMITED",
    GITHUB_REPO_NOT_FOUND = "GITHUB_REPO_NOT_FOUND",
    GITHUB_PERMISSION_DENIED = "GITHUB_PERMISSION_DENIED",
    GITHUB_API_ERROR = "GITHUB_API_ERROR",
    GITHUB_NETWORK_ERROR = "GITHUB_NETWORK_ERROR",
    GITHUB_BRANCH_NOT_FOUND = "GITHUB_BRANCH_NOT_FOUND",
    GITHUB_PR_CONFLICT = "GITHUB_PR_CONFLICT",
    GITHUB_ISSUE_NOT_FOUND = "GITHUB_ISSUE_NOT_FOUND",
    GITHUB_CIRCUIT_OPEN = "GITHUB_CIRCUIT_OPEN",
    GITHUB_SERVICE_DEGRADED = "GITHUB_SERVICE_DEGRADED",
    CLAUDE_AUTH_FAILED = "CLAUDE_AUTH_FAILED",
    CLAUDE_QUOTA_EXCEEDED = "CLAUDE_QUOTA_EXCEEDED",
    CLAUDE_RATE_LIMITED = "CLAUDE_RATE_LIMITED",
    CLAUDE_TIMEOUT = "CLAUDE_TIMEOUT",
    CLAUDE_NETWORK_ERROR = "CLAUDE_NETWORK_ERROR",
    CLAUDE_API_ERROR = "CLAUDE_API_ERROR",
    CLAUDE_INVALID_RESPONSE = "CLAUDE_INVALID_RESPONSE",
    CONFIG_INVALID = "CONFIG_INVALID",
    CONFIG_MISSING_REQUIRED = "CONFIG_MISSING_REQUIRED",
    CONFIG_FILE_NOT_FOUND = "CONFIG_FILE_NOT_FOUND",
    CONFIG_PARSE_ERROR = "CONFIG_PARSE_ERROR",
    CONFIG_VALIDATION_FAILED = "CONFIG_VALIDATION_FAILED",
    CONFIG_PATH_TRAVERSAL = "CONFIG_PATH_TRAVERSAL",
    CONFIG_INVALID_PATH = "CONFIG_INVALID_PATH",
    CONFIG_UNSAFE_INPUT = "CONFIG_UNSAFE_INPUT",
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED",
    DB_USER_NOT_FOUND = "DB_USER_NOT_FOUND",
    DB_QUERY_FAILED = "DB_QUERY_FAILED",
    DB_QUERY_TIMEOUT = "DB_QUERY_TIMEOUT",
    DB_CONSTRAINT_VIOLATION = "DB_CONSTRAINT_VIOLATION",
    DB_TRANSACTION_FAILED = "DB_TRANSACTION_FAILED",
    DB_POOL_EXHAUSTED = "DB_POOL_EXHAUSTED",
    EXEC_WORKSPACE_FAILED = "EXEC_WORKSPACE_FAILED",
    EXEC_CLONE_FAILED = "EXEC_CLONE_FAILED",
    EXEC_BRANCH_FAILED = "EXEC_BRANCH_FAILED",
    EXEC_NO_CHANGES = "EXEC_NO_CHANGES",
    EXEC_COMMIT_FAILED = "EXEC_COMMIT_FAILED",
    EXEC_PUSH_FAILED = "EXEC_PUSH_FAILED",
    EXEC_TIMEOUT = "EXEC_TIMEOUT",
    CLEANUP_FAILED = "CLEANUP_FAILED",
    CLEANUP_TIMEOUT = "CLEANUP_TIMEOUT",
    CLEANUP_PERMISSION_DENIED = "CLEANUP_PERMISSION_DENIED",
    CLEANUP_FILE_LOCKED = "CLEANUP_FILE_LOCKED",
    ANALYZER_PATH_NOT_FOUND = "ANALYZER_PATH_NOT_FOUND",
    ANALYZER_PATH_NOT_READABLE = "ANALYZER_PATH_NOT_READABLE",
    ANALYZER_PATH_NOT_DIRECTORY = "ANALYZER_PATH_NOT_DIRECTORY",
    ANALYZER_INVALID_GLOB_PATTERN = "ANALYZER_INVALID_GLOB_PATTERN",
    ANALYZER_INVALID_REGEX_PATTERN = "ANALYZER_INVALID_REGEX_PATTERN",
    ANALYZER_MAX_DEPTH_EXCEEDED = "ANALYZER_MAX_DEPTH_EXCEEDED",
    ANALYZER_MAX_FILES_EXCEEDED = "ANALYZER_MAX_FILES_EXCEEDED",
    ANALYZER_INVALID_CONFIG = "ANALYZER_INVALID_CONFIG",
    VALIDATION_FAILED = "VALIDATION_FAILED",
    VALIDATION_REQUIRED_FIELD = "VALIDATION_REQUIRED_FIELD",
    VALIDATION_INVALID_FORMAT = "VALIDATION_INVALID_FORMAT",
    VALIDATION_OUT_OF_RANGE = "VALIDATION_OUT_OF_RANGE",
    VALIDATION_INVALID_TYPE = "VALIDATION_INVALID_TYPE",
    VALIDATION_SCHEMA_MISMATCH = "VALIDATION_SCHEMA_MISMATCH",
    CONFLICT_MERGE_FAILED = "CONFLICT_MERGE_FAILED",
    CONFLICT_BRANCH_DIVERGED = "CONFLICT_BRANCH_DIVERGED",
    CONFLICT_FILE_MODIFIED = "CONFLICT_FILE_MODIFIED",
    CONFLICT_CONCURRENT_EDIT = "CONFLICT_CONCURRENT_EDIT",
    CONFLICT_RESOLUTION_FAILED = "CONFLICT_RESOLUTION_FAILED",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    NETWORK_ERROR = "NETWORK_ERROR",
    NOT_INITIALIZED = "NOT_INITIALIZED",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    SERVICE_DEGRADED = "SERVICE_DEGRADED",
    CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN",
    OFFLINE_MODE = "OFFLINE_MODE"
}
/**
 * Recovery action that can be taken for an error
 */
export interface RecoveryAction {
    description: string;
    automatic: boolean;
    action?: () => Promise<void>;
}
/**
 * Context information for debugging
 */
export interface ErrorContext {
    operation?: string;
    component?: string;
    config?: Record<string, unknown>;
    systemState?: Record<string, unknown>;
    timestamp?: string;
    requestId?: string;
    [key: string]: unknown;
}
/**
 * Base structured error class
 */
export declare class StructuredError extends Error {
    readonly code: ErrorCode;
    readonly severity: ErrorSeverity;
    readonly recoveryActions: RecoveryAction[];
    readonly context: ErrorContext;
    readonly cause?: Error;
    readonly isRetryable: boolean;
    readonly timestamp: string;
    constructor(code: ErrorCode, message: string, options?: {
        severity?: ErrorSeverity;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
        isRetryable?: boolean;
    });
    private inferSeverity;
    private inferRetryable;
    toJSON(): Record<string, unknown>;
    getRecoverySuggestions(): string[];
}
/**
 * GitHub-specific error
 */
export declare class GitHubError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        statusCode?: number;
        endpoint?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Claude/AI-specific error
 */
export declare class ClaudeError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Configuration-specific error
 */
export declare class ConfigError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        field?: string;
        value?: unknown;
        expectedType?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Execution-specific error
 */
export declare class ExecutionError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        issueNumber?: number;
        branchName?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Analyzer-specific error
 */
export declare class AnalyzerError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        path?: string;
        pattern?: string;
        limit?: number;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Database-specific error for database operations
 */
export declare class DatabaseError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        query?: string;
        table?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Validation-specific error for input/data validation
 */
export declare class ValidationError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        field?: string;
        value?: unknown;
        expectedType?: string;
        constraints?: string[];
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Conflict-specific error for merge and concurrent edit conflicts
 */
export declare class ConflictError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        branchName?: string;
        baseBranch?: string;
        conflictingFiles?: string[];
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Retry configuration for exponential backoff
 */
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
}
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Execute a function with automatic retry and exponential backoff
 */
export declare function withRetry<T>(operation: () => Promise<T>, options?: {
    config?: Partial<RetryConfig>;
    onRetry?: (error: Error, attempt: number, delay: number) => void;
    shouldRetry?: (error: Error) => boolean;
}): Promise<T>;
/**
 * Wrap an error as a StructuredError if it isn't already
 */
export declare function wrapError(error: unknown, defaultCode?: ErrorCode, context?: ErrorContext): StructuredError;
/**
 * Create a GitHub error from an Octokit error response
 */
export declare function createGitHubErrorFromResponse(error: any, endpoint?: string, context?: ErrorContext): GitHubError;
/**
 * Format a StructuredError for display
 */
export declare function formatError(error: StructuredError): string;
/**
 * Type guard to check if an error is a StructuredError
 */
export declare function isStructuredError(error: unknown): error is StructuredError;
/**
 * Type guard to check if an error is a GitHubError
 */
export declare function isGitHubError(error: unknown): error is GitHubError;
/**
 * Type guard to check if an error is a ClaudeError
 */
export declare function isClaudeError(error: unknown): error is ClaudeError;
/**
 * Type guard to check if an error is a ConfigError
 */
export declare function isConfigError(error: unknown): error is ConfigError;
/**
 * Type guard to check if an error is a DatabaseError
 */
export declare function isDatabaseError(error: unknown): error is DatabaseError;
/**
 * Type guard to check if an error is a ValidationError
 */
export declare function isValidationError(error: unknown): error is ValidationError;
/**
 * Type guard to check if an error is an ExecutionError
 */
export declare function isExecutionError(error: unknown): error is ExecutionError;
/**
 * Safely extract error message from unknown error type
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * Safely extract error code from unknown error type
 */
export declare function getErrorCode(error: unknown): ErrorCode;
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Logger interface for withErrorLogging
 */
export interface ErrorLogger {
    error(message: string, context?: Record<string, unknown>): void;
    warn?(message: string, context?: Record<string, unknown>): void;
    debug?(message: string, context?: Record<string, unknown>): void;
    structuredError?(error: StructuredError, options?: {
        context?: ErrorContext;
        includeStack?: boolean;
        includeRecovery?: boolean;
    }): void;
}
/**
 * Options for withErrorLogging higher-order function
 */
export interface WithErrorLoggingOptions {
    /** Operation name for context */
    operation: string;
    /** Component/module name for context */
    component?: string;
    /** Default error code to use when wrapping non-structured errors */
    defaultErrorCode?: ErrorCode;
    /** Whether to rethrow the error after logging (default: true) */
    rethrow?: boolean;
    /** Custom error transformer to convert to specific error types */
    errorTransformer?: (error: unknown, context: ErrorContext) => StructuredError;
    /** Additional context to include in error logs */
    additionalContext?: Record<string, unknown>;
    /** Whether to include stack trace in logs (default: true for non-transient errors) */
    includeStack?: boolean;
    /** Whether to include recovery suggestions in logs (default: true) */
    includeRecovery?: boolean;
}
/**
 * Higher-order function to wrap async functions with consistent error logging
 * Reduces duplicate error handling patterns across the codebase
 *
 * @example
 * ```typescript
 * const fetchData = withErrorLogging(
 *   async () => {
 *     const response = await api.get('/data');
 *     return response.data;
 *   },
 *   logger,
 *   { operation: 'fetchData', component: 'DataService' }
 * );
 * ```
 */
export declare function withErrorLogging<T>(fn: () => Promise<T>, logger: ErrorLogger, options: WithErrorLoggingOptions): Promise<T>;
/**
 * Synchronous version of withErrorLogging for non-async functions
 */
export declare function withErrorLoggingSync<T>(fn: () => T, logger: ErrorLogger, options: WithErrorLoggingOptions): T;
/**
 * Create a wrapped version of a function with automatic error logging
 * Returns a new function that can be called multiple times
 */
export declare function createErrorLoggingWrapper<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Promise<TResult>, logger: ErrorLogger, options: WithErrorLoggingOptions): (...args: TArgs) => Promise<TResult>;
/**
 * Normalize an unknown error to a StructuredError
 * Use this when you need to handle errors in catch blocks with proper typing
 */
export declare function normalizeError(error: unknown, defaultCode?: ErrorCode, context?: ErrorContext): StructuredError;
//# sourceMappingURL=errors.d.ts.map