/**
 * Request Correlation ID Middleware
 *
 * Generates or extracts a unique correlation ID for each request.
 * This ID is used to trace requests across logs, database operations,
 * and distributed services for debugging and observability.
 *
 * The correlation ID can be:
 * - Extracted from the X-Request-ID header (if provided by client or load balancer)
 * - Auto-generated as a UUID if not provided
 *
 * The ID is:
 * - Attached to the request object (req.correlationId)
 * - Set as X-Request-ID response header
 * - Available for logging and tracing throughout the request lifecycle
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Correlation ID header name
 * Standard header used by many systems including AWS, Azure, and other cloud providers
 */
export const CORRELATION_ID_HEADER = 'X-Request-ID';

/**
 * Extends Express Request with correlation tracking data
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * Unique correlation ID for request tracing
       * Available on all requests after correlationIdMiddleware runs
       */
      correlationId: string;

      /**
       * Timestamp when the request was received
       * Used for request duration tracking
       */
      requestStartTime: number;
    }
  }
}

/**
 * Get correlation ID from current request context
 * Utility function for use in async operations that need the correlation ID
 */
export function getCorrelationId(req: Request): string {
  return req.correlationId;
}

/**
 * Correlation ID middleware
 *
 * Always generates or extracts a correlation ID for every request.
 * This middleware should be applied early in the middleware chain,
 * before any logging or business logic.
 *
 * Usage:
 * - Access via req.correlationId in route handlers
 * - Automatically included in X-Request-ID response header
 * - Use with logger context for tracing
 *
 * @example
 * ```typescript
 * // In route handler
 * router.get('/api/example', (req, res) => {
 *   logger.info('Processing request', {
 *     component: 'ExampleRoute',
 *     requestId: req.correlationId,
 *   });
 * });
 * ```
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Extract correlation ID from header or generate a new one
  // X-Request-ID is a standard header used by load balancers and API gateways
  const headerValue = req.headers[CORRELATION_ID_HEADER.toLowerCase()];
  const correlationId = typeof headerValue === 'string' && headerValue.trim()
    ? headerValue.trim()
    : randomUUID();

  // Attach to request object for use in route handlers
  req.correlationId = correlationId;
  req.requestStartTime = Date.now();

  // Set response header so clients can correlate responses
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  next();
}

/**
 * Create a log context with correlation ID
 * Helper function to create consistent log context objects
 *
 * @param req - Express request object
 * @param component - Component name for logging
 * @param additionalContext - Additional context fields
 * @returns Log context object with correlation ID
 *
 * @example
 * ```typescript
 * logger.info('Processing request', createLogContext(req, 'MyRoute', {
 *   userId: user.id,
 *   action: 'create',
 * }));
 * ```
 */
export function createLogContext(
  req: Request,
  component: string,
  additionalContext?: Record<string, unknown>
): Record<string, unknown> {
  return {
    component,
    requestId: req.correlationId,
    ...additionalContext,
  };
}
