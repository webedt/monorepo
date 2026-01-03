/**
 * Integration Tests for Middleware Composition
 * Tests that middleware works correctly when composed together in the request pipeline
 *
 * Note: Uses test doubles to avoid circular dependency issues with @webedt/shared imports.
 * Tests verify the middleware composition patterns rather than importing actual middleware.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// TEST DOUBLES - Correlation ID Middleware
// =============================================================================

const CORRELATION_ID_HEADER = 'X-Request-ID';

function testCorrelationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  let correlationId = req.headers['x-request-id'] as string | undefined;

  if (!correlationId || typeof correlationId !== 'string') {
    correlationId = randomUUID();
  } else {
    correlationId = correlationId.trim().replace(/[\x00-\x1f\x7f]/g, '').substring(0, 128);
    if (!correlationId) {
      correlationId = randomUUID();
    }
  }

  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}

// =============================================================================
// TEST DOUBLES - Batch Context Middleware
// =============================================================================

interface TestLoaders {
  context: { clear: () => void };
}

interface TestBatchRequest extends Request {
  loaders?: TestLoaders;
}

function testHasBatchContext(req: Request): req is TestBatchRequest {
  return 'loaders' in req && (req as TestBatchRequest).loaders !== undefined;
}

function testBatchContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const context = {
      cleared: false,
      clear() {
        this.cleared = true;
      },
    };

    (req as TestBatchRequest).loaders = { context };

    let cleaned = false;
    res.on('close', () => {
      if (!cleaned) {
        cleaned = true;
        context.clear();
      }
    });

    next();
  };
}

// =============================================================================
// TEST DOUBLES - Verbose Logging Middleware
// =============================================================================

let mockVerboseMode = true;

function testVerboseLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!mockVerboseMode) {
    return next();
  }

  (req as Request & { verboseRequestId?: string; verboseStartTime?: number }).verboseRequestId = randomUUID();
  (req as Request & { verboseStartTime?: number }).verboseStartTime = Date.now();
  next();
}

// =============================================================================
// TEST DOUBLES - Path Validation Middleware
// =============================================================================

const TRAVERSAL_PATTERN = /(?:^|\/|\\)\.\.(?:\/|\\|$)/;
const SAFE_PATH_REGEX = /^[a-zA-Z0-9._\-\/]+$/;

function testValidatePathParam() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.params['0'];

    if (!path) {
      res.status(400).json({ success: false, error: 'Path is required' });
      return;
    }

    if (TRAVERSAL_PATTERN.test(path)) {
      res.status(400).json({ success: false, error: 'Path contains directory traversal patterns' });
      return;
    }

    if (!SAFE_PATH_REGEX.test(path)) {
      res.status(400).json({ success: false, error: 'Path contains invalid characters' });
      return;
    }

    if (path.startsWith('/')) {
      res.status(400).json({ success: false, error: 'Path cannot start with a slash' });
      return;
    }

    next();
  };
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createIntegrationRequest(overrides: Partial<Request> = {}): Request {
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

function createIntegrationResponse(): Response & {
  endCalled: boolean;
  statusCode: number;
  data: unknown;
  getSetHeader: (name: string) => string | undefined;
  triggerClose: () => void;
  triggerFinish: () => void;
} {
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
    get data() { return jsonBody; },

    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),

    setHeader(name: string, value: string | number | string[]) {
      responseHeaders.set(name, value as string);
      return mockRes;
    },
    getHeaders() {
      const headers: Record<string, string | number | string[]> = {};
      responseHeaders.forEach((value, key) => {
        headers[key] = value;
      });
      return headers;
    },
    getSetHeader(name: string) {
      return responseHeaders.get(name) as string | undefined;
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
    triggerClose() {
      emitter.emit('close');
    },
    triggerFinish() {
      emitter.emit('finish');
    },
  };

  return mockRes as unknown as Response & typeof mockRes;
}

/**
 * Compose multiple middleware functions into a chain
 */
function composeMiddleware(...middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>) {
  return (req: Request, res: Response, done: NextFunction) => {
    let index = 0;

    function next(err?: unknown): void {
      if (err) {
        done(err as Error);
        return;
      }

      const middleware = middlewares[index++];
      if (middleware) {
        try {
          middleware(req, res, next);
        } catch (e) {
          done(e as Error);
        }
      } else {
        done();
      }
    }

    next();
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Middleware Composition Integration Tests', () => {
  beforeEach(() => {
    mockVerboseMode = true;
  });

  describe('Correlation ID + Verbose Logging', () => {
    it('should have correlation ID available for verbose logging', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();
      let chainCompleted = false;

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testVerboseLoggingMiddleware,
        (req: Request, _res: Response, next: NextFunction) => {
          const typedReq = req as Request & { correlationId?: string; verboseRequestId?: string };
          assert.ok(typedReq.correlationId, 'Should have correlationId');
          assert.ok(typedReq.verboseRequestId, 'Should have verboseRequestId');
          chainCompleted = true;
          next();
        }
      );

      composed(req, res, () => {});

      assert.strictEqual(chainCompleted, true);
    });

    it('should set response header from correlation middleware', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testVerboseLoggingMiddleware
      );

      composed(req, res, () => {});

      const header = res.getSetHeader(CORRELATION_ID_HEADER);
      assert.ok(header, 'Should have X-Request-ID header');
      assert.strictEqual(header, (req as Request & { correlationId: string }).correlationId);
    });
  });

  describe('Correlation ID + Batch Context', () => {
    it('should have both correlation ID and loaders available', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();
      let chainCompleted = false;

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware(),
        (req: Request, _res: Response, next: NextFunction) => {
          const typedReq = req as Request & { correlationId?: string };
          assert.ok(typedReq.correlationId, 'Should have correlationId');
          assert.ok(testHasBatchContext(req), 'Should have batch context');
          chainCompleted = true;
          next();
        }
      );

      composed(req, res, () => {});

      assert.strictEqual(chainCompleted, true);
    });

    it('should clean up batch context on response close after full chain', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware()
      );

      composed(req, res, () => {});

      const loaders = (req as TestBatchRequest).loaders!;
      let clearCalled = false;
      const originalClear = loaders.context.clear.bind(loaders.context);
      loaders.context.clear = function() {
        clearCalled = true;
        return originalClear();
      };

      res.triggerClose();

      assert.strictEqual(clearCalled, true);
    });
  });

  describe('Full Request Pipeline', () => {
    it('should run correlation, batch context, and verbose logging in order', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();
      const executionOrder: string[] = [];

      // Wrap middleware to track execution order
      const trackCorrelation = (req: Request, res: Response, next: NextFunction) => {
        testCorrelationIdMiddleware(req, res, () => {
          executionOrder.push('correlation');
          next();
        });
      };

      const batchMiddleware = testBatchContextMiddleware();
      const trackBatch = (req: Request, res: Response, next: NextFunction) => {
        batchMiddleware(req, res, () => {
          executionOrder.push('batch');
          next();
        });
      };

      const trackVerbose = (req: Request, res: Response, next: NextFunction) => {
        testVerboseLoggingMiddleware(req, res, () => {
          executionOrder.push('verbose');
          next();
        });
      };

      const composed = composeMiddleware(
        trackCorrelation,
        trackBatch,
        trackVerbose
      );

      composed(req, res, () => {});

      assert.deepStrictEqual(executionOrder, ['correlation', 'batch', 'verbose']);
    });

    it('should maintain request state across entire pipeline', () => {
      const customCorrelationId = 'test-correlation-123';
      const req = createIntegrationRequest({
        headers: { 'x-request-id': customCorrelationId } as Record<string, string>,
        params: { '0': 'valid/path.txt' } as Record<string, string>,
      });
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware(),
        testVerboseLoggingMiddleware,
        testValidatePathParam()
      );

      let pipelineCompleted = false;
      composed(req, res, () => {
        pipelineCompleted = true;
      });

      const typedReq = req as Request & { correlationId?: string; verboseRequestId?: string };
      assert.strictEqual(pipelineCompleted, true);
      assert.strictEqual(typedReq.correlationId, customCorrelationId);
      assert.ok(testHasBatchContext(req));
      assert.ok(typedReq.verboseRequestId);
    });
  });

  describe('Path Validation in Pipeline', () => {
    it('should short-circuit pipeline on invalid path', () => {
      const req = createIntegrationRequest({
        params: { '0': '../../../etc/passwd' } as Record<string, string>,
      });
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testValidatePathParam(),
        (_req: Request, _res: Response, next: NextFunction) => {
          // This should never be called
          assert.fail('Should not reach this middleware');
          next();
        }
      );

      composed(req, res, () => {});

      const typedReq = req as Request & { correlationId?: string };
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(typedReq.correlationId !== undefined, true, 'Correlation ID should still be set');
    });

    it('should continue pipeline on valid path', () => {
      const req = createIntegrationRequest({
        params: { '0': 'src/valid/file.txt' } as Record<string, string>,
      });
      const res = createIntegrationResponse();
      let reachedFinalMiddleware = false;

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testValidatePathParam(),
        (_req: Request, _res: Response, next: NextFunction) => {
          reachedFinalMiddleware = true;
          next();
        }
      );

      composed(req, res, () => {});

      assert.strictEqual(reachedFinalMiddleware, true);
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe('Error Handling in Pipeline', () => {
    it('should propagate errors through the chain', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();
      const testError = new Error('Test error');

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        (_req: Request, _res: Response, _next: NextFunction) => {
          throw testError;
        }
      );

      let caughtError: Error | null = null;
      composed(req, res, (err?: Error) => {
        caughtError = err || null;
      });

      assert.strictEqual(caughtError, testError);
    });

    it('should have correlation ID set before error occurs', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        (req: Request, _res: Response, _next: NextFunction) => {
          const typedReq = req as Request & { correlationId?: string };
          assert.ok(typedReq.correlationId);
          throw new Error('Test error');
        }
      );

      composed(req, res, () => {});

      const typedReq = req as Request & { correlationId?: string };
      assert.ok(typedReq.correlationId);
    });
  });

  describe('Concurrent Requests', () => {
    it('should isolate state between concurrent requests', () => {
      const requests: Array<{ req: Request; res: Response }> = [];

      // Create 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        const req = createIntegrationRequest({
          originalUrl: `/api/test/${i}`,
        });
        const res = createIntegrationResponse();
        requests.push({ req, res });
      }

      // Run all through middleware
      for (const { req, res } of requests) {
        const composed = composeMiddleware(
          testCorrelationIdMiddleware,
          testBatchContextMiddleware(),
          testVerboseLoggingMiddleware
        );

        composed(req, res, () => {});
      }

      // Verify each has unique IDs
      type TypedRequest = Request & { correlationId?: string; verboseRequestId?: string };
      const correlationIds = new Set(requests.map(r => (r.req as TypedRequest).correlationId));
      const verboseIds = new Set(requests.map(r => (r.req as TypedRequest).verboseRequestId));

      assert.strictEqual(correlationIds.size, 5, 'Each request should have unique correlation ID');
      assert.strictEqual(verboseIds.size, 5, 'Each request should have unique verbose request ID');

      // Verify each has isolated batch context
      const contexts = new Set(requests.map(r => (r.req as TestBatchRequest).loaders!.context));
      assert.strictEqual(contexts.size, 5, 'Each request should have unique batch context');
    });
  });

  describe('Response Lifecycle', () => {
    it('should handle response end after full pipeline', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware(),
        testVerboseLoggingMiddleware
      );

      composed(req, res, () => {});

      // Simulate response lifecycle
      res.status(200);
      res.json({ success: true });
      res.end();
      res.triggerFinish();
      res.triggerClose();

      assert.strictEqual(res.endCalled, true);
      assert.deepStrictEqual(res.data, { success: true });
    });

    it('should clean up resources on client disconnect', () => {
      const req = createIntegrationRequest();
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware()
      );

      composed(req, res, () => {});

      const loaders = (req as TestBatchRequest).loaders!;
      let cleanedUp = false;
      const originalClear = loaders.context.clear.bind(loaders.context);
      loaders.context.clear = function() {
        cleanedUp = true;
        return originalClear();
      };

      // Simulate client disconnect
      res.triggerClose();

      assert.strictEqual(cleanedUp, true);
    });
  });

  describe('Request with Headers from Load Balancer', () => {
    it('should preserve load balancer correlation ID through pipeline', () => {
      const loadBalancerId = 'lb-request-12345-abcdef';
      const req = createIntegrationRequest({
        headers: { 'x-request-id': loadBalancerId } as Record<string, string>,
      });
      const res = createIntegrationResponse();

      const composed = composeMiddleware(
        testCorrelationIdMiddleware,
        testBatchContextMiddleware(),
        testVerboseLoggingMiddleware
      );

      composed(req, res, () => {});

      const typedReq = req as Request & { correlationId?: string };
      assert.strictEqual(typedReq.correlationId, loadBalancerId);
      assert.strictEqual(res.getSetHeader(CORRELATION_ID_HEADER), loadBalancerId);
    });
  });
});
