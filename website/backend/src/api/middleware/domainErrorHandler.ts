/**
 * Domain Error Handler Middleware
 *
 * Handles typed domain errors from the shared package and returns
 * appropriate HTTP responses with consistent format.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import {
  isDomainError,
  isValidationError,
  isAuthenticationError,
  isAuthorizationError,
  isRateLimitError,
  isConflictError,
  isNotFoundError,
  isBadRequestError,
  isInternalServerError,
  isServiceUnavailableError,
  isPayloadTooLargeError,
  isBadGatewayError,
  RateLimitError,
  ServiceUnavailableError,
} from '@webedt/shared';
import type { AnyDomainError } from '@webedt/shared';
import { logger } from '@webedt/shared';
import { getCorrelationId } from '@webedt/shared';

/**
 * Standard error response format for domain errors
 */
interface DomainErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    context?: Record<string, unknown>;
  };
  timestamp: string;
  requestId?: string;
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  error: AnyDomainError,
  requestId?: string
): DomainErrorResponse {
  return {
    success: false,
    error: {
      message: error.message,
      code: error.type,
      ...(error.context && Object.keys(error.context).length > 0 && { context: error.context }),
    },
    timestamp: new Date().toISOString(),
    ...(requestId && { requestId }),
  };
}

/**
 * Log domain error with appropriate severity
 */
function logDomainError(error: AnyDomainError, req: Request): void {
  const logContext = {
    component: 'DomainErrorHandler',
    errorType: error.type,
    path: req.path,
    method: req.method,
    requestId: getCorrelationId(),
    ...error.context,
  };

  // Log server errors with higher severity
  if (isInternalServerError(error) || isBadGatewayError(error)) {
    logger.error(`Domain error: ${error.message}`, error, logContext);
  } else if (isServiceUnavailableError(error)) {
    logger.warn(`Service unavailable: ${error.message}`, logContext);
  } else {
    // Client errors are debug level
    logger.debug(`Domain error: ${error.message}`, logContext);
  }
}

/**
 * Domain error handler middleware.
 *
 * Handles all typed domain errors and returns appropriate HTTP responses:
 * - ValidationError -> 400 Bad Request
 * - BadRequestError -> 400 Bad Request
 * - AuthenticationError -> 401 Unauthorized
 * - AuthorizationError -> 403 Forbidden
 * - NotFoundError -> 404 Not Found
 * - ConflictError -> 409 Conflict
 * - PayloadTooLargeError -> 413 Payload Too Large
 * - RateLimitError -> 429 Too Many Requests
 * - InternalServerError -> 500 Internal Server Error
 * - BadGatewayError -> 502 Bad Gateway
 * - ServiceUnavailableError -> 503 Service Unavailable
 *
 * Usage:
 * ```typescript
 * // Register after all routes but before generic error handler
 * app.use(domainErrorHandler);
 * app.use(genericErrorHandler);
 * ```
 */
export const domainErrorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Only handle domain errors
  if (!isDomainError(err)) {
    next(err);
    return;
  }

  const requestId = getCorrelationId();
  const response = createErrorResponse(err, requestId);

  // Log the error
  logDomainError(err, req);

  // Set Retry-After header for rate limit and service unavailable errors
  if (isRateLimitError(err)) {
    const rateLimitErr = err as RateLimitError;
    if (rateLimitErr.retryAfterSeconds) {
      res.setHeader('Retry-After', rateLimitErr.retryAfterSeconds.toString());
    }
  }

  if (isServiceUnavailableError(err)) {
    const serviceErr = err as ServiceUnavailableError;
    if (serviceErr.retryAfterSeconds) {
      res.setHeader('Retry-After', serviceErr.retryAfterSeconds.toString());
    }
  }

  // Return response with appropriate status code
  res.status(err.statusCode).json(response);
};

/**
 * Async route handler wrapper that catches errors and passes them to error middleware.
 * Use this to wrap async route handlers so errors are properly caught.
 *
 * @example
 * router.get('/users/:id', asyncHandler(async (req, res) => {
 *   const user = await userService.findById(req.params.id);
 *   if (!user) {
 *     throw NotFoundError.forResource('User', req.params.id);
 *   }
 *   res.json({ success: true, data: user });
 * }));
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>
): (req: T, res: Response, next: NextFunction) => void {
  return (req: T, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Re-export domain errors for convenient imports
 */
export {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ConflictError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
  ServiceUnavailableError,
  PayloadTooLargeError,
  BadGatewayError,
} from '@webedt/shared';
