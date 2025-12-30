/**
 * Tests for the Bulk Database Transaction utilities.
 * Covers atomic and partial transaction modes, retry logic,
 * and structured error responses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  executeBulkTransaction,
  executeBulkWrite,
  createBulkApiResponse,
  type BulkTransactionResult,
  type BulkItemResult,
  type BulkTransactionConfig,
} from '../../src/db/bulkTransaction.js';

// Mock database for testing without actual database connection
function createMockDb() {
  let transactionCallCount = 0;
  let shouldFail = false;
  let failOnAttempt = -1;
  let transientErrorCount = 0;

  return {
    get callCount() { return transactionCallCount; },
    reset() {
      transactionCallCount = 0;
      shouldFail = false;
      failOnAttempt = -1;
      transientErrorCount = 0;
    },
    setFailure(fail: boolean, onAttempt = -1) {
      shouldFail = fail;
      failOnAttempt = onAttempt;
    },
    setTransientErrors(count: number) {
      transientErrorCount = count;
    },
    async transaction<T>(operation: (tx: any) => Promise<T>): Promise<T> {
      transactionCallCount++;

      // Simulate transient errors for retry testing
      if (transientErrorCount > 0) {
        transientErrorCount--;
        throw new Error('connection terminated unexpectedly');
      }

      // Simulate failure on specific attempt
      if (shouldFail && (failOnAttempt === -1 || failOnAttempt === transactionCallCount)) {
        throw new Error('Database error');
      }

      // Create a mock transaction context
      const mockTx = {
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        delete: () => ({ where: () => Promise.resolve() }),
      };

      return operation(mockTx);
    },
  };
}

describe('executeBulkTransaction', () => {
  describe('partial mode (default)', () => {
    it('should process all items successfully', async () => {
      const mockDb = createMockDb();
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        { mode: 'partial' }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalItems, 3);
      assert.strictEqual(result.successCount, 3);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.rolledBack, false);
      assert.strictEqual(result.results.length, 3);
    });

    it('should continue on error and track failures', async () => {
      const mockDb = createMockDb();
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      let callCount = 0;

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => {
          callCount++;
          if (item.id === '2') {
            throw new Error('Item 2 failed');
          }
          return { processed: item.id };
        },
        { mode: 'partial' }
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.totalItems, 3);
      assert.strictEqual(result.successCount, 2);
      assert.strictEqual(result.failureCount, 1);
      assert.strictEqual(result.rolledBack, false);

      // Check individual results
      const successfulItems = result.results.filter(r => r.success);
      const failedItems = result.results.filter(r => !r.success);

      assert.strictEqual(successfulItems.length, 2);
      assert.strictEqual(failedItems.length, 1);
      assert.strictEqual(failedItems[0].item.id, '2');
      assert.ok(failedItems[0].error?.message.includes('Item 2 failed'));
    });

    it('should retry on transient errors', async () => {
      const mockDb = createMockDb();
      mockDb.setTransientErrors(2); // Fail twice then succeed
      const items = [{ id: '1' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        { mode: 'partial', maxRetries: 3, retryDelayMs: 1 }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.successCount, 1);
      // Verify retries happened: 2 failed attempts + 1 success = 3 total calls
      assert.strictEqual(mockDb.callCount, 3);
    });

    it('should handle empty items array', async () => {
      const mockDb = createMockDb();
      const items: { id: string }[] = [];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        { mode: 'partial' }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalItems, 0);
      assert.strictEqual(result.successCount, 0);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.results.length, 0);
    });
  });

  describe('atomic mode', () => {
    it('should process all items in single transaction', async () => {
      const mockDb = createMockDb();
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        { mode: 'atomic' }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalItems, 3);
      assert.strictEqual(result.successCount, 3);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.rolledBack, false);
      // Atomic mode uses single transaction
      assert.strictEqual(mockDb.callCount, 1);
    });

    it('should rollback on any failure', async () => {
      const mockDb = createMockDb();
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => {
          if (item.id === '2') {
            throw new Error('Item 2 failed');
          }
          return { processed: item.id };
        },
        { mode: 'atomic' }
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.rolledBack, true);
      assert.ok(result.rollbackReason?.includes('Item 2 failed'));
      // All items marked as failed due to rollback
      assert.strictEqual(result.failureCount, 3);
      assert.strictEqual(result.successCount, 0);
    });

    it('should retry transaction on transient errors', async () => {
      const mockDb = createMockDb();
      mockDb.setTransientErrors(1); // Fail once then succeed
      const items = [{ id: '1' }, { id: '2' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        { mode: 'atomic', maxRetries: 2, retryDelayMs: 1 }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.successCount, 2);
      // Verify retry happened: 1 failed attempt + 1 success = 2 total calls
      assert.strictEqual(mockDb.callCount, 2);
    });
  });

  describe('item filtering', () => {
    it('should filter items before processing', async () => {
      const mockDb = createMockDb();
      const items = [
        { id: '1', active: true },
        { id: '2', active: false },
        { id: '3', active: true },
      ];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => ({ processed: item.id }),
        {
          mode: 'partial',
          itemFilter: (item) => item.active,
        }
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.totalItems, 2);
      assert.strictEqual(result.successCount, 2);
    });
  });

  describe('timing and duration', () => {
    it('should track operation duration', async () => {
      const mockDb = createMockDb();
      const items = [{ id: '1' }];

      const result = await executeBulkTransaction(
        mockDb as any,
        items,
        async (_tx, item) => {
          await new Promise(r => setTimeout(r, 10)); // Small delay
          return { processed: item.id };
        },
        { mode: 'partial' }
      );

      assert.ok(result.durationMs >= 10);
      assert.ok(result.results[0].durationMs >= 10);
    });
  });
});

describe('executeBulkWrite', () => {
  it('should execute write operation in transaction', async () => {
    const mockDb = createMockDb();

    const result = await executeBulkWrite(
      mockDb as any,
      async (_tx) => ({ updated: 5 }),
      { operationName: 'test-write' }
    );

    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.result, { updated: 5 });
    assert.ok(result.durationMs >= 0);
  });

  it('should handle write failures', async () => {
    const mockDb = createMockDb();
    mockDb.setFailure(true);

    const result = await executeBulkWrite(
      mockDb as any,
      async (_tx) => ({ updated: 5 }),
      { operationName: 'test-write', maxRetries: 0 }
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error.message.includes('Database error'));
  });

  it('should retry on transient failures', async () => {
    const mockDb = createMockDb();
    mockDb.setTransientErrors(1);

    const result = await executeBulkWrite(
      mockDb as any,
      async (_tx) => ({ updated: 5 }),
      { operationName: 'test-write', maxRetries: 2, retryDelayMs: 1 }
    );

    assert.strictEqual(result.success, true);
    // Verify retry happened: 1 failed attempt + 1 success = 2 total calls
    assert.strictEqual(mockDb.callCount, 2);
  });
});

describe('createBulkApiResponse', () => {
  it('should create success response', () => {
    const txResult: BulkTransactionResult<{ id: string }, { processed: boolean }> = {
      success: true,
      totalItems: 3,
      successCount: 3,
      failureCount: 0,
      results: [
        { item: { id: '1' }, success: true, result: { processed: true }, durationMs: 10 },
        { item: { id: '2' }, success: true, result: { processed: true }, durationMs: 15 },
        { item: { id: '3' }, success: true, result: { processed: true }, durationMs: 12 },
      ],
      durationMs: 50,
      rolledBack: false,
      retriesAttempted: 0,
    };

    const response = createBulkApiResponse(txResult);

    assert.strictEqual(response.success, true);
    assert.strictEqual(response.data.processed, 3);
    assert.strictEqual(response.data.succeeded, 3);
    assert.strictEqual(response.data.failed, 0);
    assert.strictEqual(response.data.results.length, 3);
    assert.strictEqual(response.data.stats.durationMs, 50);
    assert.strictEqual(response.data.stats.rolledBack, false);
  });

  it('should create partial failure response', () => {
    const txResult: BulkTransactionResult<{ id: string }, { processed: boolean }> = {
      success: false,
      totalItems: 3,
      successCount: 2,
      failureCount: 1,
      results: [
        { item: { id: '1' }, success: true, result: { processed: true }, durationMs: 10 },
        { item: { id: '2' }, success: false, error: new Error('Failed'), durationMs: 5 },
        { item: { id: '3' }, success: true, result: { processed: true }, durationMs: 12 },
      ],
      durationMs: 30,
      rolledBack: false,
      retriesAttempted: 1,
    };

    const response = createBulkApiResponse(txResult);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.data.succeeded, 2);
    assert.strictEqual(response.data.failed, 1);
    assert.strictEqual(response.data.results[1].success, false);
    assert.strictEqual(response.data.results[1].error, 'Failed');
  });

  it('should create rollback response', () => {
    const txResult: BulkTransactionResult<{ id: string }, { processed: boolean }> = {
      success: false,
      totalItems: 3,
      successCount: 0,
      failureCount: 3,
      results: [
        { item: { id: '1' }, success: false, error: new Error('Rolled back'), durationMs: 0 },
        { item: { id: '2' }, success: false, error: new Error('Rolled back'), durationMs: 0 },
        { item: { id: '3' }, success: false, error: new Error('Rolled back'), durationMs: 0 },
      ],
      durationMs: 20,
      rolledBack: true,
      rollbackReason: 'Item 2 failed',
      retriesAttempted: 0,
    };

    const response = createBulkApiResponse(txResult);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.data.stats.rolledBack, true);
    assert.strictEqual(response.error, 'Item 2 failed');
  });

  it('should include custom success messages', () => {
    const txResult: BulkTransactionResult<{ id: string }, { count: number }> = {
      success: true,
      totalItems: 1,
      successCount: 1,
      failureCount: 0,
      results: [
        { item: { id: '1' }, success: true, result: { count: 5 }, durationMs: 10 },
      ],
      durationMs: 10,
      rolledBack: false,
      retriesAttempted: 0,
    };

    const response = createBulkApiResponse(
      txResult,
      (item, result) => `Processed ${item.id} with ${result.count} items`
    );

    assert.strictEqual(response.data.results[0].message, 'Processed 1 with 5 items');
  });
});

describe('BulkTransactionConfig', () => {
  it('should use default values when not specified', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }];

    const result = await executeBulkTransaction(
      mockDb as any,
      items,
      async (_tx, item) => ({ processed: item.id }),
      {} // No config options
    );

    // Should use default mode (partial)
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rolledBack, false);
  });

  it('should respect custom operation name for logging', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }];

    const result = await executeBulkTransaction(
      mockDb as any,
      items,
      async (_tx, item) => ({ processed: item.id }),
      { operationName: 'custom-operation' }
    );

    assert.strictEqual(result.success, true);
  });

  it('should include custom context in logging', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }];

    const result = await executeBulkTransaction(
      mockDb as any,
      items,
      async (_tx, item) => ({ processed: item.id }),
      {
        operationName: 'test-op',
        context: { userId: 'user-123', requestId: 'req-456' },
      }
    );

    assert.strictEqual(result.success, true);
  });
});

describe('Error Handling', () => {
  it('should preserve original error messages', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }];

    const result = await executeBulkTransaction(
      mockDb as any,
      items,
      async () => {
        throw new Error('Specific validation error: field X is invalid');
      },
      { mode: 'partial' }
    );

    assert.strictEqual(result.failureCount, 1);
    const error = result.results[0].error;
    assert.ok(error?.message.includes('Specific validation error'));
  });

  it('should handle non-Error throws', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }];

    const result = await executeBulkTransaction(
      mockDb as any,
      items,
      async () => {
        throw 'String error'; // Non-Error throw
      },
      { mode: 'partial' }
    );

    assert.strictEqual(result.failureCount, 1);
    assert.ok(result.results[0].error);
  });
});

describe('Concurrency Behavior', () => {
  it('partial mode should process items independently', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }, { id: '2' }];
    const processOrder: string[] = [];

    await executeBulkTransaction(
      mockDb as any,
      items,
      async (_tx, item) => {
        processOrder.push(item.id);
        return { processed: item.id };
      },
      { mode: 'partial' }
    );

    // Each item gets its own transaction in partial mode
    assert.strictEqual(mockDb.callCount, 2);
    assert.deepStrictEqual(processOrder, ['1', '2']);
  });

  it('atomic mode should use single transaction', async () => {
    const mockDb = createMockDb();
    const items = [{ id: '1' }, { id: '2' }, { id: '3' }];

    await executeBulkTransaction(
      mockDb as any,
      items,
      async (_tx, item) => ({ processed: item.id }),
      { mode: 'atomic' }
    );

    // All items in single transaction
    assert.strictEqual(mockDb.callCount, 1);
  });
});
