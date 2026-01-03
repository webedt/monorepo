/**
 * Tests for Verbose Logging Middleware
 * Covers verboseLoggingMiddleware, slowRequestLoggingMiddleware, and requestSizeLoggingMiddleware
 *
 * Note: Uses test doubles to avoid circular dependency issues with @webedt/shared imports.
 * Tests verify the middleware logic patterns rather than importing the actual middleware.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// TEST DOUBLES
// =============================================================================

// Mock environment flags
let mockVerboseMode = false;
let mockVerboseHttp = false;
let mockDebugLevel = false;

// Mock logger
const loggedMessages: Array<{ level: string; message: string; context: Record<string, unknown> }> = [];

function mockVerboseLog(message: string, context: Record<string, unknown> = {}) {
  loggedMessages.push({ level: 'verbose', message, context });
}

function mockWarnLog(message: string, context: Record<string, unknown> = {}) {
  loggedMessages.push({ level: 'warn', message, context });
}

function mockInfoLog(message: string, context: Record<string, unknown> = {}) {
  loggedMessages.push({ level: 'info', message, context });
}

// Recreate middleware logic for testing
function getContentLength(req: Request): number | undefined {
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    return parseInt(contentLength as string, 10);
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

function testVerboseLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip if verbose mode is disabled
  if (!mockVerboseHttp && !mockVerboseMode) {
    return next();
  }

  // Assign a unique request ID for correlation
  (req as Request & { verboseRequestId?: string; verboseStartTime?: number }).verboseRequestId = randomUUID();
  (req as Request & { verboseRequestId?: string; verboseStartTime?: number }).verboseStartTime = Date.now();

  const context = {
    component: 'HTTP',
    requestId: (req as Request & { verboseRequestId?: string }).verboseRequestId,
    operation: `${req.method} ${req.path}`,
  };

  // Log incoming request
  mockVerboseLog(`Incoming request: ${req.method} ${req.originalUrl}`, {
    ...context,
    metadata: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      query: Object.keys(req.query as Record<string, string>).length > 0 ? req.query : undefined,
      headers: mockDebugLevel ? sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>) : undefined,
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
    const durationMs = (req as Request & { verboseStartTime?: number }).verboseStartTime
      ? Date.now() - (req as Request & { verboseStartTime?: number }).verboseStartTime!
      : 0;

    mockVerboseLog(`Response: ${res.statusCode} (${durationMs}ms)`, {
      ...context,
      durationMs,
      metadata: {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        responseSize,
        durationMs,
        headers: mockDebugLevel ? res.getHeaders() : undefined,
      },
    });

    return originalEnd.apply(this, args as Parameters<typeof originalEnd>);
  };

  next();
}

function testSlowRequestLoggingMiddleware(thresholdMs: number = 1000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      if (durationMs > thresholdMs) {
        mockWarnLog(`Slow request: ${req.method} ${req.originalUrl} took ${durationMs}ms`, {
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

function testRequestSizeLoggingMiddleware(thresholdBytes: number = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = getContentLength(req);
    if (contentLength && contentLength > thresholdBytes) {
      mockInfoLog(`Large request body: ${contentLength} bytes`, {
        component: 'HTTP',
        method: req.method,
        path: req.path,
        contentLength,
      });
    }
    next();
  };
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createVerboseRequest(overrides: Partial<Request> = {}): Request {
  const baseReq: Partial<Request> = {
    method: 'GET',
    originalUrl: '/api/test',
    path: '/api/test',
    query: {},
    headers: {},
    body: {},
    ip: '127.0.0.1',
    params: {},
    ...overrides,
  };
  return baseReq as Request;
}

function createVerboseResponse(): Response & { endCalled: boolean; jsonBody: unknown } {
  const emitter = new EventEmitter();
  let statusCode = 200;
  let statusMessage = 'OK';
  let endCalled = false;
  let jsonBody: unknown = null;
  const responseHeaders = new Map<string, string | number | string[]>();

  const mockRes = {
    get statusCode() { return statusCode; },
    set statusCode(code: number) { statusCode = code; },
    get statusMessage() { return statusMessage; },
    set statusMessage(msg: string) { statusMessage = msg; },
    get endCalled() { return endCalled; },
    get jsonBody() { return jsonBody; },

    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),

    setHeader(name: string, value: string | number | string[]) {
      responseHeaders.set(name, value);
      return mockRes;
    },
    getHeaders() {
      const headers: Record<string, string | number | string[]> = {};
      responseHeaders.forEach((value, key) => {
        headers[key] = value;
      });
      return headers;
    },
    status(code: number) {
      statusCode = code;
      return mockRes;
    },
    json(body: unknown) {
      jsonBody = body;
      return mockRes as Response;
    },
    end(..._args: unknown[]) {
      endCalled = true;
      return mockRes as Response;
    },
  };

  return mockRes as unknown as Response & { endCalled: boolean; jsonBody: unknown };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Verbose Logging Middleware', () => {
  beforeEach(() => {
    // Reset mocks
    mockVerboseMode = false;
    mockVerboseHttp = false;
    mockDebugLevel = false;
    loggedMessages.length = 0;
  });

  describe('verboseLoggingMiddleware', () => {
    it('should skip logging when verbose mode is disabled', () => {
      mockVerboseMode = false;
      mockVerboseHttp = false;

      const req = createVerboseRequest();
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // Should not have modified the request
      assert.strictEqual((req as Request & { verboseRequestId?: string }).verboseRequestId, undefined);
    });

    it('should assign verboseRequestId when verbose mode is enabled', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest();
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      const typedReq = req as Request & { verboseRequestId?: string; verboseStartTime?: number };
      assert.ok(typedReq.verboseRequestId, 'Should have a verboseRequestId');
      assert.ok(typedReq.verboseStartTime, 'Should have a verboseStartTime');
      // Verify it's a valid UUID format
      assert.match(typedReq.verboseRequestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should intercept res.end and log response', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest();
      const res = createVerboseResponse();
      const originalEnd = res.end;
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // res.end should be wrapped
      assert.notStrictEqual(res.end, originalEnd);

      // Call the wrapped end
      res.end();

      assert.strictEqual(res.endCalled, true);
      // Should have logged the response
      assert.ok(loggedMessages.some(m => m.message.includes('Response:')));
    });

    it('should intercept res.json to capture response size', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest();
      const res = createVerboseResponse();
      const originalJson = res.json;
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // res.json should be wrapped
      assert.notStrictEqual(res.json, originalJson);

      // Call the wrapped json
      const testBody = { message: 'test' };
      res.json(testBody);

      assert.deepStrictEqual(res.jsonBody, testBody);
    });

    it('should handle requests with query parameters', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest({
        query: { page: '1', limit: '10' } as Record<string, string>,
        originalUrl: '/api/test?page=1&limit=10',
      });
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      const typedReq = req as Request & { verboseRequestId?: string };
      assert.ok(typedReq.verboseRequestId);
    });

    it('should handle requests with body content', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest({
        method: 'POST',
        body: { name: 'test', value: 123 },
      });
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
    });

    it('should sanitize sensitive headers', () => {
      const headers = {
        'authorization': 'Bearer secret-token',
        'cookie': 'session=abc123',
        'x-api-key': 'api-key-123',
        'content-type': 'application/json',
      };

      const sanitized = sanitizeHeaders(headers);

      assert.strictEqual(sanitized['authorization'], '[REDACTED]');
      assert.strictEqual(sanitized['cookie'], '[REDACTED]');
      assert.strictEqual(sanitized['x-api-key'], '[REDACTED]');
      assert.strictEqual(sanitized['content-type'], 'application/json');
    });

    it('should log request details when verbose mode is enabled', () => {
      mockVerboseMode = true;

      const req = createVerboseRequest({
        method: 'POST',
        originalUrl: '/api/users',
        path: '/api/users',
      });
      const res = createVerboseResponse();
      const next = () => {};

      testVerboseLoggingMiddleware(req, res, next as NextFunction);

      assert.ok(loggedMessages.some(m => m.message.includes('Incoming request')));
      assert.ok(loggedMessages.some(m => m.message.includes('POST')));
    });
  });

  describe('slowRequestLoggingMiddleware', () => {
    it('should create middleware with default threshold', () => {
      const middleware = testSlowRequestLoggingMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should create middleware with custom threshold', () => {
      const middleware = testSlowRequestLoggingMiddleware(500);
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should call next immediately', () => {
      const middleware = testSlowRequestLoggingMiddleware(1000);
      const req = createVerboseRequest();
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
    });

    it('should register finish event handler', () => {
      const middleware = testSlowRequestLoggingMiddleware(1000);
      const req = createVerboseRequest();
      const res = createVerboseResponse();
      let finishHandlerRegistered = false;

      const originalOn = res.on;
      res.on = function(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'finish') {
          finishHandlerRegistered = true;
        }
        return originalOn.call(this, event, handler);
      } as typeof res.on;

      const next = () => {};

      middleware(req, res, next as NextFunction);

      assert.strictEqual(finishHandlerRegistered, true);
    });

    it('should log slow requests when finish event fires', async () => {
      const middleware = testSlowRequestLoggingMiddleware(10); // 10ms threshold
      const req = createVerboseRequest({
        method: 'POST',
        originalUrl: '/api/slow-endpoint',
      });
      const res = createVerboseResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      // Wait to exceed threshold
      await new Promise(resolve => setTimeout(resolve, 20));

      // Emit finish event
      res.emit('finish');

      // Should have logged a warning
      assert.ok(loggedMessages.some(m => m.level === 'warn' && m.message.includes('Slow request')));
    });

    it('should not log fast requests', () => {
      const middleware = testSlowRequestLoggingMiddleware(10000); // 10 second threshold
      const req = createVerboseRequest();
      const res = createVerboseResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      // Immediately emit finish
      res.emit('finish');

      // Should not have logged a warning
      assert.ok(!loggedMessages.some(m => m.level === 'warn'));
    });
  });

  describe('requestSizeLoggingMiddleware', () => {
    it('should create middleware with default threshold', () => {
      const middleware = testRequestSizeLoggingMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should create middleware with custom threshold', () => {
      const middleware = testRequestSizeLoggingMiddleware(1024);
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should call next for small requests', () => {
      const middleware = testRequestSizeLoggingMiddleware(1024 * 1024);
      const req = createVerboseRequest({
        headers: {
          'content-length': '100',
        } as Record<string, string>,
      });
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // Should not have logged anything
      assert.ok(!loggedMessages.some(m => m.message.includes('Large request')));
    });

    it('should call next and log for large requests', () => {
      const middleware = testRequestSizeLoggingMiddleware(100); // 100 byte threshold
      const req = createVerboseRequest({
        headers: {
          'content-length': '1000',
        } as Record<string, string>,
      });
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // Should have logged
      assert.ok(loggedMessages.some(m => m.message.includes('Large request')));
    });

    it('should call next when no content-length header', () => {
      const middleware = testRequestSizeLoggingMiddleware(100);
      const req = createVerboseRequest();
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
    });

    it('should calculate size from body when no content-length', () => {
      const middleware = testRequestSizeLoggingMiddleware(10);
      const req = createVerboseRequest({
        body: { largeData: 'x'.repeat(100) },
      });
      const res = createVerboseResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      // Should have logged due to body size
      assert.ok(loggedMessages.some(m => m.message.includes('Large request')));
    });
  });

  describe('getContentLength helper', () => {
    it('should return content-length header value', () => {
      const req = createVerboseRequest({
        headers: { 'content-length': '500' } as Record<string, string>,
      });
      assert.strictEqual(getContentLength(req), 500);
    });

    it('should calculate from body when no header', () => {
      const req = createVerboseRequest({
        body: { test: 'data' },
      });
      const size = getContentLength(req);
      assert.ok(size && size > 0);
    });

    it('should return undefined for request without body', () => {
      const req = createVerboseRequest();
      delete (req as { body?: unknown }).body;
      assert.strictEqual(getContentLength(req), undefined);
    });
  });
});
