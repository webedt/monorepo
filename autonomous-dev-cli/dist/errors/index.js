/**
 * Centralized error handling module.
 *
 * This module re-exports all error-related types and classes from the utils/errors module
 * for more convenient importing and to provide a dedicated namespace for error handling.
 *
 * Usage:
 *   import { StructuredError, GitHubError, ErrorCode } from '../errors/index.js';
 *   // or
 *   import { StructuredError, GitHubError, ErrorCode } from '../errors/index.js';
 *
 * Error Class Hierarchy:
 *   StructuredError (base class)
 *   ├── GitHubError - GitHub API and service errors
 *   ├── ClaudeError - Claude/AI API errors
 *   ├── ConfigError - Configuration and settings errors
 *   ├── ExecutionError - Task execution errors
 *   ├── AnalyzerError - Codebase analysis errors
 *   ├── DatabaseError - Database operation errors
 *   ├── ValidationError - Input/data validation errors
 *   ├── ConflictError - Merge and concurrent edit conflicts
 *   └── ExecutorError (with recovery strategies)
 *       ├── NetworkExecutorError - Network-related executor failures
 *       ├── TimeoutExecutorError - Timeout-related executor failures
 *       ├── ConfigurationExecutorError - Configuration-related executor failures
 *       ├── ResourceExhaustionError - Resource exhaustion failures
 *       ├── GitExecutorError - Git operation failures
 *       ├── ClaudeExecutorError - Claude API executor failures
 *       └── WorkspaceExecutorError - Workspace/filesystem failures
 */
// Re-export all error types and utilities from the main errors module
export { 
// Error codes enum
ErrorCode, 
// Base error class
StructuredError, 
// Specialized error classes
GitHubError, ClaudeError, ConfigError, ExecutionError, AnalyzerError, DatabaseError, ValidationError, ConflictError, DEFAULT_RETRY_CONFIG, withRetry, 
// Error helper functions
wrapError, createGitHubErrorFromResponse, formatError, } from '../utils/errors.js';
// Re-export executor-specific error types and utilities
export { 
// Executor error classes with recovery strategies
ExecutorError, NetworkExecutorError, TimeoutExecutorError, ConfigurationExecutorError, ResourceExhaustionError, GitExecutorError, ClaudeExecutorError, WorkspaceExecutorError, 
// Error aggregation utilities
ErrorAggregator, getErrorAggregator, 
// Factory function for creating typed errors
createExecutorError, 
// Type guards for executor errors
isExecutorError, isNetworkExecutorError, isTimeoutExecutorError, isClaudeExecutorError, isGitExecutorError, } from './executor-errors.js';
/**
 * Type guard to check if an error is a StructuredError
 */
export function isStructuredError(error) {
    return error instanceof Error && 'code' in error && 'severity' in error && 'isRetryable' in error;
}
/**
 * Type guard to check if an error is a GitHubError
 */
export function isGitHubError(error) {
    return isStructuredError(error) && error.name === 'GitHubError';
}
/**
 * Type guard to check if an error is a ClaudeError
 */
export function isClaudeError(error) {
    return isStructuredError(error) && error.name === 'ClaudeError';
}
/**
 * Type guard to check if an error is a ConfigError
 */
export function isConfigError(error) {
    return isStructuredError(error) && error.name === 'ConfigError';
}
/**
 * Type guard to check if an error is an ExecutionError
 */
export function isExecutionError(error) {
    return isStructuredError(error) && error.name === 'ExecutionError';
}
/**
 * Type guard to check if an error is an AnalyzerError
 */
export function isAnalyzerError(error) {
    return isStructuredError(error) && error.name === 'AnalyzerError';
}
/**
 * Type guard to check if an error is a DatabaseError
 */
export function isDatabaseError(error) {
    return isStructuredError(error) && error.name === 'DatabaseError';
}
/**
 * Type guard to check if an error is a ValidationError
 */
export function isValidationError(error) {
    return isStructuredError(error) && error.name === 'ValidationError';
}
/**
 * Type guard to check if an error is a ConflictError
 */
export function isConflictError(error) {
    return isStructuredError(error) && error.name === 'ConflictError';
}
/**
 * Extract error message safely from any error type
 */
export function getErrorMessage(error) {
    if (isStructuredError(error)) {
        return `[${error.code}] ${error.message}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
/**
 * Extract error code safely from any error type
 */
export function getErrorCode(error) {
    if (isStructuredError(error)) {
        return error.code;
    }
    return undefined;
}
/**
 * Check if an error is retryable
 */
export function isRetryableError(error) {
    if (isStructuredError(error)) {
        return error.isRetryable;
    }
    return false;
}
/**
 * Get recovery suggestions from an error
 */
export function getRecoverySuggestions(error) {
    if (isStructuredError(error)) {
        return error.getRecoverySuggestions();
    }
    return [];
}
//# sourceMappingURL=index.js.map