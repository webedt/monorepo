/**
 * Tests for the centralized constants configuration module.
 * Verifies that constants are properly exported and have expected values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TIMEOUTS,
  INTERVALS,
  LIMITS,
  RETRY,
  CIRCUIT_BREAKER,
  RECOVERY_DELAYS,
  CONTEXT_RETRY,
} from '../../src/config/constants.js';

describe('Constants Module', () => {
  describe('TIMEOUTS', () => {
    it('should export HTTP timeouts with positive values', () => {
      assert.ok(TIMEOUTS.HTTP.REQUEST > 0, 'HTTP.REQUEST should be positive');
      assert.ok(TIMEOUTS.HTTP.HEAD > 0, 'HTTP.HEAD should be positive');
      assert.ok(TIMEOUTS.HTTP.HEALTH_CHECK > 0, 'HTTP.HEALTH_CHECK should be positive');
    });

    it('should export SSE timeouts with positive values', () => {
      assert.ok(TIMEOUTS.SSE.STALE > 0, 'SSE.STALE should be positive');
    });

    it('should export DATABASE timeouts with positive values', () => {
      assert.ok(TIMEOUTS.DATABASE.CONNECTION > 0, 'DATABASE.CONNECTION should be positive');
      assert.ok(TIMEOUTS.DATABASE.IDLE > 0, 'DATABASE.IDLE should be positive');
      assert.ok(TIMEOUTS.DATABASE.STATEMENT > 0, 'DATABASE.STATEMENT should be positive');
    });

    it('should export CIRCUIT_BREAKER timeouts with positive values', () => {
      assert.ok(TIMEOUTS.CIRCUIT_BREAKER.RESET > 0, 'CIRCUIT_BREAKER.RESET should be positive');
    });

    it('should export WORKER timeouts with positive values', () => {
      assert.ok(TIMEOUTS.WORKER.EXECUTION > 0, 'WORKER.EXECUTION should be positive');
      assert.ok(TIMEOUTS.WORKER.HEALTH_CHECK > 0, 'WORKER.HEALTH_CHECK should be positive');
    });

    it('should have reasonable default timeout values', () => {
      // Default HTTP request timeout should be 30s
      assert.strictEqual(TIMEOUTS.HTTP.REQUEST, 30000);
      // Default HEAD timeout should be 10s
      assert.strictEqual(TIMEOUTS.HTTP.HEAD, 10000);
      // Default health check timeout should be 5s
      assert.strictEqual(TIMEOUTS.HTTP.HEALTH_CHECK, 5000);
    });
  });

  describe('INTERVALS', () => {
    it('should export SSE intervals with positive values', () => {
      assert.ok(INTERVALS.SSE.HEARTBEAT > 0, 'SSE.HEARTBEAT should be positive');
      assert.ok(INTERVALS.SSE.CLEANUP > 0, 'SSE.CLEANUP should be positive');
    });

    it('should export HEALTH intervals with positive values', () => {
      assert.ok(INTERVALS.HEALTH.CHECK > 0, 'HEALTH.CHECK should be positive');
      assert.ok(INTERVALS.HEALTH.DATABASE > 0, 'HEALTH.DATABASE should be positive');
    });

    it('should export SYNC intervals with positive values', () => {
      assert.ok(INTERVALS.SYNC.CRDT > 0, 'SYNC.CRDT should be positive');
    });

    it('should have reasonable default interval values', () => {
      // Default SSE heartbeat should be 15s
      assert.strictEqual(INTERVALS.SSE.HEARTBEAT, 15000);
      // Default SSE cleanup should be 10s
      assert.strictEqual(INTERVALS.SSE.CLEANUP, 10000);
      // Default health check should be 30s
      assert.strictEqual(INTERVALS.HEALTH.CHECK, 30000);
    });
  });

  describe('LIMITS', () => {
    it('should export SSE limits with positive values', () => {
      assert.ok(LIMITS.SSE.MAX_LISTENERS > 0, 'SSE.MAX_LISTENERS should be positive');
      assert.ok(LIMITS.SSE.MAX_PER_SESSION > 0, 'SSE.MAX_PER_SESSION should be positive');
      assert.ok(LIMITS.SSE.MAX_PER_USER > 0, 'SSE.MAX_PER_USER should be positive');
      assert.ok(LIMITS.SSE.WARN_THRESHOLD > 0, 'SSE.WARN_THRESHOLD should be positive');
      assert.ok(LIMITS.SSE.ERROR_THRESHOLD > 0, 'SSE.ERROR_THRESHOLD should be positive');
    });

    it('should have SSE thresholds in correct order', () => {
      assert.ok(
        LIMITS.SSE.WARN_THRESHOLD < LIMITS.SSE.ERROR_THRESHOLD,
        'WARN_THRESHOLD should be less than ERROR_THRESHOLD'
      );
      assert.ok(
        LIMITS.SSE.ERROR_THRESHOLD < LIMITS.SSE.MAX_LISTENERS,
        'ERROR_THRESHOLD should be less than MAX_LISTENERS'
      );
    });

    it('should export DATABASE limits with valid values', () => {
      assert.ok(LIMITS.DATABASE.MAX_CONNECTIONS > 0, 'DATABASE.MAX_CONNECTIONS should be positive');
      assert.ok(LIMITS.DATABASE.MIN_CONNECTIONS >= 0, 'DATABASE.MIN_CONNECTIONS should be non-negative');
      assert.ok(
        LIMITS.DATABASE.MIN_CONNECTIONS <= LIMITS.DATABASE.MAX_CONNECTIONS,
        'MIN_CONNECTIONS should not exceed MAX_CONNECTIONS'
      );
    });

    it('should export IMPORT limits with positive values', () => {
      assert.ok(LIMITS.IMPORT.MAX_FILE_SIZE > 0, 'IMPORT.MAX_FILE_SIZE should be positive');
    });

    it('should export BATCH limits with positive values', () => {
      assert.ok(LIMITS.BATCH.CRDT_SIZE > 0, 'BATCH.CRDT_SIZE should be positive');
      assert.ok(LIMITS.BATCH.CONCURRENT_API_CALLS > 0, 'BATCH.CONCURRENT_API_CALLS should be positive');
    });

    it('should export EVICTION rate within valid range', () => {
      assert.ok(LIMITS.EVICTION.LRU_RATE >= 0.1, 'LRU_RATE should be at least 0.1');
      assert.ok(LIMITS.EVICTION.LRU_RATE <= 0.5, 'LRU_RATE should be at most 0.5');
    });

    it('should have reasonable default limit values', () => {
      // Default max listeners should be 1000
      assert.strictEqual(LIMITS.SSE.MAX_LISTENERS, 1000);
      // Default max connections should be 20
      assert.strictEqual(LIMITS.DATABASE.MAX_CONNECTIONS, 20);
      // Default max file size should be 10MB
      assert.strictEqual(LIMITS.IMPORT.MAX_FILE_SIZE, 10 * 1024 * 1024);
    });
  });

  describe('RETRY', () => {
    it('should export DEFAULT retry config with valid values', () => {
      assert.ok(RETRY.DEFAULT.MAX_ATTEMPTS > 0, 'MAX_ATTEMPTS should be positive');
      assert.ok(RETRY.DEFAULT.BASE_DELAY_MS > 0, 'BASE_DELAY_MS should be positive');
      assert.ok(RETRY.DEFAULT.MAX_DELAY_MS > 0, 'MAX_DELAY_MS should be positive');
      assert.ok(RETRY.DEFAULT.BACKOFF_MULTIPLIER > 1, 'BACKOFF_MULTIPLIER should be greater than 1');
      assert.ok(RETRY.DEFAULT.JITTER_FACTOR > 0, 'JITTER_FACTOR should be positive');
      assert.ok(RETRY.DEFAULT.JITTER_FACTOR <= 1, 'JITTER_FACTOR should be at most 1');
    });

    it('should have BASE_DELAY_MS less than or equal to MAX_DELAY_MS', () => {
      assert.ok(
        RETRY.DEFAULT.BASE_DELAY_MS <= RETRY.DEFAULT.MAX_DELAY_MS,
        'BASE_DELAY_MS should not exceed MAX_DELAY_MS'
      );
    });

    it('should export retry PROFILES with valid configurations', () => {
      const profiles = ['FAST', 'STANDARD', 'AGGRESSIVE', 'RATE_LIMIT', 'NETWORK'] as const;

      for (const profileName of profiles) {
        const profile = RETRY.PROFILES[profileName];
        assert.ok(profile.maxRetries > 0, `${profileName}.maxRetries should be positive`);
        assert.ok(profile.baseDelayMs > 0, `${profileName}.baseDelayMs should be positive`);
        assert.ok(profile.maxDelayMs > 0, `${profileName}.maxDelayMs should be positive`);
        assert.ok(profile.backoffMultiplier >= 1, `${profileName}.backoffMultiplier should be at least 1`);
        assert.strictEqual(typeof profile.useJitter, 'boolean', `${profileName}.useJitter should be boolean`);
        assert.ok(profile.jitterFactor > 0, `${profileName}.jitterFactor should be positive`);
      }
    });

    it('should have reasonable default retry values', () => {
      assert.strictEqual(RETRY.DEFAULT.MAX_ATTEMPTS, 3);
      assert.strictEqual(RETRY.DEFAULT.BASE_DELAY_MS, 1000);
      assert.strictEqual(RETRY.DEFAULT.MAX_DELAY_MS, 30000);
      assert.strictEqual(RETRY.DEFAULT.BACKOFF_MULTIPLIER, 2);
    });
  });

  describe('CIRCUIT_BREAKER', () => {
    it('should export DEFAULT circuit breaker config with valid values', () => {
      assert.ok(CIRCUIT_BREAKER.DEFAULT.FAILURE_THRESHOLD > 0, 'FAILURE_THRESHOLD should be positive');
      assert.ok(CIRCUIT_BREAKER.DEFAULT.SUCCESS_THRESHOLD > 0, 'SUCCESS_THRESHOLD should be positive');
      assert.ok(CIRCUIT_BREAKER.DEFAULT.HALF_OPEN_MAX_ATTEMPTS > 0, 'HALF_OPEN_MAX_ATTEMPTS should be positive');
      assert.ok(CIRCUIT_BREAKER.DEFAULT.RESET_TIMEOUT_MS > 0, 'RESET_TIMEOUT_MS should be positive');
    });

    it('should have reasonable default circuit breaker values', () => {
      assert.strictEqual(CIRCUIT_BREAKER.DEFAULT.FAILURE_THRESHOLD, 5);
      assert.strictEqual(CIRCUIT_BREAKER.DEFAULT.SUCCESS_THRESHOLD, 3);
      assert.strictEqual(CIRCUIT_BREAKER.DEFAULT.HALF_OPEN_MAX_ATTEMPTS, 3);
      assert.strictEqual(CIRCUIT_BREAKER.DEFAULT.RESET_TIMEOUT_MS, 30000);
    });
  });

  describe('RECOVERY_DELAYS', () => {
    it('should export recovery delays with positive values', () => {
      assert.ok(RECOVERY_DELAYS.RATE_LIMIT > 0, 'RATE_LIMIT should be positive');
      assert.ok(RECOVERY_DELAYS.NETWORK > 0, 'NETWORK should be positive');
      assert.ok(RECOVERY_DELAYS.SERVER > 0, 'SERVER should be positive');
      assert.ok(RECOVERY_DELAYS.CONFLICT > 0, 'CONFLICT should be positive');
      assert.ok(RECOVERY_DELAYS.UNKNOWN > 0, 'UNKNOWN should be positive');
    });

    it('should have rate limit delay as the longest', () => {
      assert.ok(
        RECOVERY_DELAYS.RATE_LIMIT >= RECOVERY_DELAYS.SERVER,
        'RATE_LIMIT delay should be at least as long as SERVER delay'
      );
      assert.ok(
        RECOVERY_DELAYS.RATE_LIMIT >= RECOVERY_DELAYS.NETWORK,
        'RATE_LIMIT delay should be at least as long as NETWORK delay'
      );
    });

    it('should have reasonable default recovery delay values', () => {
      assert.strictEqual(RECOVERY_DELAYS.RATE_LIMIT, 60000);
      assert.strictEqual(RECOVERY_DELAYS.NETWORK, 2000);
      assert.strictEqual(RECOVERY_DELAYS.SERVER, 5000);
      assert.strictEqual(RECOVERY_DELAYS.CONFLICT, 10000);
      assert.strictEqual(RECOVERY_DELAYS.UNKNOWN, 1000);
    });
  });

  describe('CONTEXT_RETRY', () => {
    it('should export CRDT retry config with valid values', () => {
      assert.ok(CONTEXT_RETRY.CRDT.MAX_DELAY_MS > 0, 'CRDT.MAX_DELAY_MS should be positive');
    });

    it('should export DB_HEALTH_CHECK retry config with valid values', () => {
      assert.ok(CONTEXT_RETRY.DB_HEALTH_CHECK.MAX_DELAY_MS > 0, 'DB_HEALTH_CHECK.MAX_DELAY_MS should be positive');
    });

    it('should export DB_CONNECTION retry config with valid values', () => {
      assert.ok(CONTEXT_RETRY.DB_CONNECTION.MAX_RETRIES > 0, 'DB_CONNECTION.MAX_RETRIES should be positive');
    });

    it('should have context-specific retries different from defaults for their use case', () => {
      // CRDT should have shorter max delay for real-time sync
      assert.ok(
        CONTEXT_RETRY.CRDT.MAX_DELAY_MS <= RETRY.DEFAULT.MAX_DELAY_MS,
        'CRDT max delay should be shorter than or equal to default'
      );
      // DB connections should have more retries than default
      assert.ok(
        CONTEXT_RETRY.DB_CONNECTION.MAX_RETRIES >= RETRY.DEFAULT.MAX_ATTEMPTS,
        'DB connection retries should be at least as many as default'
      );
    });
  });
});
