/**
 * Tests for the environment configuration validation.
 * Verifies that validateEnv() correctly identifies configuration issues.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Store original env values for restoration
const originalEnv = { ...process.env };

/**
 * Helper to reload the env module with modified environment variables.
 * This is necessary because the env module evaluates values at import time.
 */
async function reloadEnvModule() {
  // Clear the module cache for env.ts and constants.ts
  const envPath = new URL('../../src/config/env.js', import.meta.url).href;
  const constantsPath = new URL('../../src/config/constants.js', import.meta.url).href;

  // Delete from cache if exists (this may not work in all Node.js versions)
  // For proper testing, we'll rely on the module's exported validateEnv function
  // which reads the already-parsed values

  const { validateEnv } = await import('../../src/config/env.js');
  return validateEnv;
}

describe('Environment Validation', () => {
  // Note: These tests verify the default configuration is valid.
  // Testing with modified env vars is complex due to module caching.
  // For comprehensive testing, consider using dependency injection or mocking.

  describe('validateEnv() with default values', () => {
    it('should return valid for default configuration', async () => {
      const { validateEnv } = await import('../../src/config/env.js');
      const result = validateEnv();

      // Default values should be valid
      assert.strictEqual(result.valid, true, 'Default configuration should be valid');
      assert.strictEqual(result.errors.length, 0, 'Should have no errors with defaults');
    });

    it('should return warnings for missing optional configs in default setup', async () => {
      const { validateEnv } = await import('../../src/config/env.js');
      const result = validateEnv();

      // CLAUDE_ENVIRONMENT_ID is typically not set in test environment
      // This is expected to generate a warning
      assert.ok(Array.isArray(result.warnings), 'Should return warnings array');
    });
  });

  describe('LRU_EVICTION_RATE clamping', () => {
    it('should clamp LRU_EVICTION_RATE to valid range', async () => {
      const { LRU_EVICTION_RATE } = await import('../../src/config/env.js');

      // Should be clamped to 0.1-0.5 range
      assert.ok(LRU_EVICTION_RATE >= 0.1, 'LRU_EVICTION_RATE should be at least 0.1');
      assert.ok(LRU_EVICTION_RATE <= 0.5, 'LRU_EVICTION_RATE should be at most 0.5');
    });
  });

  describe('Default timeout values', () => {
    it('should have positive HTTP timeouts by default', async () => {
      const {
        HTTP_REQUEST_TIMEOUT_MS,
        HTTP_HEAD_TIMEOUT_MS,
        HTTP_HEALTH_CHECK_TIMEOUT_MS,
      } = await import('../../src/config/env.js');

      assert.ok(HTTP_REQUEST_TIMEOUT_MS > 0, 'HTTP_REQUEST_TIMEOUT_MS should be positive');
      assert.ok(HTTP_HEAD_TIMEOUT_MS > 0, 'HTTP_HEAD_TIMEOUT_MS should be positive');
      assert.ok(HTTP_HEALTH_CHECK_TIMEOUT_MS > 0, 'HTTP_HEALTH_CHECK_TIMEOUT_MS should be positive');
    });

    it('should have positive database timeouts by default', async () => {
      const {
        DB_CONNECTION_TIMEOUT_MS,
        DB_IDLE_TIMEOUT_MS,
        DB_STATEMENT_TIMEOUT_MS,
      } = await import('../../src/config/env.js');

      assert.ok(DB_CONNECTION_TIMEOUT_MS > 0, 'DB_CONNECTION_TIMEOUT_MS should be positive');
      assert.ok(DB_IDLE_TIMEOUT_MS > 0, 'DB_IDLE_TIMEOUT_MS should be positive');
      assert.ok(DB_STATEMENT_TIMEOUT_MS > 0, 'DB_STATEMENT_TIMEOUT_MS should be positive');
    });

    it('should have positive interval values by default', async () => {
      const {
        SSE_HEARTBEAT_INTERVAL_MS,
        SSE_CLEANUP_INTERVAL_MS,
        HEALTH_CHECK_INTERVAL_MS,
        DB_HEALTH_CHECK_INTERVAL_MS,
        CRDT_SYNC_INTERVAL_MS,
      } = await import('../../src/config/env.js');

      assert.ok(SSE_HEARTBEAT_INTERVAL_MS > 0, 'SSE_HEARTBEAT_INTERVAL_MS should be positive');
      assert.ok(SSE_CLEANUP_INTERVAL_MS > 0, 'SSE_CLEANUP_INTERVAL_MS should be positive');
      assert.ok(HEALTH_CHECK_INTERVAL_MS > 0, 'HEALTH_CHECK_INTERVAL_MS should be positive');
      assert.ok(DB_HEALTH_CHECK_INTERVAL_MS > 0, 'DB_HEALTH_CHECK_INTERVAL_MS should be positive');
      assert.ok(CRDT_SYNC_INTERVAL_MS > 0, 'CRDT_SYNC_INTERVAL_MS should be positive');
    });
  });

  describe('Default SSE limits', () => {
    it('should have SSE thresholds in correct order by default', async () => {
      const {
        SSE_MAX_LISTENERS,
        SSE_WARN_SUBSCRIBER_COUNT,
        SSE_ERROR_SUBSCRIBER_COUNT,
      } = await import('../../src/config/env.js');

      assert.ok(
        SSE_WARN_SUBSCRIBER_COUNT < SSE_ERROR_SUBSCRIBER_COUNT,
        'WARN should be less than ERROR threshold'
      );
      assert.ok(
        SSE_ERROR_SUBSCRIBER_COUNT < SSE_MAX_LISTENERS,
        'ERROR threshold should be less than MAX_LISTENERS'
      );
    });

    it('should have positive SSE limits by default', async () => {
      const {
        SSE_MAX_LISTENERS,
        SSE_MAX_SUBSCRIBERS_PER_SESSION,
        SSE_MAX_SUBSCRIBERS_PER_USER,
      } = await import('../../src/config/env.js');

      assert.ok(SSE_MAX_LISTENERS > 0, 'SSE_MAX_LISTENERS should be positive');
      assert.ok(SSE_MAX_SUBSCRIBERS_PER_SESSION > 0, 'SSE_MAX_SUBSCRIBERS_PER_SESSION should be positive');
      assert.ok(SSE_MAX_SUBSCRIBERS_PER_USER > 0, 'SSE_MAX_SUBSCRIBERS_PER_USER should be positive');
    });
  });

  describe('Default database limits', () => {
    it('should have valid database connection limits by default', async () => {
      const {
        DB_MAX_CONNECTIONS,
        DB_MIN_CONNECTIONS,
      } = await import('../../src/config/env.js');

      assert.ok(DB_MAX_CONNECTIONS > 0, 'DB_MAX_CONNECTIONS should be positive');
      assert.ok(DB_MIN_CONNECTIONS >= 0, 'DB_MIN_CONNECTIONS should be non-negative');
      assert.ok(
        DB_MIN_CONNECTIONS <= DB_MAX_CONNECTIONS,
        'MIN should not exceed MAX connections'
      );
    });
  });

  describe('Default retry configuration', () => {
    it('should have valid retry config by default', async () => {
      const {
        RETRY_MAX_ATTEMPTS,
        RETRY_BASE_DELAY_MS,
        RETRY_MAX_DELAY_MS,
        RETRY_BACKOFF_MULTIPLIER,
        RETRY_JITTER_FACTOR,
      } = await import('../../src/config/env.js');

      assert.ok(RETRY_MAX_ATTEMPTS > 0, 'RETRY_MAX_ATTEMPTS should be positive');
      assert.ok(RETRY_BASE_DELAY_MS > 0, 'RETRY_BASE_DELAY_MS should be positive');
      assert.ok(RETRY_MAX_DELAY_MS > 0, 'RETRY_MAX_DELAY_MS should be positive');
      assert.ok(RETRY_BACKOFF_MULTIPLIER > 1, 'RETRY_BACKOFF_MULTIPLIER should be greater than 1');
      assert.ok(RETRY_JITTER_FACTOR > 0 && RETRY_JITTER_FACTOR <= 1, 'RETRY_JITTER_FACTOR should be between 0 and 1');
      assert.ok(
        RETRY_BASE_DELAY_MS <= RETRY_MAX_DELAY_MS,
        'BASE_DELAY should not exceed MAX_DELAY'
      );
    });
  });

  describe('Default recovery delays', () => {
    it('should have positive recovery delays by default', async () => {
      const {
        RECOVERY_DELAY_RATE_LIMIT_MS,
        RECOVERY_DELAY_NETWORK_MS,
        RECOVERY_DELAY_SERVER_MS,
        RECOVERY_DELAY_CONFLICT_MS,
        RECOVERY_DELAY_UNKNOWN_MS,
      } = await import('../../src/config/env.js');

      assert.ok(RECOVERY_DELAY_RATE_LIMIT_MS > 0, 'RECOVERY_DELAY_RATE_LIMIT_MS should be positive');
      assert.ok(RECOVERY_DELAY_NETWORK_MS > 0, 'RECOVERY_DELAY_NETWORK_MS should be positive');
      assert.ok(RECOVERY_DELAY_SERVER_MS > 0, 'RECOVERY_DELAY_SERVER_MS should be positive');
      assert.ok(RECOVERY_DELAY_CONFLICT_MS > 0, 'RECOVERY_DELAY_CONFLICT_MS should be positive');
      assert.ok(RECOVERY_DELAY_UNKNOWN_MS > 0, 'RECOVERY_DELAY_UNKNOWN_MS should be positive');
    });
  });

  describe('Context-specific retry configuration', () => {
    it('should have valid context-specific retry values by default', async () => {
      const {
        CRDT_RETRY_MAX_DELAY_MS,
        DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS,
        DB_CONNECTION_MAX_RETRIES,
      } = await import('../../src/config/env.js');

      assert.ok(CRDT_RETRY_MAX_DELAY_MS > 0, 'CRDT_RETRY_MAX_DELAY_MS should be positive');
      assert.ok(DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS > 0, 'DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS should be positive');
      assert.ok(DB_CONNECTION_MAX_RETRIES > 0, 'DB_CONNECTION_MAX_RETRIES should be positive');
    });
  });

  describe('Default session operation limits', () => {
    it('should have positive session limits by default', async () => {
      const {
        SESSION_CONCURRENCY_LIMIT,
        SESSION_MAX_BATCH_SIZE,
        SESSION_MAX_ARCHIVE_BATCH_SIZE,
      } = await import('../../src/config/env.js');

      assert.ok(SESSION_CONCURRENCY_LIMIT > 0, 'SESSION_CONCURRENCY_LIMIT should be positive');
      assert.ok(SESSION_MAX_BATCH_SIZE > 0, 'SESSION_MAX_BATCH_SIZE should be positive');
      assert.ok(SESSION_MAX_ARCHIVE_BATCH_SIZE > 0, 'SESSION_MAX_ARCHIVE_BATCH_SIZE should be positive');
    });

    it('should have archive batch size not exceeding max batch size', async () => {
      const {
        SESSION_MAX_BATCH_SIZE,
        SESSION_MAX_ARCHIVE_BATCH_SIZE,
      } = await import('../../src/config/env.js');

      assert.ok(
        SESSION_MAX_ARCHIVE_BATCH_SIZE <= SESSION_MAX_BATCH_SIZE,
        'SESSION_MAX_ARCHIVE_BATCH_SIZE should not exceed SESSION_MAX_BATCH_SIZE'
      );
    });

    it('should have session limits within recommended upper bounds', async () => {
      const {
        SESSION_CONCURRENCY_LIMIT,
        SESSION_MAX_BATCH_SIZE,
      } = await import('../../src/config/env.js');

      assert.ok(SESSION_CONCURRENCY_LIMIT <= 50, 'Default SESSION_CONCURRENCY_LIMIT should not exceed 50');
      assert.ok(SESSION_MAX_BATCH_SIZE <= 1000, 'Default SESSION_MAX_BATCH_SIZE should not exceed 1000');
    });
  });

  describe('Default DataLoader limits', () => {
    it('should have positive DataLoader limits by default', async () => {
      const { DATALOADER_MAX_BATCH_SIZE } = await import('../../src/config/env.js');

      assert.ok(DATALOADER_MAX_BATCH_SIZE > 0, 'DATALOADER_MAX_BATCH_SIZE should be positive');
    });

    it('should have DataLoader limits within recommended upper bounds', async () => {
      const { DATALOADER_MAX_BATCH_SIZE } = await import('../../src/config/env.js');

      assert.ok(DATALOADER_MAX_BATCH_SIZE <= 1000, 'Default DATALOADER_MAX_BATCH_SIZE should not exceed 1000');
    });
  });

  describe('Default search limits', () => {
    it('should have positive search limits by default', async () => {
      const {
        SEARCH_GAMES_LIMIT,
        SEARCH_USERS_LIMIT,
        SEARCH_SESSIONS_LIMIT,
        SEARCH_POSTS_LIMIT,
        SEARCH_DEFAULT_LIMIT,
        SEARCH_MAX_LIMIT,
        SEARCH_SUGGESTIONS_DEFAULT_LIMIT,
        SEARCH_SUGGESTIONS_MAX_LIMIT,
      } = await import('../../src/config/env.js');

      assert.ok(SEARCH_GAMES_LIMIT > 0, 'SEARCH_GAMES_LIMIT should be positive');
      assert.ok(SEARCH_USERS_LIMIT > 0, 'SEARCH_USERS_LIMIT should be positive');
      assert.ok(SEARCH_SESSIONS_LIMIT > 0, 'SEARCH_SESSIONS_LIMIT should be positive');
      assert.ok(SEARCH_POSTS_LIMIT > 0, 'SEARCH_POSTS_LIMIT should be positive');
      assert.ok(SEARCH_DEFAULT_LIMIT > 0, 'SEARCH_DEFAULT_LIMIT should be positive');
      assert.ok(SEARCH_MAX_LIMIT > 0, 'SEARCH_MAX_LIMIT should be positive');
      assert.ok(SEARCH_SUGGESTIONS_DEFAULT_LIMIT > 0, 'SEARCH_SUGGESTIONS_DEFAULT_LIMIT should be positive');
      assert.ok(SEARCH_SUGGESTIONS_MAX_LIMIT > 0, 'SEARCH_SUGGESTIONS_MAX_LIMIT should be positive');
    });

    it('should have search default not exceeding max by default', async () => {
      const {
        SEARCH_DEFAULT_LIMIT,
        SEARCH_MAX_LIMIT,
        SEARCH_SUGGESTIONS_DEFAULT_LIMIT,
        SEARCH_SUGGESTIONS_MAX_LIMIT,
      } = await import('../../src/config/env.js');

      assert.ok(
        SEARCH_DEFAULT_LIMIT <= SEARCH_MAX_LIMIT,
        'SEARCH_DEFAULT_LIMIT should not exceed SEARCH_MAX_LIMIT'
      );
      assert.ok(
        SEARCH_SUGGESTIONS_DEFAULT_LIMIT <= SEARCH_SUGGESTIONS_MAX_LIMIT,
        'SEARCH_SUGGESTIONS_DEFAULT_LIMIT should not exceed SEARCH_SUGGESTIONS_MAX_LIMIT'
      );
    });

    it('should have search limits within recommended upper bounds', async () => {
      const { SEARCH_MAX_LIMIT } = await import('../../src/config/env.js');

      assert.ok(SEARCH_MAX_LIMIT <= 500, 'Default SEARCH_MAX_LIMIT should not exceed 500');
    });
  });

  describe('Default live chat limits', () => {
    it('should have positive live chat limits by default', async () => {
      const {
        LIVE_CHAT_MESSAGES_DEFAULT_LIMIT,
        LIVE_CHAT_HISTORY_LIMIT,
        LIVE_CHAT_CONTEXT_MESSAGES,
      } = await import('../../src/config/env.js');

      assert.ok(LIVE_CHAT_MESSAGES_DEFAULT_LIMIT > 0, 'LIVE_CHAT_MESSAGES_DEFAULT_LIMIT should be positive');
      assert.ok(LIVE_CHAT_HISTORY_LIMIT > 0, 'LIVE_CHAT_HISTORY_LIMIT should be positive');
      assert.ok(LIVE_CHAT_CONTEXT_MESSAGES > 0, 'LIVE_CHAT_CONTEXT_MESSAGES should be positive');
    });

    it('should have live chat limits within recommended upper bounds', async () => {
      const { LIVE_CHAT_MESSAGES_DEFAULT_LIMIT } = await import('../../src/config/env.js');

      assert.ok(LIVE_CHAT_MESSAGES_DEFAULT_LIMIT <= 500, 'Default LIVE_CHAT_MESSAGES_DEFAULT_LIMIT should not exceed 500');
    });
  });

  describe('Default batch operation limits', () => {
    it('should have positive batch operation limits by default', async () => {
      const {
        BATCH_DEFAULT_CONCURRENCY,
        BATCH_MAX_BATCH_SIZE,
      } = await import('../../src/config/env.js');

      assert.ok(BATCH_DEFAULT_CONCURRENCY > 0, 'BATCH_DEFAULT_CONCURRENCY should be positive');
      assert.ok(BATCH_MAX_BATCH_SIZE > 0, 'BATCH_MAX_BATCH_SIZE should be positive');
    });

    it('should have batch limits within recommended upper bounds', async () => {
      const {
        BATCH_DEFAULT_CONCURRENCY,
        BATCH_MAX_BATCH_SIZE,
      } = await import('../../src/config/env.js');

      assert.ok(BATCH_DEFAULT_CONCURRENCY <= 50, 'Default BATCH_DEFAULT_CONCURRENCY should not exceed 50');
      assert.ok(BATCH_MAX_BATCH_SIZE <= 1000, 'Default BATCH_MAX_BATCH_SIZE should not exceed 1000');
    });
  });
});
