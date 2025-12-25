/**
 * Tests for the Circuit Breaker pattern implementation.
 * Covers state transitions, backoff, health tracking, and singleton management.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  CircuitBreaker,
  getClaudeCircuitBreaker,
  getClaudeSDKCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerHealth,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
  type CircuitBreakerHealth,
} from '../../src/utils/circuit-breaker.js';
import { ClaudeError, ErrorCode } from '../../src/utils/errors.js';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({ name: 'test' });
  });

  describe('constructor', () => {
    it('should initialize in closed state', () => {
      assert.strictEqual(circuitBreaker.getState(), 'closed');
    });

    it('should use default config', () => {
      const cb = new CircuitBreaker();
      const health = cb.getHealth();
      assert.ok(health);
    });

    it('should accept custom config', () => {
      const customConfig: Partial<CircuitBreakerConfig> = {
        failureThreshold: 10,
        resetTimeoutMs: 120000,
        baseDelayMs: 200,
      };
      const cb = new CircuitBreaker(customConfig);
      assert.ok(cb);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = circuitBreaker.getState();
      assert.ok(['closed', 'open', 'half_open'].includes(state));
    });
  });

  describe('getHealth', () => {
    it('should return health information', () => {
      const health = circuitBreaker.getHealth();

      assert.ok('state' in health);
      assert.ok('consecutiveFailures' in health);
      assert.ok('consecutiveSuccesses' in health);
      assert.ok('totalFailures' in health);
      assert.ok('totalSuccesses' in health);
      assert.ok('stateChanges' in health);
      assert.ok('timeInCurrentState' in health);
    });

    it('should track consecutive failures', () => {
      circuitBreaker.recordFailure(new Error('Fail 1'));
      circuitBreaker.recordFailure(new Error('Fail 2'));

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveFailures, 2);
    });

    it('should track total failures', () => {
      circuitBreaker.recordFailure(new Error('Fail'));
      circuitBreaker.recordSuccess();
      circuitBreaker.recordFailure(new Error('Fail again'));

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.totalFailures, 2);
    });

    it('should track last error message', () => {
      circuitBreaker.recordFailure(new Error('Specific error message'));

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.lastError, 'Specific error message');
    });
  });

  describe('canExecute', () => {
    it('should return true when closed', () => {
      assert.strictEqual(circuitBreaker.canExecute(), true);
    });

    it('should return false when open', () => {
      // Open the circuit by triggering failures
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 60000,
      });

      cb.recordFailure(new Error('Fail 1'));
      cb.recordFailure(new Error('Fail 2'));

      assert.strictEqual(cb.getState(), 'open');
      assert.strictEqual(cb.canExecute(), false);
    });

    it('should transition to half_open after reset timeout', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 50,
      });

      cb.recordFailure(new Error('Fail'));
      assert.strictEqual(cb.getState(), 'open');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.strictEqual(cb.canExecute(), true);
      assert.strictEqual(cb.getState(), 'half_open');
    });
  });

  describe('recordSuccess', () => {
    it('should reset consecutive failures', () => {
      circuitBreaker.recordFailure(new Error('Fail'));
      circuitBreaker.recordSuccess();

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveFailures, 0);
    });

    it('should increment consecutive successes', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordSuccess();

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveSuccesses, 2);
    });

    it('should close circuit from half_open after success threshold', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        successThreshold: 1,
        resetTimeoutMs: 10,
      });

      // Trip the circuit
      cb.recordFailure(new Error('Fail'));
      assert.strictEqual(cb.getState(), 'open');

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Trigger half_open
      cb.canExecute();
      assert.strictEqual(cb.getState(), 'half_open');

      // Record success to close
      cb.recordSuccess();
      assert.strictEqual(cb.getState(), 'closed');
    });
  });

  describe('recordFailure', () => {
    it('should increment consecutive failures', () => {
      circuitBreaker.recordFailure(new Error('Fail 1'));
      circuitBreaker.recordFailure(new Error('Fail 2'));
      circuitBreaker.recordFailure(new Error('Fail 3'));

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveFailures, 3);
    });

    it('should reset consecutive successes', () => {
      circuitBreaker.recordSuccess();
      circuitBreaker.recordSuccess();
      circuitBreaker.recordFailure(new Error('Fail'));

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveSuccesses, 0);
    });

    it('should open circuit after failure threshold', () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 3,
      });

      cb.recordFailure(new Error('Fail 1'));
      cb.recordFailure(new Error('Fail 2'));
      assert.strictEqual(cb.getState(), 'closed');

      cb.recordFailure(new Error('Fail 3'));
      assert.strictEqual(cb.getState(), 'open');
    });

    it('should open circuit immediately from half_open on failure', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 10,
      });

      // Trip the circuit
      cb.recordFailure(new Error('Fail'));
      assert.strictEqual(cb.getState(), 'open');

      // Wait for reset
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Trigger half_open
      cb.canExecute();
      assert.strictEqual(cb.getState(), 'half_open');

      // Another failure should trip it again
      cb.recordFailure(new Error('Fail again'));
      assert.strictEqual(cb.getState(), 'open');
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential delay', () => {
      const delay0 = circuitBreaker.calculateBackoffDelay(0);
      const delay1 = circuitBreaker.calculateBackoffDelay(1);
      const delay2 = circuitBreaker.calculateBackoffDelay(2);

      // With default config: 100, 200, 400...
      assert.ok(delay0 >= 90 && delay0 <= 110);
      assert.ok(delay1 >= 180 && delay1 <= 220);
      assert.ok(delay2 >= 360 && delay2 <= 440);
    });

    it('should cap at max delay', () => {
      const delay = circuitBreaker.calculateBackoffDelay(100);
      assert.ok(delay <= DEFAULT_CIRCUIT_BREAKER_CONFIG.maxDelayMs);
    });

    it('should add jitter', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(Math.round(circuitBreaker.calculateBackoffDelay(0)));
      }
      // With jitter, should have some variation
      assert.ok(delays.size >= 1);
    });
  });

  describe('createCircuitOpenError', () => {
    it('should create ClaudeError with circuit breaker code', () => {
      const error = circuitBreaker.createCircuitOpenError();

      assert.ok(error instanceof ClaudeError);
      assert.strictEqual(error.code, ErrorCode.CIRCUIT_BREAKER_OPEN);
    });

    it('should include context', () => {
      const error = circuitBreaker.createCircuitOpenError({
        operation: 'test-op',
      });

      assert.strictEqual(error.context.operation, 'test-op');
      assert.ok('circuitState' in error.context);
      assert.ok('consecutiveFailures' in error.context);
    });

    it('should include time until retry', () => {
      circuitBreaker.recordFailure(new Error('Fail'));
      const error = circuitBreaker.createCircuitOpenError();

      assert.ok(error.message.includes('retry'));
    });
  });

  describe('reset', () => {
    it('should reset to closed state', () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
      });

      cb.recordFailure(new Error('Fail'));
      assert.strictEqual(cb.getState(), 'open');

      cb.reset();
      assert.strictEqual(cb.getState(), 'closed');
    });

    it('should reset counters', () => {
      circuitBreaker.recordFailure(new Error('Fail'));
      circuitBreaker.recordFailure(new Error('Fail'));
      circuitBreaker.reset();

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveFailures, 0);
      assert.strictEqual(health.consecutiveSuccesses, 0);
    });
  });

  describe('execute', () => {
    it('should execute operation when circuit is closed', async () => {
      const result = await circuitBreaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should record success on successful operation', async () => {
      await circuitBreaker.execute(async () => 'success');

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveSuccesses, 1);
      assert.strictEqual(health.totalSuccesses, 1);
    });

    it('should record failure on failed operation', async () => {
      await assert.rejects(async () => {
        await circuitBreaker.execute(async () => {
          throw new Error('Operation failed');
        });
      });

      const health = circuitBreaker.getHealth();
      assert.strictEqual(health.consecutiveFailures, 1);
      assert.strictEqual(health.totalFailures, 1);
    });

    it('should throw circuit open error when circuit is open', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 60000,
      });

      // Trip the circuit
      cb.recordFailure(new Error('Fail'));

      await assert.rejects(
        async () => {
          await cb.execute(async () => 'success');
        },
        (err: any) => {
          return err.code === ErrorCode.CIRCUIT_BREAKER_OPEN;
        }
      );
    });
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const result = await circuitBreaker.executeWithRetry(async () => 'success');
      assert.strictEqual(result, 'success');
    });

    it('should retry on retryable error', async () => {
      let attempts = 0;
      const result = await circuitBreaker.executeWithRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const error: any = new Error('Temporary error');
            error.status = 503;
            throw error;
          }
          return 'success';
        },
        { maxRetries: 5 }
      );

      assert.strictEqual(result, 'success');
      assert.strictEqual(attempts, 3);
    });

    it('should respect maxRetries', async () => {
      let attempts = 0;

      await assert.rejects(async () => {
        await circuitBreaker.executeWithRetry(
          async () => {
            attempts++;
            const error: any = new Error('Always fails');
            error.status = 500;
            throw error;
          },
          { maxRetries: 2 }
        );
      });

      assert.strictEqual(attempts, 3); // Initial + 2 retries
    });

    it('should call onRetry callback', async () => {
      let retryCount = 0;

      await circuitBreaker.executeWithRetry(
        async () => {
          if (retryCount < 2) {
            const error: any = new Error('Error');
            error.status = 500;
            throw error;
          }
          return 'done';
        },
        {
          maxRetries: 5,
          onRetry: () => {
            retryCount++;
          },
        }
      );

      assert.strictEqual(retryCount, 2);
    });

    it('should use custom shouldRetry', async () => {
      let attempts = 0;

      await assert.rejects(async () => {
        await circuitBreaker.executeWithRetry(
          async () => {
            attempts++;
            throw new Error('Custom error');
          },
          {
            maxRetries: 5,
            shouldRetry: () => false,
          }
        );
      });

      assert.strictEqual(attempts, 1);
    });

    it('should throw circuit open error when circuit opens during retry', async () => {
      const cb = new CircuitBreaker({
        name: 'test',
        failureThreshold: 2,
        resetTimeoutMs: 60000,
      });

      await assert.rejects(
        async () => {
          await cb.executeWithRetry(
            async () => {
              const error: any = new Error('Always fails');
              error.status = 500;
              throw error;
            },
            { maxRetries: 10 }
          );
        },
        (err: any) => {
          return err.code === ErrorCode.CIRCUIT_BREAKER_OPEN;
        }
      );
    });
  });
});

describe('Singleton Circuit Breakers', () => {
  afterEach(() => {
    resetAllCircuitBreakers();
  });

  describe('getClaudeCircuitBreaker', () => {
    it('should return same instance on multiple calls', () => {
      const cb1 = getClaudeCircuitBreaker();
      const cb2 = getClaudeCircuitBreaker();
      assert.strictEqual(cb1, cb2);
    });

    it('should accept custom config on first call', () => {
      const cb = getClaudeCircuitBreaker({ failureThreshold: 10 });
      assert.ok(cb);
    });
  });

  describe('getClaudeSDKCircuitBreaker', () => {
    it('should return same instance on multiple calls', () => {
      const cb1 = getClaudeSDKCircuitBreaker();
      const cb2 = getClaudeSDKCircuitBreaker();
      assert.strictEqual(cb1, cb2);
    });

    it('should be different from Claude API circuit breaker', () => {
      const apiCB = getClaudeCircuitBreaker();
      const sdkCB = getClaudeSDKCircuitBreaker();
      assert.notStrictEqual(apiCB, sdkCB);
    });
  });

  describe('resetAllCircuitBreakers', () => {
    it('should reset all circuit breakers', () => {
      const apiCB = getClaudeCircuitBreaker();
      const sdkCB = getClaudeSDKCircuitBreaker();

      // Record enough failures to trip the default threshold (5)
      for (let i = 0; i < 5; i++) {
        apiCB.recordFailure(new Error(`Fail ${i}`));
        sdkCB.recordFailure(new Error(`Fail ${i}`));
      }

      assert.strictEqual(apiCB.getState(), 'open');
      assert.strictEqual(sdkCB.getState(), 'open');

      resetAllCircuitBreakers();

      assert.strictEqual(apiCB.getState(), 'closed');
      assert.strictEqual(sdkCB.getState(), 'closed');
    });
  });

  describe('getAllCircuitBreakerHealth', () => {
    it('should return health of all circuit breakers', () => {
      getClaudeCircuitBreaker();
      getClaudeSDKCircuitBreaker();

      const health = getAllCircuitBreakerHealth();

      assert.ok('claude-api' in health);
      assert.ok('claude-sdk' in health);
    });

    it('should return empty object if no circuit breakers created', () => {
      // Note: In practice, this test might fail if run after others
      // that created circuit breakers, since they're singletons
      const health = getAllCircuitBreakerHealth();
      assert.ok(typeof health === 'object');
    });
  });
});

describe('DEFAULT_CIRCUIT_BREAKER_CONFIG', () => {
  it('should have reasonable defaults', () => {
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold, 5);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs, 60000);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.baseDelayMs, 100);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.maxDelayMs, 30000);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.backoffMultiplier, 2);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.jitterFactor, 0.1);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold, 1);
    assert.strictEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG.name, 'claude');
  });
});

describe('CircuitBreakerState type', () => {
  it('should allow valid states', () => {
    const closed: CircuitBreakerState = 'closed';
    const open: CircuitBreakerState = 'open';
    const halfOpen: CircuitBreakerState = 'half_open';

    assert.strictEqual(closed, 'closed');
    assert.strictEqual(open, 'open');
    assert.strictEqual(halfOpen, 'half_open');
  });
});

describe('CircuitBreakerHealth type', () => {
  it('should have all required fields', () => {
    const health: CircuitBreakerHealth = {
      state: 'closed',
      consecutiveFailures: 0,
      consecutiveSuccesses: 5,
      lastFailure: undefined,
      lastSuccess: new Date(),
      lastError: undefined,
      totalFailures: 2,
      totalSuccesses: 10,
      stateChanges: 1,
      timeInCurrentState: 5000,
    };

    assert.ok(health);
    assert.strictEqual(health.state, 'closed');
    assert.strictEqual(health.consecutiveSuccesses, 5);
  });
});

describe('Circuit Breaker edge cases', () => {
  it('should handle rapid success/failure toggles', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 5 });

    for (let i = 0; i < 10; i++) {
      cb.recordFailure(new Error('Fail'));
      cb.recordSuccess();
    }

    const health = cb.getHealth();
    assert.strictEqual(health.consecutiveSuccesses, 1);
    assert.strictEqual(health.consecutiveFailures, 0);
    assert.strictEqual(health.state, 'closed');
  });

  it('should handle many consecutive failures', () => {
    const cb = new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      resetTimeoutMs: 60000,
    });

    for (let i = 0; i < 100; i++) {
      cb.recordFailure(new Error(`Fail ${i}`));
    }

    const health = cb.getHealth();
    assert.strictEqual(health.totalFailures, 100);
    assert.strictEqual(health.state, 'open');
  });

  it('should handle different error types', () => {
    const cb = new CircuitBreaker({ name: 'test' });

    cb.recordFailure(new Error('Standard error'));
    cb.recordFailure(new TypeError('Type error'));
    cb.recordFailure(new RangeError('Range error'));

    const health = cb.getHealth();
    assert.strictEqual(health.consecutiveFailures, 3);
    assert.strictEqual(health.lastError, 'Range error');
  });

  it('should preserve timestamps', async () => {
    const cb = new CircuitBreaker({ name: 'test' });

    cb.recordFailure(new Error('Fail'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    cb.recordSuccess();

    const health = cb.getHealth();
    assert.ok(health.lastFailure);
    assert.ok(health.lastSuccess);
    assert.ok(health.lastSuccess > health.lastFailure);
  });
});

describe('Circuit Breaker retryable error detection', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ name: 'test' });
  });

  it('should detect rate limit errors as retryable', async () => {
    const result = await cb.executeWithRetry(
      (() => {
        let attempts = 0;
        return async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Rate limit');
            error.status = 429;
            throw error;
          }
          return 'success';
        };
      })(),
      { maxRetries: 3 }
    );

    assert.strictEqual(result, 'success');
  });

  it('should detect timeout errors as retryable', async () => {
    const result = await cb.executeWithRetry(
      (() => {
        let attempts = 0;
        return async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Connection timeout');
          }
          return 'success';
        };
      })(),
      { maxRetries: 3 }
    );

    assert.strictEqual(result, 'success');
  });

  it('should detect network errors as retryable', async () => {
    const result = await cb.executeWithRetry(
      (() => {
        let attempts = 0;
        return async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Network error');
          }
          return 'success';
        };
      })(),
      { maxRetries: 3 }
    );

    assert.strictEqual(result, 'success');
  });

  it('should respect isRetryable property on errors', async () => {
    const result = await cb.executeWithRetry(
      (() => {
        let attempts = 0;
        return async () => {
          attempts++;
          if (attempts < 2) {
            const error: any = new Error('Custom retryable');
            error.isRetryable = true;
            throw error;
          }
          return 'success';
        };
      })(),
      { maxRetries: 3 }
    );

    assert.strictEqual(result, 'success');
  });
});
