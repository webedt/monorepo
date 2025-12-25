import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  ConflictResolver,
  createConflictResolver,
  type ConflictResolverOptions,
  type MergeAttemptResult,
} from '../../src/conflicts/resolver.js';
import { type PRManager, type PullRequest, type MergeResult } from '../../src/github/pulls.js';
import { type BranchManager } from '../../src/github/branches.js';

// Create mock PR
function createMockPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'Test PR',
    body: 'Test description',
    state: 'open',
    head: { ref: 'feature-branch', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    htmlUrl: 'https://github.com/owner/repo/pull/1',
    mergeable: true,
    merged: false,
    draft: false,
    ...overrides,
  };
}

// Create mock PR Manager
function createMockPRManager(overrides: Partial<PRManager> = {}): PRManager {
  return {
    listOpenPRs: mock.fn(async () => []),
    getPR: mock.fn(async () => createMockPR()),
    findPRForBranch: mock.fn(async () => createMockPR()),
    createPR: mock.fn(async () => createMockPR()),
    mergePR: mock.fn(async (): Promise<MergeResult> => ({
      merged: true,
      sha: 'merged-sha',
      message: 'Merged successfully',
    })),
    closePR: mock.fn(async () => {}),
    updatePRFromBase: mock.fn(async () => true),
    waitForMergeable: mock.fn(async () => true),
    getChecksStatus: mock.fn(async () => ({ state: 'success', statuses: [] })),
    ...overrides,
  };
}

// Create mock Branch Manager
function createMockBranchManager(overrides: Partial<BranchManager> = {}): BranchManager {
  return {
    getBranch: mock.fn(async () => ({ name: 'main', sha: 'sha123', protected: false })),
    listBranches: mock.fn(async () => []),
    createBranch: mock.fn(async () => ({ name: 'new-branch', sha: 'sha456', protected: false })),
    deleteBranch: mock.fn(async () => {}),
    branchExists: mock.fn(async () => true),
    ...overrides,
  };
}

describe('ConflictResolver', () => {
  const defaultOptions: ConflictResolverOptions = {
    prManager: createMockPRManager(),
    branchManager: createMockBranchManager(),
    maxRetries: 3,
    strategy: 'rebase',
    mergeMethod: 'squash',
    owner: 'test-owner',
    repo: 'test-repo',
    baseBranch: 'main',
  };

  describe('constructor', () => {
    it('should create resolver with provided options', () => {
      const resolver = new ConflictResolver(defaultOptions);
      assert.ok(resolver);
    });

    it('should accept different merge strategies', () => {
      const strategies: Array<'rebase' | 'merge' | 'manual'> = ['rebase', 'merge', 'manual'];

      strategies.forEach(strategy => {
        const resolver = new ConflictResolver({
          ...defaultOptions,
          strategy,
        });
        assert.ok(resolver);
      });
    });

    it('should accept different merge methods', () => {
      const methods: Array<'merge' | 'squash' | 'rebase'> = ['merge', 'squash', 'rebase'];

      methods.forEach(mergeMethod => {
        const resolver = new ConflictResolver({
          ...defaultOptions,
          mergeMethod,
        });
        assert.ok(resolver);
      });
    });
  });

  describe('createConflictResolver factory', () => {
    it('should create a ConflictResolver instance', () => {
      const resolver = createConflictResolver(defaultOptions);
      assert.ok(resolver instanceof ConflictResolver);
    });
  });

  describe('attemptMerge', () => {
    it('should successfully merge a PR', async () => {
      const prManager = createMockPRManager();
      const branchManager = createMockBranchManager();

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
        branchManager,
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.merged, true);
      assert.ok(result.pr);
    });

    it('should return error when no PR found', async () => {
      const prManager = createMockPRManager({
        getPR: mock.fn(async () => null),
        findPRForBranch: mock.fn(async () => null),
      });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const result = await resolver.attemptMerge('nonexistent-branch');

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.merged, false);
      assert.strictEqual(result.error, 'No PR found');
    });

    it('should use PR number when provided', async () => {
      const getPR = mock.fn(async () => createMockPR({ number: 42 }));
      const prManager = createMockPRManager({ getPR });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      await resolver.attemptMerge('feature-branch', 42);

      assert.strictEqual(getPR.mock.calls.length, 1);
      assert.strictEqual(getPR.mock.calls[0].arguments[0], 42);
    });

    it('should find PR by branch when number not provided', async () => {
      const findPRForBranch = mock.fn(async () => createMockPR());
      const prManager = createMockPRManager({ findPRForBranch });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      await resolver.attemptMerge('feature-branch');

      assert.strictEqual(findPRForBranch.mock.calls.length, 1);
    });

    it('should wait for mergeability', async () => {
      const waitForMergeable = mock.fn(async () => true);
      const prManager = createMockPRManager({ waitForMergeable });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(waitForMergeable.mock.calls.length, 1);
    });

    it('should delete branch after successful merge', async () => {
      const deleteBranch = mock.fn(async () => {});
      const branchManager = createMockBranchManager({ deleteBranch });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        branchManager,
      });

      await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(deleteBranch.mock.calls.length, 1);
      assert.strictEqual(deleteBranch.mock.calls[0].arguments[0], 'feature-branch');
    });

    it('should handle delete branch failure gracefully', async () => {
      const deleteBranch = mock.fn(async () => {
        throw new Error('Branch already deleted');
      });
      const branchManager = createMockBranchManager({ deleteBranch });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        branchManager,
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      // Should still succeed even if branch deletion fails
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.merged, true);
    });

    it('should return manual resolution required for manual strategy', async () => {
      const prManager = createMockPRManager({
        waitForMergeable: mock.fn(async () => false),
      });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
        strategy: 'manual',
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Conflicts require manual resolution');
    });

    it('should attempt update from base when not mergeable', async () => {
      let callCount = 0;
      const waitForMergeable = mock.fn(async () => {
        callCount++;
        return callCount > 1; // Not mergeable first time, then mergeable
      });
      const updatePRFromBase = mock.fn(async () => true);
      const prManager = createMockPRManager({
        waitForMergeable,
        updatePRFromBase,
      });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
        strategy: 'rebase',
        maxRetries: 2,
      });

      await resolver.attemptMerge('feature-branch', 1);

      // Should have attempted to update from base
      assert.ok(updatePRFromBase.mock.calls.length >= 1);
    });

    it('should respect max retries', async () => {
      const mergePR = mock.fn(async (): Promise<MergeResult> => ({
        merged: false,
        sha: null,
        message: 'Merge failed',
      }));
      const waitForMergeable = mock.fn(async () => true);
      const prManager = createMockPRManager({
        mergePR,
        waitForMergeable,
      });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
        maxRetries: 2,
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.attempts, 2);
    });

    it('should include SHA in successful result', async () => {
      const prManager = createMockPRManager({
        mergePR: mock.fn(async (): Promise<MergeResult> => ({
          merged: true,
          sha: 'merge-commit-sha',
          message: 'Success',
        })),
      });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      assert.strictEqual(result.sha, 'merge-commit-sha');
    });

    it('should track attempt count', async () => {
      const prManager = createMockPRManager();

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const result = await resolver.attemptMerge('feature-branch', 1);

      assert.ok(result.attempts >= 1);
    });
  });

  describe('mergeSequentially', () => {
    it('should merge multiple branches', async () => {
      const mergePR = mock.fn(async (): Promise<MergeResult> => ({
        merged: true,
        sha: 'sha',
        message: 'Success',
      }));
      const prManager = createMockPRManager({ mergePR });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const branches = [
        { branchName: 'feature-1', prNumber: 1 },
        { branchName: 'feature-2', prNumber: 2 },
        { branchName: 'feature-3', prNumber: 3 },
      ];

      const results = await resolver.mergeSequentially(branches);

      assert.strictEqual(results.size, 3);
      assert.ok(results.has('feature-1'));
      assert.ok(results.has('feature-2'));
      assert.ok(results.has('feature-3'));
    });

    it('should return Map with results for each branch', async () => {
      const prManager = createMockPRManager();

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const branches = [
        { branchName: 'branch-1' },
        { branchName: 'branch-2' },
      ];

      const results = await resolver.mergeSequentially(branches);

      assert.ok(results instanceof Map);
      results.forEach((result, branchName) => {
        assert.ok(typeof branchName === 'string');
        assert.ok('success' in result);
        assert.ok('merged' in result);
      });
    });

    it('should continue processing after a failure', async () => {
      let callCount = 0;
      const findPRForBranch = mock.fn(async () => {
        callCount++;
        if (callCount === 1) return null; // First branch fails
        return createMockPR();
      });
      const prManager = createMockPRManager({ findPRForBranch });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const branches = [
        { branchName: 'failing-branch' },
        { branchName: 'success-branch' },
      ];

      const results = await resolver.mergeSequentially(branches);

      const failingResult = results.get('failing-branch');
      const successResult = results.get('success-branch');

      assert.strictEqual(failingResult?.success, false);
      assert.strictEqual(successResult?.success, true);
    });

    it('should handle empty branch list', async () => {
      const prManager = createMockPRManager();

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const results = await resolver.mergeSequentially([]);

      assert.strictEqual(results.size, 0);
    });

    it('should process branches in order', async () => {
      const processOrder: string[] = [];
      const findPRForBranch = mock.fn(async (branchName: string) => {
        processOrder.push(branchName);
        return createMockPR({ head: { ref: branchName, sha: 'sha' } });
      });
      const prManager = createMockPRManager({ findPRForBranch });

      const resolver = new ConflictResolver({
        ...defaultOptions,
        prManager,
      });

      const branches = [
        { branchName: 'first' },
        { branchName: 'second' },
        { branchName: 'third' },
      ];

      await resolver.mergeSequentially(branches);

      assert.deepStrictEqual(processOrder, ['first', 'second', 'third']);
    });
  });

  describe('MergeAttemptResult', () => {
    it('should include all required fields for success', () => {
      const result: MergeAttemptResult = {
        success: true,
        pr: createMockPR(),
        merged: true,
        sha: 'commit-sha',
        attempts: 1,
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.merged, true);
      assert.ok(result.sha);
      assert.ok(result.pr);
    });

    it('should include all required fields for failure', () => {
      const result: MergeAttemptResult = {
        success: false,
        merged: false,
        error: 'Merge conflict',
        attempts: 3,
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.merged, false);
      assert.ok(result.error);
    });

    it('should allow optional pr field', () => {
      const result: MergeAttemptResult = {
        success: false,
        merged: false,
        error: 'No PR found',
        attempts: 0,
      };

      assert.strictEqual(result.pr, undefined);
    });

    it('should allow optional sha field', () => {
      const result: MergeAttemptResult = {
        success: false,
        merged: false,
        error: 'Failed to merge',
        attempts: 1,
      };

      assert.strictEqual(result.sha, undefined);
    });
  });

  describe('ConflictResolverOptions', () => {
    it('should require prManager', () => {
      const options: ConflictResolverOptions = {
        prManager: createMockPRManager(),
        branchManager: createMockBranchManager(),
        maxRetries: 3,
        strategy: 'rebase',
        mergeMethod: 'squash',
        owner: 'owner',
        repo: 'repo',
        baseBranch: 'main',
      };

      const resolver = new ConflictResolver(options);
      assert.ok(resolver);
    });

    it('should accept various max retry values', () => {
      [1, 3, 5, 10].forEach(maxRetries => {
        const resolver = new ConflictResolver({
          ...defaultOptions,
          maxRetries,
        });
        assert.ok(resolver);
      });
    });
  });
});

describe('Strategy behavior', () => {
  it('should use rebase strategy by default in test options', () => {
    const options: ConflictResolverOptions = {
      prManager: createMockPRManager(),
      branchManager: createMockBranchManager(),
      maxRetries: 3,
      strategy: 'rebase',
      mergeMethod: 'squash',
      owner: 'owner',
      repo: 'repo',
      baseBranch: 'main',
    };

    const resolver = new ConflictResolver(options);
    assert.ok(resolver);
  });

  it('should support merge strategy', () => {
    const options: ConflictResolverOptions = {
      prManager: createMockPRManager(),
      branchManager: createMockBranchManager(),
      maxRetries: 3,
      strategy: 'merge',
      mergeMethod: 'merge',
      owner: 'owner',
      repo: 'repo',
      baseBranch: 'main',
    };

    const resolver = new ConflictResolver(options);
    assert.ok(resolver);
  });

  it('should support manual strategy', () => {
    const options: ConflictResolverOptions = {
      prManager: createMockPRManager(),
      branchManager: createMockBranchManager(),
      maxRetries: 3,
      strategy: 'manual',
      mergeMethod: 'squash',
      owner: 'owner',
      repo: 'repo',
      baseBranch: 'main',
    };

    const resolver = new ConflictResolver(options);
    assert.ok(resolver);
  });
});

describe('Merge method behavior', () => {
  it('should use specified merge method', async () => {
    const mergePR = mock.fn(async (): Promise<MergeResult> => ({
      merged: true,
      sha: 'sha',
      message: 'Success',
    }));
    const prManager = createMockPRManager({ mergePR });

    const resolver = new ConflictResolver({
      prManager,
      branchManager: createMockBranchManager(),
      maxRetries: 3,
      strategy: 'rebase',
      mergeMethod: 'rebase',
      owner: 'owner',
      repo: 'repo',
      baseBranch: 'main',
    });

    await resolver.attemptMerge('feature', 1);

    // Verify mergePR was called with rebase method
    assert.strictEqual(mergePR.mock.calls.length, 1);
    assert.strictEqual(mergePR.mock.calls[0].arguments[1], 'rebase');
  });
});
