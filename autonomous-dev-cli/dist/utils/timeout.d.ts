/**
 * Timeout enforcement utilities using AbortController.
 * Provides structured timeout handling with proper cleanup and error classification.
 */
import { type ErrorContext } from './errors.js';
/**
 * Options for timeout enforcement
 */
export interface TimeoutOptions {
    /** Timeout duration in milliseconds */
    timeoutMs: number;
    /** Operation name for error context */
    operation: string;
    /** Component name for error context */
    component?: string;
    /** Additional context for error reporting */
    context?: ErrorContext;
    /** Optional AbortSignal to link with (for parent abort propagation) */
    signal?: AbortSignal;
    /** Callback invoked when timeout occurs (before throwing) */
    onTimeout?: (elapsedMs: number) => void;
}
/**
 * Result of a timeout-wrapped operation
 */
export interface TimeoutResult<T> {
    /** The operation result if successful */
    result: T;
    /** Time elapsed in milliseconds */
    elapsedMs: number;
    /** Whether the operation was aborted (but completed before abort took effect) */
    wasAborted: boolean;
}
/**
 * Check if an error is an abort error (from AbortController)
 */
export declare function isAbortError(error: unknown): boolean;
/**
 * Check if an error is a timeout error (either our custom timeout or abort)
 */
export declare function isTimeoutError(error: unknown): boolean;
/**
 * Create a linked AbortController that aborts when either the timeout expires
 * or an optional parent signal is aborted.
 */
export declare function createLinkedAbortController(timeoutMs: number, parentSignal?: AbortSignal): {
    controller: AbortController;
    timeoutId: NodeJS.Timeout;
    cleanup: () => void;
};
/**
 * Execute an async operation with timeout enforcement.
 * Throws a structured error if the operation times out.
 *
 * @param operation - The async operation to execute. Receives an AbortController for cancellation.
 * @param options - Timeout options
 * @returns The operation result wrapped with timing information
 * @throws ClaudeError or ExecutionError on timeout, or the original error on other failures
 */
export declare function withTimeout<T>(operation: (abortController: AbortController) => Promise<T>, options: TimeoutOptions): Promise<TimeoutResult<T>>;
/**
 * Execute a fetch request with timeout enforcement.
 * Uses AbortController to cancel the fetch on timeout.
 */
export declare function fetchWithTimeout(url: string, init?: RequestInit & {
    timeout?: number;
    timeoutMs?: number;
}): Promise<Response>;
/**
 * Create a promise that resolves after a delay, but can be aborted.
 */
export declare function abortableDelay(ms: number, signal?: AbortSignal): Promise<void>;
/**
 * Track elapsed time for an ongoing operation.
 * Useful for logging progress and timeout warnings.
 */
export declare class TimeoutTracker {
    private startTime;
    private timeoutMs;
    private warningThreshold;
    private onWarning?;
    private warningInterval?;
    constructor(options: {
        timeoutMs: number;
        warningThreshold?: number;
        onWarning?: (elapsedMs: number, remainingMs: number) => void;
        warningCheckIntervalMs?: number;
    });
    /** Get elapsed time in milliseconds */
    getElapsed(): number;
    /** Get remaining time in milliseconds */
    getRemaining(): number;
    /** Get progress as a percentage (0-100) */
    getProgress(): number;
    /** Check if timeout has been exceeded */
    isExpired(): boolean;
    /** Stop the warning interval */
    stop(): void;
}
//# sourceMappingURL=timeout.d.ts.map