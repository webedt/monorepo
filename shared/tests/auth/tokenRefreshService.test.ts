/**
 * Tests for the TokenRefreshService module.
 * Tests token refresh logic and edge cases for both Claude and Gemini tokens.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  shouldRefreshClaudeToken,
  ensureValidToken,
} from '../../src/auth/claudeAuth.js';
import {
  shouldRefreshGeminiToken,
  ensureValidGeminiToken,
} from '../../src/auth/geminiAuth.js';

import type { ClaudeAuth } from '../../src/auth/claudeAuth.js';
import type { GeminiAuth } from '../../src/auth/lucia.js';

// Token refresh buffer time (10 minutes in milliseconds)
const TOKEN_BUFFER_TIME = 10 * 60 * 1000;

describe('Token Refresh Service', () => {
  describe('Claude Token Refresh', () => {
    describe('shouldRefreshClaudeToken', () => {
      it('should return false when token has no expiresAt', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), false);
      });

      it('should return false when token is still valid (more than 10 min remaining)', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), false);
      });

      it('should return true when token expires within 10 minutes', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), true);
      });

      it('should return true when token is already expired', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), true);
      });

      it('should return true when token expires exactly at buffer time', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + TOKEN_BUFFER_TIME, // Exactly at buffer boundary
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), true);
      });

      it('should return false when token expires just over buffer time', () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + TOKEN_BUFFER_TIME + 1000, // 1 second over buffer
        };

        assert.strictEqual(shouldRefreshClaudeToken(auth), false);
      });
    });

    describe('ensureValidToken', () => {
      it('should return same auth when token is still valid', async () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
        };

        const result = await ensureValidToken(auth);

        assert.strictEqual(result.accessToken, 'test-token');
      });

      it('should throw error when refresh is needed but no refresh token', async () => {
        const auth: ClaudeAuth = {
          accessToken: 'test-token',
          // No refresh token
          expiresAt: Date.now() + 5 * 60 * 1000, // Needs refresh (5 min remaining)
        };

        await assert.rejects(
          async () => ensureValidToken(auth),
          /Cannot refresh token: no refresh token available/
        );
      });
    });
  });

  describe('Gemini Token Refresh', () => {
    describe('shouldRefreshGeminiToken', () => {
      it('should return false when token is still valid (more than 10 min remaining)', () => {
        const auth: GeminiAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes from now
          tokenType: 'Bearer',
        };

        assert.strictEqual(shouldRefreshGeminiToken(auth), false);
      });

      it('should return true when token expires within 10 minutes', () => {
        const auth: GeminiAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
          tokenType: 'Bearer',
        };

        assert.strictEqual(shouldRefreshGeminiToken(auth), true);
      });

      it('should return true when token is already expired', () => {
        const auth: GeminiAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
          tokenType: 'Bearer',
        };

        assert.strictEqual(shouldRefreshGeminiToken(auth), true);
      });

      it('should return true when token expires exactly at buffer time', () => {
        const auth: GeminiAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + TOKEN_BUFFER_TIME, // Exactly at buffer boundary
          tokenType: 'Bearer',
        };

        assert.strictEqual(shouldRefreshGeminiToken(auth), true);
      });
    });

    describe('ensureValidGeminiToken', () => {
      it('should return same auth when token is still valid', async () => {
        const auth: GeminiAuth = {
          accessToken: 'test-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
          tokenType: 'Bearer',
        };

        const result = await ensureValidGeminiToken(auth);

        assert.strictEqual(result.accessToken, 'test-token');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle token expiry at Unix epoch edge case', () => {
      const auth: ClaudeAuth = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: 0, // Unix epoch - definitely expired
      };

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });

    it('should handle very large future expiry times', () => {
      const auth: ClaudeAuth = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
      };

      assert.strictEqual(shouldRefreshClaudeToken(auth), false);
    });

    it('should handle negative expiry times', () => {
      const auth: ClaudeAuth = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: -1000, // Negative timestamp (before Unix epoch)
      };

      assert.strictEqual(shouldRefreshClaudeToken(auth), true);
    });
  });
});
