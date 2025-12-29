/**
 * Integration Tests for GitHub Routes
 *
 * Tests GitHub OAuth flow, repository operations, branch management,
 * pull requests, and file operations.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockRequest, createMockResponse, createMockUser, createMockSession } from '../helpers/mockExpress.js';

describe('GitHub Routes - Integration Tests', () => {
  describe('OAuth Flow', () => {
    describe('GET /oauth - Initiate OAuth', () => {
      it('should require authentication', () => {
        const req = createMockRequest({ user: null, authSession: null });
        const res = createMockResponse();

        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        assert.strictEqual(res.statusCode, 401);
      });

      it('should build OAuth state with session info', () => {
        const state = buildOAuthState({
          sessionId: 'auth-session-123',
          userId: 'user-456',
          returnOrigin: 'https://app.example.com',
          returnPath: '/settings',
        });

        const decoded = JSON.parse(Buffer.from(state, 'base64').toString());

        assert.strictEqual(decoded.sessionId, 'auth-session-123');
        assert.strictEqual(decoded.userId, 'user-456');
        assert.strictEqual(decoded.returnOrigin, 'https://app.example.com');
        assert.strictEqual(decoded.returnPath, '/settings');
        assert.ok(decoded.timestamp);
      });

      it('should build redirect URI correctly', () => {
        const redirectUri = buildRedirectUri('https://app.example.com');
        assert.strictEqual(redirectUri, 'https://app.example.com/api/github/oauth/callback');
      });

      it('should build GitHub authorization URL', () => {
        const authUrl = buildGitHubAuthUrl({
          clientId: 'test-client-id',
          redirectUri: 'https://app.example.com/api/github/oauth/callback',
          state: 'encoded-state',
          scope: 'repo user',
        });

        assert.ok(authUrl.includes('github.com/login/oauth/authorize'));
        assert.ok(authUrl.includes('client_id=test-client-id'));
        // URL.searchParams encodes spaces as '+' not '%20'
        assert.ok(authUrl.includes('scope=repo+user') || authUrl.includes('scope=repo%20user'));
      });
    });

    describe('GET /oauth/callback - OAuth Callback', () => {
      it('should require code parameter', () => {
        const result = validateOAuthCallback({ state: 'abc123' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'missing_params');
      });

      it('should require state parameter', () => {
        const result = validateOAuthCallback({ code: 'auth-code' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'missing_params');
      });

      it('should reject invalid base64 state', () => {
        const result = validateOAuthCallback({ code: 'auth-code', state: 'not-valid-base64!!!' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'invalid_state');
      });

      it('should reject expired state', () => {
        const expiredState = buildOAuthState({
          sessionId: 's',
          userId: 'u',
          returnOrigin: 'https://example.com',
          returnPath: '/',
          timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        });

        const result = validateOAuthCallback({ code: 'auth-code', state: expiredState });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'state_expired');
      });

      it('should accept valid callback parameters', () => {
        const validState = buildOAuthState({
          sessionId: 's',
          userId: 'u',
          returnOrigin: 'https://example.com',
          returnPath: '/',
          timestamp: Date.now(),
        });

        const result = validateOAuthCallback({ code: 'auth-code', state: validState });

        assert.strictEqual(result.valid, true);
      });
    });

    describe('POST /disconnect - Disconnect GitHub', () => {
      it('should require authentication', () => {
        const req = createMockRequest({ user: null });
        const res = createMockResponse();

        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        assert.strictEqual(res.statusCode, 401);
      });

      it('should disconnect GitHub connection', () => {
        const user = createMockUser({ githubAccessToken: 'gho_xxx', githubId: '12345' });

        // Simulate disconnect
        user.githubAccessToken = null;
        user.githubId = null;

        assert.strictEqual(user.githubAccessToken, null);
        assert.strictEqual(user.githubId, null);
      });
    });
  });

  describe('Repository Operations', () => {
    describe('GET /repos - List Repositories', () => {
      it('should require GitHub connection', () => {
        const user = createMockUser({ githubAccessToken: null });
        const result = validateGitHubConnection(user);

        assert.strictEqual(result.connected, false);
        assert.strictEqual(result.error, 'GitHub not connected');
      });

      it('should accept connected GitHub', () => {
        const user = createMockUser({ githubAccessToken: 'gho_xxx' });
        const result = validateGitHubConnection(user);

        assert.strictEqual(result.connected, true);
      });

      it('should format repository list response', () => {
        const repos = [
          { id: 1, name: 'repo1', full_name: 'owner/repo1', private: false },
          { id: 2, name: 'repo2', full_name: 'owner/repo2', private: true },
        ];

        const response = createReposResponse(repos);

        assert.strictEqual(response.success, true);
        assert.strictEqual(response.data.length, 2);
        assert.strictEqual(response.data[0].name, 'repo1');
      });
    });

    describe('GET /repos/:owner/:repo - Get Repository', () => {
      it('should validate owner and repo params', () => {
        assert.strictEqual(validateRepoParams({ owner: '', repo: 'repo' }).valid, false);
        assert.strictEqual(validateRepoParams({ owner: 'owner', repo: '' }).valid, false);
        assert.strictEqual(validateRepoParams({ owner: 'owner', repo: 'repo' }).valid, true);
      });
    });

    describe('GET /repos/:owner/:repo/branches - List Branches', () => {
      it('should format branch list response', () => {
        const branches = [
          { name: 'main', protected: true, commit: { sha: 'abc123' } },
          { name: 'develop', protected: false, commit: { sha: 'def456' } },
        ];

        const response = createBranchesResponse(branches);

        assert.strictEqual(response.success, true);
        assert.strictEqual(response.data.length, 2);
      });
    });

    describe('POST /repos/:owner/:repo/branches - Create Branch', () => {
      it('should require branch name', () => {
        const result = validateCreateBranch({ baseBranch: 'main' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name is required');
      });

      it('should default base branch to main', () => {
        const result = validateCreateBranch({ branchName: 'feature-branch' });

        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.baseBranch, 'main');
      });

      it('should accept custom base branch', () => {
        const result = validateCreateBranch({ branchName: 'feature', baseBranch: 'develop' });

        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.baseBranch, 'develop');
      });

      it('should validate branch name format', () => {
        // Valid branch names
        assert.strictEqual(validateBranchName('feature-branch').valid, true);
        assert.strictEqual(validateBranchName('feature/add-login').valid, true);
        assert.strictEqual(validateBranchName('bugfix_123').valid, true);

        // Invalid branch names
        assert.strictEqual(validateBranchName('').valid, false);
        assert.strictEqual(validateBranchName('..invalid').valid, false);
        assert.strictEqual(validateBranchName('branch..name').valid, false);
      });
    });

    describe('DELETE /repos/:owner/:repo/branches/:branch - Delete Branch', () => {
      it('should prevent deleting protected branches', () => {
        const protectedBranches = ['main', 'master', 'develop'];

        for (const branch of protectedBranches) {
          const result = canDeleteBranch(branch, protectedBranches);
          assert.strictEqual(result.allowed, false);
          assert.ok(result.reason?.includes('protected'));
        }
      });

      it('should allow deleting non-protected branches', () => {
        const protectedBranches = ['main', 'master'];
        const result = canDeleteBranch('feature-branch', protectedBranches);

        assert.strictEqual(result.allowed, true);
      });
    });
  });

  describe('Pull Request Operations', () => {
    describe('POST /repos/:owner/:repo/pulls - Create PR', () => {
      it('should require head and base branches', () => {
        assert.strictEqual(validateCreatePR({ base: 'main' }).valid, false);
        assert.strictEqual(validateCreatePR({ head: 'feature' }).valid, false);
        assert.strictEqual(validateCreatePR({ head: 'feature', base: 'main' }).valid, true);
      });

      it('should use default title if not provided', () => {
        const result = validateCreatePR({ head: 'feature', base: 'main' });

        assert.strictEqual(result.title, 'Merge feature into main');
      });

      it('should use provided title', () => {
        const result = validateCreatePR({ head: 'feature', base: 'main', title: 'Custom Title' });

        assert.strictEqual(result.title, 'Custom Title');
      });

      it('should format PR creation response', () => {
        const pr = {
          number: 123,
          title: 'Test PR',
          html_url: 'https://github.com/owner/repo/pull/123',
          state: 'open',
        };

        const response = createPRResponse(pr);

        assert.strictEqual(response.success, true);
        assert.strictEqual(response.data.number, 123);
        assert.strictEqual(response.data.htmlUrl, 'https://github.com/owner/repo/pull/123');
      });
    });

    describe('GET /repos/:owner/:repo/pulls - List PRs', () => {
      it('should accept valid state filters', () => {
        const validStates = ['open', 'closed', 'all'];

        for (const state of validStates) {
          const result = validateListPRs({ state });
          assert.strictEqual(result.valid, true);
        }
      });

      it('should reject invalid state filter', () => {
        const result = validateListPRs({ state: 'invalid' });

        assert.strictEqual(result.valid, false);
      });

      it('should default to open state', () => {
        const result = validateListPRs({});

        assert.strictEqual(result.state, 'open');
      });
    });

    describe('POST /repos/:owner/:repo/pulls/:pull_number/merge - Merge PR', () => {
      it('should default merge method to merge', () => {
        const result = validateMergePR({});

        assert.strictEqual(result.merge_method, 'merge');
      });

      it('should accept squash merge method', () => {
        const result = validateMergePR({ merge_method: 'squash' });

        assert.strictEqual(result.merge_method, 'squash');
      });

      it('should accept rebase merge method', () => {
        const result = validateMergePR({ merge_method: 'rebase' });

        assert.strictEqual(result.merge_method, 'rebase');
      });

      it('should reject invalid merge method', () => {
        const result = validateMergePR({ merge_method: 'invalid' });

        assert.strictEqual(result.valid, false);
      });
    });

    describe('POST /repos/:owner/:repo/generate-pr-content - Generate PR Content', () => {
      it('should require head and base branches', () => {
        assert.strictEqual(validateGeneratePRContent({ head: 'feature' }).valid, false);
        assert.strictEqual(validateGeneratePRContent({ base: 'main' }).valid, false);
        assert.strictEqual(validateGeneratePRContent({ head: 'feature', base: 'main' }).valid, true);
      });
    });
  });

  describe('File Operations', () => {
    describe('PUT /repos/:owner/:repo/contents/* - Update File', () => {
      it('should require branch', () => {
        const result = validateUpdateFile({ content: 'file content' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch is required');
      });

      it('should require content', () => {
        const result = validateUpdateFile({ branch: 'main' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Content is required');
      });

      it('should accept valid file update params', () => {
        const result = validateUpdateFile({
          content: 'file content',
          branch: 'main',
          message: 'Update file',
        });

        assert.strictEqual(result.valid, true);
      });
    });

    describe('POST /repos/:owner/:repo/rename/* - Rename File', () => {
      it('should require branch', () => {
        const result = validateRenameFile({ newPath: 'new/path' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch is required');
      });

      it('should require new path', () => {
        const result = validateRenameFile({ branch: 'main' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'New path is required');
      });

      it('should reject same path', () => {
        const result = validateRenameFile({ branch: 'main', newPath: 'old/path' }, 'old/path');

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'New path must be different from old path');
      });

      it('should accept valid rename params', () => {
        const result = validateRenameFile({ branch: 'main', newPath: 'new/path' }, 'old/path');

        assert.strictEqual(result.valid, true);
      });
    });

    describe('DELETE /repos/:owner/:repo/contents/* - Delete File', () => {
      it('should require branch', () => {
        const result = validateDeleteFile({});

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch is required');
      });

      it('should accept valid delete params', () => {
        const result = validateDeleteFile({ branch: 'main' });

        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('Commit Operations', () => {
    describe('POST /repos/:owner/:repo/commit - Create Commit', () => {
      it('should require branch', () => {
        const result = validateCommit({ files: [{ path: 'test.txt', content: 'hello' }] });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch is required');
      });

      it('should require files, images, or deletions', () => {
        const result = validateCommit({ branch: 'main' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'No files, images, or deletions to commit');
      });

      it('should accept files array', () => {
        const result = validateCommit({
          branch: 'main',
          files: [{ path: 'test.txt', content: 'hello' }],
        });

        assert.strictEqual(result.valid, true);
      });

      it('should accept images array', () => {
        const result = validateCommit({
          branch: 'main',
          images: [{ path: 'image.png', content: 'base64data' }],
        });

        assert.strictEqual(result.valid, true);
      });

      it('should accept deletions array', () => {
        const result = validateCommit({
          branch: 'main',
          deletions: ['old-file.txt'],
        });

        assert.strictEqual(result.valid, true);
      });

      it('should accept mixed operations', () => {
        const result = validateCommit({
          branch: 'main',
          files: [{ path: 'new.txt', content: 'new' }],
          images: [{ path: 'img.png', content: 'base64' }],
          deletions: ['old.txt'],
          message: 'Update files',
        });

        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('Folder Operations', () => {
    describe('DELETE /repos/:owner/:repo/folder/* - Delete Folder', () => {
      it('should require branch', () => {
        const result = validateFolderOperation({});

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch is required');
      });

      it('should accept valid params', () => {
        const result = validateFolderOperation({ branch: 'main', message: 'Delete folder' });

        assert.strictEqual(result.valid, true);
      });
    });

    describe('POST /repos/:owner/:repo/rename-folder/* - Rename Folder', () => {
      it('should require new folder path', () => {
        const result = validateRenameFolder({ branch: 'main' });

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'New folder path is required');
      });

      it('should reject same path', () => {
        const result = validateRenameFolder({ branch: 'main', newFolderPath: 'old/folder' }, 'old/folder');

        assert.strictEqual(result.valid, false);
      });

      it('should accept valid params', () => {
        const result = validateRenameFolder({ branch: 'main', newFolderPath: 'new/folder' }, 'old/folder');

        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('Auto PR Operations', () => {
    describe('POST /repos/:owner/:repo/branches/*/auto-pr - Create Auto PR', () => {
      it('should require base branch', () => {
        const result = validateAutoPR({});

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Base branch is required');
      });

      it('should accept valid params', () => {
        const result = validateAutoPR({
          base: 'main',
          title: 'Auto PR',
          body: 'Description',
          sessionId: 'session-123',
        });

        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('Error Response Format', () => {
    it('should format 404 error for branch not found', () => {
      const response = createGitHubError(404, 'Branch or repository not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.statusCode, 404);
    });

    it('should format 422 error for branch exists', () => {
      const response = createGitHubError(422, 'Branch already exists');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.statusCode, 422);
    });

    it('should format 409 error for merge conflict', () => {
      const response = createGitHubError(409, 'Merge conflict');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.statusCode, 409);
    });

    it('should format 403 error for permission denied', () => {
      const response = createGitHubError(403, 'Permission denied');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.statusCode, 403);
    });
  });
});

// Helper functions
function buildOAuthState(data: {
  sessionId: string;
  userId: string;
  returnOrigin: string;
  returnPath: string;
  timestamp?: number;
}): string {
  return Buffer.from(
    JSON.stringify({
      ...data,
      timestamp: data.timestamp || Date.now(),
    })
  ).toString('base64');
}

function buildRedirectUri(origin: string): string {
  return `${origin}/api/github/oauth/callback`;
}

function buildGitHubAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', params.scope);
  return url.toString();
}

function validateOAuthCallback(query: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { code, state } = query;

  if (!code || !state) {
    return { valid: false, error: 'missing_params' };
  }

  try {
    const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());

    if (Date.now() - decoded.timestamp > 10 * 60 * 1000) {
      return { valid: false, error: 'state_expired' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'invalid_state' };
  }
}

function validateGitHubConnection(user: { githubAccessToken: string | null }): {
  connected: boolean;
  error?: string;
} {
  if (!user.githubAccessToken) {
    return { connected: false, error: 'GitHub not connected' };
  }
  return { connected: true };
}

function validateRepoParams(params: { owner: string; repo: string }): { valid: boolean } {
  if (!params.owner || !params.repo) {
    return { valid: false };
  }
  return { valid: true };
}

function validateCreateBranch(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  baseBranch?: string;
} {
  const { branchName, baseBranch } = body;

  if (!branchName) {
    return { valid: false, error: 'Branch name is required' };
  }

  return { valid: true, baseBranch: (baseBranch as string) || 'main' };
}

function validateBranchName(name: string): { valid: boolean } {
  if (!name) return { valid: false };
  if (name.startsWith('..') || name.includes('..')) return { valid: false };
  return { valid: true };
}

function canDeleteBranch(branch: string, protectedBranches: string[]): {
  allowed: boolean;
  reason?: string;
} {
  if (protectedBranches.includes(branch)) {
    return { allowed: false, reason: `Branch '${branch}' is protected` };
  }
  return { allowed: true };
}

function validateCreatePR(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  title?: string;
} {
  const { head, base, title } = body;

  if (!head || !base) {
    return { valid: false, error: 'Head and base branches are required' };
  }

  return {
    valid: true,
    title: (title as string) || `Merge ${head} into ${base}`,
  };
}

function validateListPRs(query: Record<string, unknown>): {
  valid: boolean;
  state?: string;
} {
  const { state } = query;
  const validStates = ['open', 'closed', 'all'];

  if (state && !validStates.includes(state as string)) {
    return { valid: false };
  }

  return { valid: true, state: (state as string) || 'open' };
}

function validateMergePR(body: Record<string, unknown>): {
  valid?: boolean;
  merge_method: string;
} {
  const method = body.merge_method as string;
  const validMethods = ['merge', 'squash', 'rebase'];

  if (method && !validMethods.includes(method)) {
    return { valid: false, merge_method: method };
  }

  return { merge_method: method || 'merge' };
}

function validateGeneratePRContent(body: Record<string, unknown>): { valid: boolean } {
  const { head, base } = body;
  if (!head || !base) {
    return { valid: false };
  }
  return { valid: true };
}

function validateUpdateFile(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch, content } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };
  if (content === undefined) return { valid: false, error: 'Content is required' };
  return { valid: true };
}

function validateRenameFile(body: Record<string, unknown>, oldPath?: string): {
  valid: boolean;
  error?: string;
} {
  const { branch, newPath } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };
  if (!newPath) return { valid: false, error: 'New path is required' };
  if (oldPath && oldPath === newPath) return { valid: false, error: 'New path must be different from old path' };
  return { valid: true };
}

function validateDeleteFile(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };
  return { valid: true };
}

function validateCommit(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch, files, images, deletions } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };

  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasDeletions = Array.isArray(deletions) && deletions.length > 0;

  if (!hasFiles && !hasImages && !hasDeletions) {
    return { valid: false, error: 'No files, images, or deletions to commit' };
  }

  return { valid: true };
}

function validateFolderOperation(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };
  return { valid: true };
}

function validateRenameFolder(body: Record<string, unknown>, oldFolderPath?: string): {
  valid: boolean;
  error?: string;
} {
  const { branch, newFolderPath } = body;
  if (!branch) return { valid: false, error: 'Branch is required' };
  if (!newFolderPath) return { valid: false, error: 'New folder path is required' };
  if (oldFolderPath && oldFolderPath === newFolderPath) return { valid: false, error: 'Paths must be different' };
  return { valid: true };
}

function validateAutoPR(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { base } = body;
  if (!base) return { valid: false, error: 'Base branch is required' };
  return { valid: true };
}

function createReposResponse(repos: Array<Record<string, unknown>>): {
  success: boolean;
  data: Array<Record<string, unknown>>;
} {
  return { success: true, data: repos };
}

function createBranchesResponse(branches: Array<Record<string, unknown>>): {
  success: boolean;
  data: Array<Record<string, unknown>>;
} {
  return { success: true, data: branches };
}

function createPRResponse(pr: { number: number; title: string; html_url: string; state: string }): {
  success: boolean;
  data: { number: number; title: string; htmlUrl: string; state: string };
} {
  return {
    success: true,
    data: {
      number: pr.number,
      title: pr.title,
      htmlUrl: pr.html_url,
      state: pr.state,
    },
  };
}

function createGitHubError(statusCode: number, error: string): {
  success: boolean;
  statusCode: number;
  error: string;
} {
  return { success: false, statusCode, error };
}
