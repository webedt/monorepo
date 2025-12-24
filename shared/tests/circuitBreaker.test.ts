/**
 * Tests for the Circuit Breaker module.
 * Covers state transitions, failure thresholds, and recovery behavior.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { CircuitBreaker, createCircuitBreaker, circuitBreakerRegistry } from './circuitBreaker.js';

describe('CircuitBreaker', () => {
  describe('Initial State', () => {
    it('should start in closed state', () => {
      const breaker = createCircuitBreaker({ name: 'test-initial' });

      assert.strictEqual(breaker.getState(), 'closed');
      assert.strictEqual(breaker.isClosed(), true);
      assert.strictEqual(breaker.isOpen(), false);
    });

    it('should allow execution when closed', () => {
      const breaker = createCircuitBreaker({ name: 'test-allow' });

      assert.strictEqual(breaker.canExecute(), true);
    });

    it('should have zero failure count initially', () => {
      const breaker = createCircuitBreaker({ name: 'test-zero' });
      const stats = breaker.getStats();

      assert.strictEqual(stats.consecutiveFailures, 0);
      assert.strictEqual(stats.totalFailures, 0);
      assert.strictEqual(stats.totalSuccesses, 0);
    });
  });

  describe('Successful Operations', () => {
    it('should execute and return success result', async () => {
      const breaker = createCircuitBreaker({ name: 'test-success' });

      const result = await breaker.execute(async () => 'hello');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, 'hello');
      assert.strictEqual(result.wasRejected, false);
    });

    it('should increment success counter', async () => {
      const breaker = createCircuitBreaker({ name: 'test-counter' });

      await breaker.execute(async () => 'one');
      await breaker.execute(async () => 'two');
      await breaker.execute(async () => 'three');

      const stats = breaker.getStats();
      assert.strictEqual(stats.totalSuccesses, 3);
      assert.strictEqual(stats.consecutiveSuccesses, 3);
    });

    it('should reset consecutive failures on success', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-reset',
        failureThreshold: 5
      });

      // Cause some failures (but not enough to open)
      await breaker.execute(async () => { throw new Error('fail1'); });
      await breaker.execute(async () => { throw new Error('fail2'); });

      let stats = breaker.getStats();
      assert.strictEqual(stats.consecutiveFailures, 2);

      // Now succeed
      await breaker.execute(async () => 'success');

      stats = breaker.getStats();
      assert.strictEqual(stats.consecutiveFailures, 0);
      assert.strictEqual(stats.consecutiveSuccesses, 1);
    });
  });

  describe('Failed Operations', () => {
    it('should return failure result without opening circuit', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-fail',
        failureThreshold: 5
      });

      const result = await breaker.execute(async () => {
        throw new Error('test error');
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.wasRejected, false);
      assert.ok(result.error);
      assert.strictEqual(result.error?.message, 'test error');
      assert.strictEqual(breaker.getState(), 'closed');
    });

    it('should open circuit after reaching failure threshold', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-threshold',
        failureThreshold: 3
      });

      // Fail 3 times
      for (let i = 0; i < 3; i++) {
        await breaker.execute(async () => { throw new Error(`fail ${i}`); });
      }

      assert.strictEqual(breaker.getState(), 'open');
      assert.strictEqual(breaker.isOpen(), true);
      assert.strictEqual(breaker.canExecute(), false);
    });

    it('should increment failure counters', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-fail-counter',
        failureThreshold: 10
      });

      await breaker.execute(async () => { throw new Error('e1'); });
      await breaker.execute(async () => { throw new Error('e2'); });

      const stats = breaker.getStats();
      assert.strictEqual(stats.totalFailures, 2);
      assert.strictEqual(stats.consecutiveFailures, 2);
      assert.ok(stats.lastFailureTime);
      assert.ok(stats.lastError);
    });
  });

  describe('Open State Behavior', () => {
    it('should reject requests when open', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-reject',
        failureThreshold: 1
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail'); });
      assert.strictEqual(breaker.isOpen(), true);

      // Try another request
      const result = await breaker.execute(async () => 'should not run');

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.wasRejected, true);
      assert.ok(result.error?.message.includes('is open'));
    });

    it('should not increment failure count for rejected requests', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-no-increment',
        failureThreshold: 1
      });

      await breaker.execute(async () => { throw new Error('fail'); });
      const initialStats = breaker.getStats();

      await breaker.execute(async () => 'rejected');
      const finalStats = breaker.getStats();

      assert.strictEqual(initialStats.totalFailures, finalStats.totalFailures);
    });
  });

  describe('Half-Open State and Recovery', () => {
    it('should transition to half-open after reset timeout', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-half-open',
        failureThreshold: 1,
        resetTimeoutMs: 10 // Very short for testing
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail'); });
      assert.strictEqual(breaker.getState(), 'open');

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should allow execution (transition to half-open)
      assert.strictEqual(breaker.canExecute(), true);
    });

    it('should close circuit after success threshold in half-open', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-recovery',
        failureThreshold: 1,
        successThreshold: 2,
        resetTimeoutMs: 10
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail'); });

      // Wait for half-open
      await new Promise(resolve => setTimeout(resolve, 20));

      // Succeed twice
      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');

      assert.strictEqual(breaker.getState(), 'closed');
      assert.strictEqual(breaker.isClosed(), true);
    });

    it('should reopen circuit on failure in half-open state', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-reopen',
        failureThreshold: 1,
        halfOpenMaxAttempts: 1,
        resetTimeoutMs: 10
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail1'); });

      // Wait for half-open
      await new Promise(resolve => setTimeout(resolve, 20));

      // Fail again in half-open
      await breaker.execute(async () => { throw new Error('fail2'); });

      assert.strictEqual(breaker.getState(), 'open');
    });
  });

  describe('executeWithFallback', () => {
    it('should return operation result when successful', async () => {
      const breaker = createCircuitBreaker({ name: 'test-fallback-success' });

      const { value, degraded } = await breaker.executeWithFallback(
        async () => 'real value',
        'fallback value'
      );

      assert.strictEqual(value, 'real value');
      assert.strictEqual(degraded, false);
    });

    it('should return fallback when operation fails', async () => {
      const breaker = createCircuitBreaker({ name: 'test-fallback-fail' });

      const { value, degraded } = await breaker.executeWithFallback(
        async () => { throw new Error('fail'); },
        'fallback value'
      );

      assert.strictEqual(value, 'fallback value');
      assert.strictEqual(degraded, true);
    });

    it('should return fallback when circuit is open', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-fallback-open',
        failureThreshold: 1
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail'); });

      const { value, degraded } = await breaker.executeWithFallback(
        async () => 'should not run',
        'fallback'
      );

      assert.strictEqual(value, 'fallback');
      assert.strictEqual(degraded, true);
    });
  });

  describe('State Change Listeners', () => {
    it('should notify listeners on state change', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-listener',
        failureThreshold: 1
      });

      const stateChanges: Array<{ from: string; to: string }> = [];

      breaker.onStateChange((newState, prevState) => {
        stateChanges.push({ from: prevState, to: newState });
      });

      // Trigger state change to open
      await breaker.execute(async () => { throw new Error('fail'); });

      assert.strictEqual(stateChanges.length, 1);
      assert.strictEqual(stateChanges[0].from, 'closed');
      assert.strictEqual(stateChanges[0].to, 'open');
    });
  });

  describe('Manual Reset', () => {
    it('should reset circuit to closed state', async () => {
      const breaker = createCircuitBreaker({
        name: 'test-manual-reset',
        failureThreshold: 1
      });

      // Open the circuit
      await breaker.execute(async () => { throw new Error('fail'); });
      assert.strictEqual(breaker.isOpen(), true);

      // Manual reset
      breaker.reset();

      assert.strictEqual(breaker.isClosed(), true);
      assert.strictEqual(breaker.canExecute(), true);

      const stats = breaker.getStats();
      assert.strictEqual(stats.consecutiveFailures, 0);
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    // Reset registry between tests
    circuitBreakerRegistry.resetAll();
  });

  describe('get', () => {
    it('should create new circuit breaker if not exists', () => {
      const breaker = circuitBreakerRegistry.get('new-breaker');

      assert.ok(breaker);
      assert.strictEqual(breaker.getName(), 'new-breaker');
    });

    it('should return existing circuit breaker', () => {
      const first = circuitBreakerRegistry.get('same-breaker');
      const second = circuitBreakerRegistry.get('same-breaker');

      assert.strictEqual(first, second);
    });

    it('should apply config when creating new breaker', async () => {
      const breaker = circuitBreakerRegistry.get('config-test', {
        failureThreshold: 2
      });

      await breaker.execute(async () => { throw new Error('1'); });
      assert.strictEqual(breaker.isClosed(), true);

      await breaker.execute(async () => { throw new Error('2'); });
      assert.strictEqual(breaker.isOpen(), true);
    });
  });

  describe('getAllStats', () => {
    it('should return stats for all registered breakers', async () => {
      const breaker1 = circuitBreakerRegistry.get('stats-1');
      const breaker2 = circuitBreakerRegistry.get('stats-2');

      await breaker1.execute(async () => 'success');
      await breaker2.execute(async () => { throw new Error('fail'); });

      const allStats = circuitBreakerRegistry.getAllStats();

      assert.ok(allStats['stats-1']);
      assert.ok(allStats['stats-2']);
      assert.strictEqual(allStats['stats-1'].totalSuccesses, 1);
      assert.strictEqual(allStats['stats-2'].totalFailures, 1);
    });
  });

  describe('resetAll', () => {
    it('should reset all breakers to closed state', async () => {
      const breaker1 = circuitBreakerRegistry.get('reset-1', { failureThreshold: 1 });
      const breaker2 = circuitBreakerRegistry.get('reset-2', { failureThreshold: 1 });

      await breaker1.execute(async () => { throw new Error('1'); });
      await breaker2.execute(async () => { throw new Error('2'); });

      assert.strictEqual(breaker1.isOpen(), true);
      assert.strictEqual(breaker2.isOpen(), true);

      circuitBreakerRegistry.resetAll();

      assert.strictEqual(breaker1.isClosed(), true);
      assert.strictEqual(breaker2.isClosed(), true);
    });
  });

  describe('size', () => {
    it('should return number of registered breakers', () => {
      const initialSize = circuitBreakerRegistry.size();

      circuitBreakerRegistry.get('size-test-1');
      circuitBreakerRegistry.get('size-test-2');
      circuitBreakerRegistry.get('size-test-3');

      // Should have added 3 more breakers
      assert.strictEqual(circuitBreakerRegistry.size(), initialSize + 3);
    });
  });
});

describe('Circuit Breaker Integration Scenarios', () => {
  it('should handle intermittent failures without opening circuit', async () => {
    const breaker = createCircuitBreaker({
      name: 'test-intermittent',
      failureThreshold: 3
    });

    // Alternating success/failure pattern
    await breaker.execute(async () => 'success');
    await breaker.execute(async () => { throw new Error('fail'); });
    await breaker.execute(async () => 'success');
    await breaker.execute(async () => { throw new Error('fail'); });
    await breaker.execute(async () => 'success');

    // Should still be closed because failures are not consecutive
    assert.strictEqual(breaker.isClosed(), true);
  });

  it('should protect downstream service from cascading failures', async () => {
    let requestCount = 0;
    const breaker = createCircuitBreaker({
      name: 'test-cascade',
      failureThreshold: 2
    });

    const callService = async () => {
      requestCount++;
      throw new Error('Service unavailable');
    };

    // These will hit the service
    await breaker.execute(callService);
    await breaker.execute(callService);
    assert.strictEqual(requestCount, 2);

    // These should be rejected without hitting service
    await breaker.execute(callService);
    await breaker.execute(callService);
    await breaker.execute(callService);

    // Service was only called twice
    assert.strictEqual(requestCount, 2);
  });
});
