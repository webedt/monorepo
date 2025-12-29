/**
 * Session Middleware and Utilities
 *
 * Provides reusable middleware and utilities for session routes:
 * - validateSessionId: Validates session ID from request params
 * - requireSessionOwnership: Fetches session and verifies user ownership
 * - setupSSEHeaders: Sets up SSE response headers
 * - asyncHandler: Wraps async route handlers with error handling
 */

import { Request, Response, NextFunction } from 'express';
import { ServiceProvider, ASessionQueryService, ASessionAuthorizationService, logger } from '@webedt/shared';

import type { ChatSession } from '@webedt/shared';
import type { AuthRequest } from './auth.js';

/**
 * Extended request with session data attached by middleware
 */
export interface SessionRequest extends AuthRequest {
  sessionId: string;
  chatSession: ChatSession;
}

/**
 * Send a standardized error response
 */
function sendError(res: Response, statusCode: number, error: string): void {
  res.status(statusCode).json({ success: false, error });
}

/**
 * Middleware that validates and extracts session ID from request params.
 *
 * Sets `req.sessionId` on success.
 *
 * @example
 * router.get('/:id', requireAuth, validateSessionId, (req, res) => {
 *   const sessionId = (req as SessionRequest).sessionId;
 * });
 */
export function validateSessionId(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.params.id;

  if (!sessionId || sessionId.trim() === '') {
    sendError(res, 400, 'Invalid session ID');
    return;
  }

  (req as SessionRequest).sessionId = sessionId;
  next();
}

/**
 * Middleware that fetches a session and verifies user ownership.
 *
 * MUST be used after `requireAuth` and `validateSessionId` middleware.
 * Sets `req.chatSession` on success.
 *
 * @example
 * router.get('/:id', requireAuth, validateSessionId, requireSessionOwnership, (req, res) => {
 *   const session = (req as SessionRequest).chatSession;
 * });
 */
export async function requireSessionOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthRequest;
  const sessionReq = req as SessionRequest;

  if (!authReq.user) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  if (!sessionReq.sessionId) {
    sendError(res, 400, 'Invalid session ID');
    return;
  }

  try {
    const queryService = ServiceProvider.get(ASessionQueryService);
    const session = await queryService.getById(sessionReq.sessionId);

    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const authResult = authService.verifyOwnership(session, authReq.user.id);

    if (!authResult.authorized) {
      sendError(res, authResult.statusCode || 403, authResult.error || 'Access denied');
      return;
    }

    sessionReq.chatSession = session!;
    next();
  } catch (error) {
    logger.error('Session ownership check failed', error as Error, {
      component: 'SessionMiddleware',
      sessionId: sessionReq.sessionId,
    });
    sendError(res, 500, 'Failed to verify session access');
  }
}

/**
 * Create a middleware chain for session routes that require ownership verification.
 *
 * Combines `validateSessionId` and `requireSessionOwnership` into a single array.
 *
 * @example
 * router.get('/:id', requireAuth, ...withSessionOwnership(), (req, res) => {
 *   const session = (req as SessionRequest).chatSession;
 * });
 */
export function withSessionOwnership(): [(req: Request, res: Response, next: NextFunction) => void, (req: Request, res: Response, next: NextFunction) => Promise<void>] {
  return [validateSessionId, requireSessionOwnership];
}

/**
 * Set up SSE (Server-Sent Events) response headers.
 *
 * Configures the response for SSE streaming with:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache
 * - Connection: keep-alive
 * - X-Accel-Buffering: no (for nginx proxy support)
 *
 * @param res - Express response object
 *
 * @example
 * router.get('/stream', (req, res) => {
 *   setupSSEHeaders(res);
 *   res.write('data: hello\n\n');
 * });
 */
export function setupSSEHeaders(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

/**
 * Type for async Express route handlers
 */
type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wrap an async route handler with automatic error catching and logging.
 *
 * Catches any errors thrown by the handler and:
 * 1. Logs the error with structured logging
 * 2. Sends a standardized 500 error response (if headers not sent)
 *
 * @param handler - Async route handler function
 * @param options - Configuration options
 * @param options.component - Component name for logging (default: 'Sessions')
 * @param options.errorMessage - Custom error message for response (default: 'Internal server error')
 *
 * @example
 * router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
 *   const data = await fetchData();
 *   res.json({ success: true, data });
 * }, { component: 'Sessions', errorMessage: 'Failed to fetch data' }));
 */
export function asyncHandler(
  handler: AsyncRequestHandler,
  options: { component?: string; errorMessage?: string } = {}
): AsyncRequestHandler {
  const { component = 'Sessions', errorMessage = 'Internal server error' } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } catch (error) {
      logger.error(errorMessage, error as Error, {
        component,
        path: req.path,
        method: req.method,
      });

      if (!res.headersSent) {
        sendError(res, 500, errorMessage);
      }
    }
  };
}

/**
 * Higher-order function that creates an async handler with consistent error handling.
 *
 * This is a convenience wrapper that combines asyncHandler with common patterns.
 *
 * @param component - Component name for logging
 *
 * @example
 * const handler = createHandler('Sessions');
 *
 * router.get('/:id', requireAuth, handler(async (req, res) => {
 *   res.json({ success: true });
 * }, 'Failed to get session'));
 */
export function createHandler(component: string) {
  return (
    handler: AsyncRequestHandler,
    errorMessage: string
  ): AsyncRequestHandler => {
    return asyncHandler(handler, { component, errorMessage });
  };
}

/**
 * Send a standardized success response with data
 */
export function sendSuccess<T>(res: Response, data: T): void {
  res.json({ success: true, ...data });
}

/**
 * Send a standardized success response with a data property
 */
export function sendData<T>(res: Response, data: T): void {
  res.json({ success: true, data });
}

/**
 * Send a standardized success response with a session property
 */
export function sendSession(res: Response, session: ChatSession): void {
  res.json({ success: true, session });
}

/**
 * Send a standardized internal server error
 */
export function sendInternalError(res: Response, message: string): void {
  sendError(res, 500, message);
}

/**
 * Send a standardized not found error
 */
export function sendNotFound(res: Response, message = 'Not found'): void {
  sendError(res, 404, message);
}

/**
 * Send a standardized bad request error
 */
export function sendBadRequest(res: Response, message: string): void {
  sendError(res, 400, message);
}

/**
 * Send a standardized forbidden error
 */
export function sendForbidden(res: Response, message = 'Access denied'): void {
  sendError(res, 403, message);
}

/**
 * Send a standardized unauthorized error
 */
export function sendUnauthorized(res: Response, message = 'Unauthorized'): void {
  sendError(res, 401, message);
}
