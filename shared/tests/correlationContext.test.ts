/**
 * Tests for the Correlation Context module.
 * Covers AsyncLocalStorage propagation, context retrieval, and helper functions.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  getCorrelationContext,
  getCorrelationId,
  runWithCorrelation,
  runWithCorrelationContext,
  updateCorrelationContext,
  withCorrelationContext,
  type CorrelationContext,
} from '../src/utils/logging/correlationContext.js';

describe('Correlation Context Module', () => {
  describe('getCorrelationId', () => {
    it('should return undefined when called outside of a correlation context', () => {
      const correlationId = getCorrelationId();
      assert.strictEqual(correlationId, undefined);
    });

    it('should return the correlation ID when called within a context', () => {
      const testId = 'test-correlation-id-123';

      runWithCorrelation(testId, () => {
        const correlationId = getCorrelationId();
        assert.strictEqual(correlationId, testId);
      });
    });

    it('should return undefined after exiting the context', () => {
      runWithCorrelation('temp-id', () => {
        // Inside context
      });

      const correlationId = getCorrelationId();
      assert.strictEqual(correlationId, undefined);
    });
  });

  describe('getCorrelationContext', () => {
    it('should return undefined when called outside of a correlation context', () => {
      const context = getCorrelationContext();
      assert.strictEqual(context, undefined);
    });

    it('should return the full context when called within a context', () => {
      const testId = 'test-context-id';

      runWithCorrelation(testId, () => {
        const context = getCorrelationContext();
        assert.ok(context);
        assert.strictEqual(context.correlationId, testId);
      });
    });

    it('should return full context with additional fields when using runWithCorrelationContext', () => {
      const fullContext: CorrelationContext = {
        correlationId: 'full-context-id',
        userId: 'user-123',
        sessionId: 'session-456',
      };

      runWithCorrelationContext(fullContext, () => {
        const context = getCorrelationContext();
        assert.ok(context);
        assert.strictEqual(context.correlationId, 'full-context-id');
        assert.strictEqual(context.userId, 'user-123');
        assert.strictEqual(context.sessionId, 'session-456');
      });
    });
  });

  describe('runWithCorrelation', () => {
    it('should make correlation ID available within the callback', () => {
      let capturedId: string | undefined;

      runWithCorrelation('callback-test-id', () => {
        capturedId = getCorrelationId();
      });

      assert.strictEqual(capturedId, 'callback-test-id');
    });

    it('should return the callback return value', () => {
      const result = runWithCorrelation('return-test', () => {
        return 'test-result';
      });

      assert.strictEqual(result, 'test-result');
    });

    it('should handle async callbacks and propagate context', async () => {
      const result = await runWithCorrelation('async-test-id', async () => {
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 10));
        return getCorrelationId();
      });

      assert.strictEqual(result, 'async-test-id');
    });

    it('should propagate context through nested async operations', async () => {
      const capturedIds: (string | undefined)[] = [];

      await runWithCorrelation('nested-async-id', async () => {
        capturedIds.push(getCorrelationId());

        await Promise.all([
          (async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            capturedIds.push(getCorrelationId());
          })(),
          (async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            capturedIds.push(getCorrelationId());
          })(),
        ]);

        capturedIds.push(getCorrelationId());
      });

      assert.deepStrictEqual(capturedIds, [
        'nested-async-id',
        'nested-async-id',
        'nested-async-id',
        'nested-async-id',
      ]);
    });

    it('should handle nested runWithCorrelation calls with different IDs', () => {
      let outerId: string | undefined;
      let innerId: string | undefined;
      let afterInnerId: string | undefined;

      runWithCorrelation('outer-id', () => {
        outerId = getCorrelationId();

        runWithCorrelation('inner-id', () => {
          innerId = getCorrelationId();
        });

        afterInnerId = getCorrelationId();
      });

      assert.strictEqual(outerId, 'outer-id');
      assert.strictEqual(innerId, 'inner-id');
      assert.strictEqual(afterInnerId, 'outer-id');
    });
  });

  describe('runWithCorrelationContext', () => {
    it('should make full context available within the callback', () => {
      const context: CorrelationContext = {
        correlationId: 'full-test-id',
        userId: 'user-abc',
        customField: 'custom-value',
      };

      let capturedContext: CorrelationContext | undefined;

      runWithCorrelationContext(context, () => {
        capturedContext = getCorrelationContext();
      });

      assert.ok(capturedContext);
      assert.strictEqual(capturedContext.correlationId, 'full-test-id');
      assert.strictEqual(capturedContext.userId, 'user-abc');
      assert.strictEqual(capturedContext.customField, 'custom-value');
    });
  });

  describe('updateCorrelationContext', () => {
    it('should update context when inside a correlation context', () => {
      runWithCorrelation('update-test-id', () => {
        updateCorrelationContext({ userId: 'new-user-id' });

        const context = getCorrelationContext();
        assert.ok(context);
        assert.strictEqual(context.correlationId, 'update-test-id');
        assert.strictEqual(context.userId, 'new-user-id');
      });
    });

    it('should do nothing when called outside of a correlation context', () => {
      // Should not throw
      updateCorrelationContext({ userId: 'ignored' });

      const context = getCorrelationContext();
      assert.strictEqual(context, undefined);
    });

    it('should allow multiple updates', () => {
      runWithCorrelation('multi-update-id', () => {
        updateCorrelationContext({ userId: 'user-1' });
        updateCorrelationContext({ sessionId: 'session-1' });
        updateCorrelationContext({ customField: 'custom-1' });

        const context = getCorrelationContext();
        assert.ok(context);
        assert.strictEqual(context.userId, 'user-1');
        assert.strictEqual(context.sessionId, 'session-1');
        assert.strictEqual(context.customField, 'custom-1');
      });
    });

    it('should allow overwriting existing fields', () => {
      runWithCorrelation('overwrite-test-id', () => {
        updateCorrelationContext({ userId: 'user-1' });
        updateCorrelationContext({ userId: 'user-2' });

        const context = getCorrelationContext();
        assert.ok(context);
        assert.strictEqual(context.userId, 'user-2');
      });
    });
  });

  describe('withCorrelationContext', () => {
    it('should return just the provided context when outside of correlation context', () => {
      const result = withCorrelationContext({ component: 'Test' });

      assert.deepStrictEqual(result, { component: 'Test' });
    });

    it('should merge correlation ID into context when inside correlation context', () => {
      runWithCorrelation('merge-test-id', () => {
        const result = withCorrelationContext({ component: 'Test' });

        assert.strictEqual(result.component, 'Test');
        assert.strictEqual(result.requestId, 'merge-test-id');
      });
    });

    it('should include userId and sessionId when available', () => {
      runWithCorrelationContext({
        correlationId: 'full-merge-id',
        userId: 'user-xyz',
        sessionId: 'session-xyz',
      }, () => {
        const result = withCorrelationContext({ component: 'Test' });

        assert.strictEqual(result.component, 'Test');
        assert.strictEqual(result.requestId, 'full-merge-id');
        assert.strictEqual(result.userId, 'user-xyz');
        assert.strictEqual(result.sessionId, 'session-xyz');
      });
    });

    it('should return empty object when no context provided and outside correlation context', () => {
      const result = withCorrelationContext();

      assert.deepStrictEqual(result, {});
    });

    it('should return object with just requestId when inside context and no additional context provided', () => {
      runWithCorrelation('minimal-test-id', () => {
        const result = withCorrelationContext();

        assert.deepStrictEqual(result, { requestId: 'minimal-test-id' });
      });
    });
  });

  describe('async context propagation', () => {
    it('should propagate context through setTimeout', async () => {
      let capturedId: string | undefined;

      await runWithCorrelation('timeout-test-id', async () => {
        await new Promise<void>(resolve => {
          setTimeout(() => {
            capturedId = getCorrelationId();
            resolve();
          }, 10);
        });
      });

      assert.strictEqual(capturedId, 'timeout-test-id');
    });

    it('should propagate context through Promise.resolve', async () => {
      let capturedId: string | undefined;

      await runWithCorrelation('promise-test-id', async () => {
        await Promise.resolve().then(() => {
          capturedId = getCorrelationId();
        });
      });

      assert.strictEqual(capturedId, 'promise-test-id');
    });

    it('should propagate context through chained promises', async () => {
      const capturedIds: (string | undefined)[] = [];

      await runWithCorrelation('chain-test-id', async () => {
        await Promise.resolve()
          .then(() => {
            capturedIds.push(getCorrelationId());
            return Promise.resolve();
          })
          .then(() => {
            capturedIds.push(getCorrelationId());
            return Promise.resolve();
          })
          .then(() => {
            capturedIds.push(getCorrelationId());
          });
      });

      assert.deepStrictEqual(capturedIds, [
        'chain-test-id',
        'chain-test-id',
        'chain-test-id',
      ]);
    });
  });

  describe('error handling', () => {
    it('should preserve context when error is thrown and caught', () => {
      let capturedIdBeforeError: string | undefined;
      let capturedIdAfterError: string | undefined;

      runWithCorrelation('error-test-id', () => {
        capturedIdBeforeError = getCorrelationId();

        try {
          throw new Error('Test error');
        } catch {
          capturedIdAfterError = getCorrelationId();
        }
      });

      assert.strictEqual(capturedIdBeforeError, 'error-test-id');
      assert.strictEqual(capturedIdAfterError, 'error-test-id');
    });

    it('should clean up context even when error is thrown', () => {
      try {
        runWithCorrelation('cleanup-test-id', () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      const contextAfter = getCorrelationId();
      assert.strictEqual(contextAfter, undefined);
    });
  });
});
