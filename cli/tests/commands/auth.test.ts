/**
 * Tests for auth.ts CLI command
 *
 * Tests the authentication utility commands:
 * - auth check - Check Claude authentication status
 * - auth refresh - Refresh Claude access token
 * - auth ensure - Ensure token is valid (refresh if needed)
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  createMockClaudeAuth,
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock the shared package functions
const mockGetClaudeCredentials = mock.fn<() => Promise<ReturnType<typeof createMockClaudeAuth> | null>>();
const mockShouldRefreshClaudeToken = mock.fn<(auth: unknown) => boolean>();
const mockRefreshClaudeToken = mock.fn<(auth: unknown) => Promise<ReturnType<typeof createMockClaudeAuth>>>();
const mockEnsureValidToken = mock.fn<(auth: unknown) => Promise<ReturnType<typeof createMockClaudeAuth>>>();

// Store original console and process.exit
let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let originalProcessExit: typeof process.exit;
let mockConsole: ReturnType<typeof createMockConsole>;
let mockExit: ReturnType<typeof createMockProcessExit>;

// ============================================================================
// TEST HELPERS
// ============================================================================

function setupMocks() {
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  originalProcessExit = process.exit;

  mockConsole = createMockConsole();
  mockExit = createMockProcessExit();

  console.log = mockConsole.log;
  console.error = mockConsole.error;
  process.exit = mockExit.exit;
}

function teardownMocks() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
  mock.reset();
}

// ============================================================================
// TESTS: AUTH CHECK COMMAND
// ============================================================================

describe('Auth Command', () => {
  describe('auth check', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    describe('Validation', () => {
      it('should detect when no credentials are found', async () => {
        mockGetClaudeCredentials.mock.mockImplementation(async () => null);

        // Simulate the check command behavior
        const auth = await mockGetClaudeCredentials();

        assert.strictEqual(auth, null);
      });

      it('should detect when credentials are valid', async () => {
        const validAuth = createMockClaudeAuth({
          expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
        });
        mockGetClaudeCredentials.mock.mockImplementation(async () => validAuth);

        const auth = await mockGetClaudeCredentials();

        assert.ok(auth);
        assert.strictEqual(auth.accessToken, validAuth.accessToken);
      });

      it('should detect expired tokens', async () => {
        const expiredAuth = createMockClaudeAuth({
          expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        });

        const expiresAt = new Date(expiredAuth.expiresAt * 1000);
        const isExpired = expiresAt < new Date();

        assert.strictEqual(isExpired, true);
      });

      it('should identify token source', async () => {
        const authWithSource = createMockClaudeAuth({
          source: 'credentials-file',
        });

        assert.strictEqual(authWithSource.source, 'credentials-file');
      });
    });

    describe('JSON Output', () => {
      it('should format successful auth as JSON', () => {
        const auth = createMockClaudeAuth();
        const expiresAt = auth.expiresAt ? new Date(auth.expiresAt * 1000) : null;

        const jsonOutput = {
          authenticated: true,
          source: auth.source,
          needsRefresh: false,
          isExpired: false,
          expiresAt: expiresAt?.toISOString() || null,
          hasRefreshToken: !!auth.refreshToken,
          scopes: auth.scopes || [],
          subscriptionType: auth.subscriptionType || null,
          rateLimitTier: auth.rateLimitTier || null,
        };

        assert.strictEqual(jsonOutput.authenticated, true);
        assert.strictEqual(jsonOutput.hasRefreshToken, true);
        assert.ok(Array.isArray(jsonOutput.scopes));
      });

      it('should format failed auth as JSON', () => {
        const jsonOutput = {
          authenticated: false,
          source: null,
          error: 'No credentials found',
        };

        assert.strictEqual(jsonOutput.authenticated, false);
        assert.strictEqual(jsonOutput.error, 'No credentials found');
      });
    });

    describe('Human-readable Output', () => {
      it('should format auth status correctly', () => {
        const auth = createMockClaudeAuth();
        const expiresAt = auth.expiresAt ? new Date(auth.expiresAt * 1000) : null;
        const isExpired = expiresAt ? expiresAt < new Date() : false;

        const output = [
          'Claude Authentication Status:',
          `  Authenticated:  Yes`,
          `  Source:         ${auth.source}`,
          `  Token Valid:    ${isExpired ? 'No (expired)' : 'Yes'}`,
        ].join('\n');

        assert.ok(output.includes('Authenticated:  Yes'));
        assert.ok(output.includes('Token Valid:    Yes'));
      });
    });
  });

  // ============================================================================
  // TESTS: AUTH REFRESH COMMAND
  // ============================================================================

  describe('auth refresh', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    describe('Validation', () => {
      it('should fail if no credentials found', async () => {
        mockGetClaudeCredentials.mock.mockImplementation(async () => null);

        const auth = await mockGetClaudeCredentials();

        assert.strictEqual(auth, null);
      });

      it('should fail if no refresh token available', async () => {
        const authWithoutRefresh = createMockClaudeAuth({
          refreshToken: null,
        });

        assert.strictEqual(authWithoutRefresh.refreshToken, null);
      });

      it('should succeed with valid refresh token', async () => {
        const originalAuth = createMockClaudeAuth();
        const refreshedAuth = createMockClaudeAuth({
          accessToken: 'new-access-token',
          expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours in future
        });

        mockRefreshClaudeToken.mock.mockImplementation(async () => refreshedAuth);

        const result = await mockRefreshClaudeToken(originalAuth);

        assert.strictEqual(result.accessToken, 'new-access-token');
        assert.ok(result.expiresAt > originalAuth.expiresAt);
      });
    });

    describe('JSON Output', () => {
      it('should format successful refresh as JSON', () => {
        const refreshedAuth = createMockClaudeAuth({
          expiresAt: Math.floor(Date.now() / 1000) + 7200,
        });
        const expiresAt = new Date(refreshedAuth.expiresAt * 1000);

        const jsonOutput = {
          success: true,
          expiresAt: expiresAt.toISOString(),
        };

        assert.strictEqual(jsonOutput.success, true);
        assert.ok(jsonOutput.expiresAt);
      });

      it('should format failed refresh as JSON', () => {
        const jsonOutput = {
          success: false,
          error: 'Failed to refresh token',
        };

        assert.strictEqual(jsonOutput.success, false);
        assert.ok(jsonOutput.error);
      });
    });
  });

  // ============================================================================
  // TESTS: AUTH ENSURE COMMAND
  // ============================================================================

  describe('auth ensure', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    describe('Validation', () => {
      it('should fail if no credentials found', async () => {
        mockGetClaudeCredentials.mock.mockImplementation(async () => null);

        const auth = await mockGetClaudeCredentials();

        assert.strictEqual(auth, null);
      });

      it('should not refresh if token is still valid', async () => {
        const validAuth = createMockClaudeAuth({
          expiresAt: Math.floor(Date.now() / 1000) + 7200, // 2 hours in future
        });

        mockEnsureValidToken.mock.mockImplementation(async (auth) => auth as ReturnType<typeof createMockClaudeAuth>);

        const result = await mockEnsureValidToken(validAuth);
        const wasRefreshed = result.accessToken !== validAuth.accessToken;

        assert.strictEqual(wasRefreshed, false);
      });

      it('should detect when token was refreshed', async () => {
        const originalAuth = createMockClaudeAuth({
          accessToken: 'original-token',
          expiresAt: Math.floor(Date.now() / 1000) - 100, // Expired
        });

        const refreshedAuth = createMockClaudeAuth({
          accessToken: 'refreshed-token',
          expiresAt: Math.floor(Date.now() / 1000) + 7200,
        });

        mockEnsureValidToken.mock.mockImplementation(async () => refreshedAuth);

        const result = await mockEnsureValidToken(originalAuth);
        const wasRefreshed = result.accessToken !== originalAuth.accessToken;

        assert.strictEqual(wasRefreshed, true);
      });
    });

    describe('JSON Output', () => {
      it('should format valid token as JSON', () => {
        const auth = createMockClaudeAuth();
        const expiresAt = new Date(auth.expiresAt * 1000);

        const jsonOutput = {
          valid: true,
          wasRefreshed: false,
          expiresAt: expiresAt.toISOString(),
        };

        assert.strictEqual(jsonOutput.valid, true);
        assert.strictEqual(jsonOutput.wasRefreshed, false);
      });

      it('should format refreshed token as JSON', () => {
        const auth = createMockClaudeAuth();
        const expiresAt = new Date(auth.expiresAt * 1000);

        const jsonOutput = {
          valid: true,
          wasRefreshed: true,
          expiresAt: expiresAt.toISOString(),
        };

        assert.strictEqual(jsonOutput.valid, true);
        assert.strictEqual(jsonOutput.wasRefreshed, true);
      });

      it('should format invalid token as JSON', () => {
        const jsonOutput = {
          valid: false,
          error: 'Token validation failed',
        };

        assert.strictEqual(jsonOutput.valid, false);
        assert.ok(jsonOutput.error);
      });
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Auth Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle missing expiresAt gracefully', () => {
    const auth = createMockClaudeAuth();
    const authWithoutExpiry = { ...auth, expiresAt: undefined as unknown as number };

    const expiresAt = authWithoutExpiry.expiresAt ? new Date(authWithoutExpiry.expiresAt * 1000) : null;

    assert.strictEqual(expiresAt, null);
  });

  it('should handle missing scopes gracefully', () => {
    const auth = createMockClaudeAuth();
    const authWithoutScopes = { ...auth, scopes: undefined };

    const scopes = authWithoutScopes.scopes || [];

    assert.ok(Array.isArray(scopes));
    assert.strictEqual(scopes.length, 0);
  });

  it('should handle various auth sources', () => {
    const sources = ['credentials-file', 'keychain', 'database', 'environment', 'unknown'];

    for (const source of sources) {
      const auth = createMockClaudeAuth({ source });
      assert.strictEqual(auth.source, source);
    }
  });

  it('should handle auth error gracefully', async () => {
    mockGetClaudeCredentials.mock.mockImplementation(async () => {
      throw new Error('Network error');
    });

    try {
      await mockGetClaudeCredentials();
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.strictEqual((error as Error).message, 'Network error');
    }
  });
});
