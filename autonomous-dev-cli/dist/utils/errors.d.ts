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
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED",
    DB_USER_NOT_FOUND = "DB_USER_NOT_FOUND",
    DB_QUERY_FAILED = "DB_QUERY_FAILED",
    EXEC_WORKSPACE_FAILED = "EXEC_WORKSPACE_FAILED",
    EXEC_CLONE_FAILED = "EXEC_CLONE_FAILED",
    EXEC_BRANCH_FAILED = "EXEC_BRANCH_FAILED",
    EXEC_NO_CHANGES = "EXEC_NO_CHANGES",
    EXEC_COMMIT_FAILED = "EXEC_COMMIT_FAILED",
    EXEC_PUSH_FAILED = "EXEC_PUSH_FAILED",
    EXEC_TIMEOUT = "EXEC_TIMEOUT",
    ANALYZER_PATH_NOT_FOUND = "ANALYZER_PATH_NOT_FOUND",
    ANALYZER_PATH_NOT_READABLE = "ANALYZER_PATH_NOT_READABLE",
    ANALYZER_PATH_NOT_DIRECTORY = "ANALYZER_PATH_NOT_DIRECTORY",
    ANALYZER_INVALID_GLOB_PATTERN = "ANALYZER_INVALID_GLOB_PATTERN",
    ANALYZER_INVALID_REGEX_PATTERN = "ANALYZER_INVALID_REGEX_PATTERN",
    ANALYZER_MAX_DEPTH_EXCEEDED = "ANALYZER_MAX_DEPTH_EXCEEDED",
    ANALYZER_MAX_FILES_EXCEEDED = "ANALYZER_MAX_FILES_EXCEEDED",
    ANALYZER_INVALID_CONFIG = "ANALYZER_INVALID_CONFIG",
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
//# sourceMappingURL=errors.d.ts.map