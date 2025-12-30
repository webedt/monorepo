/**
 * Tests for the MemoryCache module.
 * Covers cache operations, TTL expiration, LRU eviction, tag invalidation,
 * and request coalescing to prevent stampeding herd.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MemoryCache } from '../../src/caching/MemoryCache.js';

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(async () => {
    cache = new MemoryCache({
      defaultTtlMs: 1000,
      maxEntries: 100,
      maxSizeBytes: 1024 * 1024,
      cleanupIntervalMs: 0, // Disable auto cleanup for tests
      enableStats: true,
    });
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.dispose();
  });

  describe('Basic Operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get<string>('key1');

      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.value, 'value1');
      assert.strictEqual(result.expired, false);
    });

    it('should return miss for non-existent key', async () => {
      const result = await cache.get<string>('nonexistent');

      assert.strictEqual(result.hit, false);
      assert.strictEqual(result.value, undefined);
    });

    it('should delete a key', async () => {
      await cache.set('key1', 'value1');
      const deleted = await cache.delete('key1');

      assert.strictEqual(deleted, true);

      const result = await cache.get<string>('key1');
      assert.strictEqual(result.hit, false);
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('nonexistent');
      assert.strictEqual(deleted, false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1');

      assert.strictEqual(await cache.has('key1'), true);
      assert.strictEqual(await cache.has('nonexistent'), false);
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      await cache.clear();

      assert.strictEqual((await cache.get('key1')).hit, false);
      assert.strictEqual((await cache.get('key2')).hit, false);
      assert.strictEqual((await cache.get('key3')).hit, false);
    });

    it('should support sync operations', () => {
      cache.setSync('key1', 'value1');
      const result = cache.getSync<string>('key1');

      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.value, 'value1');
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      await cache.set('short-lived', 'value', { ttlMs: 50 });

      // Should be available immediately
      let result = await cache.get<string>('short-lived');
      assert.strictEqual(result.hit, true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      result = await cache.get<string>('short-lived');
      assert.strictEqual(result.hit, false);
      assert.strictEqual(result.expired, true);
    });

    it('should use default TTL when not specified', async () => {
      const shortTtlCache = new MemoryCache({
        defaultTtlMs: 50,
        cleanupIntervalMs: 0,
      });
      await shortTtlCache.initialize();

      await shortTtlCache.set('key', 'value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      const result = await shortTtlCache.get<string>('key');
      assert.strictEqual(result.hit, false);

      await shortTtlCache.dispose();
    });

    it('should remove expired entries from has() check', async () => {
      await cache.set('expiring', 'value', { ttlMs: 50 });

      assert.strictEqual(await cache.has('expiring'), true);

      await new Promise(resolve => setTimeout(resolve, 60));

      assert.strictEqual(await cache.has('expiring'), false);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when max entries reached', async () => {
      const smallCache = new MemoryCache({
        maxEntries: 3,
        cleanupIntervalMs: 0,
      });
      await smallCache.initialize();

      // Set entries with explicit delays to ensure distinct access times
      await smallCache.set('first', 1);
      await new Promise(resolve => setTimeout(resolve, 5));
      await smallCache.set('second', 2);
      await new Promise(resolve => setTimeout(resolve, 5));
      await smallCache.set('third', 3);
      await new Promise(resolve => setTimeout(resolve, 5));

      // Access first and third to make them recently used, leaving 'second' as LRU
      await smallCache.get('first');
      await new Promise(resolve => setTimeout(resolve, 5));
      await smallCache.get('third');
      await new Promise(resolve => setTimeout(resolve, 5));

      // Add fourth entry, should evict 'second' (least recently used)
      await smallCache.set('fourth', 4);

      // Store results to avoid multiple gets affecting the test
      const firstResult = await smallCache.get<number>('first');
      const secondResult = await smallCache.get<number>('second');
      const thirdResult = await smallCache.get<number>('third');
      const fourthResult = await smallCache.get<number>('fourth');

      assert.strictEqual(firstResult.hit, true, 'first should still be in cache');
      assert.strictEqual(secondResult.hit, false, 'second should be evicted (LRU)');
      assert.strictEqual(thirdResult.hit, true, 'third should still be in cache');
      assert.strictEqual(fourthResult.hit, true, 'fourth should be in cache');

      await smallCache.dispose();
    });

    it('should evict based on size limit', async () => {
      const smallCache = new MemoryCache({
        maxEntries: 1000,
        maxSizeBytes: 200, // Very small size limit
        cleanupIntervalMs: 0,
      });
      await smallCache.initialize();

      // Add entries that will exceed size limit
      await smallCache.set('key1', 'a'.repeat(50));
      await smallCache.set('key2', 'b'.repeat(50));
      await smallCache.set('key3', 'c'.repeat(50));
      await smallCache.set('key4', 'd'.repeat(50));

      // Some entries should have been evicted
      const stats = smallCache.getStats();
      assert.ok(stats.evictions > 0, 'Should have evicted entries');

      await smallCache.dispose();
    });
  });

  describe('Tag Invalidation', () => {
    it('should invalidate entries by tag', async () => {
      await cache.set('user:1:profile', 'profile1', { tags: ['user:1'] });
      await cache.set('user:1:settings', 'settings1', { tags: ['user:1'] });
      await cache.set('user:2:profile', 'profile2', { tags: ['user:2'] });

      const count = await cache.invalidateTags(['user:1']);

      assert.strictEqual(count, 2);
      assert.strictEqual((await cache.get('user:1:profile')).hit, false);
      assert.strictEqual((await cache.get('user:1:settings')).hit, false);
      assert.strictEqual((await cache.get('user:2:profile')).hit, true);
    });

    it('should invalidate entries by prefix', async () => {
      await cache.set('session:abc:data', 'data1');
      await cache.set('session:abc:events', 'data2');
      await cache.set('session:def:data', 'data3');

      const count = await cache.invalidatePrefix('session:abc');

      assert.strictEqual(count, 2);
      assert.strictEqual((await cache.get('session:abc:data')).hit, false);
      assert.strictEqual((await cache.get('session:abc:events')).hit, false);
      assert.strictEqual((await cache.get('session:def:data')).hit, true);
    });

    it('should clean up empty tag sets', async () => {
      await cache.set('key1', 'value1', { tags: ['tag1'] });
      await cache.set('key2', 'value2', { tags: ['tag2'] });

      // Invalidate tag1
      await cache.invalidateTags(['tag1']);

      // Now invalidating tag1 again should return 0 (tag set cleaned up)
      const count = await cache.invalidateTags(['tag1']);
      assert.strictEqual(count, 0);
    });
  });

  describe('getOrSet - Request Coalescing', () => {
    it('should return cached value if exists', async () => {
      await cache.set('existing', 'cached-value');

      let factoryCalled = false;
      const result = await cache.getOrSet('existing', async () => {
        factoryCalled = true;
        return 'new-value';
      });

      assert.strictEqual(result, 'cached-value');
      assert.strictEqual(factoryCalled, false);
    });

    it('should call factory and cache result on miss', async () => {
      let factoryCalled = false;
      const result = await cache.getOrSet('new-key', async () => {
        factoryCalled = true;
        return 'factory-value';
      });

      assert.strictEqual(result, 'factory-value');
      assert.strictEqual(factoryCalled, true);

      // Should be cached now
      const cached = await cache.get<string>('new-key');
      assert.strictEqual(cached.value, 'factory-value');
    });

    it('should prevent stampeding herd with request coalescing', async () => {
      let factoryCallCount = 0;

      const factory = async () => {
        factoryCallCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return `value-${factoryCallCount}`;
      };

      // Start multiple concurrent requests for the same key
      const promises = [
        cache.getOrSet('concurrent-key', factory),
        cache.getOrSet('concurrent-key', factory),
        cache.getOrSet('concurrent-key', factory),
        cache.getOrSet('concurrent-key', factory),
        cache.getOrSet('concurrent-key', factory),
      ];

      const results = await Promise.all(promises);

      // Factory should only be called once due to request coalescing
      assert.strictEqual(factoryCallCount, 1);

      // All results should be the same
      results.forEach(result => {
        assert.strictEqual(result, 'value-1');
      });
    });

    it('should clean up pending factory on error', async () => {
      const factory = async () => {
        throw new Error('Factory error');
      };

      // First call should throw
      await assert.rejects(
        cache.getOrSet('error-key', factory),
        { message: 'Factory error' }
      );

      // Second call should also call factory (not stuck on failed promise)
      let secondFactoryCalled = false;
      const result = await cache.getOrSet('error-key', async () => {
        secondFactoryCalled = true;
        return 'success';
      });

      assert.strictEqual(secondFactoryCalled, true);
      assert.strictEqual(result, 'success');
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', 'value1');

      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.ok(stats.hitRate > 0.6);
    });

    it('should track sets and deletes', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.delete('key1');

      const stats = cache.getStats();
      assert.strictEqual(stats.sets, 2);
      assert.strictEqual(stats.deletes, 1);
      assert.strictEqual(stats.entryCount, 1);
    });

    it('should track evictions', async () => {
      const smallCache = new MemoryCache({
        maxEntries: 2,
        cleanupIntervalMs: 0,
        enableStats: true,
      });
      await smallCache.initialize();

      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key3', 'value3'); // Should evict one

      const stats = smallCache.getStats();
      assert.strictEqual(stats.evictions, 1);

      await smallCache.dispose();
    });
  });

  describe('Health Check', () => {
    it('should report healthy status', () => {
      const health = cache.getHealth();

      assert.strictEqual(health.healthy, true);
      assert.ok(health.entryCount >= 0);
      assert.ok(health.sizeBytes >= 0);
      assert.deepStrictEqual(health.errors, []);
    });
  });

  describe('Key Generation', () => {
    it('should generate consistent hash keys', () => {
      const key1 = cache.generateKey('user', 123, 'profile');
      const key2 = cache.generateKey('user', 123, 'profile');

      assert.strictEqual(key1, key2);
      assert.strictEqual(key1.length, 32); // SHA256 truncated to 32 chars
    });

    it('should generate different keys for different inputs', () => {
      const key1 = cache.generateKey('user', 123);
      const key2 = cache.generateKey('user', 456);

      assert.notStrictEqual(key1, key2);
    });

    it('should create scoped keys with prefix', () => {
      const key = cache.scopedKey('session:list', 'user123');

      assert.strictEqual(key, 'session:list:user123');
    });

    it('should handle null/undefined in scoped keys', () => {
      const key = cache.scopedKey('prefix', null, undefined, 'value');

      assert.strictEqual(key, 'prefix:value');
    });
  });

  describe('Circular Reference Handling', () => {
    it('should handle circular references in size calculation', async () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj; // Circular reference

      // Should not throw
      await cache.set('circular', obj);

      const result = await cache.get('circular');
      assert.strictEqual(result.hit, true);
    });
  });

  describe('Cleanup', () => {
    it('should remove expired entries on cleanup', async () => {
      await cache.set('expired1', 'value1', { ttlMs: 10 });
      await cache.set('expired2', 'value2', { ttlMs: 10 });
      await cache.set('valid', 'value3', { ttlMs: 10000 });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      const removed = await cache.cleanup();

      assert.strictEqual(removed, 2);
      assert.strictEqual((await cache.get('expired1')).hit, false);
      assert.strictEqual((await cache.get('expired2')).hit, false);
      assert.strictEqual((await cache.get('valid')).hit, true);
    });
  });

  describe('Warmup', () => {
    it('should pre-populate cache with entries', async () => {
      await cache.warmup([
        { key: 'warmed1', value: 'value1' },
        { key: 'warmed2', value: 'value2', options: { ttlMs: 5000 } },
        { key: 'warmed3', value: 'value3', options: { tags: ['warmup'] } },
      ]);

      assert.strictEqual((await cache.get('warmed1')).hit, true);
      assert.strictEqual((await cache.get('warmed2')).hit, true);
      assert.strictEqual((await cache.get('warmed3')).hit, true);
    });
  });

  describe('Config Updates', () => {
    it('should allow updating configuration', () => {
      cache.updateConfig({ defaultTtlMs: 2000 });

      const config = cache.getConfig();
      assert.strictEqual(config.defaultTtlMs, 2000);
    });
  });
});
