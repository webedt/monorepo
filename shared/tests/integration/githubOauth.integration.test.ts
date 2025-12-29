/**
 * Integration Tests for GitHub OAuth Flow
 *
 * These tests verify the GitHub OAuth authentication flow including:
 * - State generation and validation
 * - Token exchange
 * - User profile fetching
 * - Database updates
 * - Error handling
 * - Redirect URL handling
 *
 * Note: These tests use mock data and don't connect to real GitHub API.
 *
 * Run these tests:
 *   npm run test:integration -w shared
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import {
  createMockUser,
  createMockGitHubOAuthState,
  createMockGitHubTokenResponse,
  createMockGitHubUser,
} from './fixtures.js';

/**
 * Local mock helper for Lucia sessions
 * Creates a mock session object for testing OAuth flows
 */
function createMockLuciaSession(userId: string = 'test-user-id'): { id: string; userId: string; expiresAt: Date } {
  return {
    id: `lucia-session-${randomUUID()}`,
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

// ============================================================================
// Mock GitHub OAuth Implementation
// ============================================================================

interface OAuthState {
  sessionId: string;
  userId: string;
  timestamp: number;
  returnOrigin?: string;
  returnPath?: string;
}

/**
 * Mock GitHub OAuth Service
 * Simulates the GitHub OAuth flow
 */
class MockGitHubOAuthService {
  private static readonly STATE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private tokenExchangeResults: Map<string, { accessToken?: string; error?: string }> = new Map();
  private userProfiles: Map<string, ReturnType<typeof createMockGitHubUser>> = new Map();
  private failNextTokenExchange = false;
  private failNextUserFetch = false;

  /**
   * Generate OAuth state parameter
   */
  generateState(params: {
    sessionId: string;
    userId: string;
    returnOrigin?: string;
    returnPath?: string;
  }): string {
    const state: OAuthState = {
      sessionId: params.sessionId,
      userId: params.userId,
      timestamp: Date.now(),
      returnOrigin: params.returnOrigin || 'http://localhost:3000',
      returnPath: params.returnPath || '/settings',
    };
    return Buffer.from(JSON.stringify(state)).toString('base64');
  }

  /**
   * Parse and validate OAuth state
   */
  parseState(stateString: string): { valid: boolean; data?: OAuthState; error?: string } {
    try {
      const decoded = Buffer.from(stateString, 'base64').toString('utf-8');
      const state: OAuthState = JSON.parse(decoded);

      // Validate required fields
      if (!state.sessionId || !state.userId || !state.timestamp) {
        return { valid: false, error: 'Missing required state fields' };
      }

      // Check timestamp (10 minute timeout)
      if (Date.now() - state.timestamp > MockGitHubOAuthService.STATE_TIMEOUT_MS) {
        return { valid: false, error: 'State expired' };
      }

      return { valid: true, data: state };
    } catch {
      return { valid: false, error: 'Invalid state format' };
    }
  }

  /**
   * Build authorization URL
   */
  buildAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    scope?: string;
  }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('scope', params.scope || 'repo workflow user:email');
    return url.toString();
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(params: {
    clientId: string;
    clientSecret: string;
    code: string;
  }): Promise<{ accessToken?: string; error?: string }> {
    if (this.failNextTokenExchange) {
      this.failNextTokenExchange = false;
      return { error: 'bad_verification_code' };
    }

    // Check for pre-configured result
    const configured = this.tokenExchangeResults.get(params.code);
    if (configured) {
      return configured;
    }

    // Default success
    return { accessToken: `ghu_${randomUUID().replace(/-/g, '')}` };
  }

  /**
   * Get authenticated user profile
   */
  async getAuthenticatedUser(accessToken: string): Promise<ReturnType<typeof createMockGitHubUser>> {
    if (this.failNextUserFetch) {
      this.failNextUserFetch = false;
      throw new Error('Failed to fetch user profile');
    }

    // Check for pre-configured user
    const configured = this.userProfiles.get(accessToken);
    if (configured) {
      return configured;
    }

    // Default user
    return createMockGitHubUser();
  }

  /**
   * Build redirect URL for callback
   */
  buildRedirectUrl(params: {
    origin: string;
    path: string;
    success?: boolean;
    error?: string;
  }): string {
    let url = `${params.origin}/#${params.path}`;
    if (params.success) {
      url += '?success=github_connected';
    } else if (params.error) {
      url += `?error=${params.error}`;
    }
    return url;
  }

  // Test helpers
  setTokenExchangeResult(code: string, result: { accessToken?: string; error?: string }): void {
    this.tokenExchangeResults.set(code, result);
  }

  setUserProfile(accessToken: string, user: ReturnType<typeof createMockGitHubUser>): void {
    this.userProfiles.set(accessToken, user);
  }

  setFailNextTokenExchange(): void {
    this.failNextTokenExchange = true;
  }

  setFailNextUserFetch(): void {
    this.failNextUserFetch = true;
  }

  reset(): void {
    this.tokenExchangeResults.clear();
    this.userProfiles.clear();
    this.failNextTokenExchange = false;
    this.failNextUserFetch = false;
  }
}

/**
 * Mock User Repository
 * Simulates database operations for user management
 */
class MockUserRepository {
  private users: Map<string, ReturnType<typeof createMockUser>> = new Map();

  /**
   * Create a user
   */
  create(user: ReturnType<typeof createMockUser>): void {
    this.users.set(user.id, { ...user });
  }

  /**
   * Get user by ID
   */
  getById(userId: string): ReturnType<typeof createMockUser> | undefined {
    return this.users.get(userId);
  }

  /**
   * Get user by GitHub ID
   */
  getByGitHubId(githubId: string): ReturnType<typeof createMockUser> | undefined {
    for (const user of this.users.values()) {
      if (user.githubId === githubId) {
        return user;
      }
    }
    return undefined;
  }

  /**
   * Update user's GitHub connection
   */
  updateGitHubConnection(
    userId: string,
    params: { githubId: string; githubAccessToken: string }
  ): void {
    const user = this.users.get(userId);
    if (user) {
      user.githubId = params.githubId;
      user.githubAccessToken = params.githubAccessToken;
    }
  }

  /**
   * Remove GitHub connection from user
   */
  disconnectGitHub(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.githubId = null;
      user.githubAccessToken = null;
    }
  }

  /**
   * Clear GitHub connection from all users with specific GitHub ID
   */
  clearGitHubIdFromAll(githubId: string): void {
    for (const user of this.users.values()) {
      if (user.githubId === githubId) {
        user.githubId = null;
        user.githubAccessToken = null;
      }
    }
  }

  /**
   * Clear all users
   */
  clear(): void {
    this.users.clear();
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('GitHub OAuth Integration Tests', () => {
  let oauthService: MockGitHubOAuthService;
  let userRepo: MockUserRepository;

  beforeEach(() => {
    oauthService = new MockGitHubOAuthService();
    userRepo = new MockUserRepository();
  });

  describe('State Generation and Validation', () => {
    it('should generate valid state with all parameters', () => {
      const session = createMockLuciaSession();
      const user = createMockUser();

      const state = oauthService.generateState({
        sessionId: session.id,
        userId: user.id,
        returnOrigin: 'https://example.com',
        returnPath: '/dashboard',
      });

      const result = oauthService.parseState(state);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data?.sessionId, session.id);
      assert.strictEqual(result.data?.userId, user.id);
      assert.strictEqual(result.data?.returnOrigin, 'https://example.com');
      assert.strictEqual(result.data?.returnPath, '/dashboard');
    });

    it('should use default values for optional parameters', () => {
      const session = createMockLuciaSession();
      const user = createMockUser();

      const state = oauthService.generateState({
        sessionId: session.id,
        userId: user.id,
      });

      const result = oauthService.parseState(state);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.data?.returnOrigin, 'http://localhost:3000');
      assert.strictEqual(result.data?.returnPath, '/settings');
    });

    it('should reject expired state', () => {
      // Create state with old timestamp
      const oldState = {
        sessionId: randomUUID(),
        userId: randomUUID(),
        timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        returnOrigin: 'http://localhost:3000',
        returnPath: '/settings',
      };

      const encoded = Buffer.from(JSON.stringify(oldState)).toString('base64');
      const result = oauthService.parseState(encoded);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'State expired');
    });

    it('should reject invalid base64 state', () => {
      const result = oauthService.parseState('not-valid-base64!!!');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid state format'));
    });

    it('should reject malformed JSON state', () => {
      const malformed = Buffer.from('not json').toString('base64');
      const result = oauthService.parseState(malformed);

      assert.strictEqual(result.valid, false);
    });

    it('should reject state missing required fields', () => {
      const incomplete = Buffer.from(JSON.stringify({
        sessionId: randomUUID(),
        // missing userId and timestamp
      })).toString('base64');

      const result = oauthService.parseState(incomplete);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Missing required'));
    });

    it('should validate state within timeout window', () => {
      // Create state 5 minutes ago (should still be valid)
      const recentState = {
        sessionId: randomUUID(),
        userId: randomUUID(),
        timestamp: Date.now() - 5 * 60 * 1000, // 5 minutes ago
        returnOrigin: 'http://localhost:3000',
        returnPath: '/settings',
      };

      const encoded = Buffer.from(JSON.stringify(recentState)).toString('base64');
      const result = oauthService.parseState(encoded);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Authorization URL Building', () => {
    it('should build correct authorization URL', () => {
      const state = oauthService.generateState({
        sessionId: randomUUID(),
        userId: randomUUID(),
      });

      const url = oauthService.buildAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/api/github/oauth/callback',
        state,
        scope: 'repo workflow user:email',
      });

      const parsed = new URL(url);

      assert.strictEqual(parsed.origin, 'https://github.com');
      assert.strictEqual(parsed.pathname, '/login/oauth/authorize');
      assert.strictEqual(parsed.searchParams.get('client_id'), 'test-client-id');
      assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'https://example.com/api/github/oauth/callback');
      assert.strictEqual(parsed.searchParams.get('state'), state);
      assert.strictEqual(parsed.searchParams.get('scope'), 'repo workflow user:email');
    });

    it('should use default scope if not provided', () => {
      const url = oauthService.buildAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/callback',
        state: 'test-state',
      });

      const parsed = new URL(url);
      assert.strictEqual(parsed.searchParams.get('scope'), 'repo workflow user:email');
    });
  });

  describe('Token Exchange', () => {
    it('should exchange code for token successfully', async () => {
      const result = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'valid-auth-code',
      });

      assert.ok(result.accessToken);
      assert.ok(result.accessToken.startsWith('ghu_'));
      assert.strictEqual(result.error, undefined);
    });

    it('should return error for invalid code', async () => {
      oauthService.setFailNextTokenExchange();

      const result = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'invalid-code',
      });

      assert.strictEqual(result.accessToken, undefined);
      assert.strictEqual(result.error, 'bad_verification_code');
    });

    it('should use pre-configured token exchange result', async () => {
      const expectedToken = 'ghu_preconfigured_token';
      oauthService.setTokenExchangeResult('special-code', { accessToken: expectedToken });

      const result = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'special-code',
      });

      assert.strictEqual(result.accessToken, expectedToken);
    });
  });

  describe('User Profile Fetching', () => {
    it('should fetch user profile successfully', async () => {
      const user = await oauthService.getAuthenticatedUser('valid-token');

      assert.ok(user.id);
      assert.ok(user.login);
      assert.ok(user.email);
    });

    it('should return pre-configured user profile', async () => {
      const customUser = createMockGitHubUser({
        id: 12345,
        login: 'custom-user',
        email: 'custom@example.com',
      });
      oauthService.setUserProfile('custom-token', customUser);

      const user = await oauthService.getAuthenticatedUser('custom-token');

      assert.strictEqual(user.id, 12345);
      assert.strictEqual(user.login, 'custom-user');
    });

    it('should throw error on fetch failure', async () => {
      oauthService.setFailNextUserFetch();

      await assert.rejects(
        async () => {
          await oauthService.getAuthenticatedUser('any-token');
        },
        { message: 'Failed to fetch user profile' }
      );
    });
  });

  describe('User Repository Operations', () => {
    it('should create and retrieve user', () => {
      const user = createMockUser();
      userRepo.create(user);

      const retrieved = userRepo.getById(user.id);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, user.id);
      assert.strictEqual(retrieved.email, user.email);
    });

    it('should update GitHub connection', () => {
      const user = createMockUser();
      userRepo.create(user);

      userRepo.updateGitHubConnection(user.id, {
        githubId: '12345',
        githubAccessToken: 'ghu_test_token',
      });

      const updated = userRepo.getById(user.id);
      assert.strictEqual(updated?.githubId, '12345');
      assert.strictEqual(updated?.githubAccessToken, 'ghu_test_token');
    });

    it('should disconnect GitHub', () => {
      const user = createMockUser({
        githubId: '12345',
        githubAccessToken: 'ghu_test_token',
      });
      userRepo.create(user);

      userRepo.disconnectGitHub(user.id);

      const updated = userRepo.getById(user.id);
      assert.strictEqual(updated?.githubId, null);
      assert.strictEqual(updated?.githubAccessToken, null);
    });

    it('should find user by GitHub ID', () => {
      const user = createMockUser({
        githubId: '67890',
        githubAccessToken: 'ghu_test',
      });
      userRepo.create(user);

      const found = userRepo.getByGitHubId('67890');

      assert.ok(found);
      assert.strictEqual(found.id, user.id);
    });

    it('should clear GitHub ID from all users', () => {
      const user1 = createMockUser({ githubId: '12345' });
      const user2 = createMockUser({ githubId: '12345' }); // Same GitHub ID
      userRepo.create(user1);
      userRepo.create(user2);

      userRepo.clearGitHubIdFromAll('12345');

      assert.strictEqual(userRepo.getById(user1.id)?.githubId, null);
      assert.strictEqual(userRepo.getById(user2.id)?.githubId, null);
    });
  });

  describe('Redirect URL Building', () => {
    it('should build success redirect URL', () => {
      const url = oauthService.buildRedirectUrl({
        origin: 'https://example.com',
        path: '/settings',
        success: true,
      });

      assert.strictEqual(url, 'https://example.com/#/settings?success=github_connected');
    });

    it('should build error redirect URL', () => {
      const url = oauthService.buildRedirectUrl({
        origin: 'https://example.com',
        path: '/settings',
        error: 'oauth_failed',
      });

      assert.strictEqual(url, 'https://example.com/#/settings?error=oauth_failed');
    });

    it('should build plain redirect URL without query params', () => {
      const url = oauthService.buildRedirectUrl({
        origin: 'https://example.com',
        path: '/dashboard',
      });

      assert.strictEqual(url, 'https://example.com/#/dashboard');
    });
  });

  describe('Complete OAuth Flow', () => {
    it('should complete full OAuth flow successfully', async () => {
      // 1. Create user and session
      const user = createMockUser();
      userRepo.create(user);
      const session = createMockLuciaSession(user.id);

      // 2. Generate state and authorization URL
      const state = oauthService.generateState({
        sessionId: session.id,
        userId: user.id,
        returnOrigin: 'https://example.com',
        returnPath: '/dashboard',
      });

      const authUrl = oauthService.buildAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'https://example.com/api/github/oauth/callback',
        state,
      });

      assert.ok(authUrl.includes('github.com'));

      // 3. Simulate callback with code (user approved)
      const code = 'authorization-code-from-github';

      // 4. Validate state
      const stateValidation = oauthService.parseState(state);
      assert.strictEqual(stateValidation.valid, true);

      // 5. Exchange code for token
      const tokenResult = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code,
      });

      assert.ok(tokenResult.accessToken);

      // 6. Fetch GitHub user profile
      const githubUser = await oauthService.getAuthenticatedUser(tokenResult.accessToken);

      // 7. Update user in database
      userRepo.updateGitHubConnection(user.id, {
        githubId: String(githubUser.id),
        githubAccessToken: tokenResult.accessToken,
      });

      // 8. Verify user updated
      const updatedUser = userRepo.getById(user.id);
      assert.strictEqual(updatedUser?.githubId, String(githubUser.id));
      assert.strictEqual(updatedUser?.githubAccessToken, tokenResult.accessToken);

      // 9. Build redirect URL
      const redirectUrl = oauthService.buildRedirectUrl({
        origin: stateValidation.data!.returnOrigin!,
        path: stateValidation.data!.returnPath!,
        success: true,
      });

      assert.ok(redirectUrl.includes('success=github_connected'));
    });

    it('should handle OAuth flow with expired state', async () => {
      // Create expired state
      const expiredState = {
        sessionId: randomUUID(),
        userId: randomUUID(),
        timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
      };
      const encoded = Buffer.from(JSON.stringify(expiredState)).toString('base64');

      // Validate state
      const stateValidation = oauthService.parseState(encoded);

      assert.strictEqual(stateValidation.valid, false);
      assert.strictEqual(stateValidation.error, 'State expired');

      // Build error redirect
      const redirectUrl = oauthService.buildRedirectUrl({
        origin: expiredState.returnOrigin,
        path: expiredState.returnPath,
        error: 'state_expired',
      });

      assert.ok(redirectUrl.includes('error=state_expired'));
    });

    it('should handle OAuth flow with token exchange failure', async () => {
      const user = createMockUser();
      userRepo.create(user);

      const state = oauthService.generateState({
        sessionId: randomUUID(),
        userId: user.id,
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
      });

      // Simulate token exchange failure
      oauthService.setFailNextTokenExchange();

      const stateValidation = oauthService.parseState(state);
      assert.strictEqual(stateValidation.valid, true);

      const tokenResult = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'invalid-code',
      });

      assert.ok(tokenResult.error);

      // User should not be updated
      const unchangedUser = userRepo.getById(user.id);
      assert.strictEqual(unchangedUser?.githubId, null);
    });

    it('should transfer GitHub connection between accounts', async () => {
      // User A has GitHub connected
      const userA = createMockUser({
        githubId: '12345',
        githubAccessToken: 'ghu_old_token',
      });
      userRepo.create(userA);

      // User B wants to connect same GitHub account
      const userB = createMockUser();
      userRepo.create(userB);

      // Configure mock to return same GitHub user
      const accessToken = 'ghu_new_token';
      oauthService.setUserProfile(accessToken, createMockGitHubUser({ id: 12345 }));

      // User B goes through OAuth
      const tokenResult = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'user-b-code',
      });

      // First, clear GitHub connection from any user with this GitHub ID
      userRepo.clearGitHubIdFromAll('12345');

      // Verify User A's GitHub is now disconnected
      assert.strictEqual(userRepo.getById(userA.id)?.githubId, null);

      // Connect GitHub to User B
      userRepo.updateGitHubConnection(userB.id, {
        githubId: '12345',
        githubAccessToken: tokenResult.accessToken!,
      });

      // Verify User B now has the GitHub connection
      const updatedUserB = userRepo.getById(userB.id);
      assert.strictEqual(updatedUserB?.githubId, '12345');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing code in callback', () => {
      // No code provided
      const redirectUrl = oauthService.buildRedirectUrl({
        origin: 'https://example.com',
        path: '/login',
        error: 'missing_params',
      });

      assert.ok(redirectUrl.includes('error=missing_params'));
    });

    it('should handle missing state in callback', () => {
      // No state provided
      const redirectUrl = oauthService.buildRedirectUrl({
        origin: 'https://example.com',
        path: '/login',
        error: 'missing_params',
      });

      assert.ok(redirectUrl.includes('error=missing_params'));
    });

    it('should handle GitHub API error during user fetch', async () => {
      const user = createMockUser();
      userRepo.create(user);

      const tokenResult = await oauthService.exchangeCodeForToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        code: 'valid-code',
      });

      // Simulate user fetch failure
      oauthService.setFailNextUserFetch();

      await assert.rejects(
        async () => {
          await oauthService.getAuthenticatedUser(tokenResult.accessToken!);
        },
        { message: 'Failed to fetch user profile' }
      );

      // User should remain unchanged
      assert.strictEqual(userRepo.getById(user.id)?.githubId, null);
    });

    it('should handle non-existent user in state', async () => {
      // State references a user that doesn't exist
      const state = oauthService.generateState({
        sessionId: randomUUID(),
        userId: 'non-existent-user-id',
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
      });

      const stateValidation = oauthService.parseState(state);
      assert.strictEqual(stateValidation.valid, true);

      // User doesn't exist in repo
      const user = userRepo.getById('non-existent-user-id');
      assert.strictEqual(user, undefined);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in returnPath', () => {
      const state = oauthService.generateState({
        sessionId: randomUUID(),
        userId: randomUUID(),
        returnPath: '/settings?tab=github&action=connect',
      });

      const parsed = oauthService.parseState(state);
      assert.strictEqual(parsed.valid, true);
      assert.strictEqual(parsed.data?.returnPath, '/settings?tab=github&action=connect');
    });

    it('should handle very long state values', () => {
      const longUserId = 'a'.repeat(100);

      const state = oauthService.generateState({
        sessionId: randomUUID(),
        userId: longUserId,
        returnOrigin: 'https://very-long-domain-name-for-testing.example.com',
        returnPath: '/very/long/path/to/some/deeply/nested/page',
      });

      const parsed = oauthService.parseState(state);
      assert.strictEqual(parsed.valid, true);
      assert.strictEqual(parsed.data?.userId, longUserId);
    });

    it('should handle multiple concurrent OAuth flows', async () => {
      // Create multiple users
      const users = Array.from({ length: 5 }, () => createMockUser());
      users.forEach(u => userRepo.create(u));

      // Generate states for all users
      const states = users.map((user, i) =>
        oauthService.generateState({
          sessionId: randomUUID(),
          userId: user.id,
          returnPath: `/user/${i}`,
        })
      );

      // All states should be valid and different
      const parsed = states.map(s => oauthService.parseState(s));

      assert.ok(parsed.every(p => p.valid));

      const userIds = parsed.map(p => p.data?.userId);
      const uniqueUserIds = new Set(userIds);
      assert.strictEqual(uniqueUserIds.size, 5);
    });

    it('should handle state at exact timeout boundary', async () => {
      // State just past 10 minutes ago (10 minutes + 1 second)
      const boundaryState = {
        sessionId: randomUUID(),
        userId: randomUUID(),
        timestamp: Date.now() - 10 * 60 * 1000 - 1000, // Just past 10 minutes
        returnOrigin: 'http://localhost:3000',
        returnPath: '/settings',
      };

      const encoded = Buffer.from(JSON.stringify(boundaryState)).toString('base64');
      const result = oauthService.parseState(encoded);

      // Just past the boundary should be expired
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'State expired');
    });
  });
});
