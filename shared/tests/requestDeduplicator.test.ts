/**
 * Tests for the Request Deduplicator module.
 * Covers deduplication, TTL cleanup, statistics, and registry behavior.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  RequestDeduplicator,
  createRequestDeduplicator,
  requestDeduplicatorRegistry,
  generateRequestKey,
  simpleHash,
} from '../src/utils/resilience/requestDeduplicator.js';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new RequestDeduplicator({
      name: 'test',
      defaultTtlMs: 5000,
      cleanupIntervalMs: 1000,
      maxPendingRequests: 100,
    });
  });

  afterEach(async () => {
    await deduplicator.dispose();
  });

  describe('Initial State', () => {
    it('should have no pending requests initially', () => {
      assert.strictEqual(deduplicator.getPendingCount(), 0);
    });

    it('should have zero statistics initially', () => {
      const stats = deduplicator.getStats();

      assert.strictEqual(stats.pendingCount, 0);
      assert.strictEqual(stats.deduplicatedCount, 0);
      assert.strictEqual(stats.executedCount, 0);
      assert.strictEqual(stats.successCount, 0);
      assert.strictEqual(stats.failureCount, 0);
      assert.strictEqual(stats.cleanedUpCount, 0);
    });

    it('should not show any request as pending', () => {
      assert.strictEqual(deduplicator.isPending('some-key'), false);
    });
  });

  describe('Basic Deduplication', () => {
    it('should execute operation and return result', async () => {
      const result = await deduplicator.deduplicate(
        'test-key',
        async () => 'hello'
      );

      assert.strictEqual(result.data, 'hello');
      assert.strictEqual(result.wasDeduplicated, false);
      assert.strictEqual(result.key, 'test-key');
    });

    it('should deduplicate concurrent identical requests', async () => {
      let executionCount = 0;

      const operation = async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'result';
      };

      // Start two concurrent requests with the same key
      const [result1, result2] = await Promise.all([
        deduplicator.deduplicate('shared-key', operation),
        deduplicator.deduplicate('shared-key', operation),
      ]);

      // Operation should only execute once
      assert.strictEqual(executionCount, 1);

      // Both should get the same result
      assert.strictEqual(result1.data, 'result');
      assert.strictEqual(result2.data, 'result');

      // One was original, one was deduplicated
      assert.strictEqual(result1.wasDeduplicated, false);
      assert.strictEqual(result2.wasDeduplicated, true);
    });

    it('should not deduplicate requests with different keys', async () => {
      let executionCount = 0;

      const operation = async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 20));
        return executionCount;
      };

      const [result1, result2] = await Promise.all([
        deduplicator.deduplicate('key-1', operation),
        deduplicator.deduplicate('key-2', operation),
      ]);

      // Both operations should execute
      assert.strictEqual(executionCount, 2);
      assert.strictEqual(result1.wasDeduplicated, false);
      assert.strictEqual(result2.wasDeduplicated, false);
    });

    it('should allow new request after previous completes', async () => {
      let executionCount = 0;

      const operation = async () => {
        executionCount++;
        return 'result';
      };

      // First request
      const result1 = await deduplicator.deduplicate('key', operation);
      assert.strictEqual(result1.wasDeduplicated, false);

      // Second request after first completes
      const result2 = await deduplicator.deduplicate('key', operation);
      assert.strictEqual(result2.wasDeduplicated, false);

      // Both should have executed
      assert.strictEqual(executionCount, 2);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors to all waiting callers', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        throw new Error('Test error');
      };

      const promises = [
        deduplicator.deduplicate('error-key', operation),
        deduplicator.deduplicate('error-key', operation),
      ];

      const results = await Promise.allSettled(promises);

      // Both should reject
      assert.strictEqual(results[0].status, 'rejected');
      assert.strictEqual(results[1].status, 'rejected');

      if (results[0].status === 'rejected') {
        assert.strictEqual(results[0].reason.message, 'Test error');
      }
    });

    it('should track failures in statistics', async () => {
      try {
        await deduplicator.deduplicate('fail-key', async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      const stats = deduplicator.getStats();
      assert.strictEqual(stats.executedCount, 1);
      assert.strictEqual(stats.failureCount, 1);
      assert.strictEqual(stats.successCount, 0);
    });

    it('should remove pending entry after failure', async () => {
      try {
        await deduplicator.deduplicate('cleanup-key', async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      assert.strictEqual(deduplicator.isPending('cleanup-key'), false);
      assert.strictEqual(deduplicator.getPendingCount(), 0);
    });
  });

  describe('Statistics', () => {
    it('should track executed and deduplicated counts', async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return 'data';
      };

      await Promise.all([
        deduplicator.deduplicate('stat-key', operation),
        deduplicator.deduplicate('stat-key', operation),
        deduplicator.deduplicate('stat-key', operation),
      ]);

      const stats = deduplicator.getStats();
      assert.strictEqual(stats.executedCount, 1);
      assert.strictEqual(stats.deduplicatedCount, 2);
      assert.strictEqual(stats.successCount, 1);
    });

    it('should reset statistics', async () => {
      await deduplicator.deduplicate('reset-test', async () => 'data');

      deduplicator.resetStats();

      const stats = deduplicator.getStats();
      assert.strictEqual(stats.executedCount, 0);
      assert.strictEqual(stats.successCount, 0);
      assert.strictEqual(stats.deduplicatedCount, 0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up expired entries', async () => {
      const shortTtlDeduplicator = new RequestDeduplicator({
        name: 'short-ttl',
        defaultTtlMs: 10,
        cleanupIntervalMs: 100000, // Disable auto cleanup
        maxPendingRequests: 100,
      });

      // Start a long-running operation
      const operationPromise = shortTtlDeduplicator.deduplicate(
        'expire-key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'data';
        }
      );

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 30));

      // Manual cleanup
      const cleaned = shortTtlDeduplicator.cleanup();

      // The entry should be cleaned up
      assert.strictEqual(cleaned, 1);

      await shortTtlDeduplicator.dispose();
      await operationPromise.catch(() => {}); // Ignore any errors
    });

    it('should track cleanup count in stats', async () => {
      const shortTtlDeduplicator = new RequestDeduplicator({
        name: 'cleanup-stats',
        defaultTtlMs: 5,
        cleanupIntervalMs: 100000,
        maxPendingRequests: 100,
      });

      shortTtlDeduplicator.deduplicate('expire-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'data';
      });

      await new Promise(resolve => setTimeout(resolve, 20));
      shortTtlDeduplicator.cleanup();

      const stats = shortTtlDeduplicator.getStats();
      assert.strictEqual(stats.cleanedUpCount, 1);

      await shortTtlDeduplicator.dispose();
    });

    it('should clear all pending requests', () => {
      // Start some operations but don't await
      deduplicator.deduplicate('clear-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data';
      });
      deduplicator.deduplicate('clear-2', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data';
      });

      assert.strictEqual(deduplicator.getPendingCount(), 2);

      deduplicator.clear();

      assert.strictEqual(deduplicator.getPendingCount(), 0);
    });
  });

  describe('Custom TTL', () => {
    it('should use custom TTL when provided', async () => {
      const customTtlDeduplicator = new RequestDeduplicator({
        name: 'custom-ttl',
        defaultTtlMs: 10000,
        cleanupIntervalMs: 100000,
        maxPendingRequests: 100,
      });

      // Start operation with very short custom TTL
      customTtlDeduplicator.deduplicate(
        'custom-ttl-key',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'data';
        },
        { ttlMs: 5 }
      );

      await new Promise(resolve => setTimeout(resolve, 20));

      // Should be cleaned up because custom TTL expired
      const cleaned = customTtlDeduplicator.cleanup();
      assert.strictEqual(cleaned, 1);

      await customTtlDeduplicator.dispose();
    });
  });

  describe('Capacity Management', () => {
    it('should evict oldest entry when at capacity', async () => {
      const smallCapDeduplicator = new RequestDeduplicator({
        name: 'small-cap',
        defaultTtlMs: 60000,
        cleanupIntervalMs: 100000,
        maxPendingRequests: 2,
      });

      // Add first two entries
      smallCapDeduplicator.deduplicate('key-1', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data1';
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      smallCapDeduplicator.deduplicate('key-2', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data2';
      });

      // At capacity now (2 entries)
      assert.strictEqual(smallCapDeduplicator.getPendingCount(), 2);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Add third entry, should evict oldest (key-1)
      smallCapDeduplicator.deduplicate('key-3', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data3';
      });

      assert.strictEqual(smallCapDeduplicator.getPendingCount(), 2);
      assert.strictEqual(smallCapDeduplicator.isPending('key-1'), false);
      assert.strictEqual(smallCapDeduplicator.isPending('key-2'), true);
      assert.strictEqual(smallCapDeduplicator.isPending('key-3'), true);

      await smallCapDeduplicator.dispose();
    });
  });

  describe('Cleanup Timer Management', () => {
    it('should stop and start cleanup timer', () => {
      deduplicator.stopCleanup();
      deduplicator.startCleanup();
      // No assertion needed - just verify no errors
    });
  });
});

describe('createRequestDeduplicator', () => {
  it('should create a deduplicator instance', async () => {
    const deduplicator = createRequestDeduplicator({ name: 'factory-test' });

    const result = await deduplicator.deduplicate('key', async () => 'data');

    assert.strictEqual(result.data, 'data');

    await deduplicator.dispose?.();
  });
});

describe('RequestDeduplicatorRegistry', () => {
  beforeEach(() => {
    requestDeduplicatorRegistry.clearAll();
    requestDeduplicatorRegistry.resetAllStats();
  });

  describe('get', () => {
    it('should create new deduplicator if not exists', () => {
      const deduplicator = requestDeduplicatorRegistry.get('new-dedup');

      assert.ok(deduplicator);
      assert.strictEqual(requestDeduplicatorRegistry.size(), 1);
    });

    it('should return existing deduplicator', () => {
      const first = requestDeduplicatorRegistry.get('same-dedup');
      const second = requestDeduplicatorRegistry.get('same-dedup');

      assert.strictEqual(first, second);
    });

    it('should apply config when creating new deduplicator', async () => {
      const deduplicator = requestDeduplicatorRegistry.get('config-test', {
        defaultTtlMs: 1000,
      });

      const result = await deduplicator.deduplicate('key', async () => 'data');
      assert.strictEqual(result.data, 'data');
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all registered deduplicators', async () => {
      const dedup1 = requestDeduplicatorRegistry.get('stats-1');
      const dedup2 = requestDeduplicatorRegistry.get('stats-2');

      await dedup1.deduplicate('key1', async () => 'data1');
      await dedup2.deduplicate('key2', async () => 'data2');

      const allStats = requestDeduplicatorRegistry.getAllStats();

      assert.ok(allStats['stats-1']);
      assert.ok(allStats['stats-2']);
      assert.strictEqual(allStats['stats-1'].successCount, 1);
      assert.strictEqual(allStats['stats-2'].successCount, 1);
    });
  });

  describe('resetAllStats', () => {
    it('should reset stats for all deduplicators', async () => {
      const dedup = requestDeduplicatorRegistry.get('reset-test');
      await dedup.deduplicate('key', async () => 'data');

      requestDeduplicatorRegistry.resetAllStats();

      const stats = dedup.getStats();
      assert.strictEqual(stats.successCount, 0);
    });
  });

  describe('clearAll', () => {
    it('should clear pending requests in all deduplicators', () => {
      const dedup1 = requestDeduplicatorRegistry.get('clear-1');
      const dedup2 = requestDeduplicatorRegistry.get('clear-2');

      dedup1.deduplicate('key1', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data';
      });
      dedup2.deduplicate('key2', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'data';
      });

      requestDeduplicatorRegistry.clearAll();

      assert.strictEqual(dedup1.getPendingCount(), 0);
      assert.strictEqual(dedup2.getPendingCount(), 0);
    });
  });

  describe('size', () => {
    it('should return number of registered deduplicators', () => {
      const initialSize = requestDeduplicatorRegistry.size();

      requestDeduplicatorRegistry.get('size-1');
      requestDeduplicatorRegistry.get('size-2');
      requestDeduplicatorRegistry.get('size-3');

      assert.strictEqual(requestDeduplicatorRegistry.size(), initialSize + 3);
    });
  });
});

describe('Helper Functions', () => {
  describe('generateRequestKey', () => {
    it('should generate colon-separated key from parts', () => {
      const key = generateRequestKey('user123', '/api/sync', 'abc123');

      assert.strictEqual(key, 'user123:/api/sync:abc123');
    });

    it('should filter out undefined and null values', () => {
      const key = generateRequestKey('user123', undefined, 'endpoint', null, 'hash');

      assert.strictEqual(key, 'user123:endpoint:hash');
    });

    it('should convert numbers to strings', () => {
      const key = generateRequestKey('user', 123, 456);

      assert.strictEqual(key, 'user:123:456');
    });
  });

  describe('simpleHash', () => {
    it('should generate consistent hash for same input', () => {
      const hash1 = simpleHash('test string');
      const hash2 = simpleHash('test string');

      assert.strictEqual(hash1, hash2);
    });

    it('should generate different hashes for different inputs', () => {
      const hash1 = simpleHash('string one');
      const hash2 = simpleHash('string two');

      assert.notStrictEqual(hash1, hash2);
    });

    it('should return a non-empty string', () => {
      const hash = simpleHash('any input');

      assert.ok(hash.length > 0);
    });

    it('should handle empty string', () => {
      const hash = simpleHash('');

      assert.strictEqual(typeof hash, 'string');
    });
  });
});

describe('Integration Scenarios', () => {
  it('should handle rapid button clicks scenario', async () => {
    const deduplicator = new RequestDeduplicator({
      name: 'button-clicks',
      defaultTtlMs: 60000,
      cleanupIntervalMs: 100000,
      maxPendingRequests: 100,
    });

    let apiCallCount = 0;
    const syncSessions = async () => {
      apiCallCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
      return { sessions: ['session1', 'session2'] };
    };

    // Simulate 5 rapid clicks
    const clicks = Array(5).fill(null).map(() =>
      deduplicator.deduplicate('user123:sync', syncSessions)
    );

    const results = await Promise.all(clicks);

    // API should only be called once
    assert.strictEqual(apiCallCount, 1);

    // All results should be the same
    for (const result of results) {
      assert.deepStrictEqual(result.data.sessions, ['session1', 'session2']);
    }

    // 4 should be deduplicated, 1 should be original
    const deduplicatedCount = results.filter(r => r.wasDeduplicated).length;
    assert.strictEqual(deduplicatedCount, 4);

    await deduplicator.dispose();
  });

  it('should handle multiple users concurrently without interference', async () => {
    const deduplicator = new RequestDeduplicator({
      name: 'multi-user',
      defaultTtlMs: 60000,
      cleanupIntervalMs: 100000,
      maxPendingRequests: 100,
    });

    let user1Calls = 0;
    let user2Calls = 0;

    const user1Sync = async () => {
      user1Calls++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return 'user1-data';
    };

    const user2Sync = async () => {
      user2Calls++;
      await new Promise(resolve => setTimeout(resolve, 50));
      return 'user2-data';
    };

    // User 1 clicks sync 3 times
    // User 2 clicks sync 2 times
    const allRequests = await Promise.all([
      deduplicator.deduplicate('user1:sync', user1Sync),
      deduplicator.deduplicate('user1:sync', user1Sync),
      deduplicator.deduplicate('user2:sync', user2Sync),
      deduplicator.deduplicate('user1:sync', user1Sync),
      deduplicator.deduplicate('user2:sync', user2Sync),
    ]);

    // Each user's API should be called once
    assert.strictEqual(user1Calls, 1);
    assert.strictEqual(user2Calls, 1);

    // Verify correct data returned to each user
    assert.strictEqual(allRequests[0].data, 'user1-data');
    assert.strictEqual(allRequests[1].data, 'user1-data');
    assert.strictEqual(allRequests[2].data, 'user2-data');
    assert.strictEqual(allRequests[3].data, 'user1-data');
    assert.strictEqual(allRequests[4].data, 'user2-data');

    await deduplicator.dispose();
  });
});
