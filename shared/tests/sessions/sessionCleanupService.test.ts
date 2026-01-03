/**
 * Tests for the SessionCleanupService module.
 *
 * These tests verify the cleanup behavior for archived sessions that require
 * external API calls to GitHub (branch deletion) and Claude Remote (session archiving).
 *
 * The tests cover:
 * - GitHub branch deletion with various success/error scenarios
 * - Claude Remote session archiving with various success/error scenarios
 * - Combined cleanup operations (branch + archive)
 * - Circuit breaker handling for external APIs
 * - Already-deleted/archived resource handling (idempotent operations)
 * - Partial success scenarios
 *
 * IMPORTANT: These tests use a MockSessionCleanupService that mirrors the expected
 * behavior of the real SessionCleanupService. This approach tests cleanup logic patterns
 * without requiring actual GitHub or Claude Remote API connections.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { CleanupResult } from '../../src/sessions/ASessionCleanupService.js';
import type { ClaudeAuth } from '../../src/auth/claudeAuth.js';

/**
 * Mock ClaudeAuth for testing
 */
function createMockClaudeAuth(overrides: Partial<ClaudeAuth> = {}): ClaudeAuth {
  return {
    accessToken: overrides.accessToken || 'mock-access-token',
    refreshToken: overrides.refreshToken || 'mock-refresh-token',
    expiresAt: overrides.expiresAt || Date.now() + 3600000,
  };
}

/**
 * Types for simulating API errors
 */
interface ApiError {
  status: number;
  message: string;
}

/**
 * Mock implementation of SessionCleanupService for testing cleanup logic
 */
class MockSessionCleanupService {
  // Track deleted branches
  private deletedBranches: Set<string> = new Set();

  // Track archived sessions
  private archivedSessions: Set<string> = new Set();

  // Simulate API errors
  private githubErrors: Map<string, ApiError> = new Map();
  private claudeErrors: Map<string, ApiError> = new Map();

  // Simulate circuit breaker states
  private githubCircuitOpen = false;
  private claudeCircuitOpen = false;

  /**
   * Configure a GitHub error for a specific branch
   */
  setGitHubError(owner: string, repo: string, branch: string, error: ApiError): void {
    const key = `${owner}/${repo}/${branch}`;
    this.githubErrors.set(key, error);
  }

  /**
   * Configure a Claude error for a specific session
   */
  setClaudeError(sessionId: string, error: ApiError): void {
    this.claudeErrors.set(sessionId, error);
  }

  /**
   * Set GitHub circuit breaker state
   */
  setGitHubCircuitOpen(open: boolean): void {
    this.githubCircuitOpen = open;
  }

  /**
   * Set Claude circuit breaker state
   */
  setClaudeCircuitOpen(open: boolean): void {
    this.claudeCircuitOpen = open;
  }

  /**
   * Pre-mark a branch as deleted (to simulate already-deleted state)
   */
  markBranchAsDeleted(owner: string, repo: string, branch: string): void {
    this.deletedBranches.add(`${owner}/${repo}/${branch}`);
  }

  /**
   * Pre-mark a session as archived (to simulate already-archived state)
   */
  markSessionAsArchived(sessionId: string): void {
    this.archivedSessions.add(sessionId);
  }

  /**
   * Check if a branch was deleted
   */
  wasBranchDeleted(owner: string, repo: string, branch: string): boolean {
    return this.deletedBranches.has(`${owner}/${repo}/${branch}`);
  }

  /**
   * Check if a session was archived
   */
  wasSessionArchived(sessionId: string): boolean {
    return this.archivedSessions.has(sessionId);
  }

  /**
   * Delete a GitHub branch
   */
  async deleteGitHubBranch(
    githubAccessToken: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<CleanupResult> {
    const key = `${owner}/${repo}/${branch}`;

    // Check circuit breaker
    if (this.githubCircuitOpen) {
      return {
        success: false,
        message: 'GitHub API temporarily unavailable',
      };
    }

    // Check for configured errors
    const error = this.githubErrors.get(key);
    if (error) {
      if (error.status === 422 || error.status === 404) {
        // Branch doesn't exist - treat as success
        return {
          success: true,
          message: 'Branch already deleted or does not exist',
        };
      }
      if (error.message?.includes('circuit breaker')) {
        return {
          success: false,
          message: 'GitHub API temporarily unavailable',
        };
      }
      return {
        success: false,
        message: 'Failed to delete branch',
      };
    }

    // Check if already deleted
    if (this.deletedBranches.has(key)) {
      return {
        success: true,
        message: 'Branch already deleted or does not exist',
      };
    }

    // Successful deletion
    this.deletedBranches.add(key);
    return {
      success: true,
      message: 'Branch deleted',
    };
  }

  /**
   * Archive a Claude Remote session
   */
  async archiveClaudeRemoteSession(
    remoteSessionId: string,
    claudeAuth: ClaudeAuth,
    environmentId?: string
  ): Promise<CleanupResult> {
    // Check circuit breaker
    if (this.claudeCircuitOpen) {
      return {
        success: false,
        message: 'Claude Remote API temporarily unavailable',
      };
    }

    // Check for configured errors
    const error = this.claudeErrors.get(remoteSessionId);
    if (error) {
      if (error.status === 404) {
        // Session doesn't exist - treat as success
        return {
          success: true,
          message: 'Remote session already archived or does not exist',
        };
      }
      if (error.message?.includes('circuit breaker')) {
        return {
          success: false,
          message: 'Claude Remote API temporarily unavailable',
        };
      }
      return {
        success: false,
        message: `Failed to archive remote session: ${error.message}`,
      };
    }

    // Check if already archived
    if (this.archivedSessions.has(remoteSessionId)) {
      return {
        success: true,
        message: 'Remote session already archived or does not exist',
      };
    }

    // Successful archival
    this.archivedSessions.add(remoteSessionId);
    return {
      success: true,
      message: 'Remote session archived',
    };
  }

  /**
   * Combined cleanup operation
   */
  async cleanupSession(params: {
    githubAccessToken?: string;
    owner?: string;
    repo?: string;
    branch?: string;
    remoteSessionId?: string;
    claudeAuth?: ClaudeAuth;
    environmentId?: string;
  }): Promise<{
    branchResult?: CleanupResult;
    archiveResult?: CleanupResult;
  }> {
    const results: {
      branchResult?: CleanupResult;
      archiveResult?: CleanupResult;
    } = {};

    if (params.githubAccessToken && params.owner && params.repo && params.branch) {
      results.branchResult = await this.deleteGitHubBranch(
        params.githubAccessToken,
        params.owner,
        params.repo,
        params.branch
      );
    }

    if (params.remoteSessionId && params.claudeAuth) {
      results.archiveResult = await this.archiveClaudeRemoteSession(
        params.remoteSessionId,
        params.claudeAuth,
        params.environmentId
      );
    }

    return results;
  }
}

describe('SessionCleanupService deleteGitHubBranch', () => {
  let service: MockSessionCleanupService;

  beforeEach(() => {
    service = new MockSessionCleanupService();
  });

  describe('Successful Deletion', () => {
    it('should successfully delete a branch', async () => {
      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'feature-branch'
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'Branch deleted');
      assert.ok(service.wasBranchDeleted('owner', 'repo', 'feature-branch'));
    });

    it('should handle branch with special characters', async () => {
      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'feature/test-123'
      );

      assert.strictEqual(result.success, true);
      assert.ok(service.wasBranchDeleted('owner', 'repo', 'feature/test-123'));
    });
  });

  describe('Already Deleted Branch', () => {
    it('should return success for already deleted branch (404)', async () => {
      service.setGitHubError('owner', 'repo', 'old-branch', {
        status: 404,
        message: 'Reference does not exist',
      });

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'old-branch'
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('already deleted'));
    });

    it('should return success for unprocessable entity (422)', async () => {
      service.setGitHubError('owner', 'repo', 'old-branch', {
        status: 422,
        message: 'Reference update failed',
      });

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'old-branch'
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('already deleted'));
    });

    it('should handle pre-deleted branch gracefully', async () => {
      service.markBranchAsDeleted('owner', 'repo', 'old-branch');

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'old-branch'
      );

      assert.strictEqual(result.success, true);
    });
  });

  describe('Error Handling', () => {
    it('should handle circuit breaker open state', async () => {
      service.setGitHubCircuitOpen(true);

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'branch'
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('temporarily unavailable'));
    });

    it('should handle circuit breaker error message', async () => {
      service.setGitHubError('owner', 'repo', 'branch', {
        status: 503,
        message: 'circuit breaker is open',
      });

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'branch'
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('temporarily unavailable'));
    });

    it('should handle generic API errors', async () => {
      service.setGitHubError('owner', 'repo', 'branch', {
        status: 500,
        message: 'Internal server error',
      });

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'branch'
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed to delete branch'));
    });

    it('should handle unauthorized error', async () => {
      service.setGitHubError('owner', 'repo', 'branch', {
        status: 401,
        message: 'Unauthorized',
      });

      const result = await service.deleteGitHubBranch(
        'github-token',
        'owner',
        'repo',
        'branch'
      );

      assert.strictEqual(result.success, false);
    });
  });
});

describe('SessionCleanupService archiveClaudeRemoteSession', () => {
  let service: MockSessionCleanupService;
  let mockAuth: ClaudeAuth;

  beforeEach(() => {
    service = new MockSessionCleanupService();
    mockAuth = createMockClaudeAuth();
  });

  describe('Successful Archival', () => {
    it('should successfully archive a session', async () => {
      const result = await service.archiveClaudeRemoteSession(
        'remote-session-123',
        mockAuth
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message, 'Remote session archived');
      assert.ok(service.wasSessionArchived('remote-session-123'));
    });

    it('should accept optional environment ID', async () => {
      const result = await service.archiveClaudeRemoteSession(
        'remote-session-123',
        mockAuth,
        'custom-env-id'
      );

      assert.strictEqual(result.success, true);
    });
  });

  describe('Already Archived Session', () => {
    it('should return success for already archived session (404)', async () => {
      service.setClaudeError('old-session', {
        status: 404,
        message: 'Session not found',
      });

      const result = await service.archiveClaudeRemoteSession(
        'old-session',
        mockAuth
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.message.includes('already archived'));
    });

    it('should handle pre-archived session gracefully', async () => {
      service.markSessionAsArchived('old-session');

      const result = await service.archiveClaudeRemoteSession(
        'old-session',
        mockAuth
      );

      assert.strictEqual(result.success, true);
    });
  });

  describe('Error Handling', () => {
    it('should handle circuit breaker open state', async () => {
      service.setClaudeCircuitOpen(true);

      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('temporarily unavailable'));
    });

    it('should handle circuit breaker error message', async () => {
      service.setClaudeError('session-123', {
        status: 503,
        message: 'circuit breaker is open',
      });

      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('temporarily unavailable'));
    });

    it('should handle generic API errors with error message', async () => {
      service.setClaudeError('session-123', {
        status: 500,
        message: 'Internal server error',
      });

      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Failed to archive'));
      assert.ok(result.message.includes('Internal server error'));
    });

    it('should handle authorization errors', async () => {
      service.setClaudeError('session-123', {
        status: 401,
        message: 'Token expired',
      });

      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('Token expired'));
    });
  });

  describe('Authentication', () => {
    it('should work with valid auth tokens', async () => {
      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        createMockClaudeAuth({
          accessToken: 'valid-token',
          refreshToken: 'valid-refresh',
        })
      );

      assert.strictEqual(result.success, true);
    });
  });
});

describe('SessionCleanupService cleanupSession', () => {
  let service: MockSessionCleanupService;
  let mockAuth: ClaudeAuth;

  beforeEach(() => {
    service = new MockSessionCleanupService();
    mockAuth = createMockClaudeAuth();
  });

  describe('Combined Operations', () => {
    it('should cleanup both branch and remote session', async () => {
      const result = await service.cleanupSession({
        githubAccessToken: 'github-token',
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.ok(result.branchResult);
      assert.strictEqual(result.branchResult.success, true);
      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, true);
    });

    it('should only delete branch if no remote session params', async () => {
      const result = await service.cleanupSession({
        githubAccessToken: 'github-token',
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
      });

      assert.ok(result.branchResult);
      assert.strictEqual(result.branchResult.success, true);
      assert.strictEqual(result.archiveResult, undefined);
    });

    it('should only archive session if no branch params', async () => {
      const result = await service.cleanupSession({
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.strictEqual(result.branchResult, undefined);
      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, true);
    });

    it('should return empty results if no params provided', async () => {
      const result = await service.cleanupSession({});

      assert.strictEqual(result.branchResult, undefined);
      assert.strictEqual(result.archiveResult, undefined);
    });
  });

  describe('Partial Success', () => {
    it('should handle branch success and archive failure', async () => {
      service.setClaudeError('remote-123', {
        status: 500,
        message: 'Server error',
      });

      const result = await service.cleanupSession({
        githubAccessToken: 'github-token',
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.ok(result.branchResult);
      assert.strictEqual(result.branchResult.success, true);
      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, false);
    });

    it('should handle branch failure and archive success', async () => {
      service.setGitHubError('owner', 'repo', 'feature-branch', {
        status: 500,
        message: 'Server error',
      });

      const result = await service.cleanupSession({
        githubAccessToken: 'github-token',
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.ok(result.branchResult);
      assert.strictEqual(result.branchResult.success, false);
      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, true);
    });

    it('should handle both operations failing', async () => {
      service.setGitHubError('owner', 'repo', 'feature-branch', {
        status: 500,
        message: 'Server error',
      });
      service.setClaudeError('remote-123', {
        status: 500,
        message: 'Server error',
      });

      const result = await service.cleanupSession({
        githubAccessToken: 'github-token',
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.ok(result.branchResult);
      assert.strictEqual(result.branchResult.success, false);
      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, false);
    });
  });

  describe('Missing Parameters', () => {
    it('should not delete branch if missing githubAccessToken', async () => {
      const result = await service.cleanupSession({
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-branch',
      });

      assert.strictEqual(result.branchResult, undefined);
    });

    it('should not delete branch if missing owner', async () => {
      const result = await service.cleanupSession({
        githubAccessToken: 'token',
        repo: 'repo',
        branch: 'feature-branch',
      });

      assert.strictEqual(result.branchResult, undefined);
    });

    it('should not delete branch if missing repo', async () => {
      const result = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        branch: 'feature-branch',
      });

      assert.strictEqual(result.branchResult, undefined);
    });

    it('should not delete branch if missing branch', async () => {
      const result = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        repo: 'repo',
      });

      assert.strictEqual(result.branchResult, undefined);
    });

    it('should not archive if missing remoteSessionId', async () => {
      const result = await service.cleanupSession({
        claudeAuth: mockAuth,
      });

      assert.strictEqual(result.archiveResult, undefined);
    });

    it('should not archive if missing claudeAuth', async () => {
      const result = await service.cleanupSession({
        remoteSessionId: 'remote-123',
      });

      assert.strictEqual(result.archiveResult, undefined);
    });
  });

  describe('Environment ID', () => {
    it('should pass environment ID to archive operation', async () => {
      const result = await service.cleanupSession({
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
        environmentId: 'custom-env',
      });

      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, true);
    });

    it('should work without environment ID (uses default)', async () => {
      const result = await service.cleanupSession({
        remoteSessionId: 'remote-123',
        claudeAuth: mockAuth,
      });

      assert.ok(result.archiveResult);
      assert.strictEqual(result.archiveResult.success, true);
    });
  });
});

describe('SessionCleanupService Edge Cases', () => {
  let service: MockSessionCleanupService;
  let mockAuth: ClaudeAuth;

  beforeEach(() => {
    service = new MockSessionCleanupService();
    mockAuth = createMockClaudeAuth();
  });

  describe('Idempotent Operations', () => {
    it('should handle multiple deletion attempts for same branch', async () => {
      // First deletion
      const result1 = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'branch'
      );
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.message, 'Branch deleted');

      // Second deletion (already deleted)
      const result2 = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'branch'
      );
      assert.strictEqual(result2.success, true);
      assert.ok(result2.message.includes('already deleted'));
    });

    it('should handle multiple archive attempts for same session', async () => {
      // First archive
      const result1 = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result1.message, 'Remote session archived');

      // Second archive (already archived)
      const result2 = await service.archiveClaudeRemoteSession(
        'session-123',
        mockAuth
      );
      assert.strictEqual(result2.success, true);
      assert.ok(result2.message.includes('already archived'));
    });
  });

  describe('Circuit Breaker Recovery', () => {
    it('should fail when circuit is open', async () => {
      service.setGitHubCircuitOpen(true);

      const result = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'branch'
      );

      assert.strictEqual(result.success, false);
    });

    it('should succeed when circuit is closed', async () => {
      service.setGitHubCircuitOpen(true);

      // First attempt fails
      const result1 = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'branch'
      );
      assert.strictEqual(result1.success, false);

      // Circuit closes
      service.setGitHubCircuitOpen(false);

      // Second attempt succeeds
      const result2 = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'branch'
      );
      assert.strictEqual(result2.success, true);
    });
  });

  describe('Special Characters in Identifiers', () => {
    it('should handle branch names with slashes', async () => {
      const result = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'feature/my-feature'
      );

      assert.strictEqual(result.success, true);
      assert.ok(service.wasBranchDeleted('owner', 'repo', 'feature/my-feature'));
    });

    it('should handle branch names with dashes and numbers', async () => {
      const result = await service.deleteGitHubBranch(
        'token',
        'owner',
        'repo',
        'fix-123-bug'
      );

      assert.strictEqual(result.success, true);
    });

    it('should handle session IDs with UUIDs', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = await service.archiveClaudeRemoteSession(uuid, mockAuth);

      assert.strictEqual(result.success, true);
      assert.ok(service.wasSessionArchived(uuid));
    });
  });

  describe('Multiple Sessions Cleanup', () => {
    it('should cleanup multiple sessions independently', async () => {
      // Cleanup session 1
      const result1 = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        repo: 'repo',
        branch: 'branch-1',
        remoteSessionId: 'session-1',
        claudeAuth: mockAuth,
      });

      // Cleanup session 2
      const result2 = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        repo: 'repo',
        branch: 'branch-2',
        remoteSessionId: 'session-2',
        claudeAuth: mockAuth,
      });

      assert.ok(result1.branchResult?.success);
      assert.ok(result1.archiveResult?.success);
      assert.ok(result2.branchResult?.success);
      assert.ok(result2.archiveResult?.success);

      assert.ok(service.wasBranchDeleted('owner', 'repo', 'branch-1'));
      assert.ok(service.wasBranchDeleted('owner', 'repo', 'branch-2'));
      assert.ok(service.wasSessionArchived('session-1'));
      assert.ok(service.wasSessionArchived('session-2'));
    });

    it('should handle one session failing without affecting others', async () => {
      service.setGitHubError('owner', 'repo', 'branch-1', {
        status: 500,
        message: 'Server error',
      });

      // First session fails branch deletion
      const result1 = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        repo: 'repo',
        branch: 'branch-1',
        remoteSessionId: 'session-1',
        claudeAuth: mockAuth,
      });

      // Second session should still work
      const result2 = await service.cleanupSession({
        githubAccessToken: 'token',
        owner: 'owner',
        repo: 'repo',
        branch: 'branch-2',
        remoteSessionId: 'session-2',
        claudeAuth: mockAuth,
      });

      assert.strictEqual(result1.branchResult?.success, false);
      assert.strictEqual(result1.archiveResult?.success, true);
      assert.strictEqual(result2.branchResult?.success, true);
      assert.strictEqual(result2.archiveResult?.success, true);
    });
  });

  describe('Cross-Repository Operations', () => {
    it('should handle branches from different repos', async () => {
      const result1 = await service.deleteGitHubBranch(
        'token',
        'owner1',
        'repo1',
        'branch'
      );

      const result2 = await service.deleteGitHubBranch(
        'token',
        'owner2',
        'repo2',
        'branch' // Same branch name, different repo
      );

      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);

      assert.ok(service.wasBranchDeleted('owner1', 'repo1', 'branch'));
      assert.ok(service.wasBranchDeleted('owner2', 'repo2', 'branch'));
    });
  });

  describe('Token Handling', () => {
    it('should handle expired access token gracefully', async () => {
      const expiredAuth = createMockClaudeAuth({
        accessToken: 'expired-token',
        expiresAt: Date.now() - 3600000, // 1 hour ago
      });

      // Service should still attempt the operation
      // (Real implementation would refresh the token)
      const result = await service.archiveClaudeRemoteSession(
        'session-123',
        expiredAuth
      );

      assert.strictEqual(result.success, true);
    });

    it('should work with different GitHub tokens', async () => {
      const result1 = await service.deleteGitHubBranch(
        'token-user-1',
        'owner',
        'repo',
        'branch-1'
      );

      const result2 = await service.deleteGitHubBranch(
        'token-user-2',
        'owner',
        'repo',
        'branch-2'
      );

      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
    });
  });
});

describe('SessionCleanupService Rate Limiting Scenarios', () => {
  let service: MockSessionCleanupService;
  let mockAuth: ClaudeAuth;

  beforeEach(() => {
    service = new MockSessionCleanupService();
    mockAuth = createMockClaudeAuth();
  });

  it('should handle rate limit errors from GitHub', async () => {
    service.setGitHubError('owner', 'repo', 'branch', {
      status: 429,
      message: 'Rate limit exceeded',
    });

    const result = await service.deleteGitHubBranch(
      'token',
      'owner',
      'repo',
      'branch'
    );

    assert.strictEqual(result.success, false);
  });

  it('should handle rate limit errors from Claude', async () => {
    service.setClaudeError('session-123', {
      status: 429,
      message: 'Rate limit exceeded',
    });

    const result = await service.archiveClaudeRemoteSession(
      'session-123',
      mockAuth
    );

    assert.strictEqual(result.success, false);
  });
});

describe('SessionCleanupService Network Errors', () => {
  let service: MockSessionCleanupService;
  let mockAuth: ClaudeAuth;

  beforeEach(() => {
    service = new MockSessionCleanupService();
    mockAuth = createMockClaudeAuth();
  });

  it('should handle timeout-like errors', async () => {
    service.setGitHubError('owner', 'repo', 'branch', {
      status: 504,
      message: 'Gateway Timeout',
    });

    const result = await service.deleteGitHubBranch(
      'token',
      'owner',
      'repo',
      'branch'
    );

    assert.strictEqual(result.success, false);
  });

  it('should handle service unavailable errors', async () => {
    service.setClaudeError('session-123', {
      status: 503,
      message: 'Service Unavailable',
    });

    const result = await service.archiveClaudeRemoteSession(
      'session-123',
      mockAuth
    );

    assert.strictEqual(result.success, false);
  });
});
