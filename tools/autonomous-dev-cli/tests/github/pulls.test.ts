/**
 * Tests for the GitHub Pull Requests Manager.
 * Covers PR CRUD, merging, status checks, and graceful degradation.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createPRManager,
  type PullRequest,
  type PRManager,
  type CreatePROptions,
  type MergeResult,
  type DegradedResult,
} from './pulls.js';
import { type GitHubClient, type ServiceHealth } from './client.js';

// Mock Octokit responses
function createMockOctokit() {
  return {
    pulls: {
      list: mock.fn(),
      get: mock.fn(),
      create: mock.fn(),
      update: mock.fn(),
      merge: mock.fn(),
    },
    repos: {
      getCombinedStatusForRef: mock.fn(),
      merge: mock.fn(),
    },
  };
}

// Create a mock GitHub client
function createMockClient(overrides: Record<string, any> = {}): GitHubClient {
  const mockOctokit = createMockOctokit();
  return {
    client: mockOctokit,
    owner: 'test-owner',
    repo: 'test-repo',
    verifyAuth: mock.fn(async () => ({ login: 'test-user' })),
    getRepo: mock.fn(async () => ({ fullName: 'test-owner/test-repo', defaultBranch: 'main' })),
    getServiceHealth: mock.fn(() => ({
      status: 'healthy',
      circuitState: 'closed',
      consecutiveFailures: 0,
      rateLimitRemaining: 5000,
      lastSuccessfulCall: new Date(),
    })),
    isAvailable: mock.fn(() => true),
    execute: mock.fn(async <T>(operation: () => Promise<T>) => {
      return operation();
    }),
    executeWithFallback: mock.fn(async <T>(operation: () => Promise<T>, fallback: T) => {
      try {
        const value = await operation();
        return { value, degraded: false };
      } catch (error) {
        return { value: fallback, degraded: true };
      }
    }),
    getCachedOrFetch: mock.fn(async <T>(_type: string, _key: string, fetcher: () => Promise<T>) => {
      return fetcher();
    }),
    ...overrides,
  } as unknown as GitHubClient;
}

// Helper to create mock API PR response
function createMockApiPR(overrides: Record<string, any> = {}) {
  return {
    number: 1,
    title: 'Test PR',
    body: 'PR description',
    state: 'open',
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    html_url: 'https://github.com/owner/repo/pull/1',
    mergeable: true,
    merged: false,
    draft: false,
    ...overrides,
  };
}

describe('PRManager', () => {
  let prManager: PRManager;
  let mockClient: GitHubClient;
  let mockOctokit: ReturnType<typeof createMockOctokit>;

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    mockClient = createMockClient({ client: mockOctokit });
    prManager = createPRManager(mockClient);
  });

  describe('listOpenPRs', () => {
    it('should return list of open PRs', async () => {
      const mockPRs = [
        createMockApiPR({ number: 1, title: 'PR 1' }),
        createMockApiPR({ number: 2, title: 'PR 2' }),
      ];

      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: mockPRs,
      }));

      const prs = await prManager.listOpenPRs();

      assert.strictEqual(prs.length, 2);
      assert.strictEqual(prs[0].number, 1);
      assert.strictEqual(prs[1].number, 2);
    });

    it('should call API with correct parameters', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      await prManager.listOpenPRs();

      const call = mockOctokit.pulls.list.mock.calls[0];
      assert.strictEqual(call.arguments[0].owner, 'test-owner');
      assert.strictEqual(call.arguments[0].repo, 'test-repo');
      assert.strictEqual(call.arguments[0].state, 'open');
      assert.strictEqual(call.arguments[0].per_page, 100);
    });

    it('should throw on API failure', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      await assert.rejects(
        async () => prManager.listOpenPRs(),
        /API Error/
      );
    });
  });

  describe('listOpenPRsWithFallback', () => {
    it('should return PRs with degraded false on success', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [createMockApiPR()],
      }));

      const result = await prManager.listOpenPRsWithFallback();

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.length, 1);
    });

    it('should return fallback with degraded true on failure', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const fallback: PullRequest[] = [
        {
          number: 99,
          title: 'Fallback PR',
          body: 'Cached',
          state: 'open',
          head: { ref: 'branch', sha: 'sha1' },
          base: { ref: 'main', sha: 'sha2' },
          htmlUrl: 'https://github.com/owner/repo/pull/99',
          mergeable: true,
          merged: false,
          draft: false,
        },
      ];

      const result = await prManager.listOpenPRsWithFallback(fallback);

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value[0].number, 99);
    });
  });

  describe('getPR', () => {
    it('should return PR details', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR({ number: 42, title: 'Specific PR' }),
      }));

      const pr = await prManager.getPR(42);

      assert.ok(pr);
      assert.strictEqual(pr.number, 42);
      assert.strictEqual(pr.title, 'Specific PR');
    });

    it('should return null for non-existent PR', async () => {
      const notFoundError: any = new Error('Not Found');
      notFoundError.status = 404;
      mockOctokit.pulls.get.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      const pr = await prManager.getPR(999);

      assert.strictEqual(pr, null);
    });

    it('should throw for other errors', async () => {
      const serverError: any = new Error('Server Error');
      serverError.status = 500;
      mockOctokit.pulls.get.mock.mockImplementation(async () => {
        throw serverError;
      });

      await assert.rejects(
        async () => prManager.getPR(1),
        /Server Error/
      );
    });

    it('should map head and base correctly', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR({
          head: { ref: 'feature/test', sha: 'head-sha-123' },
          base: { ref: 'develop', sha: 'base-sha-456' },
        }),
      }));

      const pr = await prManager.getPR(1);

      assert.ok(pr);
      assert.strictEqual(pr.head.ref, 'feature/test');
      assert.strictEqual(pr.head.sha, 'head-sha-123');
      assert.strictEqual(pr.base.ref, 'develop');
      assert.strictEqual(pr.base.sha, 'base-sha-456');
    });
  });

  describe('findPRForBranch', () => {
    it('should find PR for branch', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [createMockApiPR({ head: { ref: 'feature/test', sha: 'abc' } })],
      }));

      const pr = await prManager.findPRForBranch('feature/test');

      assert.ok(pr);
      assert.strictEqual(pr.head.ref, 'feature/test');
    });

    it('should return null if no PR found', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      const pr = await prManager.findPRForBranch('nonexistent-branch');

      assert.strictEqual(pr, null);
    });

    it('should filter by base branch when provided', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      await prManager.findPRForBranch('feature', 'develop');

      const call = mockOctokit.pulls.list.mock.calls[0];
      assert.strictEqual(call.arguments[0].base, 'develop');
    });

    it('should format head parameter correctly', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      await prManager.findPRForBranch('my-branch');

      const call = mockOctokit.pulls.list.mock.calls[0];
      assert.strictEqual(call.arguments[0].head, 'test-owner:my-branch');
    });
  });

  describe('createPR', () => {
    it('should create a new PR', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      mockOctokit.pulls.create.mock.mockImplementation(async () => ({
        data: createMockApiPR({
          number: 123,
          title: 'New PR',
          head: { ref: 'feature/new', sha: 'abc' },
        }),
      }));

      const options: CreatePROptions = {
        title: 'New PR',
        body: 'Description',
        head: 'feature/new',
        base: 'main',
      };

      const pr = await prManager.createPR(options);

      assert.strictEqual(pr.number, 123);
      assert.strictEqual(pr.title, 'New PR');
    });

    it('should return existing PR if already exists', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [createMockApiPR({
          number: 42,
          title: 'Existing PR',
          head: { ref: 'feature/existing', sha: 'abc' },
        })],
      }));

      const options: CreatePROptions = {
        title: 'New PR',
        body: 'Description',
        head: 'feature/existing',
        base: 'main',
      };

      const pr = await prManager.createPR(options);

      assert.strictEqual(pr.number, 42);
      assert.strictEqual(mockOctokit.pulls.create.mock.callCount(), 0);
    });

    it('should handle PR already exists error', async () => {
      // First call returns no PRs
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      const alreadyExistsError: any = new Error('A pull request already exists');
      alreadyExistsError.message = 'A pull request already exists for this branch';
      mockOctokit.pulls.create.mock.mockImplementation(async () => {
        throw alreadyExistsError;
      });

      // After error, find the existing PR
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [createMockApiPR({ number: 99 })],
      }));

      const options: CreatePROptions = {
        title: 'New PR',
        body: 'Description',
        head: 'feature',
        base: 'main',
      };

      const pr = await prManager.createPR(options);

      assert.strictEqual(pr.number, 99);
    });

    it('should create draft PR when specified', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      mockOctokit.pulls.create.mock.mockImplementation(async () => ({
        data: createMockApiPR({ draft: true }),
      }));

      const options: CreatePROptions = {
        title: 'Draft PR',
        body: 'WIP',
        head: 'feature',
        base: 'main',
        draft: true,
      };

      await prManager.createPR(options);

      const call = mockOctokit.pulls.create.mock.calls[0];
      assert.strictEqual(call.arguments[0].draft, true);
    });
  });

  describe('createPRWithFallback', () => {
    it('should return PR with degraded false on success', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => ({
        data: [],
      }));

      mockOctokit.pulls.create.mock.mockImplementation(async () => ({
        data: createMockApiPR(),
      }));

      const result = await prManager.createPRWithFallback({
        title: 'Test',
        body: 'Body',
        head: 'branch',
        base: 'main',
      });

      assert.strictEqual(result.degraded, false);
      assert.ok(result.value);
    });

    it('should return null with degraded true on failure', async () => {
      mockOctokit.pulls.list.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const result = await prManager.createPRWithFallback({
        title: 'Test',
        body: 'Body',
        head: 'branch',
        base: 'main',
      });

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value, null);
    });
  });

  describe('mergePR', () => {
    it('should merge PR successfully', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => ({
        data: {
          merged: true,
          sha: 'merge-sha-123',
          message: 'Pull Request successfully merged',
        },
      }));

      const result = await prManager.mergePR(1);

      assert.strictEqual(result.merged, true);
      assert.strictEqual(result.sha, 'merge-sha-123');
    });

    it('should use squash merge by default', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => ({
        data: { merged: true, sha: 'sha', message: 'Merged' },
      }));

      await prManager.mergePR(1);

      const call = mockOctokit.pulls.merge.mock.calls[0];
      assert.strictEqual(call.arguments[0].merge_method, 'squash');
    });

    it('should support different merge methods', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => ({
        data: { merged: true, sha: 'sha', message: 'Merged' },
      }));

      await prManager.mergePR(1, 'rebase');

      const call = mockOctokit.pulls.merge.mock.calls[0];
      assert.strictEqual(call.arguments[0].merge_method, 'rebase');
    });

    it('should return failed result on merge failure', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => {
        throw new Error('Merge conflict');
      });

      const result = await prManager.mergePR(1);

      assert.strictEqual(result.merged, false);
      assert.strictEqual(result.sha, null);
      assert.ok(result.message.includes('Merge conflict'));
    });
  });

  describe('mergePRWithFallback', () => {
    it('should return result with degraded false on success', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => ({
        data: { merged: true, sha: 'sha', message: 'Merged' },
      }));

      const result = await prManager.mergePRWithFallback(1);

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.merged, true);
    });

    it('should return failed result with degraded true on API error', async () => {
      mockOctokit.pulls.merge.mock.mockImplementation(async () => {
        throw new Error('Service unavailable');
      });

      const result = await prManager.mergePRWithFallback(1);

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value.merged, false);
    });
  });

  describe('closePR', () => {
    it('should close PR', async () => {
      mockOctokit.pulls.update.mock.mockImplementation(async () => ({}));

      await prManager.closePR(1);

      const call = mockOctokit.pulls.update.mock.calls[0];
      assert.strictEqual(call.arguments[0].pull_number, 1);
      assert.strictEqual(call.arguments[0].state, 'closed');
    });

    it('should throw on failure', async () => {
      mockOctokit.pulls.update.mock.mockImplementation(async () => {
        throw new Error('Not authorized');
      });

      await assert.rejects(
        async () => prManager.closePR(1),
        /Not authorized/
      );
    });
  });

  describe('updatePRFromBase', () => {
    it('should merge base branch into PR branch', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR({
          head: { ref: 'feature', sha: 'head' },
          base: { ref: 'main', sha: 'base' },
        }),
      }));

      mockOctokit.repos.merge.mock.mockImplementation(async () => ({}));

      const result = await prManager.updatePRFromBase(1);

      assert.strictEqual(result, true);
      const call = mockOctokit.repos.merge.mock.calls[0];
      assert.strictEqual(call.arguments[0].base, 'feature');
      assert.strictEqual(call.arguments[0].head, 'main');
    });

    it('should return false if PR not found', async () => {
      const notFoundError: any = new Error('Not Found');
      notFoundError.status = 404;
      mockOctokit.pulls.get.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      const result = await prManager.updatePRFromBase(999);

      assert.strictEqual(result, false);
    });

    it('should return true if already up to date (204)', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR(),
      }));

      const noContentError: any = new Error('Already up to date');
      noContentError.status = 204;
      mockOctokit.repos.merge.mock.mockImplementation(async () => {
        throw noContentError;
      });

      const result = await prManager.updatePRFromBase(1);

      assert.strictEqual(result, true);
    });

    it('should return false on merge conflict (409)', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR(),
      }));

      const conflictError: any = new Error('Merge conflict');
      conflictError.status = 409;
      mockOctokit.repos.merge.mock.mockImplementation(async () => {
        throw conflictError;
      });

      const result = await prManager.updatePRFromBase(1);

      assert.strictEqual(result, false);
    });
  });

  describe('waitForMergeable', () => {
    it('should return true when mergeable', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR({ mergeable: true }),
      }));

      const result = await prManager.waitForMergeable(1, 5);

      assert.strictEqual(result, true);
    });

    it('should return false when not mergeable', async () => {
      mockOctokit.pulls.get.mock.mockImplementation(async () => ({
        data: createMockApiPR({ mergeable: false }),
      }));

      const result = await prManager.waitForMergeable(1, 1);

      assert.strictEqual(result, false);
    });

    it('should return false if PR not found', async () => {
      const notFoundError: any = new Error('Not Found');
      notFoundError.status = 404;
      mockOctokit.pulls.get.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      const result = await prManager.waitForMergeable(999, 1);

      assert.strictEqual(result, false);
    });

    it('should poll when mergeable is null', async () => {
      let callCount = 0;
      mockOctokit.pulls.get.mock.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          return { data: createMockApiPR({ mergeable: null }) };
        }
        return { data: createMockApiPR({ mergeable: true }) };
      });

      const result = await prManager.waitForMergeable(1, 5);

      assert.strictEqual(result, true);
      assert.ok(callCount >= 3);
    });
  });

  describe('getChecksStatus', () => {
    it('should return combined status', async () => {
      mockOctokit.repos.getCombinedStatusForRef.mock.mockImplementation(async () => ({
        data: {
          state: 'success',
          statuses: [
            { context: 'ci/test', state: 'success' },
            { context: 'ci/build', state: 'success' },
          ],
        },
      }));

      const status = await prManager.getChecksStatus('abc123');

      assert.strictEqual(status.state, 'success');
      assert.strictEqual(status.statuses.length, 2);
    });

    it('should throw on failure', async () => {
      mockOctokit.repos.getCombinedStatusForRef.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      await assert.rejects(
        async () => prManager.getChecksStatus('abc123'),
        /API Error/
      );
    });
  });

  describe('getServiceHealth', () => {
    it('should return service health from client', () => {
      const health = prManager.getServiceHealth();

      assert.strictEqual(health.status, 'healthy');
    });
  });

  describe('isAvailable', () => {
    it('should return availability from client', () => {
      const available = prManager.isAvailable();

      assert.strictEqual(available, true);
    });
  });
});

describe('PullRequest interface', () => {
  it('should have all required properties', () => {
    const pr: PullRequest = {
      number: 1,
      title: 'Test PR',
      body: 'Description',
      state: 'open',
      head: { ref: 'feature', sha: 'abc123' },
      base: { ref: 'main', sha: 'def456' },
      htmlUrl: 'https://github.com/owner/repo/pull/1',
      mergeable: true,
      merged: false,
      draft: false,
    };

    assert.strictEqual(pr.number, 1);
    assert.strictEqual(pr.head.ref, 'feature');
    assert.strictEqual(pr.base.ref, 'main');
  });

  it('should handle null body', () => {
    const pr: PullRequest = {
      number: 1,
      title: 'No Body',
      body: null,
      state: 'open',
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main', sha: 'def' },
      htmlUrl: 'https://github.com/owner/repo/pull/1',
      mergeable: null,
      merged: false,
      draft: false,
    };

    assert.strictEqual(pr.body, null);
    assert.strictEqual(pr.mergeable, null);
  });

  it('should handle merged state', () => {
    const pr: PullRequest = {
      number: 1,
      title: 'Merged PR',
      body: 'Done',
      state: 'closed',
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main', sha: 'def' },
      htmlUrl: 'https://github.com/owner/repo/pull/1',
      mergeable: false,
      merged: true,
      draft: false,
    };

    assert.strictEqual(pr.merged, true);
    assert.strictEqual(pr.state, 'closed');
  });

  it('should handle draft PRs', () => {
    const pr: PullRequest = {
      number: 1,
      title: 'Draft PR',
      body: 'WIP',
      state: 'open',
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main', sha: 'def' },
      htmlUrl: 'https://github.com/owner/repo/pull/1',
      mergeable: true,
      merged: false,
      draft: true,
    };

    assert.strictEqual(pr.draft, true);
  });
});

describe('MergeResult interface', () => {
  it('should represent successful merge', () => {
    const result: MergeResult = {
      merged: true,
      sha: 'merge-commit-sha',
      message: 'Pull Request successfully merged',
    };

    assert.strictEqual(result.merged, true);
    assert.ok(result.sha);
  });

  it('should represent failed merge', () => {
    const result: MergeResult = {
      merged: false,
      sha: null,
      message: 'Merge conflict detected',
    };

    assert.strictEqual(result.merged, false);
    assert.strictEqual(result.sha, null);
  });
});

describe('CreatePROptions interface', () => {
  it('should require title, body, head, and base', () => {
    const options: CreatePROptions = {
      title: 'Feature PR',
      body: 'Description',
      head: 'feature-branch',
      base: 'main',
    };

    assert.ok(options.title);
    assert.ok(options.head);
    assert.ok(options.base);
  });

  it('should have optional draft', () => {
    const options: CreatePROptions = {
      title: 'Draft',
      body: 'WIP',
      head: 'feature',
      base: 'main',
      draft: true,
    };

    assert.strictEqual(options.draft, true);
  });
});

describe('PRManager edge cases', () => {
  let mockOctokit: ReturnType<typeof createMockOctokit>;
  let prManager: PRManager;

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    const mockClient = createMockClient({ client: mockOctokit });
    prManager = createPRManager(mockClient);
  });

  it('should handle empty PR list', async () => {
    mockOctokit.pulls.list.mock.mockImplementation(async () => ({
      data: [],
    }));

    const prs = await prManager.listOpenPRs();

    assert.strictEqual(prs.length, 0);
  });

  it('should handle very long PR body', async () => {
    const longBody = 'A'.repeat(50000);
    mockOctokit.pulls.get.mock.mockImplementation(async () => ({
      data: createMockApiPR({ body: longBody }),
    }));

    const pr = await prManager.getPR(1);

    assert.ok(pr);
    assert.strictEqual(pr.body?.length, 50000);
  });

  it('should handle unicode in PR content', async () => {
    mockOctokit.pulls.get.mock.mockImplementation(async () => ({
      data: createMockApiPR({
        title: '新功能 🚀',
        body: 'Changes: αβγ δεζ 日本語',
      }),
    }));

    const pr = await prManager.getPR(1);

    assert.ok(pr);
    assert.ok(pr.title.includes('🚀'));
    assert.ok(pr.body?.includes('日本語'));
  });

  it('should handle branch names with slashes', async () => {
    mockOctokit.pulls.get.mock.mockImplementation(async () => ({
      data: createMockApiPR({
        head: { ref: 'feature/user/auth/login', sha: 'abc' },
      }),
    }));

    const pr = await prManager.getPR(1);

    assert.ok(pr);
    assert.strictEqual(pr.head.ref, 'feature/user/auth/login');
  });
});
