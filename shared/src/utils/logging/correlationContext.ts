/**
 * Correlation Context
 *
 * Provides async-safe correlation ID propagation using Node.js AsyncLocalStorage.
 * This allows the correlation ID to be automatically available in async operations
 * without explicitly passing it through function parameters.
 *
 * Usage:
 * 1. At request entry point, call runWithCorrelation(correlationId, () => {...})
 * 2. In any async code within that context, call getCorrelationContext() to get the ID
 *
 * This is particularly useful for:
 * - Database operations that happen after async/await
 * - Background tasks spawned from a request
 * - Event handlers that need the originating request's correlation ID
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Correlation context data
 */
export interface CorrelationContext {
  /**
   * Unique request correlation ID
   */
  correlationId: string;

  /**
   * Optional user ID associated with the request
   */
  userId?: string;

  /**
   * Optional session ID associated with the request
   */
  sessionId?: string;

  /**
   * Additional context fields
   */
  [key: string]: unknown;
}

/**
 * AsyncLocalStorage instance for correlation context
 * This allows the context to be automatically propagated through async operations
 */
const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Get the current correlation context
 * Returns undefined if called outside of a correlation context
 *
 * @returns The current correlation context or undefined
 *
 * @example
 * ```typescript
 * const context = getCorrelationContext();
 * if (context) {
 *   logger.info('Processing', { requestId: context.correlationId });
 * }
 * ```
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * Get the current correlation ID
 * Returns undefined if called outside of a correlation context
 *
 * @returns The current correlation ID or undefined
 *
 * @example
 * ```typescript
 * const correlationId = getCorrelationId();
 * if (correlationId) {
 *   console.log(`Processing request ${correlationId}`);
 * }
 * ```
 */
export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

/**
 * Run a function within a correlation context
 * The correlation ID will be available in all async operations within the callback
 *
 * @param correlationId - The correlation ID to use
 * @param fn - The function to run within the context
 * @returns The return value of the function
 *
 * @example
 * ```typescript
 * // In middleware
 * runWithCorrelation(req.correlationId, () => {
 *   // All async operations here will have access to correlationId
 *   return handleRequest(req, res);
 * });
 * ```
 */
export function runWithCorrelation<T>(
  correlationId: string,
  fn: () => T
): T {
  return correlationStorage.run({ correlationId }, fn);
}

/**
 * Run a function within a full correlation context
 * Allows setting additional context fields like userId and sessionId
 *
 * @param context - The full correlation context
 * @param fn - The function to run within the context
 * @returns The return value of the function
 *
 * @example
 * ```typescript
 * runWithCorrelationContext({
 *   correlationId: req.correlationId,
 *   userId: req.user?.id,
 *   sessionId: req.authSession?.id,
 * }, () => {
 *   return processRequest(req, res);
 * });
 * ```
 */
export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T
): T {
  return correlationStorage.run(context, fn);
}

/**
 * Update the current correlation context with additional fields
 * Only works if already within a correlation context
 *
 * @param updates - Fields to add/update in the context
 *
 * @example
 * ```typescript
 * updateCorrelationContext({ userId: user.id });
 * ```
 */
export function updateCorrelationContext(
  updates: Partial<CorrelationContext>
): void {
  const currentContext = correlationStorage.getStore();
  if (currentContext) {
    Object.assign(currentContext, updates);
  }
}

/**
 * Create a log context object with correlation ID automatically included
 * Merges the provided context with the current correlation context
 *
 * @param context - Additional context fields
 * @returns Context object with correlationId/requestId included
 *
 * @example
 * ```typescript
 * logger.info('Processing', withCorrelationContext({
 *   component: 'MyService',
 *   operation: 'create',
 * }));
 * // Logs: { component: 'MyService', operation: 'create', requestId: '...' }
 * ```
 */
export function withCorrelationContext(
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  const correlationContext = getCorrelationContext();
  if (correlationContext) {
    return {
      ...context,
      requestId: correlationContext.correlationId,
      ...(correlationContext.userId && { userId: correlationContext.userId }),
      ...(correlationContext.sessionId && { sessionId: correlationContext.sessionId }),
    };
  }
  return context;
}
