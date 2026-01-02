/**
 * Unit Tests for Codex OAuth Authentication
 *
 * Tests the token expiration checking, credential validation, and error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CodexTokenExpiredError,
  shouldRefreshCodexToken,
  refreshCodexToken,
  ensureValidCodexToken,
  isCodexAuthExpired,
  hasCodexCredentials,
  isValidCodexAuth,
} from '../../src/auth/codexAuth.js';
import type { CodexAuth } from '../../src/auth/codexAuth.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockCodexAuth(overrides: Partial<CodexAuth> = {}): CodexAuth {
  return {
    apiKey: overrides.apiKey,
    accessToken: overrides.accessToken,
    refreshToken: overrides.refreshToken,
    expiresAt: overrides.expiresAt,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Codex OAuth Authentication', () => {

  describe('CodexTokenExpiredError', () => {
    it('should create error with correct properties', () => {
      const expiredAt = new Date('2024-01-01T00:00:00Z');
      const error = new CodexTokenExpiredError(expiredAt, false);

      assert.strictEqual(error.name, 'CodexTokenExpiredError');
      assert.strictEqual(error.expiredAt, expiredAt);
      assert.strictEqual(error.hasApiKeyFallback, false);
      assert.ok(error.message.includes('2024-01-01'));
      assert.ok(error.userMessage.includes('re-authenticate'));
    });

    it('should have different message when API key fallback is available', () => {
      const expiredAt = new Date('2024-01-01T00:00:00Z');
      const error = new CodexTokenExpiredError(expiredAt, true);

      assert.strictEqual(error.hasApiKeyFallback, true);
      assert.ok(error.userMessage.includes('API key authentication'));
    });

    it('should be instanceof Error and CodexTokenExpiredError', () => {
      const error = new CodexTokenExpiredError(new Date(), false);

      assert.ok(error instanceof Error);
      assert.ok(error instanceof CodexTokenExpiredError);
    });
  });

  describe('shouldRefreshCodexToken', () => {
    it('should return false when using API key authentication', () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000, // Expired
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), false);
    });

    it('should return false when token has more than 10 minutes until expiration', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), false);
    });

    it('should return true when token expires within 10 minutes', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), true);
    });

    it('should return true when token is already expired', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() - 60 * 1000, // 1 minute ago
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), true);
    });

    it('should return false when no accessToken present', () => {
      const auth = createMockCodexAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), false);
    });

    it('should return false when no expiresAt present', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      });

      assert.strictEqual(shouldRefreshCodexToken(auth), false);
    });
  });

  describe('refreshCodexToken', () => {
    it('should return auth unchanged when using API key', async () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
      });

      const result = await refreshCodexToken(auth);
      assert.strictEqual(result, auth);
    });

    it('should return auth unchanged when no refresh token present', async () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      const result = await refreshCodexToken(auth);
      assert.strictEqual(result, auth);
    });

    it('should throw CodexTokenExpiredError when token is expired', async () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      await assert.rejects(
        async () => refreshCodexToken(auth),
        (error: Error) => {
          assert.ok(error instanceof CodexTokenExpiredError);
          assert.strictEqual((error as CodexTokenExpiredError).hasApiKeyFallback, false);
          return true;
        }
      );
    });

    it('should return auth when token is expiring soon but not expired', async () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
      });

      const result = await refreshCodexToken(auth);
      assert.strictEqual(result, auth);
    });
  });

  describe('ensureValidCodexToken', () => {
    it('should return auth unchanged when using API key', async () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
      });

      const result = await ensureValidCodexToken(auth);
      assert.strictEqual(result, auth);
    });

    it('should throw CodexTokenExpiredError when token is expired', async () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      await assert.rejects(
        async () => ensureValidCodexToken(auth),
        (error: Error) => {
          assert.ok(error instanceof CodexTokenExpiredError);
          return true;
        }
      );
    });

    it('should return auth when token is still valid', async () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
      });

      const result = await ensureValidCodexToken(auth);
      assert.strictEqual(result, auth);
    });
  });

  describe('isCodexAuthExpired', () => {
    it('should return false for null/undefined', () => {
      assert.strictEqual(isCodexAuthExpired(null), false);
      assert.strictEqual(isCodexAuthExpired(undefined), false);
    });

    it('should return false when using API key', () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      assert.strictEqual(isCodexAuthExpired(auth), false);
    });

    it('should return false when token is still valid', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
      });

      assert.strictEqual(isCodexAuthExpired(auth), false);
    });

    it('should return true when token is expired', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      assert.strictEqual(isCodexAuthExpired(auth), true);
    });

    it('should return false when no expiresAt present', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
      });

      assert.strictEqual(isCodexAuthExpired(auth), false);
    });
  });

  describe('hasCodexCredentials', () => {
    it('should return false for null/undefined', () => {
      assert.strictEqual(hasCodexCredentials(null), false);
      assert.strictEqual(hasCodexCredentials(undefined), false);
    });

    it('should return true when API key present', () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
      });

      assert.strictEqual(hasCodexCredentials(auth), true);
    });

    it('should return true when access token present (even if expired)', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      assert.strictEqual(hasCodexCredentials(auth), true);
    });

    it('should return false when empty API key', () => {
      const auth = createMockCodexAuth({
        apiKey: '',
      });

      assert.strictEqual(hasCodexCredentials(auth), false);
    });

    it('should return false when empty access token', () => {
      const auth = createMockCodexAuth({
        accessToken: '',
      });

      assert.strictEqual(hasCodexCredentials(auth), false);
    });

    it('should return false when no credentials present', () => {
      const auth = createMockCodexAuth({});

      assert.strictEqual(hasCodexCredentials(auth), false);
    });
  });

  describe('isValidCodexAuth', () => {
    it('should return false for null/undefined', () => {
      assert.strictEqual(isValidCodexAuth(null), false);
      assert.strictEqual(isValidCodexAuth(undefined), false);
    });

    it('should return true when API key present', () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
      });

      assert.strictEqual(isValidCodexAuth(auth), true);
    });

    it('should return true when access token is valid and not expired', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
      });

      assert.strictEqual(isValidCodexAuth(auth), true);
    });

    it('should return false when access token is expired', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
        expiresAt: Date.now() - 60 * 1000, // Expired
      });

      assert.strictEqual(isValidCodexAuth(auth), false);
    });

    it('should return true when access token present without expiresAt', () => {
      const auth = createMockCodexAuth({
        accessToken: 'test-access-token',
      });

      assert.strictEqual(isValidCodexAuth(auth), true);
    });

    it('should return false when empty API key and no access token', () => {
      const auth = createMockCodexAuth({
        apiKey: '',
      });

      assert.strictEqual(isValidCodexAuth(auth), false);
    });

    it('should prioritize API key over expired OAuth token', () => {
      const auth = createMockCodexAuth({
        apiKey: 'sk-test-api-key',
        accessToken: 'expired-token',
        expiresAt: Date.now() - 60 * 1000, // Expired OAuth
      });

      // Should be valid because API key is present
      assert.strictEqual(isValidCodexAuth(auth), true);
    });
  });
});
