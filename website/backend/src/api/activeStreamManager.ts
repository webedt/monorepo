/**
 * Active Stream Manager
 *
 * Centralized management of AbortControllers for active session streams.
 * This allows interrupt requests to abort running executions regardless
 * of which route initiated them.
 */

// Map of chatSessionId → AbortController for active streaming connections
const activeStreams = new Map<string, AbortController>();

/**
 * Register an active stream for a session
 * Returns the AbortController whose signal should be passed to the execution provider
 */
export function registerActiveStream(chatSessionId: string): AbortController {
  // Clean up existing stream if any
  const existing = activeStreams.get(chatSessionId);
  if (existing) {
    existing.abort();
  }

  const controller = new AbortController();
  activeStreams.set(chatSessionId, controller);
  return controller;
}

/**
 * Unregister an active stream when completed
 */
export function unregisterActiveStream(chatSessionId: string): void {
  activeStreams.delete(chatSessionId);
}

/**
 * Abort an active stream (for interrupt)
 * Returns true if a stream was found and aborted
 */
export function abortActiveStream(chatSessionId: string): boolean {
  const controller = activeStreams.get(chatSessionId);
  if (controller) {
    controller.abort();
    activeStreams.delete(chatSessionId);
    return true;
  }
  return false;
}

/**
 * Check if a session has an active stream
 */
export function hasActiveStream(chatSessionId: string): boolean {
  return activeStreams.has(chatSessionId);
}
