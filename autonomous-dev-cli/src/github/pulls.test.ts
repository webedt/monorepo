import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createPRManager,
  type PRManager,
  type PullRequest,
  type CreatePROptions,
  type MergeResult,
  type DegradedResult,
} from './pulls.js';
import { GitHubClient, type ServiceHealth } from './client.js';

// Create mock PR data (API response format)
function createMockPRData(number: number, title: string, overrides: Partial<any> = {}): any {
  return {
    number,
    title,
    body: `Description for PR ${number}`,
    state: 'open',
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    html_url: `https://github.com/owner/repo/pull/${number}`,
    mergeable: true,
    merged: false,
    draft: false,
    ...overrides,
  };
}

// Create mock PullRequest type
function createMockPR(number: number, title: string, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title,
    body: `Description for PR ${number}`,
    state: 'open',
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    htmlUrl: `https://github.com/owner/repo/pull/${number}`,
    mergeable: true,
    merged: false,
    draft: false,
    ...overrides,
  };
}

// Create mock GitHub client
function createMockGitHubClient(overrides: Partial<{
  pulls: any;
  repos: any;
  executeWithFallback: any;
  getServiceHealth: any;
  isAvailable: any;
}> = {}): GitHubClient {
  const defaultHealth: ServiceHealth = {
    state: 'healthy',
    circuitState: 'closed',
    failureCount: 0,
    lastFailure: undefined,
    successRate: 1.0,
    isOperational: true,
    degradedOperations: [],
  };

  return {
    owner: 'test-owner',
    repo: 'test-repo',
    client: {
      pulls: {
        list: mock.fn(async () => ({ data: [] })),
        get: mock.fn(async () => ({ data: createMockPRData(1, 'Test') })),
        create: mock.fn(async () => ({ data: createMockPRData(1, 'New PR') })),
        merge: mock.fn(async () => ({ data: { merged: true, sha: 'merge-sha', message: 'Merged' } })),
        update: mock.fn(async () => ({})),
        ...overrides.pulls,
      },
      repos: {
        merge: mock.fn(async () => ({})),
        getCombinedStatusForRef: mock.fn(async () => ({
          data: { state: 'success', statuses: [] },
        })),
        ...overrides.repos,
      },
    },
    executeWithFallback: overrides.executeWithFallback ?? mock.fn(async (fn: any) => ({
      value: await fn(),
      degraded: false,
    })),
    getServiceHealth: overrides.getServiceHealth ?? mock.fn(() => defaultHealth),
    isAvailable: overrides.isAvailable ?? mock.fn(() => true),
  } as unknown as GitHubClient;
}

describe('PRManager', () => {
  describe('createPRManager factory', () => {
    it('should create a PRManager instance', () => {
      const client = createMockGitHubClient();
      const manager = createPRManager(client);

      assert.ok(manager);
      assert.ok(typeof manager.listOpenPRs === 'function');
      assert.ok(typeof manager.getPR === 'function');
      assert.ok(typeof manager.createPR === 'function');
      assert.ok(typeof manager.mergePR === 'function');
    });
  });

  describe('listOpenPRs', () => {
    it('should return empty array when no PRs', async () => {
      const client = createMockGitHubClient();
      const manager = createPRManager(client);

      const prs = await manager.listOpenPRs();

      assert.deepStrictEqual(prs, []);
    });

    it('should return PRs from repository', async () => {
      const mockPRs = [
        createMockPRData(1, 'First PR'),
        createMockPRData(2, 'Second PR'),
      ];

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: mockPRs })),
        },
      });
      const manager = createPRManager(client);

      const prs = await manager.listOpenPRs();

      assert.strictEqual(prs.length, 2);
      assert.strictEqual(prs[0].number, 1);
      assert.strictEqual(prs[1].number, 2);
    });

    it('should map PR data correctly', async () => {
      const mockPR = createMockPRData(1, 'Test PR', {
        body: 'Description',
        head: { ref: 'feature', sha: 'abc' },
        base: { ref: 'main', sha: 'def' },
        draft: true,
      });

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: [mockPR] })),
        },
      });
      const manager = createPRManager(client);

      const prs = await manager.listOpenPRs();

      assert.strictEqual(prs[0].title, 'Test PR');
      assert.strictEqual(prs[0].head.ref, 'feature');
      assert.strictEqual(prs[0].base.ref, 'main');
      assert.strictEqual(prs[0].draft, true);
    });
  });

  describe('listOpenPRsWithFallback', () => {
    it('should return PRs when service is healthy', async () => {
      const mockPRs = [createMockPRData(1, 'PR')];

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: mockPRs })),
        },
        executeWithFallback: mock.fn(async (fn: any) => ({
          value: await fn(),
          degraded: false,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.listOpenPRsWithFallback();

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.length, 1);
    });

    it('should return fallback when service is degraded', async () => {
      const fallbackPRs = [createMockPR(99, 'Fallback PR')];

      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async (_fn: any, fallback: any) => ({
          value: fallback,
          degraded: true,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.listOpenPRsWithFallback(fallbackPRs);

      assert.strictEqual(result.degraded, true);
      assert.deepStrictEqual(result.value, fallbackPRs);
    });
  });

  describe('getPR', () => {
    it('should return PR when found', async () => {
      const mockPR = createMockPRData(42, 'Found PR');

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.getPR(42);

      assert.ok(pr);
      assert.strictEqual(pr.number, 42);
      assert.strictEqual(pr.title, 'Found PR');
    });

    it('should return null when PR not found', async () => {
      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.getPR(999);

      assert.strictEqual(pr, null);
    });

    it('should throw on other errors', async () => {
      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => {
            const error: any = new Error('Server error');
            error.status = 500;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      await assert.rejects(
        () => manager.getPR(1),
        (error: Error) => error.message.includes('Server error')
      );
    });
  });

  describe('findPRForBranch', () => {
    it('should find PR for branch', async () => {
      const mockPR = createMockPRData(1, 'Branch PR');

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: [mockPR] })),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.findPRForBranch('feature-branch');

      assert.ok(pr);
      assert.strictEqual(pr.number, 1);
    });

    it('should return null when no PR for branch', async () => {
      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: [] })),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.findPRForBranch('nonexistent-branch');

      assert.strictEqual(pr, null);
    });

    it('should filter by base branch when provided', async () => {
      const list = mock.fn(async () => ({
        data: [createMockPRData(1, 'PR')],
      }));

      const client = createMockGitHubClient({
        pulls: { list },
      });
      const manager = createPRManager(client);

      await manager.findPRForBranch('feature', 'develop');

      assert.strictEqual(list.mock.calls.length, 1);
      const callArgs = list.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.base, 'develop');
    });
  });

  describe('createPR', () => {
    it('should create PR with required fields', async () => {
      const create = mock.fn(async () => ({
        data: createMockPRData(123, 'New PR'),
      }));

      const client = createMockGitHubClient({
        pulls: {
          create,
          list: mock.fn(async () => ({ data: [] })),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.createPR({
        title: 'New PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      assert.strictEqual(pr.number, 123);
      assert.strictEqual(create.mock.calls.length, 1);
    });

    it('should return existing PR if one exists', async () => {
      const existingPR = createMockPRData(456, 'Existing PR');

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: [existingPR] })),
          create: mock.fn(async () => {
            throw new Error('Should not be called');
          }),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.createPR({
        title: 'New PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      assert.strictEqual(pr.number, 456);
    });

    it('should create draft PR when specified', async () => {
      const create = mock.fn(async () => ({
        data: createMockPRData(123, 'Draft PR', { draft: true }),
      }));

      const client = createMockGitHubClient({
        pulls: {
          create,
          list: mock.fn(async () => ({ data: [] })),
        },
      });
      const manager = createPRManager(client);

      await manager.createPR({
        title: 'Draft PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
        draft: true,
      });

      const callArgs = create.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.draft, true);
    });

    it('should handle "PR already exists" error', async () => {
      const existingPR = createMockPRData(789, 'Existing');
      let callCount = 0;

      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => {
            callCount++;
            if (callCount === 1) {
              return { data: [] }; // First check - no existing PR
            }
            return { data: [existingPR] }; // After error - found existing
          }),
          create: mock.fn(async () => {
            const error: any = new Error('A pull request already exists for this branch');
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const pr = await manager.createPR({
        title: 'New PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      assert.strictEqual(pr.number, 789);
    });
  });

  describe('createPRWithFallback', () => {
    it('should return non-degraded result on success', async () => {
      const client = createMockGitHubClient({
        pulls: {
          list: mock.fn(async () => ({ data: [] })),
          create: mock.fn(async () => ({
            data: createMockPRData(1, 'New PR'),
          })),
        },
        executeWithFallback: mock.fn(async (fn: any) => ({
          value: await fn(),
          degraded: false,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.createPRWithFallback({
        title: 'New PR',
        body: 'Description',
        head: 'feature',
        base: 'main',
      });

      assert.strictEqual(result.degraded, false);
      assert.ok(result.value);
    });

    it('should return degraded result on failure', async () => {
      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async () => ({
          value: null,
          degraded: true,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.createPRWithFallback({
        title: 'New PR',
        body: 'Description',
        head: 'feature',
        base: 'main',
      });

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value, null);
    });
  });

  describe('mergePR', () => {
    it('should merge PR successfully', async () => {
      const merge = mock.fn(async () => ({
        data: { merged: true, sha: 'merge-commit', message: 'Merged' },
      }));

      const client = createMockGitHubClient({
        pulls: { merge },
      });
      const manager = createPRManager(client);

      const result = await manager.mergePR(1);

      assert.strictEqual(result.merged, true);
      assert.strictEqual(result.sha, 'merge-commit');
    });

    it('should use squash method by default', async () => {
      const merge = mock.fn(async () => ({
        data: { merged: true, sha: 'sha', message: 'Merged' },
      }));

      const client = createMockGitHubClient({
        pulls: { merge },
      });
      const manager = createPRManager(client);

      await manager.mergePR(1);

      const callArgs = merge.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.merge_method, 'squash');
    });

    it('should use specified merge method', async () => {
      const merge = mock.fn(async () => ({
        data: { merged: true, sha: 'sha', message: 'Merged' },
      }));

      const client = createMockGitHubClient({
        pulls: { merge },
      });
      const manager = createPRManager(client);

      await manager.mergePR(1, 'rebase');

      const callArgs = merge.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.merge_method, 'rebase');
    });

    it('should return failure result on error', async () => {
      const client = createMockGitHubClient({
        pulls: {
          merge: mock.fn(async () => {
            throw new Error('Merge conflict');
          }),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.mergePR(1);

      assert.strictEqual(result.merged, false);
      assert.strictEqual(result.sha, null);
      assert.ok(result.message.includes('Merge conflict'));
    });
  });

  describe('mergePRWithFallback', () => {
    it('should return non-degraded result on success', async () => {
      const client = createMockGitHubClient({
        pulls: {
          merge: mock.fn(async () => ({
            data: { merged: true, sha: 'sha', message: 'Merged' },
          })),
        },
        executeWithFallback: mock.fn(async (fn: any) => ({
          value: await fn(),
          degraded: false,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.mergePRWithFallback(1);

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.merged, true);
    });

    it('should return degraded result with failure message', async () => {
      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async (_fn: any, fallback: any) => ({
          value: fallback,
          degraded: true,
        })),
      });
      const manager = createPRManager(client);

      const result = await manager.mergePRWithFallback(1);

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value.merged, false);
      assert.ok(result.value.message.includes('degradation'));
    });
  });

  describe('closePR', () => {
    it('should close PR', async () => {
      const update = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        pulls: { update },
      });
      const manager = createPRManager(client);

      await manager.closePR(1);

      assert.strictEqual(update.mock.calls.length, 1);
      const callArgs = update.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.state, 'closed');
    });
  });

  describe('updatePRFromBase', () => {
    it('should update PR from base branch', async () => {
      const mockPR = createMockPRData(1, 'PR', {
        head: { ref: 'feature', sha: 'abc' },
        base: { ref: 'main', sha: 'def' },
      });

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
        repos: {
          merge: mock.fn(async () => ({})),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.updatePRFromBase(1);

      assert.strictEqual(result, true);
    });

    it('should return false when PR not found', async () => {
      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.updatePRFromBase(1);

      assert.strictEqual(result, false);
    });

    it('should return true when already up to date (204)', async () => {
      const mockPR = createMockPRData(1, 'PR');

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
        repos: {
          merge: mock.fn(async () => {
            const error: any = new Error('Already up to date');
            error.status = 204;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.updatePRFromBase(1);

      assert.strictEqual(result, true);
    });

    it('should return false on merge conflict (409)', async () => {
      const mockPR = createMockPRData(1, 'PR');

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
        repos: {
          merge: mock.fn(async () => {
            const error: any = new Error('Merge conflict');
            error.status = 409;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.updatePRFromBase(1);

      assert.strictEqual(result, false);
    });
  });

  describe('waitForMergeable', () => {
    it('should return true when PR is mergeable', async () => {
      const mockPR = createMockPRData(1, 'PR', { mergeable: true });

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.waitForMergeable(1, 1);

      assert.strictEqual(result, true);
    });

    it('should return false when PR has conflicts', async () => {
      const mockPR = createMockPRData(1, 'PR', { mergeable: false });

      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => ({ data: mockPR })),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.waitForMergeable(1, 1);

      assert.strictEqual(result, false);
    });

    it('should return false when PR not found', async () => {
      const client = createMockGitHubClient({
        pulls: {
          get: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createPRManager(client);

      const result = await manager.waitForMergeable(1, 1);

      assert.strictEqual(result, false);
    });
  });

  describe('getChecksStatus', () => {
    it('should return checks status', async () => {
      const client = createMockGitHubClient({
        repos: {
          getCombinedStatusForRef: mock.fn(async () => ({
            data: {
              state: 'success',
              statuses: [
                { context: 'ci/build', state: 'success' },
                { context: 'ci/test', state: 'success' },
              ],
            },
          })),
        },
      });
      const manager = createPRManager(client);

      const status = await manager.getChecksStatus('abc123');

      assert.strictEqual(status.state, 'success');
      assert.strictEqual(status.statuses.length, 2);
    });

    it('should return pending status', async () => {
      const client = createMockGitHubClient({
        repos: {
          getCombinedStatusForRef: mock.fn(async () => ({
            data: {
              state: 'pending',
              statuses: [{ context: 'ci/build', state: 'pending' }],
            },
          })),
        },
      });
      const manager = createPRManager(client);

      const status = await manager.getChecksStatus('abc123');

      assert.strictEqual(status.state, 'pending');
    });

    it('should return failure status', async () => {
      const client = createMockGitHubClient({
        repos: {
          getCombinedStatusForRef: mock.fn(async () => ({
            data: {
              state: 'failure',
              statuses: [{ context: 'ci/test', state: 'failure' }],
            },
          })),
        },
      });
      const manager = createPRManager(client);

      const status = await manager.getChecksStatus('abc123');

      assert.strictEqual(status.state, 'failure');
    });
  });

  describe('getServiceHealth', () => {
    it('should return service health from client', () => {
      const health: ServiceHealth = {
        state: 'healthy',
        circuitState: 'closed',
        failureCount: 0,
        lastFailure: undefined,
        successRate: 1.0,
        isOperational: true,
        degradedOperations: [],
      };

      const client = createMockGitHubClient({
        getServiceHealth: mock.fn(() => health),
      });
      const manager = createPRManager(client);

      const result = manager.getServiceHealth();

      assert.strictEqual(result.state, 'healthy');
    });
  });

  describe('isAvailable', () => {
    it('should return true when service is available', () => {
      const client = createMockGitHubClient({
        isAvailable: mock.fn(() => true),
      });
      const manager = createPRManager(client);

      assert.strictEqual(manager.isAvailable(), true);
    });

    it('should return false when service is unavailable', () => {
      const client = createMockGitHubClient({
        isAvailable: mock.fn(() => false),
      });
      const manager = createPRManager(client);

      assert.strictEqual(manager.isAvailable(), false);
    });
  });
});

describe('PullRequest interface', () => {
  it('should have required fields', () => {
    const pr: PullRequest = {
      number: 1,
      title: 'Test PR',
      body: 'Description',
      state: 'open',
      head: { ref: 'feature', sha: 'abc' },
      base: { ref: 'main', sha: 'def' },
      htmlUrl: 'https://github.com/owner/repo/pull/1',
      mergeable: true,
      merged: false,
      draft: false,
    };

    assert.strictEqual(pr.number, 1);
    assert.strictEqual(pr.state, 'open');
  });

  it('should allow closed state', () => {
    const pr: PullRequest = createMockPR(1, 'Closed', { state: 'closed' });
    assert.strictEqual(pr.state, 'closed');
  });

  it('should allow null mergeable', () => {
    const pr: PullRequest = createMockPR(1, 'Computing', { mergeable: null });
    assert.strictEqual(pr.mergeable, null);
  });

  it('should allow merged true', () => {
    const pr: PullRequest = createMockPR(1, 'Merged', { merged: true });
    assert.strictEqual(pr.merged, true);
  });
});

describe('CreatePROptions interface', () => {
  it('should have required fields', () => {
    const options: CreatePROptions = {
      title: 'New PR',
      body: 'Description',
      head: 'feature-branch',
      base: 'main',
    };

    assert.strictEqual(options.title, 'New PR');
    assert.strictEqual(options.head, 'feature-branch');
    assert.strictEqual(options.base, 'main');
  });

  it('should allow optional draft', () => {
    const options: CreatePROptions = {
      title: 'Draft PR',
      body: 'WIP',
      head: 'feature',
      base: 'main',
      draft: true,
    };

    assert.strictEqual(options.draft, true);
  });
});

describe('MergeResult interface', () => {
  it('should include success fields', () => {
    const result: MergeResult = {
      merged: true,
      sha: 'abc123',
      message: 'Successfully merged',
    };

    assert.strictEqual(result.merged, true);
    assert.strictEqual(result.sha, 'abc123');
  });

  it('should allow null sha on failure', () => {
    const result: MergeResult = {
      merged: false,
      sha: null,
      message: 'Merge conflict',
    };

    assert.strictEqual(result.merged, false);
    assert.strictEqual(result.sha, null);
  });
});
