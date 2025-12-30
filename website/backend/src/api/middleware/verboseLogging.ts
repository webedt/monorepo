/**
 * Verbose HTTP Logging Middleware
 *
 * Provides detailed request/response logging when VERBOSE_MODE is enabled.
 * Logs timing, headers, body size, and other debugging information.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { isVerbose, isDebugLevel, VERBOSE_HTTP } from '@webedt/shared';
import { logger, verboseLogger } from '@webedt/shared';

import type { VerboseContext } from '@webedt/shared';

/**
 * Extends Express Request with verbose tracking data
 */
declare global {
  namespace Express {
    interface Request {
      verboseRequestId?: string;
      verboseStartTime?: number;
    }
  }
}

/**
 * Get content length from headers or body
 */
function getContentLength(req: Request): number | undefined {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    return parseInt(contentLength, 10);
  }
  if (req.body) {
    try {
      return JSON.stringify(req.body).length;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Sanitize headers for logging (remove sensitive data)
 */
function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const sensitiveKeys = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
  const sanitized: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (sensitiveKeys.includes(key.toLowerCase())) {
      sanitized[key] = value ? '[REDACTED]' : undefined;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Verbose HTTP logging middleware
 *
 * When VERBOSE_MODE is enabled, logs:
 * - Incoming requests with method, URL, headers, body size
 * - Outgoing responses with status, duration, response size
 * - Request/response timing information
 */
export function verboseLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip if verbose mode is disabled
  if (!VERBOSE_HTTP && !isVerbose()) {
    return next();
  }

  // Assign a unique request ID for correlation
  req.verboseRequestId = randomUUID();
  req.verboseStartTime = Date.now();

  const context: VerboseContext = {
    component: 'HTTP',
    requestId: req.verboseRequestId,
    operation: `${req.method} ${req.path}`,
  };

  // Log incoming request
  verboseLogger.verbose(`Incoming request: ${req.method} ${req.originalUrl}`, {
    ...context,
    metadata: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      headers: isDebugLevel() ? sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>) : undefined,
      contentLength: getContentLength(req),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });

  // Track response timing
  const originalEnd = res.end;
  const originalJson = res.json;
  let responseSize: number | undefined;

  // Intercept res.json to capture response size
  res.json = function (body: unknown): Response {
    if (body) {
      try {
        responseSize = JSON.stringify(body).length;
      } catch {
        // Ignore serialization errors
      }
    }
    return originalJson.call(this, body);
  };

  // Intercept res.end to log response
  res.end = function (...args: unknown[]): Response {
    const durationMs = req.verboseStartTime ? Date.now() - req.verboseStartTime : 0;

    verboseLogger.verbose(`Response: ${res.statusCode} (${durationMs}ms)`, {
      ...context,
      durationMs,
      metadata: {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        responseSize,
        durationMs,
        headers: isDebugLevel() ? res.getHeaders() : undefined,
      },
    });

    // Call original end method
    return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
  };

  next();
}

/**
 * Log slow requests (requests taking longer than threshold)
 */
export function slowRequestLoggingMiddleware(thresholdMs: number = 1000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      if (durationMs > thresholdMs) {
        logger.warn(`Slow request: ${req.method} ${req.originalUrl} took ${durationMs}ms`, {
          component: 'HTTP',
          durationMs,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
        });
      }
    });

    next();
  };
}

/**
 * Request size logging middleware
 * Logs large request bodies for debugging
 */
export function requestSizeLoggingMiddleware(thresholdBytes: number = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = getContentLength(req);
    if (contentLength && contentLength > thresholdBytes) {
      logger.info(`Large request body: ${contentLength} bytes`, {
        component: 'HTTP',
        method: req.method,
        path: req.path,
        contentLength,
      });
    }
    next();
  };
}
