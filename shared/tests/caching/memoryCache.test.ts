/**
 * Tests for the MemoryCache module.
 * Covers basic operations, LRU eviction, TTL expiration, and stampede prevention.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { MemoryCache } from '../../src/caching/MemoryCache.js';

describe('MemoryCache', () => {
  describe('Basic Operations', () => {
    it('should set and get a value', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value1');
      const result = await cache.get<string>('key1');

      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.value, 'value1');
    });

    it('should return miss for non-existent key', async () => {
      const cache = new MemoryCache();
      const result = await cache.get('nonexistent');

      assert.strictEqual(result.hit, false);
      assert.strictEqual(result.value, undefined);
    });

    it('should delete a value', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value1');
      const deleted = await cache.delete('key1');
      const result = await cache.get('key1');

      assert.strictEqual(deleted, true);
      assert.strictEqual(result.hit, false);
    });

    it('should return false when deleting non-existent key', async () => {
      const cache = new MemoryCache();
      const deleted = await cache.delete('nonexistent');

      assert.strictEqual(deleted, false);
    });

    it('should check if key exists', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value1');

      assert.strictEqual(await cache.has('key1'), true);
      assert.strictEqual(await cache.has('nonexistent'), false);
    });

    it('should clear all values', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();

      assert.strictEqual((await cache.get('key1')).hit, false);
      assert.strictEqual((await cache.get('key2')).hit, false);
    });

    it('should update existing value', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value1');
      await cache.set('key1', 'value2');
      const result = await cache.get<string>('key1');

      assert.strictEqual(result.value, 'value2');
    });
  });

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const cache = new MemoryCache({ defaultTtlMs: 50 });
      await cache.set('key1', 'value1');

      // Should exist immediately
      const before = await cache.get('key1');
      assert.strictEqual(before.hit, true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      const after = await cache.get('key1');
      assert.strictEqual(after.hit, false);
      assert.strictEqual(after.expired, true);
    });

    it('should respect custom TTL per entry', async () => {
      const cache = new MemoryCache({ defaultTtlMs: 1000 });
      await cache.set('short', 'value', { ttlMs: 50 });
      await cache.set('long', 'value', { ttlMs: 500 });

      // Wait for short to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      const shortResult = await cache.get('short');
      const longResult = await cache.get('long');

      assert.strictEqual(shortResult.hit, false);
      assert.strictEqual(longResult.hit, true);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used when max entries reached', async () => {
      const cache = new MemoryCache({ maxEntries: 3 });
      await cache.set('a', '1');
      await cache.set('b', '2');
      await cache.set('c', '3');

      // Access 'a' to make it recently used
      await cache.get('a');

      // Add new entry, should evict 'b' (least recently used)
      await cache.set('d', '4');

      assert.strictEqual((await cache.get('a')).hit, true); // Still there, was accessed
      assert.strictEqual((await cache.get('b')).hit, false); // Evicted
      assert.strictEqual((await cache.get('c')).hit, true);
      assert.strictEqual((await cache.get('d')).hit, true);
    });

    it('should evict based on size limits', async () => {
      const cache = new MemoryCache({
        maxSizeBytes: 200,
        maxEntries: 1000,
      });

      // Create larger values that will exceed the size limit
      const largeValue = 'x'.repeat(100); // ~200 bytes in our size calculation

      await cache.set('k1', largeValue);
      await cache.set('k2', largeValue);

      // At least one should have been evicted due to size
      const stats = cache.getStats();
      assert.ok(stats.evictions > 0);
    });
  });

  describe('Stampeding Herd Prevention', () => {
    it('should prevent multiple factory calls for same key', async () => {
      const cache = new MemoryCache();
      let factoryCallCount = 0;

      const factory = async () => {
        factoryCallCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'expensive-result';
      };

      // Start multiple concurrent requests for the same key
      const promises = [
        cache.getOrSet('key', factory),
        cache.getOrSet('key', factory),
        cache.getOrSet('key', factory),
      ];

      const results = await Promise.all(promises);

      // Factory should only be called once
      assert.strictEqual(factoryCallCount, 1);

      // All results should be the same
      assert.deepStrictEqual(results, [
        'expensive-result',
        'expensive-result',
        'expensive-result',
      ]);
    });

    it('should call factory for different keys in parallel', async () => {
      const cache = new MemoryCache();
      let factoryCallCount = 0;

      const factory = async (value: string) => {
        factoryCallCount++;
        await new Promise(resolve => setTimeout(resolve, 30));
        return value;
      };

      const promises = [
        cache.getOrSet('key1', () => factory('value1')),
        cache.getOrSet('key2', () => factory('value2')),
        cache.getOrSet('key3', () => factory('value3')),
      ];

      await Promise.all(promises);

      // Each key should trigger its own factory call
      assert.strictEqual(factoryCallCount, 3);
    });

    it('should return cached value without calling factory', async () => {
      const cache = new MemoryCache();
      let factoryCallCount = 0;

      const factory = async () => {
        factoryCallCount++;
        return 'result';
      };

      // First call
      await cache.getOrSet('key', factory);
      assert.strictEqual(factoryCallCount, 1);

      // Second call - should use cache
      const result = await cache.getOrSet('key', factory);
      assert.strictEqual(factoryCallCount, 1);
      assert.strictEqual(result, 'result');
    });
  });

  describe('Tags and Invalidation', () => {
    it('should invalidate by tag', async () => {
      const cache = new MemoryCache();
      await cache.set('user:1:profile', 'data', { tags: ['user:1'] });
      await cache.set('user:1:sessions', 'data', { tags: ['user:1'] });
      await cache.set('user:2:profile', 'data', { tags: ['user:2'] });

      const count = await cache.invalidateTags(['user:1']);

      assert.strictEqual(count, 2);
      assert.strictEqual((await cache.get('user:1:profile')).hit, false);
      assert.strictEqual((await cache.get('user:1:sessions')).hit, false);
      assert.strictEqual((await cache.get('user:2:profile')).hit, true);
    });

    it('should invalidate by prefix', async () => {
      const cache = new MemoryCache();
      await cache.set('session:abc:data', '1');
      await cache.set('session:def:data', '2');
      await cache.set('user:123', '3');

      const count = await cache.invalidatePrefix('session:');

      assert.strictEqual(count, 2);
      assert.strictEqual((await cache.get('session:abc:data')).hit, false);
      assert.strictEqual((await cache.get('session:def:data')).hit, false);
      assert.strictEqual((await cache.get('user:123')).hit, true);
    });

    it('should clean up empty tag sets', async () => {
      const cache = new MemoryCache();
      await cache.set('key1', 'value', { tags: ['tag1'] });
      await cache.delete('key1');

      // Internal check - the tag set should be cleaned up
      // We can verify this indirectly by checking invalidation returns 0
      const count = await cache.invalidateTags(['tag1']);
      assert.strictEqual(count, 0);
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      const cache = new MemoryCache({ enableStats: true });
      await cache.set('key1', 'value1');

      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.ok(stats.hitRate > 0.6);
    });

    it('should track sets and deletes', async () => {
      const cache = new MemoryCache({ enableStats: true });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.delete('key1');

      const stats = cache.getStats();
      assert.strictEqual(stats.sets, 2);
      assert.strictEqual(stats.deletes, 1);
    });

    it('should track size', async () => {
      const cache = new MemoryCache({ enableStats: true });

      await cache.set('key1', 'value1');
      const stats = cache.getStats();

      assert.ok(stats.sizeBytes > 0);
      assert.strictEqual(stats.entryCount, 1);
    });
  });

  describe('Key Generation', () => {
    it('should generate consistent keys', () => {
      const cache = new MemoryCache();

      const key1 = cache.generateKey('user', 123, true);
      const key2 = cache.generateKey('user', 123, true);
      const key3 = cache.generateKey('user', 123, false);

      assert.strictEqual(key1, key2);
      assert.notStrictEqual(key1, key3);
    });

    it('should create scoped keys', () => {
      const cache = new MemoryCache();

      const key = cache.scopedKey('session:list', 'user123');
      assert.strictEqual(key, 'session:list:user123');

      const emptyKey = cache.scopedKey('session:list');
      assert.strictEqual(emptyKey, 'session:list');
    });

    it('should handle null and undefined in key components', () => {
      const cache = new MemoryCache();

      const key = cache.scopedKey('prefix', null, undefined, 'value');
      assert.strictEqual(key, 'prefix:value');
    });
  });

  describe('Size Calculation', () => {
    it('should handle strings', async () => {
      const cache = new MemoryCache({ enableStats: true });
      await cache.set('key', 'hello world');
      const stats = cache.getStats();
      assert.ok(stats.sizeBytes > 0);
    });

    it('should handle objects', async () => {
      const cache = new MemoryCache({ enableStats: true });
      await cache.set('key', { name: 'test', value: 123 });
      const stats = cache.getStats();
      assert.ok(stats.sizeBytes > 0);
    });

    it('should handle arrays', async () => {
      const cache = new MemoryCache({ enableStats: true });
      await cache.set('key', [1, 2, 3, 4, 5]);
      const stats = cache.getStats();
      assert.ok(stats.sizeBytes > 0);
    });

    it('should handle circular references without crashing', async () => {
      const cache = new MemoryCache({ enableStats: true });
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj; // Circular reference

      // Should not throw
      await cache.set('key', obj);
      const stats = cache.getStats();
      assert.ok(stats.sizeBytes > 0);
    });
  });

  describe('Cleanup', () => {
    it('should remove expired entries on cleanup', async () => {
      const cache = new MemoryCache({
        defaultTtlMs: 50,
        cleanupIntervalMs: 0, // Disable auto cleanup
      });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 60));

      const removed = await cache.cleanup();

      assert.strictEqual(removed, 2);
      assert.strictEqual((await cache.get('key1')).hit, false);
      assert.strictEqual((await cache.get('key2')).hit, false);
    });
  });

  describe('Warmup', () => {
    it('should populate cache with initial entries', async () => {
      const cache = new MemoryCache();

      await cache.warmup([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' },
      ]);

      assert.strictEqual((await cache.get('key1')).hit, true);
      assert.strictEqual((await cache.get('key2')).hit, true);
      assert.strictEqual((await cache.get('key3')).hit, true);
    });
  });

  describe('Health', () => {
    it('should report healthy state', () => {
      const cache = new MemoryCache();
      const health = cache.getHealth();

      assert.strictEqual(health.healthy, true);
      assert.strictEqual(health.entryCount, 0);
      assert.deepStrictEqual(health.errors, []);
    });

    it('should report unhealthy when approaching limits', async () => {
      const cache = new MemoryCache({ maxEntries: 5 });

      for (let i = 0; i < 5; i++) {
        await cache.set(`key${i}`, 'value');
      }

      const health = cache.getHealth();
      // Should not be healthy as we're at max entries
      assert.strictEqual(health.healthy, false);
    });
  });

  describe('Configuration', () => {
    it('should allow updating config', () => {
      const cache = new MemoryCache({ defaultTtlMs: 1000 });

      cache.updateConfig({ defaultTtlMs: 5000 });
      const config = cache.getConfig();

      assert.strictEqual(config.defaultTtlMs, 5000);
    });
  });

  describe('Dispose', () => {
    it('should clean up resources on dispose', async () => {
      const cache = new MemoryCache({
        cleanupIntervalMs: 100,
      });
      await cache.initialize();
      await cache.set('key', 'value');

      await cache.dispose();

      // Cache should be cleared
      assert.strictEqual((await cache.get('key')).hit, false);
    });
  });
});
