/**
 * Unit Tests for Claude OAuth Authentication
 *
 * Tests the token refresh flow, expiration checking, and credential validation.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  shouldRefreshClaudeToken,
  refreshClaudeToken,
  ensureValidToken,
  isClaudeAuthDb,
} from '../../src/auth/claudeAuth.js';
import type { ClaudeAuth, ClaudeAuthDb } from '../../src/auth/claudeAuth.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockClaudeAuth(overrides: Partial<ClaudeAuth> = {}): ClaudeAuth {
  return {
    accessToken: overrides.accessToken ?? 'test-access-token',
    refreshToken: overrides.refreshToken,
    expiresAt: overrides.expiresAt,
    scopes: overrides.scopes,
    subscriptionType: overrides.subscriptionType,
    rateLimitTier: overrides.rateLimitTier,
    source: overrides.source,
  };
}

function createMockClaudeAuthDb(overrides: Partial<ClaudeAuthDb> = {}): ClaudeAuthDb {
  return {
    accessToken: overrides.accessToken ?? 'test-access-token',
    refreshToken: overrides.refreshToken ?? 'test-refresh-token',
    expiresAt: overrides.expiresAt ?? Date.now() + 3600 * 1000, // 1 hour from now
    scopes: overrides.scopes,
    subscriptionType: overrides.subscriptionType,
    rateLimitTier: overrides.rateLimitTier,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Claude OAuth Authentication', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('isClaudeAuthDb', () => {
    it('should return true when refreshToken and expiresAt are present', () => {
      const auth = createMockClaudeAuthDb();

      assert.strictEqual(isClaudeAuthDb(auth), true);
    });

    it('should return false when refreshToken is missing', () => {
      const auth = createMockClaudeAuth({
        expiresAt: Date.now() + 3600 * 1000,
      });

      assert.strictEqual(isClaudeAuthDb(auth), false);
    });

    it('should return false when expiresAt is missing', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
      });

      assert.strictEqual(isClaudeAuthDb(auth), false);
    });

    it('should return false when both are missing', () => {
      const auth = createMockClaudeAuth();

      assert.strictEqual(isClaudeAuthDb(auth), false);
    });
  });

  describe('shouldRefreshClaudeToken', () => {
    it('should return false when expiresAt is not set', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), false);
    });

    it('should return false when token has more than 10 minutes until expiration', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), false);
    });

    it('should return true when token expires within 10 minutes', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should return true when token expires exactly at buffer time', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 10 * 60 * 1000, // Exactly 10 minutes from now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should return true when token is already expired', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() - 60 * 1000, // 1 minute ago
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should return true when token is about to expire (1 second)', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 1000, // 1 second from now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });
  });

  describe('refreshClaudeToken', () => {
    it('should throw when refreshToken is not available', async () => {
      const auth = createMockClaudeAuth(); // No refresh token

      await assert.rejects(
        () => refreshClaudeToken(auth),
        (error: Error) => {
          assert.ok(error.message.includes('no refresh token'));
          return true;
        }
      );
    });

    it('should refresh token successfully', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'old-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // Expires soon
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600, // 1 hour
          }),
        } as Response;
      };

      const refreshed = await refreshClaudeToken(auth);

      assert.strictEqual(refreshed.accessToken, 'new-access-token');
      assert.strictEqual(refreshed.refreshToken, 'new-refresh-token');
      assert.ok(refreshed.expiresAt! > Date.now() + 3500 * 1000); // ~1 hour from now
    });

    it('should preserve other auth properties after refresh', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'old-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000,
        scopes: ['read', 'write'],
        subscriptionType: 'pro',
        rateLimitTier: 'tier-1',
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        } as Response;
      };

      const refreshed = await refreshClaudeToken(auth);

      assert.deepStrictEqual(refreshed.scopes, ['read', 'write']);
      assert.strictEqual(refreshed.subscriptionType, 'pro');
      assert.strictEqual(refreshed.rateLimitTier, 'tier-1');
    });

    it('should throw on 401 Unauthorized response', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'invalid-refresh-token',
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: false,
          status: 401,
          text: async () => 'Invalid refresh token',
        } as Response;
      };

      await assert.rejects(
        () => refreshClaudeToken(auth),
        (error: Error) => {
          assert.ok(error.message.includes('401'));
          return true;
        }
      );
    });

    it('should throw on 400 Bad Request response', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'malformed-token',
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: false,
          status: 400,
          text: async () => 'Invalid grant',
        } as Response;
      };

      await assert.rejects(
        () => refreshClaudeToken(auth),
        (error: Error) => {
          assert.ok(error.message.includes('400'));
          return true;
        }
      );
    });

    it('should throw on 500 Server Error response', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'valid-refresh-token',
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        } as Response;
      };

      await assert.rejects(
        () => refreshClaudeToken(auth),
        (error: Error) => {
          assert.ok(error.message.includes('500'));
          return true;
        }
      );
    });

    it('should throw on network error', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'valid-refresh-token',
      });

      globalThis.fetch = async (): Promise<Response> => {
        throw new Error('Network error');
      };

      await assert.rejects(
        () => refreshClaudeToken(auth),
        (error: Error) => {
          assert.ok(error.message.includes('Network error'));
          return true;
        }
      );
    });

    it('should send correct request body', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
      });

      let capturedBody: unknown;

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        } as Response;
      };

      await refreshClaudeToken(auth);

      assert.ok(capturedBody);
      const body = capturedBody as { grant_type: string; refresh_token: string; client_id: string };
      assert.strictEqual(body.grant_type, 'refresh_token');
      assert.strictEqual(body.refresh_token, 'test-refresh-token');
      assert.ok(body.client_id); // Should have client_id
    });
  });

  describe('ensureValidToken', () => {
    it('should return original auth when token is still valid', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now (well beyond 10-min buffer)
      });

      const result = await ensureValidToken(auth);

      assert.strictEqual(result.accessToken, auth.accessToken);
      assert.strictEqual(result.refreshToken, auth.refreshToken);
      assert.strictEqual(result.expiresAt, auth.expiresAt);
    });

    it('should refresh when token is about to expire', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'old-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes (within 10-min buffer)
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        } as Response;
      };

      const result = await ensureValidToken(auth);

      assert.strictEqual(result.accessToken, 'new-access-token');
      assert.strictEqual(result.refreshToken, 'new-refresh-token');
    });

    it('should refresh when token is already expired', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'old-refresh-token',
        expiresAt: Date.now() - 60 * 1000, // Expired 1 minute ago
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
        } as Response;
      };

      const result = await ensureValidToken(auth);

      assert.strictEqual(result.accessToken, 'new-access-token');
    });

    it('should not refresh when expiresAt is not set', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        // No expiresAt
      });

      let fetchCalled = false;
      globalThis.fetch = async (): Promise<Response> => {
        fetchCalled = true;
        throw new Error('Should not be called');
      };

      const result = await ensureValidToken(auth);

      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(result.accessToken, auth.accessToken);
    });
  });

  describe('Concurrent Token Refresh', () => {
    it('should handle concurrent refresh attempts', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'shared-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000, // Expiring soon
      });

      let callCount = 0;

      globalThis.fetch = async (): Promise<Response> => {
        callCount++;
        // Simulate some delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `new-access-token-${callCount}`,
            refresh_token: `new-refresh-token-${callCount}`,
            expires_in: 3600,
          }),
        } as Response;
      };

      // Start multiple concurrent refreshes
      const [result1, result2, result3] = await Promise.all([
        ensureValidToken(auth),
        ensureValidToken(auth),
        ensureValidToken(auth),
      ]);

      // Each call makes its own refresh (no deduplication in current impl)
      assert.strictEqual(callCount, 3);

      // All should get valid (though potentially different) tokens
      assert.ok(result1.accessToken.startsWith('new-access-token'));
      assert.ok(result2.accessToken.startsWith('new-access-token'));
      assert.ok(result3.accessToken.startsWith('new-access-token'));
    });
  });

  describe('Token Expiration Edge Cases', () => {
    it('should handle expiresAt at exactly current time', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now(), // Exactly now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should handle expiresAt far in the future', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours from now
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), false);
    });

    it('should handle expiresAt far in the past', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() - 24 * 60 * 60 * 1000, // 24 hours ago
      });

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should handle expiresAt as 0', () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'test-refresh-token',
        expiresAt: 0, // Unix epoch
      });

      // Should be treated as expired
      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });
  });

  describe('Refresh Token Rotation', () => {
    it('should use new refresh token from response', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'original-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'rotated-refresh-token', // New refresh token
            expires_in: 3600,
          }),
        } as Response;
      };

      const refreshed = await refreshClaudeToken(auth);

      assert.strictEqual(refreshed.refreshToken, 'rotated-refresh-token');
      assert.notStrictEqual(refreshed.refreshToken, auth.refreshToken);
    });

    it('should handle missing refresh_token in response gracefully', async () => {
      const auth = createMockClaudeAuth({
        refreshToken: 'original-refresh-token',
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      globalThis.fetch = async (): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'new-access-token',
            // No refresh_token in response (some OAuth implementations do this)
            expires_in: 3600,
          }),
        } as Response;
      };

      const refreshed = await refreshClaudeToken(auth);

      // Should have new access token
      assert.strictEqual(refreshed.accessToken, 'new-access-token');
      // Refresh token should be undefined from response (spread behavior)
      assert.strictEqual(refreshed.refreshToken, undefined);
    });
  });
});
