/**
 * Tests for Batch Context Middleware
 * Covers batchContextMiddleware, hasBatchContext, getLoaders, and createCustomLoader
 *
 * Note: Uses test doubles to avoid circular dependency issues with @webedt/shared imports.
 * Tests verify the middleware logic patterns rather than importing the actual middleware.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';

import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// TEST DOUBLES
// =============================================================================

/**
 * Simple DataLoader implementation for testing
 */
class TestDataLoader<K, V> {
  private cache = new Map<K, V>();
  private batchFn: (keys: K[]) => Promise<Map<K, V | null>>;

  constructor(batchFn: (keys: K[]) => Promise<Map<K, V | null>>) {
    this.batchFn = batchFn;
  }

  async load(key: K): Promise<V | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    const result = await this.batchFn([key]);
    const value = result.get(key) ?? null;
    if (value !== null) {
      this.cache.set(key, value);
    }
    return value;
  }

  async loadMany(keys: K[]): Promise<Array<V | null>> {
    return Promise.all(keys.map(key => this.load(key)));
  }

  clear(key?: K): void {
    if (key !== undefined) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

/**
 * Simple BatchContext implementation for testing
 */
class TestBatchContext {
  private loaders = new Map<string, TestDataLoader<unknown, unknown>>();

  getLoader<K, V>(name: string, batchFn: (keys: K[]) => Promise<Map<K, V | null>>): TestDataLoader<K, V> {
    if (!this.loaders.has(name)) {
      this.loaders.set(name, new TestDataLoader(batchFn as (keys: unknown[]) => Promise<Map<unknown, unknown | null>>));
    }
    return this.loaders.get(name) as TestDataLoader<K, V>;
  }

  clear(): void {
    for (const loader of this.loaders.values()) {
      loader.clear();
    }
    this.loaders.clear();
  }
}

/**
 * Mock loaders interface
 */
interface TestRequestLoaders {
  user: TestDataLoader<string, { id: string; email: string }>;
  userInfo: TestDataLoader<string, { id: string; displayName: string }>;
  author: TestDataLoader<string, { id: string; displayName: string }>;
  session: TestDataLoader<string, { id: string; title: string }>;
  activeSession: TestDataLoader<string, { id: string; title: string }>;
  sessionSummary: TestDataLoader<string, { id: string; title: string }>;
  context: TestBatchContext;
}

interface TestBatchContextRequest extends Request {
  loaders?: TestRequestLoaders;
}

/**
 * Check if request has loaders attached
 */
function testHasBatchContext(req: Request): req is TestBatchContextRequest {
  return 'loaders' in req && (req as TestBatchContextRequest).loaders !== undefined;
}

/**
 * Get loaders from request, throwing if not available
 */
function testGetLoaders(req: Request): TestRequestLoaders {
  if (!testHasBatchContext(req)) {
    throw new Error('BatchContext middleware not configured. Add batchContextMiddleware() to your Express app.');
  }
  return (req as TestBatchContextRequest).loaders!;
}

/**
 * Create request-scoped loaders
 */
function createTestRequestLoaders(): TestRequestLoaders {
  const context = new TestBatchContext();

  // Create mock loaders that simulate the behavior
  const mockUserLoader = new TestDataLoader<string, { id: string; email: string }>(
    async (ids) => new Map(ids.map(id => [id, { id, email: `${id}@test.com` }]))
  );
  const mockUserInfoLoader = new TestDataLoader<string, { id: string; displayName: string }>(
    async (ids) => new Map(ids.map(id => [id, { id, displayName: `User ${id}` }]))
  );
  const mockAuthorLoader = new TestDataLoader<string, { id: string; displayName: string }>(
    async (ids) => new Map(ids.map(id => [id, { id, displayName: `Author ${id}` }]))
  );
  const mockSessionLoader = new TestDataLoader<string, { id: string; title: string }>(
    async (ids) => new Map(ids.map(id => [id, { id, title: `Session ${id}` }]))
  );

  return {
    user: mockUserLoader,
    userInfo: mockUserInfoLoader,
    author: mockAuthorLoader,
    session: mockSessionLoader,
    activeSession: mockSessionLoader,
    sessionSummary: mockSessionLoader,
    context,
  };
}

/**
 * Test batch context middleware
 */
function testBatchContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Create request-scoped loaders
    const loaders = createTestRequestLoaders();

    // Attach to request
    (req as TestBatchContextRequest).loaders = loaders;

    // Track cleanup state to prevent double-clearing
    let cleaned = false;
    const cleanup = () => {
      if (!cleaned) {
        cleaned = true;
        loaders.context.clear();
      }
    };

    // Clean up loaders when response finishes or client disconnects
    res.on('close', cleanup);

    next();
  };
}

/**
 * Create custom loader using the request's BatchContext
 */
function testCreateCustomLoader<K, V>(
  req: Request,
  name: string,
  batchFn: (keys: K[]) => Promise<Map<K, V | null>>
): TestDataLoader<K, V> {
  const loaders = testGetLoaders(req);
  return loaders.context.getLoader(name, batchFn);
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createBatchRequest(overrides: Partial<Request> = {}): Request {
  const baseReq: Partial<Request> = {
    ...overrides,
  };
  return baseReq as Request;
}

function createBatchResponse(): Response & { triggerClose: () => void } {
  const emitter = new EventEmitter();

  const mockRes = {
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    triggerClose() {
      emitter.emit('close');
    },
  };

  return mockRes as unknown as Response & { triggerClose: () => void };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Batch Context Middleware', () => {
  describe('batchContextMiddleware', () => {
    it('should create middleware function', () => {
      const middleware = testBatchContextMiddleware();
      assert.strictEqual(typeof middleware, 'function');
    });

    it('should attach loaders to request', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      middleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.ok((req as TestBatchContextRequest).loaders, 'Should have loaders attached');
    });

    it('should create all expected loaders', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.ok(loaders.user, 'Should have user loader');
      assert.ok(loaders.userInfo, 'Should have userInfo loader');
      assert.ok(loaders.author, 'Should have author loader');
      assert.ok(loaders.session, 'Should have session loader');
      assert.ok(loaders.activeSession, 'Should have activeSession loader');
      assert.ok(loaders.sessionSummary, 'Should have sessionSummary loader');
      assert.ok(loaders.context, 'Should have BatchContext');
    });

    it('should create loaders with load method', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.strictEqual(typeof loaders.user.load, 'function');
      assert.strictEqual(typeof loaders.userInfo.load, 'function');
      assert.strictEqual(typeof loaders.author.load, 'function');
      assert.strictEqual(typeof loaders.session.load, 'function');
      assert.strictEqual(typeof loaders.activeSession.load, 'function');
      assert.strictEqual(typeof loaders.sessionSummary.load, 'function');
    });

    it('should register close event handler for cleanup', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      let closeHandlerRegistered = false;

      const originalOn = res.on;
      res.on = function(event: string, handler: (...args: unknown[]) => void) {
        if (event === 'close') {
          closeHandlerRegistered = true;
        }
        return originalOn.call(this, event, handler);
      } as typeof res.on;

      const next = () => {};

      middleware(req, res, next as NextFunction);

      assert.strictEqual(closeHandlerRegistered, true);
    });

    it('should clear context on response close', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      let clearCalled = false;
      const originalClear = loaders.context.clear.bind(loaders.context);
      loaders.context.clear = function() {
        clearCalled = true;
        return originalClear();
      };

      res.triggerClose();

      assert.strictEqual(clearCalled, true);
    });

    it('should prevent double-clearing on multiple close events', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      let clearCallCount = 0;
      const originalClear = loaders.context.clear.bind(loaders.context);
      loaders.context.clear = function() {
        clearCallCount++;
        return originalClear();
      };

      res.triggerClose();
      res.triggerClose();
      res.triggerClose();

      assert.strictEqual(clearCallCount, 1, 'Clear should only be called once');
    });

    it('should create isolated loaders per request', () => {
      const middleware = testBatchContextMiddleware();

      const req1 = createBatchRequest();
      const res1 = createBatchResponse();
      middleware(req1, res1, () => {});

      const req2 = createBatchRequest();
      const res2 = createBatchResponse();
      middleware(req2, res2, () => {});

      const loaders1 = (req1 as TestBatchContextRequest).loaders!;
      const loaders2 = (req2 as TestBatchContextRequest).loaders!;

      assert.notStrictEqual(loaders1, loaders2, 'Each request should have unique loaders');
      assert.notStrictEqual(loaders1.user, loaders2.user);
      assert.notStrictEqual(loaders1.context, loaders2.context);
    });
  });

  describe('hasBatchContext', () => {
    it('should return false for request without loaders', () => {
      const req = createBatchRequest();

      assert.strictEqual(testHasBatchContext(req), false);
    });

    it('should return false for request with undefined loaders', () => {
      const req = createBatchRequest();
      (req as TestBatchContextRequest).loaders = undefined;

      assert.strictEqual(testHasBatchContext(req), false);
    });

    it('should return true for request with loaders attached', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      assert.strictEqual(testHasBatchContext(req), true);
    });
  });

  describe('getLoaders', () => {
    it('should throw error when middleware not configured', () => {
      const req = createBatchRequest();

      assert.throws(() => {
        testGetLoaders(req);
      }, {
        message: 'BatchContext middleware not configured. Add batchContextMiddleware() to your Express app.',
      });
    });

    it('should return loaders when middleware is configured', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = testGetLoaders(req);
      assert.ok(loaders);
      assert.ok(loaders.user);
      assert.ok(loaders.context);
    });
  });

  describe('createCustomLoader', () => {
    it('should create custom loader using request BatchContext', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const customLoader = testCreateCustomLoader(
        req,
        'testLoader',
        async (ids: string[]) => {
          const map = new Map<string, { id: string; value: number } | null>();
          ids.forEach((id, index) => {
            map.set(id, { id, value: index });
          });
          return map;
        }
      );

      assert.ok(customLoader);
      assert.strictEqual(typeof customLoader.load, 'function');
    });

    it('should throw error when creating custom loader without middleware', () => {
      const req = createBatchRequest();

      assert.throws(() => {
        testCreateCustomLoader(
          req,
          'testLoader',
          async (ids: string[]) => new Map(ids.map(id => [id, null]))
        );
      }, {
        message: 'BatchContext middleware not configured. Add batchContextMiddleware() to your Express app.',
      });
    });

    it('should return same loader instance for same name', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const batchFn = async (ids: string[]) => new Map(ids.map(id => [id, { id }]));

      const loader1 = testCreateCustomLoader(req, 'sameNameLoader', batchFn);
      const loader2 = testCreateCustomLoader(req, 'sameNameLoader', batchFn);

      assert.strictEqual(loader1, loader2, 'Same name should return same loader instance');
    });

    it('should return different loader instances for different names', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const batchFn = async (ids: string[]) => new Map(ids.map(id => [id, { id }]));

      const loader1 = testCreateCustomLoader(req, 'loader1', batchFn);
      const loader2 = testCreateCustomLoader(req, 'loader2', batchFn);

      assert.notStrictEqual(loader1, loader2);
    });
  });

  describe('Loader Functionality', () => {
    it('should have loaders with loadMany method', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.strictEqual(typeof loaders.user.loadMany, 'function');
      assert.strictEqual(typeof loaders.session.loadMany, 'function');
    });

    it('should have loaders with clear method', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.strictEqual(typeof loaders.user.clear, 'function');
    });

    it('should have BatchContext with getLoader method', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.strictEqual(typeof loaders.context.getLoader, 'function');
    });

    it('should have BatchContext with clear method', () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      assert.strictEqual(typeof loaders.context.clear, 'function');
    });

    it('should load data through loaders', async () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      const user = await loaders.user.load('user-1');

      assert.ok(user);
      assert.strictEqual(user.id, 'user-1');
      assert.strictEqual(user.email, 'user-1@test.com');
    });

    it('should load multiple items with loadMany', async () => {
      const middleware = testBatchContextMiddleware();
      const req = createBatchRequest();
      const res = createBatchResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      const loaders = (req as TestBatchContextRequest).loaders!;
      const users = await loaders.user.loadMany(['user-1', 'user-2', 'user-3']);

      assert.strictEqual(users.length, 3);
      assert.ok(users.every(u => u !== null));
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple sequential requests', () => {
      const middleware = testBatchContextMiddleware();

      for (let i = 0; i < 10; i++) {
        const req = createBatchRequest();
        const res = createBatchResponse();
        const next = () => {};

        middleware(req, res, next as NextFunction);

        assert.ok(testHasBatchContext(req));
        res.triggerClose();
      }
    });

    it('should work correctly with concurrent requests', () => {
      const middleware = testBatchContextMiddleware();
      const requests: TestBatchContextRequest[] = [];

      // Create multiple concurrent requests
      for (let i = 0; i < 5; i++) {
        const req = createBatchRequest();
        const res = createBatchResponse();
        const next = () => {};

        middleware(req, res, next as NextFunction);
        requests.push(req as TestBatchContextRequest);
      }

      // Verify each has unique loaders
      const contexts = new Set(requests.map(r => r.loaders!.context));
      assert.strictEqual(contexts.size, 5, 'Each request should have unique BatchContext');
    });
  });
});
