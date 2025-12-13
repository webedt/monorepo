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
    CLAUDE_AUTH_FAILED = "CLAUDE_AUTH_FAILED",
    CLAUDE_QUOTA_EXCEEDED = "CLAUDE_QUOTA_EXCEEDED",
    CLAUDE_TIMEOUT = "CLAUDE_TIMEOUT",
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
    WORKSPACE_CREATE_FAILED = "WORKSPACE_CREATE_FAILED",
    WORKSPACE_CLEANUP_FAILED = "WORKSPACE_CLEANUP_FAILED",
    WORKSPACE_PERMISSION_DENIED = "WORKSPACE_PERMISSION_DENIED",
    WORKSPACE_DISK_FULL = "WORKSPACE_DISK_FULL",
    WORKSPACE_PATH_INVALID = "WORKSPACE_PATH_INVALID",
    BUILD_FAILED = "BUILD_FAILED",
    BUILD_TIMEOUT = "BUILD_TIMEOUT",
    BUILD_DEPENDENCY_MISSING = "BUILD_DEPENDENCY_MISSING",
    BUILD_CONFIG_INVALID = "BUILD_CONFIG_INVALID",
    BUILD_SCRIPT_NOT_FOUND = "BUILD_SCRIPT_NOT_FOUND",
    TEST_FAILED = "TEST_FAILED",
    TEST_TIMEOUT = "TEST_TIMEOUT",
    TEST_CONFIG_INVALID = "TEST_CONFIG_INVALID",
    TEST_SCRIPT_NOT_FOUND = "TEST_SCRIPT_NOT_FOUND",
    TEST_ENVIRONMENT_ERROR = "TEST_ENVIRONMENT_ERROR",
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
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
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
 * Workspace-specific error for file system and workspace operations
 */
export declare class WorkspaceError extends StructuredError {
    constructor(code: ErrorCode, message: string, options?: {
        path?: string;
        operation?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
}
/**
 * Build-specific error for compilation and build process failures
 */
export declare class BuildError extends StructuredError {
    readonly exitCode?: number;
    readonly buildOutput?: string;
    constructor(code: ErrorCode, message: string, options?: {
        exitCode?: number;
        buildOutput?: string;
        command?: string;
        repoPath?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
    /**
     * Get user-friendly error message with actionable suggestions
     */
    getUserFriendlyMessage(): string;
}
/**
 * Test-specific error for test execution failures
 */
export declare class TestError extends StructuredError {
    readonly exitCode?: number;
    readonly testOutput?: string;
    readonly testsRun?: number;
    readonly testsPassed?: number;
    readonly testsFailed?: number;
    constructor(code: ErrorCode, message: string, options?: {
        exitCode?: number;
        testOutput?: string;
        testsRun?: number;
        testsPassed?: number;
        testsFailed?: number;
        command?: string;
        repoPath?: string;
        recoveryActions?: RecoveryAction[];
        context?: ErrorContext;
        cause?: Error;
    });
    /**
     * Get user-friendly error message with test statistics and actionable suggestions
     */
    getUserFriendlyMessage(): string;
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
/**
 * Format an error for user-friendly display with clear next steps
 */
export declare function formatUserFriendlyError(error: StructuredError): string;
/**
 * Check if an error is considered critical and should trigger graceful shutdown
 */
export declare function isCriticalError(error: StructuredError): boolean;
/**
 * Check if an error is recoverable (daemon should continue running)
 */
export declare function isRecoverableError(error: StructuredError): boolean;
/**
 * Create an error boundary wrapper for async functions
 * Converts thrown errors to StructuredError and handles logging
 */
export declare function withErrorBoundary<T>(operation: () => Promise<T>, options: {
    operationName: string;
    component: string;
    defaultErrorCode?: ErrorCode;
    onError?: (error: StructuredError) => void;
    rethrow?: boolean;
}): Promise<T | null>;
//# sourceMappingURL=errors.d.ts.map