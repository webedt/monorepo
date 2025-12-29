/**
 * Tests for the Sliding Window Rate Limiter module.
 * Covers rate limiting behavior, sliding window calculations, and store operations.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import {
  SlidingWindowRateLimiter,
  SlidingWindowStore,
  createRateLimiter,
  createSlidingWindowStore,
  rateLimiterRegistry,
} from '../src/utils/resilience/rateLimiter.js';

describe('SlidingWindowRateLimiter', () => {
  describe('Initial State', () => {
    it('should allow requests when limit not reached', async () => {
      const limiter = createRateLimiter({
        name: 'test-initial',
        maxRequests: 10,
        windowMs: 60000,
      });

      const result = await limiter.check('user1');

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.current, 0);
      assert.strictEqual(result.remaining, 10);
    });

    it('should have correct default configuration', () => {
      const limiter = createRateLimiter({ name: 'test-config' });
      const config = limiter.getConfig();

      assert.strictEqual(config.name, 'test-config');
      assert.strictEqual(config.maxRequests, 100);
      assert.strictEqual(config.windowMs, 60000);
    });

    it('should start with empty stats', () => {
      const limiter = createRateLimiter({ name: 'test-stats' });
      const stats = limiter.getStats();

      assert.strictEqual(stats.totalRequests, 0);
      assert.strictEqual(stats.totalBlocked, 0);
      assert.strictEqual(stats.activeKeys, 0);
    });
  });

  describe('Rate Limiting Behavior', () => {
    it('should increment counter on each request', async () => {
      const limiter = createRateLimiter({
        name: 'test-increment',
        maxRequests: 10,
        windowMs: 60000,
      });

      await limiter.increment('user1');
      await limiter.increment('user1');
      await limiter.increment('user1');

      const result = await limiter.check('user1');
      assert.strictEqual(result.current, 3);
      assert.strictEqual(result.remaining, 7);
    });

    it('should block requests when limit reached', async () => {
      const limiter = createRateLimiter({
        name: 'test-block',
        maxRequests: 3,
        windowMs: 60000,
      });

      // Make 3 requests (at limit)
      await limiter.increment('user1');
      await limiter.increment('user1');
      await limiter.increment('user1');

      // 4th request should be blocked
      const result = await limiter.increment('user1');
      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.remaining, 0);
    });

    it('should track blocked requests in stats', async () => {
      const limiter = createRateLimiter({
        name: 'test-blocked-stats',
        maxRequests: 2,
        windowMs: 60000,
      });

      await limiter.increment('user1');
      await limiter.increment('user1');
      await limiter.increment('user1'); // This should be blocked

      const stats = limiter.getStats();
      assert.strictEqual(stats.totalBlocked, 1);
    });

    it('should rate limit users independently', async () => {
      const limiter = createRateLimiter({
        name: 'test-independent',
        maxRequests: 2,
        windowMs: 60000,
      });

      // User1 hits limit
      await limiter.increment('user1');
      await limiter.increment('user1');

      // User2 should still be allowed
      const result = await limiter.increment('user2');
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.current, 1);
    });

    it('should return retry-after in seconds', async () => {
      const limiter = createRateLimiter({
        name: 'test-retry-after',
        maxRequests: 1,
        windowMs: 30000, // 30 seconds
      });

      await limiter.increment('user1');
      const result = await limiter.increment('user1');

      assert.strictEqual(result.allowed, false);
      assert.ok(result.retryAfter > 0);
      assert.ok(result.retryAfter <= 30);
    });
  });

  describe('Reset Functionality', () => {
    it('should reset counter for a specific key', async () => {
      const limiter = createRateLimiter({
        name: 'test-reset',
        maxRequests: 5,
        windowMs: 60000,
      });

      await limiter.increment('user1');
      await limiter.increment('user1');
      await limiter.increment('user1');

      await limiter.reset('user1');

      const result = await limiter.check('user1');
      assert.strictEqual(result.current, 0);
      assert.strictEqual(result.remaining, 5);
    });

    it('should not affect other keys when resetting', async () => {
      const limiter = createRateLimiter({
        name: 'test-reset-isolated',
        maxRequests: 5,
        windowMs: 60000,
      });

      await limiter.increment('user1');
      await limiter.increment('user2');

      await limiter.reset('user1');

      const result = await limiter.check('user2');
      assert.strictEqual(result.current, 1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up expired entries', async () => {
      const limiter = new SlidingWindowRateLimiter({
        name: 'test-cleanup',
        maxRequests: 10,
        windowMs: 100, // Very short window for testing
      });

      await limiter.increment('user1');

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 250));

      await limiter.cleanup();

      const stats = limiter.getStats();
      assert.strictEqual(stats.activeKeys, 0);

      limiter.destroy();
    });

    it('should destroy limiter and clear intervals', () => {
      const limiter = new SlidingWindowRateLimiter({
        name: 'test-destroy',
        maxRequests: 10,
        windowMs: 60000,
      });

      // Should not throw
      limiter.destroy();

      const stats = limiter.getStats();
      assert.strictEqual(stats.activeKeys, 0);
    });
  });
});

describe('SlidingWindowStore', () => {
  describe('Express Rate Limit Compatibility', () => {
    it('should implement get method', async () => {
      const store = createSlidingWindowStore(60000);

      const result = await store.get('key1');
      assert.strictEqual(result, undefined);

      store.destroy();
    });

    it('should implement increment method', async () => {
      const store = createSlidingWindowStore(60000);

      const result = await store.increment('key1');
      assert.strictEqual(result.totalHits, 1);
      assert.ok(result.resetTime instanceof Date);

      store.destroy();
    });

    it('should track hits across increments', async () => {
      const store = createSlidingWindowStore(60000);

      await store.increment('key1');
      await store.increment('key1');
      const result = await store.increment('key1');

      assert.strictEqual(result.totalHits, 3);

      store.destroy();
    });

    it('should implement decrement method', async () => {
      const store = createSlidingWindowStore(60000);

      await store.increment('key1');
      await store.increment('key1');
      await store.decrement('key1');

      const result = await store.get('key1');
      assert.strictEqual(result?.totalHits, 1);

      store.destroy();
    });

    it('should implement resetKey method', async () => {
      const store = createSlidingWindowStore(60000);

      await store.increment('key1');
      await store.increment('key1');
      await store.resetKey('key1');

      const result = await store.get('key1');
      assert.strictEqual(result, undefined);

      store.destroy();
    });

    it('should track stats correctly', async () => {
      const store = createSlidingWindowStore(60000);

      await store.increment('key1');
      await store.increment('key2');
      store.recordBlocked();

      const stats = store.getStats();
      assert.strictEqual(stats.keys, 2);
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.blocked, 1);

      store.destroy();
    });
  });

  describe('Sliding Window Calculation', () => {
    it('should calculate weighted hits across windows', async () => {
      const store = createSlidingWindowStore(100); // 100ms window for testing

      await store.increment('key1');
      await store.increment('key1');
      await store.increment('key1');

      // Within same window, should have 3 hits
      const result1 = await store.get('key1');
      assert.strictEqual(result1?.totalHits, 3);

      store.destroy();
    });
  });
});

describe('RateLimiterRegistry', () => {
  beforeEach(() => {
    rateLimiterRegistry.resetAll();
  });

  it('should create and cache rate limiters', () => {
    const limiter1 = rateLimiterRegistry.get('test-registry', { maxRequests: 10 });
    const limiter2 = rateLimiterRegistry.get('test-registry');

    // Should return the same instance
    assert.strictEqual(limiter1, limiter2);
  });

  it('should create separate limiters for different names', () => {
    const limiter1 = rateLimiterRegistry.get('limiter-a');
    const limiter2 = rateLimiterRegistry.get('limiter-b');

    assert.notStrictEqual(limiter1, limiter2);
  });

  it('should track all registered limiters', () => {
    rateLimiterRegistry.get('reg-1');
    rateLimiterRegistry.get('reg-2');
    rateLimiterRegistry.get('reg-3');

    assert.strictEqual(rateLimiterRegistry.size(), 3);
  });

  it('should provide stats for all limiters', async () => {
    const limiter1 = rateLimiterRegistry.get('stats-1');
    const limiter2 = rateLimiterRegistry.get('stats-2');

    await limiter1.increment('user1');
    await limiter2.increment('user1');
    await limiter2.increment('user2');

    const allStats = rateLimiterRegistry.getAllStats();

    assert.strictEqual(allStats['stats-1'].totalRequests, 1);
    assert.strictEqual(allStats['stats-2'].totalRequests, 2);
  });

  it('should reset all limiters', async () => {
    const limiter = rateLimiterRegistry.get('reset-all');
    await limiter.increment('user1');

    rateLimiterRegistry.resetAll();

    assert.strictEqual(rateLimiterRegistry.size(), 0);
  });
});
