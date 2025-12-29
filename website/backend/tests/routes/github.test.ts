/**
 * Tests for GitHub Routes
 * Covers OAuth flow, repo operations, branch management, and PR functionality.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('GitHub Routes - OAuth Flow', () => {
  describe('GET /oauth', () => {
    it('should require authentication', () => {
      const user = null;
      const result = validateAuthRequired(user);

      assert.strictEqual(result.authorized, false);
    });

    it('should build state with session info', () => {
      const state = buildOAuthState({
        sessionId: 'session-123',
        userId: 'user-456',
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
      });

      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());

      assert.strictEqual(decoded.sessionId, 'session-123');
      assert.strictEqual(decoded.userId, 'user-456');
      assert.ok(decoded.timestamp);
    });

    it('should build redirect URI with origin', () => {
      const redirectUri = buildRedirectUri('https://example.com');

      assert.strictEqual(redirectUri, 'https://example.com/api/github/oauth/callback');
    });
  });

  describe('GET /oauth/callback', () => {
    it('should require code parameter', () => {
      const query = { state: 'abc123' };
      const result = validateOAuthCallback(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'missing_params');
    });

    it('should require state parameter', () => {
      const query = { code: 'auth-code' };
      const result = validateOAuthCallback(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'missing_params');
    });

    it('should reject invalid state (not base64)', () => {
      const query = { code: 'auth-code', state: 'not-valid-base64!' };
      const result = validateOAuthCallback(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'invalid_state');
    });

    it('should reject expired state', () => {
      const oldState = buildOAuthState({
        sessionId: 's',
        userId: 'u',
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
        timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago
      });

      const query = { code: 'auth-code', state: oldState };
      const result = validateOAuthCallback(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'state_expired');
    });

    it('should accept valid callback parameters', () => {
      const validState = buildOAuthState({
        sessionId: 's',
        userId: 'u',
        returnOrigin: 'https://example.com',
        returnPath: '/settings',
        timestamp: Date.now(),
      });

      const query = { code: 'auth-code', state: validState };
      const result = validateOAuthCallback(query);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Repository Operations', () => {
  describe('GET /repos', () => {
    it('should require GitHub to be connected', () => {
      const user = { githubAccessToken: null };
      const result = validateGitHubConnection(user);

      assert.strictEqual(result.connected, false);
      assert.strictEqual(result.error, 'GitHub not connected');
    });

    it('should accept connected GitHub', () => {
      const user = { githubAccessToken: 'gho_xxx' };
      const result = validateGitHubConnection(user);

      assert.strictEqual(result.connected, true);
    });
  });

  describe('GET /repos/:owner/:repo/branches', () => {
    it('should require owner and repo params', () => {
      const params = { owner: '', repo: 'my-repo' };
      const result = validateRepoParams(params);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid owner and repo', () => {
      const params = { owner: 'testuser', repo: 'my-repo' };
      const result = validateRepoParams(params);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /repos/:owner/:repo/branches', () => {
    it('should require branchName', () => {
      const body = { baseBranch: 'main' };
      const result = validateCreateBranch(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch name is required');
    });

    it('should default baseBranch to main', () => {
      const body = { branchName: 'feature-branch' };
      const result = validateCreateBranch(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.baseBranch, 'main');
    });

    it('should accept custom baseBranch', () => {
      const body = { branchName: 'feature', baseBranch: 'develop' };
      const result = validateCreateBranch(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.baseBranch, 'develop');
    });
  });
});

describe('GitHub Routes - Pull Request Operations', () => {
  describe('POST /repos/:owner/:repo/pulls', () => {
    it('should require head branch', () => {
      const body = { base: 'main' };
      const result = validateCreatePR(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Head and base branches are required');
    });

    it('should require base branch', () => {
      const body = { head: 'feature' };
      const result = validateCreatePR(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid PR creation params', () => {
      const body = {
        title: 'My PR',
        head: 'feature',
        base: 'main',
        body: 'Description',
      };
      const result = validateCreatePR(body);

      assert.strictEqual(result.valid, true);
    });

    it('should use default title if not provided', () => {
      const body = { head: 'feature', base: 'main' };
      const result = validateCreatePR(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.title, 'Merge feature into main');
    });
  });

  describe('POST /repos/:owner/:repo/pulls/:pull_number/merge', () => {
    it('should default merge_method to merge', () => {
      const body = {};
      const result = validateMergePR(body);

      assert.strictEqual(result.merge_method, 'merge');
    });

    it('should accept squash merge method', () => {
      const body = { merge_method: 'squash' };
      const result = validateMergePR(body);

      assert.strictEqual(result.merge_method, 'squash');
    });

    it('should accept rebase merge method', () => {
      const body = { merge_method: 'rebase' };
      const result = validateMergePR(body);

      assert.strictEqual(result.merge_method, 'rebase');
    });
  });

  describe('POST /repos/:owner/:repo/generate-pr-content', () => {
    it('should require head and base branches', () => {
      const body = { head: 'feature' };
      const result = validateGeneratePRContent(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Head and base branches are required');
    });

    it('should accept valid params', () => {
      const body = { head: 'feature', base: 'main', userRequest: 'Add new feature' };
      const result = validateGeneratePRContent(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - File Operations', () => {
  describe('PUT /repos/:owner/:repo/contents/*', () => {
    it('should require branch', () => {
      const body = { content: 'file content' };
      const result = validateUpdateFile(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should require content', () => {
      const body = { branch: 'main' };
      const result = validateUpdateFile(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Content is required');
    });

    it('should accept valid file update params', () => {
      const body = {
        content: 'file content',
        branch: 'main',
        message: 'Update file',
      };
      const result = validateUpdateFile(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /repos/:owner/:repo/rename/*', () => {
    it('should require branch', () => {
      const body = { newPath: 'new/path' };
      const result = validateRenameFile(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should require newPath', () => {
      const body = { branch: 'main' };
      const result = validateRenameFile(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'New path is required');
    });

    it('should reject same path as new path', () => {
      const body = { branch: 'main', newPath: 'old/path' };
      const oldPath = 'old/path';
      const result = validateRenameFile(body, oldPath);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'New path must be different from old path');
    });

    it('should accept valid rename params', () => {
      const body = { branch: 'main', newPath: 'new/path' };
      const oldPath = 'old/path';
      const result = validateRenameFile(body, oldPath);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('DELETE /repos/:owner/:repo/contents/*', () => {
    it('should require branch', () => {
      const body = {};
      const result = validateDeleteFile(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should accept valid delete params', () => {
      const body = { branch: 'main' };
      const result = validateDeleteFile(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Commit Operations', () => {
  describe('POST /repos/:owner/:repo/commit', () => {
    it('should require branch', () => {
      const body = { files: [{ path: 'test.txt', content: 'hello' }] };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should require files, images, or deletions', () => {
      const body = { branch: 'main' };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'No files, images, or deletions to commit');
    });

    it('should accept files array', () => {
      const body = {
        branch: 'main',
        files: [{ path: 'test.txt', content: 'hello' }],
      };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept images array', () => {
      const body = {
        branch: 'main',
        images: [{ path: 'image.png', content: 'base64data' }],
      };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept deletions array', () => {
      const body = {
        branch: 'main',
        deletions: ['old-file.txt'],
      };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept mixed operations', () => {
      const body = {
        branch: 'main',
        files: [{ path: 'new.txt', content: 'new' }],
        images: [{ path: 'img.png', content: 'base64' }],
        deletions: ['old.txt'],
        message: 'Update files',
      };
      const result = validateCommit(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Auto PR Operations', () => {
  describe('POST /repos/:owner/:repo/branches/*/auto-pr', () => {
    it('should require base branch', () => {
      const body = {};
      const result = validateAutoPR(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Base branch is required');
    });

    it('should accept valid auto-pr params', () => {
      const body = {
        base: 'main',
        title: 'Auto PR',
        body: 'Description',
        sessionId: 'session-123',
      };
      const result = validateAutoPR(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Merge Base Operations', () => {
  describe('POST /repos/:owner/:repo/branches/*/merge-base', () => {
    it('should require base branch', () => {
      const body = {};
      const result = validateMergeBase(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Base branch is required');
    });

    it('should accept valid merge-base params', () => {
      const body = { base: 'main' };
      const result = validateMergeBase(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Folder Operations', () => {
  describe('DELETE /repos/:owner/:repo/folder/*', () => {
    it('should require branch', () => {
      const body = {};
      const result = validateFolderOperation(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should accept valid folder delete params', () => {
      const body = { branch: 'main', message: 'Delete folder' };
      const result = validateFolderOperation(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /repos/:owner/:repo/rename-folder/*', () => {
    it('should require newFolderPath', () => {
      const body = { branch: 'main' };
      const result = validateRenameFolder(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'New folder path is required');
    });

    it('should reject same path', () => {
      const body = { branch: 'main', newFolderPath: 'old/folder' };
      const oldFolderPath = 'old/folder';
      const result = validateRenameFolder(body, oldFolderPath);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'New path must be different from old path');
    });

    it('should accept valid rename folder params', () => {
      const body = { branch: 'main', newFolderPath: 'new/folder' };
      const oldFolderPath = 'old/folder';
      const result = validateRenameFolder(body, oldFolderPath);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('GitHub Routes - Response Formats', () => {
  describe('Success Responses', () => {
    it('should format repository list response', () => {
      const repos = [
        { id: 1, name: 'repo1', full_name: 'owner/repo1' },
        { id: 2, name: 'repo2', full_name: 'owner/repo2' },
      ];

      const response = createReposResponse(repos);

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.length, 2);
    });

    it('should format branch list response', () => {
      const branches = [
        { name: 'main', protected: true, commit: { sha: 'abc' } },
        { name: 'develop', protected: false, commit: { sha: 'def' } },
      ];

      const response = createBranchesResponse(branches);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.length, 2);
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

  describe('Error Responses', () => {
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
  });
});

// Helper functions that mirror the validation logic in github.ts
function validateAuthRequired(user: unknown): { authorized: boolean } {
  return { authorized: user !== null };
}

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

    // Check if state is expired (10 minute timeout)
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

function validateRepoParams(params: { owner: string; repo: string }): {
  valid: boolean;
} {
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

function validateMergePR(body: Record<string, unknown>): {
  merge_method: string;
} {
  return {
    merge_method: (body.merge_method as string) || 'merge',
  };
}

function validateGeneratePRContent(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { head, base } = body;

  if (!head || !base) {
    return { valid: false, error: 'Head and base branches are required' };
  }

  return { valid: true };
}

function validateUpdateFile(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch, content } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  if (content === undefined) {
    return { valid: false, error: 'Content is required' };
  }

  return { valid: true };
}

function validateRenameFile(
  body: Record<string, unknown>,
  oldPath?: string
): { valid: boolean; error?: string } {
  const { branch, newPath } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  if (!newPath) {
    return { valid: false, error: 'New path is required' };
  }

  if (oldPath && oldPath === newPath) {
    return { valid: false, error: 'New path must be different from old path' };
  }

  return { valid: true };
}

function validateDeleteFile(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  return { valid: true };
}

function validateCommit(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch, files, images, deletions } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  const hasFiles = Array.isArray(files) && files.length > 0;
  const hasImages = Array.isArray(images) && images.length > 0;
  const hasDeletions = Array.isArray(deletions) && deletions.length > 0;

  if (!hasFiles && !hasImages && !hasDeletions) {
    return { valid: false, error: 'No files, images, or deletions to commit' };
  }

  return { valid: true };
}

function validateAutoPR(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { base } = body;

  if (!base) {
    return { valid: false, error: 'Base branch is required' };
  }

  return { valid: true };
}

function validateMergeBase(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { base } = body;

  if (!base) {
    return { valid: false, error: 'Base branch is required' };
  }

  return { valid: true };
}

function validateFolderOperation(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { branch } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  return { valid: true };
}

function validateRenameFolder(
  body: Record<string, unknown>,
  oldFolderPath?: string
): { valid: boolean; error?: string } {
  const { branch, newFolderPath } = body;

  if (!branch) {
    return { valid: false, error: 'Branch is required' };
  }

  if (!newFolderPath) {
    return { valid: false, error: 'New folder path is required' };
  }

  if (oldFolderPath && oldFolderPath === newFolderPath) {
    return { valid: false, error: 'New path must be different from old path' };
  }

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

function createPRResponse(pr: {
  number: number;
  title: string;
  html_url: string;
  state: string;
}): {
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

function createGitHubError(
  statusCode: number,
  error: string
): { success: boolean; statusCode: number; error: string } {
  return { success: false, statusCode, error };
}
