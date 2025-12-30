/**
 * Tests for ShutdownManager
 *
 * Covers:
 * - Handler registration and unregistration
 * - Priority-based shutdown ordering
 * - Timeout handling for individual handlers
 * - Error handling and continue-on-error behavior
 * - Multiple shutdown prevention
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  shutdownManager,
  createShutdownHandler,
  ShutdownPriority,
} from '../../src/lifecycle/index.js';

describe('ShutdownManager', () => {
  beforeEach(() => {
    // Reset the shutdown manager before each test
    shutdownManager.reset();
  });

  describe('handler registration', () => {
    it('should register a handler', () => {
      const handler = createShutdownHandler('test', () => {});

      shutdownManager.register(handler);

      const stats = shutdownManager.getStats();
      assert.strictEqual(stats.handlerCount, 1);
    });

    it('should track handlers by priority', () => {
      shutdownManager.register(createShutdownHandler('high', () => {}, ShutdownPriority.STOP_ACCEPTING));
      shutdownManager.register(createShutdownHandler('medium', () => {}, ShutdownPriority.NOTIFY_CLIENTS));
      shutdownManager.register(createShutdownHandler('low', () => {}, ShutdownPriority.CLOSE_DATABASE));

      const stats = shutdownManager.getStats();
      assert.strictEqual(stats.handlerCount, 3);
      assert.deepStrictEqual(stats.handlersByPriority[ShutdownPriority.STOP_ACCEPTING], ['high']);
      assert.deepStrictEqual(stats.handlersByPriority[ShutdownPriority.NOTIFY_CLIENTS], ['medium']);
      assert.deepStrictEqual(stats.handlersByPriority[ShutdownPriority.CLOSE_DATABASE], ['low']);
    });

    it('should replace handler with same name', () => {
      shutdownManager.register(createShutdownHandler('test', () => {}, ShutdownPriority.STOP_ACCEPTING));
      shutdownManager.register(createShutdownHandler('test', () => {}, ShutdownPriority.CLOSE_DATABASE));

      const stats = shutdownManager.getStats();
      assert.strictEqual(stats.handlerCount, 1);
      // Should have the new priority
      assert.deepStrictEqual(stats.handlersByPriority[ShutdownPriority.CLOSE_DATABASE], ['test']);
    });

    it('should unregister a handler', () => {
      shutdownManager.register(createShutdownHandler('test', () => {}));

      const removed = shutdownManager.unregister('test');

      assert.strictEqual(removed, true);
      assert.strictEqual(shutdownManager.getStats().handlerCount, 0);
    });

    it('should return false when unregistering non-existent handler', () => {
      const removed = shutdownManager.unregister('non-existent');

      assert.strictEqual(removed, false);
    });

    it('should return true when registration succeeds', () => {
      const handler = createShutdownHandler('test', () => {});

      const result = shutdownManager.register(handler);

      assert.strictEqual(result, true);
    });

    it('should return false when registering during shutdown', async () => {
      shutdownManager.register(createShutdownHandler('existing', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      }));

      // Start shutdown
      const shutdownPromise = shutdownManager.shutdown('test');

      // Try to register during shutdown
      const result = shutdownManager.register(createShutdownHandler('new', () => {}));

      await shutdownPromise;

      assert.strictEqual(result, false);
    });
  });

  describe('shutdown execution', () => {
    it('should execute handlers in priority order', async () => {
      const order: string[] = [];

      shutdownManager.register({
        name: 'last',
        priority: ShutdownPriority.CLOSE_DATABASE,
        async shutdown() {
          order.push('last');
        },
      });

      shutdownManager.register({
        name: 'first',
        priority: ShutdownPriority.STOP_ACCEPTING,
        async shutdown() {
          order.push('first');
        },
      });

      shutdownManager.register({
        name: 'middle',
        priority: ShutdownPriority.NOTIFY_CLIENTS,
        async shutdown() {
          order.push('middle');
        },
      });

      await shutdownManager.shutdown('test');

      assert.deepStrictEqual(order, ['first', 'middle', 'last']);
    });

    it('should return success result when all handlers complete', async () => {
      shutdownManager.register(createShutdownHandler('one', () => {}));
      shutdownManager.register(createShutdownHandler('two', () => {}));

      const result = await shutdownManager.shutdown('test');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.successCount, 2);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.timeoutCount, 0);
    });

    it('should track handler results', async () => {
      shutdownManager.register(createShutdownHandler('handler1', () => {}, ShutdownPriority.STOP_ACCEPTING));
      shutdownManager.register(createShutdownHandler('handler2', () => {}, ShutdownPriority.NOTIFY_CLIENTS));

      const result = await shutdownManager.shutdown('test');

      assert.strictEqual(result.handlers.length, 2);
      assert.strictEqual(result.handlers[0].name, 'handler1');
      assert.strictEqual(result.handlers[0].priority, ShutdownPriority.STOP_ACCEPTING);
      assert.strictEqual(result.handlers[0].success, true);
      assert.strictEqual(result.handlers[1].name, 'handler2');
      assert.strictEqual(result.handlers[1].priority, ShutdownPriority.NOTIFY_CLIENTS);
    });
  });

  describe('error handling', () => {
    it('should continue with remaining handlers on error by default', async () => {
      const order: string[] = [];

      shutdownManager.register({
        name: 'first',
        priority: 100,
        async shutdown() {
          order.push('first');
        },
      });

      shutdownManager.register({
        name: 'error',
        priority: 200,
        async shutdown() {
          throw new Error('Test error');
        },
      });

      shutdownManager.register({
        name: 'last',
        priority: 300,
        async shutdown() {
          order.push('last');
        },
      });

      const result = await shutdownManager.shutdown('test');

      assert.deepStrictEqual(order, ['first', 'last']);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.successCount, 2);
      assert.strictEqual(result.failureCount, 1);
    });

    it('should stop on error when continueOnError is false', async () => {
      const order: string[] = [];

      shutdownManager.register({
        name: 'first',
        priority: 100,
        async shutdown() {
          order.push('first');
        },
      });

      shutdownManager.register({
        name: 'error',
        priority: 200,
        async shutdown() {
          throw new Error('Test error');
        },
      });

      shutdownManager.register({
        name: 'last',
        priority: 300,
        async shutdown() {
          order.push('last');
        },
      });

      const result = await shutdownManager.shutdown('test', { continueOnError: false });

      assert.deepStrictEqual(order, ['first']);
      assert.strictEqual(result.successCount, 1);
      assert.strictEqual(result.failureCount, 1);
    });

    it('should record error message in handler result', async () => {
      shutdownManager.register({
        name: 'error',
        priority: 100,
        async shutdown() {
          throw new Error('Specific error message');
        },
      });

      const result = await shutdownManager.shutdown('test');

      assert.strictEqual(result.handlers[0].success, false);
      assert.strictEqual(result.handlers[0].error, 'Specific error message');
    });
  });

  describe('timeout handling', () => {
    it('should timeout slow handlers', async () => {
      shutdownManager.register({
        name: 'slow',
        priority: 100,
        async shutdown() {
          // This will be interrupted by timeout
          await new Promise(resolve => setTimeout(resolve, 10000));
        },
      });

      const result = await shutdownManager.shutdown('test', {
        handlerTimeoutMs: 50,
        totalTimeoutMs: 1000,
      });

      assert.strictEqual(result.handlers[0].success, false);
      assert.strictEqual(result.handlers[0].timedOut, true);
      assert.strictEqual(result.timeoutCount, 1);
    });

    it('should continue with next handler after timeout', async () => {
      const order: string[] = [];

      shutdownManager.register({
        name: 'slow',
        priority: 100,
        async shutdown() {
          await new Promise(resolve => setTimeout(resolve, 10000));
        },
      });

      shutdownManager.register({
        name: 'fast',
        priority: 200,
        async shutdown() {
          order.push('fast');
        },
      });

      const result = await shutdownManager.shutdown('test', {
        handlerTimeoutMs: 50,
        totalTimeoutMs: 1000,
      });

      assert.deepStrictEqual(order, ['fast']);
      assert.strictEqual(result.successCount, 1);
      assert.strictEqual(result.timeoutCount, 1);
    });
  });

  describe('multiple shutdown prevention', () => {
    it('should prevent multiple shutdown attempts', async () => {
      shutdownManager.register(createShutdownHandler('test', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      }));

      // Start first shutdown
      const promise1 = shutdownManager.shutdown('first');

      // Try to start second shutdown (should be rejected)
      const result2 = await shutdownManager.shutdown('second');

      await promise1;

      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.successCount, 0);
    });

    it('should track isShuttingDown state', async () => {
      assert.strictEqual(shutdownManager.isShuttingDown(), false);

      shutdownManager.register(createShutdownHandler('test', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      }));

      const promise = shutdownManager.shutdown('test');

      // While shutdown is in progress
      assert.strictEqual(shutdownManager.isShuttingDown(), true);

      await promise;

      // After shutdown completes
      assert.strictEqual(shutdownManager.isShuttingDown(), true); // Still true after completion
    });
  });

  describe('reset', () => {
    it('should clear all handlers and state', async () => {
      shutdownManager.register(createShutdownHandler('test', () => {}));
      await shutdownManager.shutdown('test');

      shutdownManager.reset();

      const stats = shutdownManager.getStats();
      assert.strictEqual(stats.handlerCount, 0);
      assert.strictEqual(stats.isShuttingDown, false);
      assert.strictEqual(stats.shutdownStartTime, null);
    });
  });
});

describe('createShutdownHandler', () => {
  it('should create a valid shutdown handler', () => {
    const handler = createShutdownHandler('test', () => {});

    assert.strictEqual(handler.name, 'test');
    assert.strictEqual(handler.priority, ShutdownPriority.CLEANUP);
    assert.strictEqual(typeof handler.shutdown, 'function');
  });

  it('should use custom priority', () => {
    const handler = createShutdownHandler('test', () => {}, ShutdownPriority.STOP_ACCEPTING);

    assert.strictEqual(handler.priority, ShutdownPriority.STOP_ACCEPTING);
  });

  it('should wrap sync function as async', async () => {
    let called = false;
    const handler = createShutdownHandler('test', () => {
      called = true;
    });

    await handler.shutdown();

    assert.strictEqual(called, true);
  });

  it('should wrap async function', async () => {
    let called = false;
    const handler = createShutdownHandler('test', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      called = true;
    });

    await handler.shutdown();

    assert.strictEqual(called, true);
  });
});

describe('ShutdownPriority', () => {
  it('should have correct priority order', () => {
    assert.ok(ShutdownPriority.STOP_ACCEPTING < ShutdownPriority.STOP_BACKGROUND);
    assert.ok(ShutdownPriority.STOP_BACKGROUND < ShutdownPriority.NOTIFY_CLIENTS);
    assert.ok(ShutdownPriority.NOTIFY_CLIENTS < ShutdownPriority.CLOSE_CONNECTIONS);
    assert.ok(ShutdownPriority.CLOSE_CONNECTIONS < ShutdownPriority.DRAIN_REQUESTS);
    assert.ok(ShutdownPriority.DRAIN_REQUESTS < ShutdownPriority.CLEANUP);
    assert.ok(ShutdownPriority.CLEANUP < ShutdownPriority.CLOSE_DATABASE);
  });

  it('should have CLOSE_DATABASE as highest priority (last to execute)', () => {
    const priorities = [
      ShutdownPriority.STOP_ACCEPTING,
      ShutdownPriority.STOP_BACKGROUND,
      ShutdownPriority.NOTIFY_CLIENTS,
      ShutdownPriority.CLOSE_CONNECTIONS,
      ShutdownPriority.DRAIN_REQUESTS,
      ShutdownPriority.CLEANUP,
      ShutdownPriority.CLOSE_DATABASE,
    ];

    const maxPriority = Math.max(...priorities);
    assert.strictEqual(maxPriority, ShutdownPriority.CLOSE_DATABASE);
  });
});
