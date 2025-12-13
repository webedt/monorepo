/**
 * Comprehensive timeout management utilities with AbortController cleanup.
 * Provides configurable timeout wrappers for external operations to prevent
 * the system from hanging indefinitely.
 *
 * Features:
 * - withTimeout() wrapper for any async operation
 * - AbortController integration with proper cleanup
 * - Configurable timeouts via environment variables
 * - Clear error messages identifying which operation timed out
 * - Proper cleanup even when errors occur
 */
import { StructuredError } from './errors.js';
/**
 * Default timeout values in milliseconds
 */
export declare const DEFAULT_TIMEOUTS: {
    /** GitHub API operations (30 seconds) */
    readonly GITHUB_API: 30000;
    /** Git operations like clone/push (30 seconds) */
    readonly GIT_OPERATION: 30000;
    /** Database queries (10 seconds) */
    readonly DATABASE_QUERY: 10000;
    /** PR merge operations (30 seconds) */
    readonly PR_MERGE: 30000;
    /** Generic external operation (30 seconds) */
    readonly EXTERNAL_OPERATION: 30000;
};
/**
 * Environment variable names for timeout configuration
 */
export declare const TIMEOUT_ENV_VARS: {
    readonly GITHUB_API: "TIMEOUT_GITHUB_API_MS";
    readonly GIT_OPERATION: "TIMEOUT_GIT_OPERATION_MS";
    readonly DATABASE_QUERY: "TIMEOUT_DATABASE_QUERY_MS";
    readonly PR_MERGE: "TIMEOUT_PR_MERGE_MS";
    readonly EXTERNAL_OPERATION: "TIMEOUT_EXTERNAL_OPERATION_MS";
};
/**
 * Get a timeout value from environment variable or use default
 */
export declare function getTimeoutFromEnv(envVar: keyof typeof TIMEOUT_ENV_VARS, defaultValue: number): number;
/**
 * Get all timeout configurations (from env vars or defaults)
 */
export declare function getTimeoutConfig(): typeof DEFAULT_TIMEOUTS;
/**
 * Timeout error with operation context
 */
export declare class TimeoutError extends StructuredError {
    readonly timeoutMs: number;
    readonly operationName: string;
    constructor(operationName: string, timeoutMs: number, options?: {
        context?: Record<string, unknown>;
        cause?: Error;
    });
}
/**
 * Options for withTimeout wrapper
 */
export interface WithTimeoutOptions {
    /** Timeout in milliseconds */
    timeoutMs: number;
    /** Name of the operation (for error messages) */
    operationName: string;
    /** Optional AbortController to use (will be created if not provided) */
    abortController?: AbortController;
    /** Additional context for error messages */
    context?: Record<string, unknown>;
    /** Callback when timeout occurs (before throwing error) */
    onTimeout?: (timeoutMs: number, operationName: string) => void;
    /** Cleanup function to call regardless of success/failure */
    cleanup?: () => void | Promise<void>;
}
/**
 * Result of withTimeout operation
 */
export interface WithTimeoutResult<T> {
    /** The result of the operation */
    result: T;
    /** Duration in milliseconds */
    durationMs: number;
    /** Whether the operation was aborted */
    aborted: boolean;
}
/**
 * Wrap an async operation with a timeout.
 * Ensures proper cleanup of timeouts and AbortController even when errors occur.
 *
 * @param operation - The async operation to execute. Receives an AbortSignal for cancellation support.
 * @param options - Timeout configuration options
 * @returns The result of the operation
 * @throws TimeoutError if the operation times out
 *
 * @example
 * ```typescript
 * // Simple usage
 * const result = await withTimeout(
 *   async (signal) => {
 *     const response = await fetch(url, { signal });
 *     return response.json();
 *   },
 *   {
 *     timeoutMs: 30000,
 *     operationName: 'fetchData',
 *   }
 * );
 *
 * // With AbortController for manual cancellation
 * const abortController = new AbortController();
 * const result = await withTimeout(
 *   async (signal) => doSomething(signal),
 *   {
 *     timeoutMs: 30000,
 *     operationName: 'myOperation',
 *     abortController,
 *   }
 * );
 * // Can manually abort: abortController.abort();
 * ```
 */
export declare function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, options: WithTimeoutOptions): Promise<T>;
/**
 * Wrap an async operation with timeout and return detailed result
 */
export declare function withTimeoutDetailed<T>(operation: (signal: AbortSignal) => Promise<T>, options: WithTimeoutOptions): Promise<WithTimeoutResult<T>>;
/**
 * Create a timeout wrapper with pre-configured defaults for GitHub API calls
 */
export declare function withGitHubTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, operationName: string, context?: Record<string, unknown>): Promise<T>;
/**
 * Create a timeout wrapper with pre-configured defaults for Git operations
 */
export declare function withGitTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, operationName: string, context?: Record<string, unknown>): Promise<T>;
/**
 * Create a timeout wrapper with pre-configured defaults for database queries
 */
export declare function withDatabaseTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, operationName: string, context?: Record<string, unknown>): Promise<T>;
/**
 * Create a timeout wrapper with pre-configured defaults for PR merge operations
 */
export declare function withMergeTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, operationName: string, context?: Record<string, unknown>): Promise<T>;
/**
 * Race a promise against a timeout, returning the first to complete
 * Unlike withTimeout, this doesn't throw on timeout but returns a discriminated result
 */
export declare function raceWithTimeout<T>(operation: Promise<T>, timeoutMs: number, operationName: string): Promise<{
    success: true;
    result: T;
} | {
    success: false;
    timedOut: true;
    timeoutMs: number;
}>;
/**
 * Create an AbortController that automatically aborts after a timeout
 * Returns both the controller and a cleanup function
 */
export declare function createTimedAbortController(timeoutMs: number, operationName?: string): {
    controller: AbortController;
    cleanup: () => void;
    isTimedOut: () => boolean;
};
/**
 * Ensure a cleanup function is called even if an error occurs
 * Useful for wrapping operations that need guaranteed cleanup
 */
export declare function withCleanup<T>(operation: () => Promise<T>, cleanup: () => void | Promise<void>): Promise<T>;
/**
 * Execute multiple operations with individual timeouts
 * Returns results for completed operations and errors for timed out ones
 */
export declare function withTimeoutAll<T>(operations: Array<{
    operation: (signal: AbortSignal) => Promise<T>;
    timeoutMs: number;
    operationName: string;
}>): Promise<Array<{
    success: true;
    result: T;
} | {
    success: false;
    error: TimeoutError;
}>>;
//# sourceMappingURL=timeout.d.ts.map