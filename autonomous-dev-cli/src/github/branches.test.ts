import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createBranchManager,
  type BranchManager,
  type Branch,
} from './branches.js';
import { GitHubClient } from './client.js';

// Create mock branch data (API response format)
function createMockBranchData(name: string, sha: string, isProtected: boolean = false): any {
  return {
    name,
    commit: { sha },
    protected: isProtected,
  };
}

// Create mock Branch type
function createMockBranch(name: string, sha: string, isProtected: boolean = false): Branch {
  return {
    name,
    sha,
    protected: isProtected,
  };
}

// Create mock GitHub client
function createMockGitHubClient(overrides: Partial<{
  repos: any;
  git: any;
}> = {}): GitHubClient {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    client: {
      repos: {
        listBranches: mock.fn(async () => ({ data: [] })),
        getBranch: mock.fn(async () => ({
          data: createMockBranchData('main', 'sha123'),
        })),
        ...overrides.repos,
      },
      git: {
        createRef: mock.fn(async () => ({})),
        deleteRef: mock.fn(async () => ({})),
        ...overrides.git,
      },
    },
  } as unknown as GitHubClient;
}

describe('BranchManager', () => {
  describe('createBranchManager factory', () => {
    it('should create a BranchManager instance', () => {
      const client = createMockGitHubClient();
      const manager = createBranchManager(client);

      assert.ok(manager);
      assert.ok(typeof manager.listBranches === 'function');
      assert.ok(typeof manager.getBranch === 'function');
      assert.ok(typeof manager.createBranch === 'function');
      assert.ok(typeof manager.deleteBranch === 'function');
      assert.ok(typeof manager.branchExists === 'function');
    });
  });

  describe('listBranches', () => {
    it('should return empty array when no branches', async () => {
      const client = createMockGitHubClient();
      const manager = createBranchManager(client);

      const branches = await manager.listBranches();

      assert.deepStrictEqual(branches, []);
    });

    it('should return branches from repository', async () => {
      const mockBranches = [
        createMockBranchData('main', 'sha1'),
        createMockBranchData('develop', 'sha2'),
        createMockBranchData('feature-x', 'sha3'),
      ];

      const client = createMockGitHubClient({
        repos: {
          listBranches: mock.fn(async () => ({ data: mockBranches })),
        },
      });
      const manager = createBranchManager(client);

      const branches = await manager.listBranches();

      assert.strictEqual(branches.length, 3);
      assert.strictEqual(branches[0].name, 'main');
      assert.strictEqual(branches[1].name, 'develop');
      assert.strictEqual(branches[2].name, 'feature-x');
    });

    it('should map branch data correctly', async () => {
      const mockBranches = [
        createMockBranchData('main', 'abc123', true),
      ];

      const client = createMockGitHubClient({
        repos: {
          listBranches: mock.fn(async () => ({ data: mockBranches })),
        },
      });
      const manager = createBranchManager(client);

      const branches = await manager.listBranches();

      assert.strictEqual(branches[0].name, 'main');
      assert.strictEqual(branches[0].sha, 'abc123');
      assert.strictEqual(branches[0].protected, true);
    });

    it('should throw on API error', async () => {
      const client = createMockGitHubClient({
        repos: {
          listBranches: mock.fn(async () => {
            throw new Error('API Error');
          }),
        },
      });
      const manager = createBranchManager(client);

      await assert.rejects(
        () => manager.listBranches(),
        (error: Error) => error.message === 'API Error'
      );
    });
  });

  describe('getBranch', () => {
    it('should return branch when found', async () => {
      const mockBranch = createMockBranchData('feature', 'def456', false);

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: mockBranch })),
        },
      });
      const manager = createBranchManager(client);

      const branch = await manager.getBranch('feature');

      assert.ok(branch);
      assert.strictEqual(branch.name, 'feature');
      assert.strictEqual(branch.sha, 'def456');
      assert.strictEqual(branch.protected, false);
    });

    it('should return null when branch not found', async () => {
      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      const branch = await manager.getBranch('nonexistent');

      assert.strictEqual(branch, null);
    });

    it('should throw on other errors', async () => {
      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => {
            const error: any = new Error('Server error');
            error.status = 500;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      await assert.rejects(
        () => manager.getBranch('feature'),
        (error: Error) => error.message === 'Server error'
      );
    });
  });

  describe('createBranch', () => {
    it('should create branch from base branch', async () => {
      const baseBranch = createMockBranchData('main', 'base-sha');
      const createRef = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: baseBranch })),
        },
        git: { createRef },
      });
      const manager = createBranchManager(client);

      const branch = await manager.createBranch('new-feature', 'main');

      assert.strictEqual(branch.name, 'new-feature');
      assert.strictEqual(branch.sha, 'base-sha');
      assert.strictEqual(branch.protected, false);

      assert.strictEqual(createRef.mock.calls.length, 1);
      const callArgs = createRef.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.ref, 'refs/heads/new-feature');
      assert.strictEqual(callArgs.sha, 'base-sha');
    });

    it('should return existing branch if already exists', async () => {
      const existingBranch = createMockBranchData('existing', 'existing-sha');

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: existingBranch })),
        },
        git: {
          createRef: mock.fn(async () => {
            const error: any = new Error('Reference already exists');
            error.status = 422;
            error.message = 'Reference already exists';
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      const branch = await manager.createBranch('existing', 'main');

      assert.strictEqual(branch.name, 'existing');
      assert.strictEqual(branch.sha, 'existing-sha');
    });

    it('should throw on other creation errors', async () => {
      const baseBranch = createMockBranchData('main', 'base-sha');

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: baseBranch })),
        },
        git: {
          createRef: mock.fn(async () => {
            const error: any = new Error('Permission denied');
            error.status = 403;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      await assert.rejects(
        () => manager.createBranch('new-branch', 'main'),
        (error: Error) => error.message === 'Permission denied'
      );
    });
  });

  describe('deleteBranch', () => {
    it('should delete branch', async () => {
      const deleteRef = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        git: { deleteRef },
      });
      const manager = createBranchManager(client);

      await manager.deleteBranch('feature-to-delete');

      assert.strictEqual(deleteRef.mock.calls.length, 1);
      const callArgs = deleteRef.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.ref, 'heads/feature-to-delete');
    });

    it('should ignore 404 errors silently', async () => {
      const client = createMockGitHubClient({
        git: {
          deleteRef: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      // Should not throw
      await manager.deleteBranch('already-deleted');
    });

    it('should throw on other errors', async () => {
      const client = createMockGitHubClient({
        git: {
          deleteRef: mock.fn(async () => {
            const error: any = new Error('Protected branch');
            error.status = 422;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      await assert.rejects(
        () => manager.deleteBranch('protected-branch'),
        (error: Error) => error.message === 'Protected branch'
      );
    });
  });

  describe('branchExists', () => {
    it('should return true when branch exists', async () => {
      const mockBranch = createMockBranchData('feature', 'sha123');

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: mockBranch })),
        },
      });
      const manager = createBranchManager(client);

      const exists = await manager.branchExists('feature');

      assert.strictEqual(exists, true);
    });

    it('should return false when branch does not exist', async () => {
      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createBranchManager(client);

      const exists = await manager.branchExists('nonexistent');

      assert.strictEqual(exists, false);
    });
  });
});

describe('Branch interface', () => {
  it('should have required fields', () => {
    const branch: Branch = {
      name: 'main',
      sha: 'abc123',
      protected: true,
    };

    assert.strictEqual(branch.name, 'main');
    assert.strictEqual(branch.sha, 'abc123');
    assert.strictEqual(branch.protected, true);
  });

  it('should allow unprotected branches', () => {
    const branch: Branch = {
      name: 'feature',
      sha: 'def456',
      protected: false,
    };

    assert.strictEqual(branch.protected, false);
  });
});

describe('Branch naming', () => {
  const validBranchNames = [
    'main',
    'master',
    'develop',
    'feature/new-feature',
    'bugfix/fix-bug',
    'release/v1.0.0',
    'hotfix/urgent-fix',
    'feat-123',
    'issue-456-description',
  ];

  validBranchNames.forEach(branchName => {
    it(`should accept branch name: ${branchName}`, async () => {
      const mockBranch = createMockBranchData(branchName, 'sha123');

      const client = createMockGitHubClient({
        repos: {
          getBranch: mock.fn(async () => ({ data: mockBranch })),
        },
      });
      const manager = createBranchManager(client);

      const branch = await manager.getBranch(branchName);

      assert.ok(branch);
      assert.strictEqual(branch.name, branchName);
    });
  });
});

describe('BranchManager edge cases', () => {
  it('should handle branches with special characters', async () => {
    const mockBranch = createMockBranchData('feature/add-user-@mention', 'sha123');

    const client = createMockGitHubClient({
      repos: {
        getBranch: mock.fn(async () => ({ data: mockBranch })),
      },
    });
    const manager = createBranchManager(client);

    const branch = await manager.getBranch('feature/add-user-@mention');

    assert.ok(branch);
  });

  it('should handle very long branch names', async () => {
    const longName = 'feature/' + 'a'.repeat(200);
    const mockBranch = createMockBranchData(longName, 'sha123');

    const client = createMockGitHubClient({
      repos: {
        getBranch: mock.fn(async () => ({ data: mockBranch })),
      },
    });
    const manager = createBranchManager(client);

    const branch = await manager.getBranch(longName);

    assert.ok(branch);
  });

  it('should list up to 100 branches', async () => {
    const mockBranches = Array.from({ length: 100 }, (_, i) =>
      createMockBranchData(`branch-${i}`, `sha${i}`)
    );

    const listBranches = mock.fn(async () => ({ data: mockBranches }));

    const client = createMockGitHubClient({
      repos: { listBranches },
    });
    const manager = createBranchManager(client);

    const branches = await manager.listBranches();

    assert.strictEqual(branches.length, 100);

    const callArgs = listBranches.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.per_page, 100);
  });
});
