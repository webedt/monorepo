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
export { type ErrorSeverity, ErrorCode, type RecoveryAction, type ErrorContext, StructuredError, GitHubError, ClaudeError, ConfigError, ExecutionError, AnalyzerError, DatabaseError, ValidationError, ConflictError, type RetryConfig, DEFAULT_RETRY_CONFIG, withRetry, wrapError, createGitHubErrorFromResponse, formatError, } from '../utils/errors.js';
export { type RecoveryStrategy, type RecoveryStrategyConfig, type TaskExecutionState, type ExecutionPhase, type ExecutorErrorContext, ExecutorError, NetworkExecutorError, TimeoutExecutorError, ConfigurationExecutorError, ResourceExhaustionError, GitExecutorError, ClaudeExecutorError, WorkspaceExecutorError, ErrorAggregator, getErrorAggregator, createExecutorError, isExecutorError, isNetworkExecutorError, isTimeoutExecutorError, isClaudeExecutorError, isGitExecutorError, } from './executor-errors.js';
/**
 * Type guard to check if an error is a StructuredError
 */
export declare function isStructuredError(error: unknown): error is import('../utils/errors.js').StructuredError;
/**
 * Type guard to check if an error is a GitHubError
 */
export declare function isGitHubError(error: unknown): error is import('../utils/errors.js').GitHubError;
/**
 * Type guard to check if an error is a ClaudeError
 */
export declare function isClaudeError(error: unknown): error is import('../utils/errors.js').ClaudeError;
/**
 * Type guard to check if an error is a ConfigError
 */
export declare function isConfigError(error: unknown): error is import('../utils/errors.js').ConfigError;
/**
 * Type guard to check if an error is an ExecutionError
 */
export declare function isExecutionError(error: unknown): error is import('../utils/errors.js').ExecutionError;
/**
 * Type guard to check if an error is an AnalyzerError
 */
export declare function isAnalyzerError(error: unknown): error is import('../utils/errors.js').AnalyzerError;
/**
 * Type guard to check if an error is a DatabaseError
 */
export declare function isDatabaseError(error: unknown): error is import('../utils/errors.js').DatabaseError;
/**
 * Type guard to check if an error is a ValidationError
 */
export declare function isValidationError(error: unknown): error is import('../utils/errors.js').ValidationError;
/**
 * Type guard to check if an error is a ConflictError
 */
export declare function isConflictError(error: unknown): error is import('../utils/errors.js').ConflictError;
/**
 * Extract error message safely from any error type
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * Extract error code safely from any error type
 */
export declare function getErrorCode(error: unknown): string | undefined;
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: unknown): boolean;
/**
 * Get recovery suggestions from an error
 */
export declare function getRecoverySuggestions(error: unknown): string[];
//# sourceMappingURL=index.d.ts.map