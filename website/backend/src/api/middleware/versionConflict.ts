/**
 * Version Conflict Error Handler Middleware
 *
 * Handles optimistic locking errors from session status updates.
 * When a version conflict is detected, returns a 409 Conflict response
 * with details about the conflict to allow client retry.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import {
  VersionConflictError,
  SessionNotFoundError,
  InvalidStatusTransitionError,
  isVersionConflict,
  isSessionNotFound,
  isInvalidStatusTransition,
} from '@webedt/shared';

/**
 * Standard error response format for session locking errors
 */
interface SessionLockingErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: {
    sessionId?: string;
    expectedVersion?: number;
    currentStatus?: string;
    targetStatus?: string;
  };
}

/**
 * Error handler middleware for session locking errors.
 *
 * This should be registered after all route handlers to catch
 * locking errors and return appropriate HTTP responses:
 * - VersionConflictError -> 409 Conflict
 * - SessionNotFoundError -> 404 Not Found
 * - InvalidStatusTransitionError -> 409 Conflict (invalid state transition)
 *
 * Usage:
 * ```typescript
 * app.use('/api', sessionRoutes);
 * app.use(versionConflictErrorHandler);
 * ```
 */
export const versionConflictErrorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Handle version conflict errors (optimistic locking failure)
  if (isVersionConflict(err)) {
    const response: SessionLockingErrorResponse = {
      success: false,
      error: 'Session was modified by another request. Please retry.',
      code: 'VERSION_CONFLICT',
      details: {
        sessionId: err.sessionId,
        expectedVersion: err.expectedVersion,
      },
    };

    res.status(409).json(response);
    return;
  }

  // Handle session not found errors
  if (isSessionNotFound(err)) {
    const response: SessionLockingErrorResponse = {
      success: false,
      error: `Session not found: ${err.sessionId}`,
      code: 'SESSION_NOT_FOUND',
      details: {
        sessionId: err.sessionId,
      },
    };

    res.status(404).json(response);
    return;
  }

  // Handle invalid status transition errors
  if (isInvalidStatusTransition(err)) {
    const response: SessionLockingErrorResponse = {
      success: false,
      error: `Cannot transition session from '${err.currentStatus}' to '${err.targetStatus}'`,
      code: 'INVALID_STATUS_TRANSITION',
      details: {
        sessionId: err.sessionId,
        currentStatus: err.currentStatus,
        targetStatus: err.targetStatus,
      },
    };

    res.status(409).json(response);
    return;
  }

  // Pass other errors to the next error handler
  next(err);
};

/**
 * Check if an error is a retryable locking error.
 * Useful for client-side retry logic.
 */
export function isRetryableLockingError(error: unknown): boolean {
  return isVersionConflict(error);
}

/**
 * Suggested retry delay based on error type.
 * Returns milliseconds to wait before retrying.
 */
export function getSuggestedRetryDelay(error: unknown): number {
  if (isVersionConflict(error)) {
    // Small delay for version conflicts (likely concurrent user)
    return 100 + Math.random() * 100; // 100-200ms with jitter
  }
  return 0;
}
