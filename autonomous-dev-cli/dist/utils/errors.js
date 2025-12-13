/**
 * Structured error handling system with error codes, severity levels, and recovery suggestions.
 */
/**
 * Error codes for all known error types
 */
export var ErrorCode;
(function (ErrorCode) {
    // GitHub errors (1000-1999)
    ErrorCode["GITHUB_AUTH_FAILED"] = "GITHUB_AUTH_FAILED";
    ErrorCode["GITHUB_RATE_LIMITED"] = "GITHUB_RATE_LIMITED";
    ErrorCode["GITHUB_REPO_NOT_FOUND"] = "GITHUB_REPO_NOT_FOUND";
    ErrorCode["GITHUB_PERMISSION_DENIED"] = "GITHUB_PERMISSION_DENIED";
    ErrorCode["GITHUB_API_ERROR"] = "GITHUB_API_ERROR";
    ErrorCode["GITHUB_NETWORK_ERROR"] = "GITHUB_NETWORK_ERROR";
    ErrorCode["GITHUB_BRANCH_NOT_FOUND"] = "GITHUB_BRANCH_NOT_FOUND";
    ErrorCode["GITHUB_PR_CONFLICT"] = "GITHUB_PR_CONFLICT";
    ErrorCode["GITHUB_ISSUE_NOT_FOUND"] = "GITHUB_ISSUE_NOT_FOUND";
    ErrorCode["GITHUB_CIRCUIT_OPEN"] = "GITHUB_CIRCUIT_OPEN";
    ErrorCode["GITHUB_SERVICE_DEGRADED"] = "GITHUB_SERVICE_DEGRADED";
    // Claude/AI errors (2000-2999)
    ErrorCode["CLAUDE_AUTH_FAILED"] = "CLAUDE_AUTH_FAILED";
    ErrorCode["CLAUDE_QUOTA_EXCEEDED"] = "CLAUDE_QUOTA_EXCEEDED";
    ErrorCode["CLAUDE_RATE_LIMITED"] = "CLAUDE_RATE_LIMITED";
    ErrorCode["CLAUDE_TIMEOUT"] = "CLAUDE_TIMEOUT";
    ErrorCode["CLAUDE_NETWORK_ERROR"] = "CLAUDE_NETWORK_ERROR";
    ErrorCode["CLAUDE_API_ERROR"] = "CLAUDE_API_ERROR";
    ErrorCode["CLAUDE_INVALID_RESPONSE"] = "CLAUDE_INVALID_RESPONSE";
    // Configuration errors (3000-3999)
    ErrorCode["CONFIG_INVALID"] = "CONFIG_INVALID";
    ErrorCode["CONFIG_MISSING_REQUIRED"] = "CONFIG_MISSING_REQUIRED";
    ErrorCode["CONFIG_FILE_NOT_FOUND"] = "CONFIG_FILE_NOT_FOUND";
    ErrorCode["CONFIG_PARSE_ERROR"] = "CONFIG_PARSE_ERROR";
    ErrorCode["CONFIG_VALIDATION_FAILED"] = "CONFIG_VALIDATION_FAILED";
    // Database errors (4000-4999)
    ErrorCode["DB_CONNECTION_FAILED"] = "DB_CONNECTION_FAILED";
    ErrorCode["DB_USER_NOT_FOUND"] = "DB_USER_NOT_FOUND";
    ErrorCode["DB_QUERY_FAILED"] = "DB_QUERY_FAILED";
    ErrorCode["DB_QUERY_TIMEOUT"] = "DB_QUERY_TIMEOUT";
    ErrorCode["DB_CONSTRAINT_VIOLATION"] = "DB_CONSTRAINT_VIOLATION";
    ErrorCode["DB_TRANSACTION_FAILED"] = "DB_TRANSACTION_FAILED";
    ErrorCode["DB_POOL_EXHAUSTED"] = "DB_POOL_EXHAUSTED";
    // Execution errors (5000-5999)
    ErrorCode["EXEC_WORKSPACE_FAILED"] = "EXEC_WORKSPACE_FAILED";
    ErrorCode["EXEC_CLONE_FAILED"] = "EXEC_CLONE_FAILED";
    ErrorCode["EXEC_BRANCH_FAILED"] = "EXEC_BRANCH_FAILED";
    ErrorCode["EXEC_NO_CHANGES"] = "EXEC_NO_CHANGES";
    ErrorCode["EXEC_COMMIT_FAILED"] = "EXEC_COMMIT_FAILED";
    ErrorCode["EXEC_PUSH_FAILED"] = "EXEC_PUSH_FAILED";
    ErrorCode["EXEC_TIMEOUT"] = "EXEC_TIMEOUT";
    // Analyzer errors (6000-6999)
    ErrorCode["ANALYZER_PATH_NOT_FOUND"] = "ANALYZER_PATH_NOT_FOUND";
    ErrorCode["ANALYZER_PATH_NOT_READABLE"] = "ANALYZER_PATH_NOT_READABLE";
    ErrorCode["ANALYZER_PATH_NOT_DIRECTORY"] = "ANALYZER_PATH_NOT_DIRECTORY";
    ErrorCode["ANALYZER_INVALID_GLOB_PATTERN"] = "ANALYZER_INVALID_GLOB_PATTERN";
    ErrorCode["ANALYZER_INVALID_REGEX_PATTERN"] = "ANALYZER_INVALID_REGEX_PATTERN";
    ErrorCode["ANALYZER_MAX_DEPTH_EXCEEDED"] = "ANALYZER_MAX_DEPTH_EXCEEDED";
    ErrorCode["ANALYZER_MAX_FILES_EXCEEDED"] = "ANALYZER_MAX_FILES_EXCEEDED";
    ErrorCode["ANALYZER_INVALID_CONFIG"] = "ANALYZER_INVALID_CONFIG";
    // Validation errors (7000-7999)
    ErrorCode["VALIDATION_FAILED"] = "VALIDATION_FAILED";
    ErrorCode["VALIDATION_REQUIRED_FIELD"] = "VALIDATION_REQUIRED_FIELD";
    ErrorCode["VALIDATION_INVALID_FORMAT"] = "VALIDATION_INVALID_FORMAT";
    ErrorCode["VALIDATION_OUT_OF_RANGE"] = "VALIDATION_OUT_OF_RANGE";
    ErrorCode["VALIDATION_INVALID_TYPE"] = "VALIDATION_INVALID_TYPE";
    ErrorCode["VALIDATION_SCHEMA_MISMATCH"] = "VALIDATION_SCHEMA_MISMATCH";
    // Conflict errors (8000-8999)
    ErrorCode["CONFLICT_MERGE_FAILED"] = "CONFLICT_MERGE_FAILED";
    ErrorCode["CONFLICT_BRANCH_DIVERGED"] = "CONFLICT_BRANCH_DIVERGED";
    ErrorCode["CONFLICT_FILE_MODIFIED"] = "CONFLICT_FILE_MODIFIED";
    ErrorCode["CONFLICT_CONCURRENT_EDIT"] = "CONFLICT_CONCURRENT_EDIT";
    ErrorCode["CONFLICT_RESOLUTION_FAILED"] = "CONFLICT_RESOLUTION_FAILED";
    // General errors (9000-9999)
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    ErrorCode["NOT_INITIALIZED"] = "NOT_INITIALIZED";
    ErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
    ErrorCode["SERVICE_DEGRADED"] = "SERVICE_DEGRADED";
    ErrorCode["CIRCUIT_BREAKER_OPEN"] = "CIRCUIT_BREAKER_OPEN";
    ErrorCode["OFFLINE_MODE"] = "OFFLINE_MODE";
})(ErrorCode || (ErrorCode = {}));
/**
 * Base structured error class
 */
export class StructuredError extends Error {
    code;
    severity;
    recoveryActions;
    context;
    cause;
    isRetryable;
    timestamp;
    constructor(code, message, options = {}) {
        super(message);
        this.name = 'StructuredError';
        this.code = code;
        this.severity = options.severity ?? this.inferSeverity(code);
        this.recoveryActions = options.recoveryActions ?? [];
        this.context = {
            ...options.context,
            timestamp: new Date().toISOString(),
        };
        this.cause = options.cause;
        this.isRetryable = options.isRetryable ?? this.inferRetryable(code);
        this.timestamp = new Date().toISOString();
        // Capture stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, StructuredError);
        }
    }
    inferSeverity(code) {
        // Transient errors that typically resolve on retry
        const transientCodes = [
            ErrorCode.GITHUB_RATE_LIMITED,
            ErrorCode.GITHUB_NETWORK_ERROR,
            ErrorCode.GITHUB_CIRCUIT_OPEN,
            ErrorCode.GITHUB_SERVICE_DEGRADED,
            ErrorCode.NETWORK_ERROR,
            ErrorCode.CLAUDE_TIMEOUT,
            ErrorCode.CLAUDE_RATE_LIMITED,
            ErrorCode.CLAUDE_NETWORK_ERROR,
            ErrorCode.DB_CONNECTION_FAILED,
            ErrorCode.DB_QUERY_TIMEOUT,
            ErrorCode.DB_POOL_EXHAUSTED,
            ErrorCode.SERVICE_DEGRADED,
            ErrorCode.CIRCUIT_BREAKER_OPEN,
            ErrorCode.CONFLICT_CONCURRENT_EDIT,
        ];
        if (transientCodes.includes(code))
            return 'transient';
        // Critical errors requiring immediate attention
        const criticalCodes = [
            ErrorCode.GITHUB_AUTH_FAILED,
            ErrorCode.CLAUDE_AUTH_FAILED,
            ErrorCode.CONFIG_INVALID,
            ErrorCode.CONFIG_MISSING_REQUIRED,
            ErrorCode.DB_CONSTRAINT_VIOLATION,
        ];
        if (criticalCodes.includes(code))
            return 'critical';
        // Warning for offline mode - not an error, just informational
        if (code === ErrorCode.OFFLINE_MODE)
            return 'warning';
        return 'error';
    }
    inferRetryable(code) {
        const retryableCodes = [
            ErrorCode.GITHUB_RATE_LIMITED,
            ErrorCode.GITHUB_NETWORK_ERROR,
            ErrorCode.GITHUB_CIRCUIT_OPEN,
            ErrorCode.GITHUB_SERVICE_DEGRADED,
            ErrorCode.NETWORK_ERROR,
            ErrorCode.CLAUDE_TIMEOUT,
            ErrorCode.CLAUDE_RATE_LIMITED,
            ErrorCode.CLAUDE_NETWORK_ERROR,
            ErrorCode.DB_CONNECTION_FAILED,
            ErrorCode.DB_QUERY_TIMEOUT,
            ErrorCode.DB_POOL_EXHAUSTED,
            ErrorCode.DB_TRANSACTION_FAILED,
            ErrorCode.EXEC_CLONE_FAILED,
            ErrorCode.EXEC_PUSH_FAILED,
            ErrorCode.SERVICE_DEGRADED,
            ErrorCode.CIRCUIT_BREAKER_OPEN,
            ErrorCode.CONFLICT_MERGE_FAILED,
            ErrorCode.CONFLICT_CONCURRENT_EDIT,
        ];
        return retryableCodes.includes(code);
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            severity: this.severity,
            isRetryable: this.isRetryable,
            recoveryActions: this.recoveryActions.map((a) => ({
                description: a.description,
                automatic: a.automatic,
            })),
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack,
            cause: this.cause?.message,
        };
    }
    getRecoverySuggestions() {
        return this.recoveryActions.map((a) => a.description);
    }
}
/**
 * GitHub-specific error
 */
export class GitHubError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getGitHubRecoveryActions(code, options.statusCode);
        super(code, message, {
            severity: getGitHubSeverity(code, options.statusCode),
            recoveryActions,
            context: {
                ...options.context,
                statusCode: options.statusCode,
                endpoint: options.endpoint,
            },
            cause: options.cause,
            isRetryable: isGitHubRetryable(code, options.statusCode),
        });
        this.name = 'GitHubError';
    }
}
function getGitHubSeverity(code, statusCode) {
    if (statusCode === 429)
        return 'transient';
    if (statusCode === 401 || statusCode === 403)
        return 'critical';
    if (statusCode && statusCode >= 500)
        return 'transient';
    return 'error';
}
function isGitHubRetryable(code, statusCode) {
    if (statusCode === 429)
        return true;
    if (statusCode && statusCode >= 500)
        return true;
    if (code === ErrorCode.GITHUB_NETWORK_ERROR)
        return true;
    return false;
}
function getGitHubRecoveryActions(code, statusCode) {
    const actions = [];
    switch (code) {
        case ErrorCode.GITHUB_AUTH_FAILED:
            actions.push({
                description: 'Verify your GitHub token is valid and not expired',
                automatic: false,
            });
            actions.push({
                description: 'Generate a new token at https://github.com/settings/tokens',
                automatic: false,
            });
            actions.push({
                description: 'Ensure the token has required scopes: repo, workflow',
                automatic: false,
            });
            break;
        case ErrorCode.GITHUB_RATE_LIMITED:
            actions.push({
                description: 'Wait for rate limit reset (check X-RateLimit-Reset header)',
                automatic: true,
            });
            actions.push({
                description: 'Consider using a GitHub App for higher rate limits',
                automatic: false,
            });
            break;
        case ErrorCode.GITHUB_REPO_NOT_FOUND:
            actions.push({
                description: 'Verify the repository owner and name are correct',
                automatic: false,
            });
            actions.push({
                description: 'Check that your token has access to the repository',
                automatic: false,
            });
            break;
        case ErrorCode.GITHUB_PERMISSION_DENIED:
            actions.push({
                description: 'Request access to the repository from the owner',
                automatic: false,
            });
            actions.push({
                description: 'Verify your token has the required permissions',
                automatic: false,
            });
            break;
        case ErrorCode.GITHUB_NETWORK_ERROR:
            actions.push({
                description: 'Check your network connection',
                automatic: false,
            });
            actions.push({
                description: 'Retry the operation',
                automatic: true,
            });
            break;
        case ErrorCode.GITHUB_PR_CONFLICT:
            actions.push({
                description: 'Rebase the branch on the latest base branch',
                automatic: true,
            });
            actions.push({
                description: 'Resolve conflicts manually if automatic rebase fails',
                automatic: false,
            });
            break;
        case ErrorCode.GITHUB_CIRCUIT_OPEN:
        case ErrorCode.GITHUB_SERVICE_DEGRADED:
            actions.push({
                description: 'Wait for circuit breaker timeout to allow recovery attempts',
                automatic: true,
            });
            actions.push({
                description: 'Check GitHub status at https://www.githubstatus.com/',
                automatic: false,
            });
            actions.push({
                description: 'Operations will continue with graceful degradation',
                automatic: true,
            });
            break;
    }
    return actions;
}
/**
 * Claude/AI-specific error
 */
export class ClaudeError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getClaudeRecoveryActions(code);
        super(code, message, {
            severity: getClaudeSeverity(code),
            recoveryActions,
            context: options.context,
            cause: options.cause,
        });
        this.name = 'ClaudeError';
    }
}
function getClaudeSeverity(code) {
    switch (code) {
        case ErrorCode.CLAUDE_AUTH_FAILED:
        case ErrorCode.CLAUDE_QUOTA_EXCEEDED:
            return 'critical';
        case ErrorCode.CLAUDE_TIMEOUT:
        case ErrorCode.CLAUDE_RATE_LIMITED:
        case ErrorCode.CLAUDE_NETWORK_ERROR:
            return 'transient';
        default:
            return 'error';
    }
}
function getClaudeRecoveryActions(code) {
    const actions = [];
    switch (code) {
        case ErrorCode.CLAUDE_AUTH_FAILED:
            actions.push({
                description: 'Verify your Claude API credentials are valid',
                automatic: false,
            });
            actions.push({
                description: 'Refresh your Claude access token if expired',
                automatic: true,
            });
            actions.push({
                description: 'Re-authenticate with Claude using the auth command',
                automatic: false,
            });
            break;
        case ErrorCode.CLAUDE_QUOTA_EXCEEDED:
            actions.push({
                description: 'Wait for your quota to reset',
                automatic: false,
            });
            actions.push({
                description: 'Upgrade your Claude subscription for higher limits',
                automatic: false,
            });
            actions.push({
                description: 'Reduce task complexity to use fewer tokens',
                automatic: false,
            });
            break;
        case ErrorCode.CLAUDE_RATE_LIMITED:
            actions.push({
                description: 'Wait for rate limit reset (check Retry-After header)',
                automatic: true,
            });
            actions.push({
                description: 'Retry the operation with exponential backoff',
                automatic: true,
            });
            actions.push({
                description: 'Reduce request frequency to stay within limits',
                automatic: false,
            });
            break;
        case ErrorCode.CLAUDE_NETWORK_ERROR:
            actions.push({
                description: 'Check your network connection',
                automatic: false,
            });
            actions.push({
                description: 'Retry the operation',
                automatic: true,
            });
            actions.push({
                description: 'Check https://status.anthropic.com for service status',
                automatic: false,
            });
            break;
        case ErrorCode.CLAUDE_TIMEOUT:
            actions.push({
                description: 'Increase the timeout setting in configuration',
                automatic: false,
            });
            actions.push({
                description: 'Retry with a simpler task',
                automatic: true,
            });
            break;
    }
    return actions;
}
/**
 * Configuration-specific error
 */
export class ConfigError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getConfigRecoveryActions(code, options.field);
        super(code, message, {
            severity: 'critical',
            recoveryActions,
            context: {
                ...options.context,
                field: options.field,
                invalidValue: options.value,
                expectedType: options.expectedType,
            },
            cause: options.cause,
            isRetryable: false,
        });
        this.name = 'ConfigError';
    }
}
function getConfigRecoveryActions(code, field) {
    const actions = [];
    actions.push({
        description: 'Run "autonomous-dev help-config" for configuration documentation',
        automatic: false,
    });
    actions.push({
        description: 'Run "autonomous-dev init" to create a new configuration file',
        automatic: false,
    });
    if (field) {
        actions.push({
            description: `Check the value of "${field}" in your configuration`,
            automatic: false,
        });
    }
    return actions;
}
/**
 * Execution-specific error
 */
export class ExecutionError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getExecutionRecoveryActions(code);
        super(code, message, {
            recoveryActions,
            context: {
                ...options.context,
                issueNumber: options.issueNumber,
                branchName: options.branchName,
            },
            cause: options.cause,
        });
        this.name = 'ExecutionError';
    }
}
/**
 * Analyzer-specific error
 */
export class AnalyzerError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getAnalyzerRecoveryActions(code);
        super(code, message, {
            severity: 'error',
            recoveryActions,
            context: {
                ...options.context,
                path: options.path,
                pattern: options.pattern,
                limit: options.limit,
            },
            cause: options.cause,
            isRetryable: false,
        });
        this.name = 'AnalyzerError';
    }
}
function getAnalyzerRecoveryActions(code) {
    const actions = [];
    switch (code) {
        case ErrorCode.ANALYZER_PATH_NOT_FOUND:
            actions.push({
                description: 'Verify the repository path exists and is correct',
                automatic: false,
            });
            actions.push({
                description: 'Check that the repository was cloned successfully',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_PATH_NOT_READABLE:
            actions.push({
                description: 'Check file system permissions for the repository directory',
                automatic: false,
            });
            actions.push({
                description: 'Ensure the user has read access to the repository',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_PATH_NOT_DIRECTORY:
            actions.push({
                description: 'Provide a path to a directory, not a file',
                automatic: false,
            });
            actions.push({
                description: 'Verify the repository path configuration',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_INVALID_GLOB_PATTERN:
            actions.push({
                description: 'Check glob pattern syntax - avoid nested quantifiers and excessive wildcards',
                automatic: false,
            });
            actions.push({
                description: 'Use simpler patterns like "*.js" or "src/**/*.ts"',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_INVALID_REGEX_PATTERN:
            actions.push({
                description: 'Verify the regex pattern compiles correctly',
                automatic: false,
            });
            actions.push({
                description: 'Test the pattern in a regex validator before using',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_MAX_DEPTH_EXCEEDED:
            actions.push({
                description: 'Reduce maxDepth configuration value (must be 1-20)',
                automatic: false,
            });
            actions.push({
                description: 'Use excludePaths to skip deeply nested directories',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_MAX_FILES_EXCEEDED:
            actions.push({
                description: 'Reduce maxFiles configuration value (must be 100-50000)',
                automatic: false,
            });
            actions.push({
                description: 'Add more paths to excludePaths to reduce files scanned',
                automatic: false,
            });
            break;
        case ErrorCode.ANALYZER_INVALID_CONFIG:
            actions.push({
                description: 'Check analyzer configuration values are within valid ranges',
                automatic: false,
            });
            actions.push({
                description: 'Run "autonomous-dev help-config" for configuration documentation',
                automatic: false,
            });
            break;
    }
    return actions;
}
/**
 * Database-specific error for database operations
 */
export class DatabaseError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getDatabaseRecoveryActions(code);
        super(code, message, {
            severity: getDatabaseSeverity(code),
            recoveryActions,
            context: {
                ...options.context,
                query: options.query,
                table: options.table,
            },
            cause: options.cause,
            isRetryable: isDatabaseRetryable(code),
        });
        this.name = 'DatabaseError';
    }
}
function getDatabaseSeverity(code) {
    switch (code) {
        case ErrorCode.DB_CONNECTION_FAILED:
        case ErrorCode.DB_QUERY_TIMEOUT:
        case ErrorCode.DB_POOL_EXHAUSTED:
        case ErrorCode.DB_TRANSACTION_FAILED:
            return 'transient';
        case ErrorCode.DB_CONSTRAINT_VIOLATION:
            return 'critical';
        default:
            return 'error';
    }
}
function isDatabaseRetryable(code) {
    const retryableCodes = [
        ErrorCode.DB_CONNECTION_FAILED,
        ErrorCode.DB_QUERY_TIMEOUT,
        ErrorCode.DB_POOL_EXHAUSTED,
        ErrorCode.DB_TRANSACTION_FAILED,
    ];
    return retryableCodes.includes(code);
}
function getDatabaseRecoveryActions(code) {
    const actions = [];
    switch (code) {
        case ErrorCode.DB_CONNECTION_FAILED:
            actions.push({
                description: 'Check database connection string is correct',
                automatic: false,
            });
            actions.push({
                description: 'Verify database server is running and accessible',
                automatic: false,
            });
            actions.push({
                description: 'Retry the connection',
                automatic: true,
            });
            break;
        case ErrorCode.DB_USER_NOT_FOUND:
            actions.push({
                description: 'Verify the user email is correct',
                automatic: false,
            });
            actions.push({
                description: 'Check that the user exists in the database',
                automatic: false,
            });
            break;
        case ErrorCode.DB_QUERY_FAILED:
            actions.push({
                description: 'Check the query syntax and parameters',
                automatic: false,
            });
            actions.push({
                description: 'Verify database permissions',
                automatic: false,
            });
            break;
        case ErrorCode.DB_QUERY_TIMEOUT:
            actions.push({
                description: 'Increase query timeout in configuration',
                automatic: false,
            });
            actions.push({
                description: 'Optimize the query or add database indexes',
                automatic: false,
            });
            actions.push({
                description: 'Retry the query',
                automatic: true,
            });
            break;
        case ErrorCode.DB_CONSTRAINT_VIOLATION:
            actions.push({
                description: 'Check for duplicate keys or foreign key violations',
                automatic: false,
            });
            actions.push({
                description: 'Verify data integrity before insert/update',
                automatic: false,
            });
            break;
        case ErrorCode.DB_TRANSACTION_FAILED:
            actions.push({
                description: 'Retry the transaction',
                automatic: true,
            });
            actions.push({
                description: 'Check for deadlocks or resource contention',
                automatic: false,
            });
            break;
        case ErrorCode.DB_POOL_EXHAUSTED:
            actions.push({
                description: 'Wait for connections to be released',
                automatic: true,
            });
            actions.push({
                description: 'Increase connection pool size in configuration',
                automatic: false,
            });
            actions.push({
                description: 'Check for connection leaks',
                automatic: false,
            });
            break;
    }
    return actions;
}
/**
 * Validation-specific error for input/data validation
 */
export class ValidationError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getValidationRecoveryActions(code, options.field);
        super(code, message, {
            severity: 'error',
            recoveryActions,
            context: {
                ...options.context,
                field: options.field,
                invalidValue: options.value,
                expectedType: options.expectedType,
                constraints: options.constraints,
            },
            cause: options.cause,
            isRetryable: false,
        });
        this.name = 'ValidationError';
    }
}
function getValidationRecoveryActions(code, field) {
    const actions = [];
    switch (code) {
        case ErrorCode.VALIDATION_FAILED:
            actions.push({
                description: 'Review the input data for errors',
                automatic: false,
            });
            break;
        case ErrorCode.VALIDATION_REQUIRED_FIELD:
            if (field) {
                actions.push({
                    description: `Provide a value for the required field "${field}"`,
                    automatic: false,
                });
            }
            else {
                actions.push({
                    description: 'Provide values for all required fields',
                    automatic: false,
                });
            }
            break;
        case ErrorCode.VALIDATION_INVALID_FORMAT:
            actions.push({
                description: 'Check the format of the input value',
                automatic: false,
            });
            if (field) {
                actions.push({
                    description: `Ensure "${field}" matches the expected format`,
                    automatic: false,
                });
            }
            break;
        case ErrorCode.VALIDATION_OUT_OF_RANGE:
            actions.push({
                description: 'Ensure the value is within the allowed range',
                automatic: false,
            });
            break;
        case ErrorCode.VALIDATION_INVALID_TYPE:
            actions.push({
                description: 'Provide a value of the correct type',
                automatic: false,
            });
            break;
        case ErrorCode.VALIDATION_SCHEMA_MISMATCH:
            actions.push({
                description: 'Check the data structure matches the expected schema',
                automatic: false,
            });
            actions.push({
                description: 'Review the API documentation for the correct format',
                automatic: false,
            });
            break;
    }
    return actions;
}
/**
 * Conflict-specific error for merge and concurrent edit conflicts
 */
export class ConflictError extends StructuredError {
    constructor(code, message, options = {}) {
        const recoveryActions = options.recoveryActions ?? getConflictRecoveryActions(code);
        super(code, message, {
            severity: getConflictSeverity(code),
            recoveryActions,
            context: {
                ...options.context,
                branchName: options.branchName,
                baseBranch: options.baseBranch,
                conflictingFiles: options.conflictingFiles,
            },
            cause: options.cause,
            isRetryable: isConflictRetryable(code),
        });
        this.name = 'ConflictError';
    }
}
function getConflictSeverity(code) {
    switch (code) {
        case ErrorCode.CONFLICT_CONCURRENT_EDIT:
            return 'transient';
        case ErrorCode.CONFLICT_RESOLUTION_FAILED:
            return 'critical';
        default:
            return 'error';
    }
}
function isConflictRetryable(code) {
    const retryableCodes = [
        ErrorCode.CONFLICT_MERGE_FAILED,
        ErrorCode.CONFLICT_CONCURRENT_EDIT,
    ];
    return retryableCodes.includes(code);
}
function getConflictRecoveryActions(code) {
    const actions = [];
    switch (code) {
        case ErrorCode.CONFLICT_MERGE_FAILED:
            actions.push({
                description: 'Pull the latest changes from the base branch',
                automatic: true,
            });
            actions.push({
                description: 'Resolve merge conflicts manually',
                automatic: false,
            });
            actions.push({
                description: 'Retry the merge operation',
                automatic: true,
            });
            break;
        case ErrorCode.CONFLICT_BRANCH_DIVERGED:
            actions.push({
                description: 'Rebase the branch onto the latest base branch',
                automatic: true,
            });
            actions.push({
                description: 'Create a new branch from the latest base',
                automatic: false,
            });
            break;
        case ErrorCode.CONFLICT_FILE_MODIFIED:
            actions.push({
                description: 'Review the modified files for conflicts',
                automatic: false,
            });
            actions.push({
                description: 'Merge the changes manually',
                automatic: false,
            });
            break;
        case ErrorCode.CONFLICT_CONCURRENT_EDIT:
            actions.push({
                description: 'Wait for the concurrent operation to complete',
                automatic: true,
            });
            actions.push({
                description: 'Retry the operation',
                automatic: true,
            });
            break;
        case ErrorCode.CONFLICT_RESOLUTION_FAILED:
            actions.push({
                description: 'Manually resolve the conflicts in the affected files',
                automatic: false,
            });
            actions.push({
                description: 'Consider using a different conflict resolution strategy',
                automatic: false,
            });
            break;
    }
    return actions;
}
function getExecutionRecoveryActions(code) {
    const actions = [];
    switch (code) {
        case ErrorCode.EXEC_CLONE_FAILED:
            actions.push({
                description: 'Verify network connectivity',
                automatic: false,
            });
            actions.push({
                description: 'Check that the repository URL is correct',
                automatic: false,
            });
            actions.push({
                description: 'Retry the clone operation',
                automatic: true,
            });
            break;
        case ErrorCode.EXEC_NO_CHANGES:
            actions.push({
                description: 'Review the issue description for clarity',
                automatic: false,
            });
            actions.push({
                description: 'Add more context to the issue',
                automatic: false,
            });
            break;
        case ErrorCode.EXEC_PUSH_FAILED:
            actions.push({
                description: 'Check for branch protection rules',
                automatic: false,
            });
            actions.push({
                description: 'Verify push permissions',
                automatic: false,
            });
            actions.push({
                description: 'Retry the push operation',
                automatic: true,
            });
            break;
        case ErrorCode.EXEC_TIMEOUT:
            actions.push({
                description: 'Increase the timeout configuration',
                automatic: false,
            });
            actions.push({
                description: 'Break down the task into smaller issues',
                automatic: false,
            });
            break;
    }
    return actions;
}
export const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
};
/**
 * Sleep for a specified duration
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Calculate delay for exponential backoff
 */
function calculateBackoffDelay(attempt, config) {
    const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, config.maxDelayMs);
}
/**
 * Execute a function with automatic retry and exponential backoff
 */
export async function withRetry(operation, options = {}) {
    const config = { ...DEFAULT_RETRY_CONFIG, ...options.config };
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            // Check if we should retry
            const isRetryable = options.shouldRetry?.(lastError) ??
                (lastError instanceof StructuredError && lastError.isRetryable);
            if (!isRetryable || attempt >= config.maxRetries) {
                throw lastError;
            }
            // Calculate delay and wait
            const delay = calculateBackoffDelay(attempt, config);
            options.onRetry?.(lastError, attempt + 1, delay);
            await sleep(delay);
        }
    }
    throw lastError;
}
/**
 * Wrap an error as a StructuredError if it isn't already
 */
export function wrapError(error, defaultCode = ErrorCode.UNKNOWN_ERROR, context) {
    if (error instanceof StructuredError) {
        // Add additional context if provided
        if (context) {
            return new StructuredError(error.code, error.message, {
                severity: error.severity,
                recoveryActions: error.recoveryActions,
                context: { ...error.context, ...context },
                cause: error.cause,
                isRetryable: error.isRetryable,
            });
        }
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;
    return new StructuredError(defaultCode, message, {
        context,
        cause,
    });
}
/**
 * Create a GitHub error from an Octokit error response
 */
export function createGitHubErrorFromResponse(error, endpoint, context) {
    const statusCode = error.status ?? error.response?.status;
    const message = error.message ?? 'GitHub API request failed';
    let code;
    switch (statusCode) {
        case 401:
            code = ErrorCode.GITHUB_AUTH_FAILED;
            break;
        case 403:
            if (message.toLowerCase().includes('rate limit')) {
                code = ErrorCode.GITHUB_RATE_LIMITED;
            }
            else {
                code = ErrorCode.GITHUB_PERMISSION_DENIED;
            }
            break;
        case 404:
            code = ErrorCode.GITHUB_REPO_NOT_FOUND;
            break;
        case 409:
            code = ErrorCode.GITHUB_PR_CONFLICT;
            break;
        default:
            if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
                code = ErrorCode.GITHUB_NETWORK_ERROR;
            }
            else {
                code = ErrorCode.GITHUB_API_ERROR;
            }
    }
    return new GitHubError(code, message, {
        statusCode,
        endpoint,
        context: {
            ...context,
            originalError: error.message,
            responseData: error.response?.data,
        },
        cause: error,
    });
}
/**
 * Format a StructuredError for display
 */
export function formatError(error) {
    const lines = [];
    lines.push(`[${error.code}] ${error.message}`);
    lines.push(`  Severity: ${error.severity}`);
    lines.push(`  Retryable: ${error.isRetryable ? 'yes' : 'no'}`);
    if (error.recoveryActions.length > 0) {
        lines.push('  Recovery suggestions:');
        for (const action of error.recoveryActions) {
            const prefix = action.automatic ? '(auto)' : '(manual)';
            lines.push(`    ${prefix} ${action.description}`);
        }
    }
    if (Object.keys(error.context).length > 0) {
        lines.push('  Context:');
        for (const [key, value] of Object.entries(error.context)) {
            if (value !== undefined) {
                lines.push(`    ${key}: ${JSON.stringify(value)}`);
            }
        }
    }
    return lines.join('\n');
}
//# sourceMappingURL=errors.js.map