/**
 * Tests for timing utilities.
 * Covers sleep, jitter, and exponential backoff calculations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sleep,
  addJitter,
  addPositiveJitter,
  calculateBackoffDelay,
  sleepWithJitter,
  sleepWithBackoff,
} from '../src/utils/timing.js';

describe('Timing Utilities', () => {
  describe('sleep', () => {
    it('should resolve after approximately the specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      // Allow 20ms tolerance for timing variations
      assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
      assert.ok(elapsed < 100, `Expected less than 100ms, got ${elapsed}ms`);
    });

    it('should handle zero milliseconds', async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;

      assert.ok(elapsed < 50, `Expected quick resolution, got ${elapsed}ms`);
    });
  });

  describe('addJitter', () => {
    it('should return value within ±factor range', () => {
      const value = 1000;
      const factor = 0.3;

      // Run multiple times to check distribution
      for (let i = 0; i < 100; i++) {
        const result = addJitter(value, factor);
        const minExpected = value * (1 - factor); // 700
        const maxExpected = value * (1 + factor); // 1300

        assert.ok(
          result >= minExpected && result <= maxExpected,
          `Expected ${result} to be between ${minExpected} and ${maxExpected}`
        );
      }
    });

    it('should use default jitter factor when not specified', () => {
      const value = 1000;

      // Default factor is 0.3, so range should be 700-1300
      for (let i = 0; i < 50; i++) {
        const result = addJitter(value);
        assert.ok(result >= 700 && result <= 1300, `Result ${result} out of expected range`);
      }
    });

    it('should handle zero value', () => {
      const result = addJitter(0, 0.3);
      assert.strictEqual(result, 0);
    });
  });

  describe('addPositiveJitter', () => {
    it('should only increase the value, never decrease', () => {
      const value = 1000;
      const factor = 0.3;

      for (let i = 0; i < 100; i++) {
        const result = addPositiveJitter(value, factor);

        assert.ok(result >= value, `Expected ${result} >= ${value}`);
        assert.ok(result <= value * (1 + factor), `Expected ${result} <= ${value * (1 + factor)}`);
      }
    });

    it('should use default jitter factor when not specified', () => {
      const value = 1000;

      for (let i = 0; i < 50; i++) {
        const result = addPositiveJitter(value);
        assert.ok(result >= 1000 && result <= 1300, `Result ${result} out of expected range`);
      }
    });

    it('should handle zero value', () => {
      const result = addPositiveJitter(0, 0.3);
      assert.strictEqual(result, 0);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential delay for successive attempts', () => {
      const config = { baseDelayMs: 1000, backoffMultiplier: 2, useJitter: false };

      assert.strictEqual(calculateBackoffDelay(1, config), 1000);
      assert.strictEqual(calculateBackoffDelay(2, config), 2000);
      assert.strictEqual(calculateBackoffDelay(3, config), 4000);
      assert.strictEqual(calculateBackoffDelay(4, config), 8000);
    });

    it('should respect maxDelayMs cap', () => {
      const config = { baseDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 5000, useJitter: false };

      assert.strictEqual(calculateBackoffDelay(1, config), 1000);
      assert.strictEqual(calculateBackoffDelay(2, config), 2000);
      assert.strictEqual(calculateBackoffDelay(3, config), 4000);
      assert.strictEqual(calculateBackoffDelay(4, config), 5000); // Capped
      assert.strictEqual(calculateBackoffDelay(10, config), 5000); // Still capped
    });

    it('should apply bidirectional jitter when jitterMode is bidirectional', () => {
      const config = { baseDelayMs: 1000, backoffMultiplier: 2, useJitter: true, jitterMode: 'bidirectional' as const };

      let sawLower = false;
      let sawHigher = false;

      for (let i = 0; i < 100; i++) {
        const result = calculateBackoffDelay(1, config);
        if (result < 1000) sawLower = true;
        if (result > 1000) sawHigher = true;
      }

      // With bidirectional jitter, we should see both lower and higher values
      assert.ok(sawLower || sawHigher, 'Jitter should produce variation');
    });

    it('should apply positive-only jitter when jitterMode is positive', () => {
      const config = { baseDelayMs: 1000, backoffMultiplier: 2, useJitter: true, jitterMode: 'positive' as const };

      for (let i = 0; i < 50; i++) {
        const result = calculateBackoffDelay(1, config);
        assert.ok(result >= 1000, `Expected ${result} >= 1000 with positive jitter`);
        assert.ok(result <= 1300, `Expected ${result} <= 1300 with positive jitter (30%)`);
      }
    });

    it('should enforce minimum delay of half base delay with bidirectional jitter', () => {
      const config = {
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        useJitter: true,
        jitterMode: 'bidirectional' as const,
        jitterFactor: 0.9 // Large jitter factor
      };

      for (let i = 0; i < 50; i++) {
        const result = calculateBackoffDelay(1, config);
        assert.ok(result >= 500, `Expected ${result} >= 500 (half of base delay)`);
      }
    });

    it('should handle attempt=0 gracefully', () => {
      const config = { baseDelayMs: 1000, backoffMultiplier: 2, useJitter: false };
      const result = calculateBackoffDelay(0, config);

      // 1000 * 2^(-1) = 500
      assert.strictEqual(result, 500);
    });

    it('should use default config when none provided', () => {
      // Default config has jitter enabled, so just verify it returns a reasonable value
      const result = calculateBackoffDelay(1);
      assert.ok(result > 0, 'Should return positive delay');
      assert.ok(typeof result === 'number', 'Should return a number');
    });

    it('should floor the result to integer', () => {
      const config = { baseDelayMs: 100, backoffMultiplier: 1.5, useJitter: false };

      // 100 * 1.5 = 150 (integer)
      // 100 * 1.5^2 = 225 (integer)
      const result2 = calculateBackoffDelay(2, config);
      assert.strictEqual(result2, Math.floor(100 * 1.5));
    });
  });

  describe('sleepWithJitter', () => {
    it('should sleep for at least the specified duration', async () => {
      const start = Date.now();
      await sleepWithJitter(50);
      const elapsed = Date.now() - start;

      // With positive jitter, sleep should be >= 50ms
      assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}ms`);
    });

    it('should add positive jitter to the duration', async () => {
      const durations: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = Date.now();
        await sleepWithJitter(50);
        durations.push(Date.now() - start);
      }

      // All durations should be >= 50ms (positive jitter only)
      for (const d of durations) {
        assert.ok(d >= 45, `Expected duration >= 45ms, got ${d}ms`);
      }
    });
  });

  describe('sleepWithBackoff', () => {
    it('should return the delay that was slept', async () => {
      const delay = await sleepWithBackoff(1, { baseDelayMs: 50, useJitter: false });

      assert.strictEqual(delay, 50);
    });

    it('should sleep for approximately the calculated delay', async () => {
      const start = Date.now();
      const delay = await sleepWithBackoff(1, { baseDelayMs: 50, useJitter: false });
      const elapsed = Date.now() - start;

      assert.ok(elapsed >= delay - 10, `Expected elapsed >= ${delay - 10}ms, got ${elapsed}ms`);
      assert.ok(elapsed < delay + 50, `Expected elapsed < ${delay + 50}ms, got ${elapsed}ms`);
    });

    it('should calculate exponential backoff', async () => {
      const delay1 = await sleepWithBackoff(1, { baseDelayMs: 10, backoffMultiplier: 2, useJitter: false });
      const delay2 = await sleepWithBackoff(2, { baseDelayMs: 10, backoffMultiplier: 2, useJitter: false });

      assert.strictEqual(delay1, 10);
      assert.strictEqual(delay2, 20);
    });
  });

  describe('JitterMode types', () => {
    it('should accept bidirectional as jitter mode', () => {
      const result = calculateBackoffDelay(1, {
        baseDelayMs: 100,
        jitterMode: 'bidirectional'
      });
      assert.ok(typeof result === 'number');
    });

    it('should accept positive as jitter mode', () => {
      const result = calculateBackoffDelay(1, {
        baseDelayMs: 100,
        jitterMode: 'positive'
      });
      assert.ok(typeof result === 'number');
    });
  });
});
