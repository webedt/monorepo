/**
 * Timeout enforcement utilities using AbortController.
 * Provides structured timeout handling with proper cleanup and error classification.
 */

import { ClaudeError, ExecutionError, ErrorCode, type ErrorContext } from './errors.js';

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
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    // Node.js AbortError
    if (error.name === 'AbortError') return true;
    // DOMException from browser/DOM APIs
    if (error.name === 'DOMException' && error.message.includes('abort')) return true;
    // Some libraries throw with this message pattern
    if (error.message.toLowerCase().includes('aborted') ||
        error.message.toLowerCase().includes('abort')) return true;
  }
  return false;
}

/**
 * Check if an error is a timeout error (either our custom timeout or abort)
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof ClaudeError && error.code === ErrorCode.CLAUDE_TIMEOUT) return true;
  if (error instanceof ExecutionError && error.code === ErrorCode.EXEC_TIMEOUT) return true;
  return isAbortError(error);
}

/**
 * Create a linked AbortController that aborts when either the timeout expires
 * or an optional parent signal is aborted.
 */
export function createLinkedAbortController(
  timeoutMs: number,
  parentSignal?: AbortSignal
): { controller: AbortController; timeoutId: NodeJS.Timeout; cleanup: () => void } {
  const controller = new AbortController();

  // Set up timeout
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Operation timed out'));
  }, timeoutMs);

  // Link to parent signal if provided
  let parentAbortHandler: (() => void) | undefined;
  if (parentSignal) {
    parentAbortHandler = () => {
      clearTimeout(timeoutId);
      controller.abort(parentSignal.reason);
    };
    parentSignal.addEventListener('abort', parentAbortHandler);
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (parentSignal && parentAbortHandler) {
      parentSignal.removeEventListener('abort', parentAbortHandler);
    }
  };

  return { controller, timeoutId, cleanup };
}

/**
 * Execute an async operation with timeout enforcement.
 * Throws a structured error if the operation times out.
 *
 * @param operation - The async operation to execute. Receives an AbortController for cancellation.
 * @param options - Timeout options
 * @returns The operation result wrapped with timing information
 * @throws ClaudeError or ExecutionError on timeout, or the original error on other failures
 */
export async function withTimeout<T>(
  operation: (abortController: AbortController) => Promise<T>,
  options: TimeoutOptions
): Promise<TimeoutResult<T>> {
  const startTime = Date.now();
  const { timeoutMs, operation: opName, component, context, signal, onTimeout } = options;

  const { controller, cleanup } = createLinkedAbortController(timeoutMs, signal);

  try {
    const result = await operation(controller);
    const elapsedMs = Date.now() - startTime;

    return {
      result,
      elapsedMs,
      wasAborted: controller.signal.aborted,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startTime;

    // Check if this was a timeout/abort
    if (isAbortError(error) || controller.signal.aborted) {
      // Determine if this was our timeout or external abort
      const wasOurTimeout = elapsedMs >= timeoutMs - 100; // Allow 100ms tolerance

      if (onTimeout) {
        onTimeout(elapsedMs);
      }

      // Create appropriate error based on component
      const errorContext: ErrorContext = {
        ...context,
        operation: opName,
        component: component,
        timeoutMs,
        elapsedMs,
        wasOurTimeout,
      };

      if (component?.toLowerCase().includes('claude') || opName.toLowerCase().includes('claude')) {
        throw new ClaudeError(
          ErrorCode.CLAUDE_TIMEOUT,
          `Claude operation timed out after ${Math.round(elapsedMs / 1000)}s (limit: ${Math.round(timeoutMs / 1000)}s)`,
          { context: errorContext, cause: error instanceof Error ? error : undefined }
        );
      } else {
        throw new ExecutionError(
          ErrorCode.EXEC_TIMEOUT,
          `Operation '${opName}' timed out after ${Math.round(elapsedMs / 1000)}s (limit: ${Math.round(timeoutMs / 1000)}s)`,
          { context: errorContext, cause: error instanceof Error ? error : undefined }
        );
      }
    }

    // Not a timeout error, re-throw as-is
    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Execute a fetch request with timeout enforcement.
 * Uses AbortController to cancel the fetch on timeout.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeout?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = init.timeout ?? init.timeoutMs ?? 30000; // Default 30s timeout
  const { timeout, timeoutMs: _, ...fetchInit } = init;

  const { controller, cleanup } = createLinkedAbortController(
    timeoutMs,
    init.signal ?? undefined
  );

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Create a promise that resolves after a delay, but can be aborted.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(signal.reason ?? new Error('Aborted'));
    });
  });
}

/**
 * Track elapsed time for an ongoing operation.
 * Useful for logging progress and timeout warnings.
 */
export class TimeoutTracker {
  private startTime: number;
  private timeoutMs: number;
  private warningThreshold: number;
  private onWarning?: (elapsedMs: number, remainingMs: number) => void;
  private warningInterval?: NodeJS.Timeout;

  constructor(options: {
    timeoutMs: number;
    warningThreshold?: number; // Default 0.75 (75% of timeout)
    onWarning?: (elapsedMs: number, remainingMs: number) => void;
    warningCheckIntervalMs?: number; // Default 60000 (1 minute)
  }) {
    this.startTime = Date.now();
    this.timeoutMs = options.timeoutMs;
    this.warningThreshold = options.warningThreshold ?? 0.75;
    this.onWarning = options.onWarning;

    if (this.onWarning) {
      this.warningInterval = setInterval(() => {
        const elapsed = this.getElapsed();
        const remaining = this.getRemaining();
        if (elapsed >= this.timeoutMs * this.warningThreshold) {
          this.onWarning!(elapsed, remaining);
        }
      }, options.warningCheckIntervalMs ?? 60000);
    }
  }

  /** Get elapsed time in milliseconds */
  getElapsed(): number {
    return Date.now() - this.startTime;
  }

  /** Get remaining time in milliseconds */
  getRemaining(): number {
    return Math.max(0, this.timeoutMs - this.getElapsed());
  }

  /** Get progress as a percentage (0-100) */
  getProgress(): number {
    return Math.min(100, (this.getElapsed() / this.timeoutMs) * 100);
  }

  /** Check if timeout has been exceeded */
  isExpired(): boolean {
    return this.getElapsed() >= this.timeoutMs;
  }

  /** Stop the warning interval */
  stop(): void {
    if (this.warningInterval) {
      clearInterval(this.warningInterval);
      this.warningInterval = undefined;
    }
  }
}
