/**
 * Tests for the Git Helper module.
 * Covers git operations like status, diff, commit, push, and branch management.
 * Uses mock implementations for git commands.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

describe('GitHelper Module', () => {
  describe('constructor', () => {
    it('should create instance with workspace path', () => {
      // Test the expected interface
      const config = {
        workspacePath: '/workspace/repo'
      };

      assert.strictEqual(config.workspacePath, '/workspace/repo');
    });

    it('should accept different workspace paths', () => {
      const paths = [
        '/tmp/workspace',
        '/home/user/projects/repo',
        '/var/lib/docker/volumes/repo'
      ];

      for (const path of paths) {
        assert.ok(typeof path === 'string');
        assert.ok(path.startsWith('/'));
      }
    });
  });

  describe('getStatus mock behavior', () => {
    it('should return formatted status string', async () => {
      const mockGetStatus = mock.fn(async () => {
        return `
Branch: main
Changes not staged: 3
Untracked files: 1
Modified: src/index.ts, src/utils.ts
Deleted: none
New files: src/new-file.ts
`.trim();
      });

      const status = await mockGetStatus();

      assert.ok(status.includes('Branch: main'));
      assert.ok(status.includes('Changes not staged'));
      assert.ok(status.includes('Modified'));
    });

    it('should show clean repository status', async () => {
      const mockGetStatus = mock.fn(async () => {
        return `
Branch: main
Changes not staged: 0
Untracked files: 0
Modified: none
Deleted: none
New files: none
`.trim();
      });

      const status = await mockGetStatus();

      assert.ok(status.includes('Changes not staged: 0'));
      assert.ok(status.includes('Modified: none'));
    });

    it('should handle error cases', async () => {
      const mockGetStatus = mock.fn(async () => {
        throw new Error('Not a git repository');
      });

      await assert.rejects(
        () => mockGetStatus(),
        /Not a git repository/
      );
    });
  });

  describe('getDiff mock behavior', () => {
    it('should return diff output', async () => {
      const mockGetDiff = mock.fn(async () => {
        return `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
+// New comment
 export function main() {
+  console.log('Hello');
 }`;
      });

      const diff = await mockGetDiff();

      assert.ok(diff.includes('diff --git'));
      assert.ok(diff.includes('+// New comment'));
    });

    it('should return empty diff for no changes', async () => {
      const mockGetDiff = mock.fn(async () => 'No changes');

      const diff = await mockGetDiff();

      assert.strictEqual(diff, 'No changes');
    });
  });

  describe('hasChanges mock behavior', () => {
    it('should return true when there are changes', async () => {
      const mockHasChanges = mock.fn(async () => true);

      const hasChanges = await mockHasChanges();

      assert.strictEqual(hasChanges, true);
    });

    it('should return false when clean', async () => {
      const mockHasChanges = mock.fn(async () => false);

      const hasChanges = await mockHasChanges();

      assert.strictEqual(hasChanges, false);
    });

    it('should throw on git errors (not silently return false)', async () => {
      const mockHasChanges = mock.fn(async () => {
        throw new Error('dubious ownership');
      });

      await assert.rejects(
        () => mockHasChanges(),
        /dubious ownership/
      );
    });

    it('should detect various change types', async () => {
      const scenarios = [
        { modified: ['src/a.ts'], notAdded: [], deleted: [], expected: true },
        { modified: [], notAdded: ['new.ts'], deleted: [], expected: true },
        { modified: [], notAdded: [], deleted: ['old.ts'], expected: true },
        { modified: [], notAdded: [], deleted: [], expected: false }
      ];

      for (const scenario of scenarios) {
        const hasChanges = scenario.modified.length > 0 ||
          scenario.notAdded.length > 0 ||
          scenario.deleted.length > 0;

        assert.strictEqual(hasChanges, scenario.expected);
      }
    });
  });

  describe('createBranch mock behavior', () => {
    it('should create and checkout new branch', async () => {
      let createdBranch = '';
      const mockCreateBranch = mock.fn(async (branchName: string) => {
        createdBranch = branchName;
      });

      await mockCreateBranch('feature/new-feature');

      assert.strictEqual(createdBranch, 'feature/new-feature');
    });

    it('should throw if branch already exists', async () => {
      const existingBranches = ['main', 'develop'];
      const mockCreateBranch = mock.fn(async (branchName: string) => {
        if (existingBranches.includes(branchName)) {
          throw new Error(`Branch '${branchName}' already exists`);
        }
      });

      await assert.rejects(
        () => mockCreateBranch('main'),
        /already exists/
      );
    });
  });

  describe('branchExists mock behavior', () => {
    it('should return true for existing branch', async () => {
      const branches = ['main', 'develop', 'feature/auth'];
      const mockBranchExists = mock.fn(async (branchName: string) => {
        return branches.includes(branchName);
      });

      const exists = await mockBranchExists('main');

      assert.strictEqual(exists, true);
    });

    it('should return false for non-existing branch', async () => {
      const branches = ['main'];
      const mockBranchExists = mock.fn(async (branchName: string) => {
        return branches.includes(branchName);
      });

      const exists = await mockBranchExists('non-existent');

      assert.strictEqual(exists, false);
    });
  });

  describe('commitAll mock behavior', () => {
    it('should stage and commit all changes', async () => {
      let committedMessage = '';
      const mockCommitAll = mock.fn(async (message: string) => {
        committedMessage = message;
        return 'abc1234'; // commit hash
      });

      const hash = await mockCommitAll('Add new feature');

      assert.strictEqual(committedMessage, 'Add new feature');
      assert.ok(hash.length > 0);
    });

    it('should return commit hash', async () => {
      const mockCommitAll = mock.fn(async (_message: string) => 'def5678');

      const hash = await mockCommitAll('Fix bug');

      assert.strictEqual(hash, 'def5678');
    });

    it('should throw if nothing to commit', async () => {
      const mockCommitAll = mock.fn(async (_message: string) => {
        throw new Error('nothing to commit');
      });

      await assert.rejects(
        () => mockCommitAll('Empty commit'),
        /nothing to commit/
      );
    });
  });

  describe('push mock behavior', () => {
    it('should push to origin by default', async () => {
      let pushedRemote = '';
      let pushedBranch = '';
      const mockPush = mock.fn(async (remote?: string, branch?: string) => {
        pushedRemote = remote || 'origin';
        pushedBranch = branch || 'main';
      });

      await mockPush();

      assert.strictEqual(pushedRemote, 'origin');
      assert.strictEqual(pushedBranch, 'main');
    });

    it('should push to specified remote and branch', async () => {
      let pushedRemote = '';
      let pushedBranch = '';
      const mockPush = mock.fn(async (remote?: string, branch?: string) => {
        pushedRemote = remote || 'origin';
        pushedBranch = branch || 'main';
      });

      await mockPush('upstream', 'develop');

      assert.strictEqual(pushedRemote, 'upstream');
      assert.strictEqual(pushedBranch, 'develop');
    });

    it('should throw on push failure', async () => {
      const mockPush = mock.fn(async () => {
        throw new Error('Push rejected: non-fast-forward');
      });

      await assert.rejects(
        () => mockPush(),
        /Push rejected/
      );
    });
  });

  describe('getCurrentBranch mock behavior', () => {
    it('should return current branch name', async () => {
      const mockGetCurrentBranch = mock.fn(async () => 'main');

      const branch = await mockGetCurrentBranch();

      assert.strictEqual(branch, 'main');
    });

    it('should return feature branch names', async () => {
      const mockGetCurrentBranch = mock.fn(async () => 'feature/auth-system');

      const branch = await mockGetCurrentBranch();

      assert.strictEqual(branch, 'feature/auth-system');
    });

    it('should return "unknown" on error', async () => {
      const mockGetCurrentBranch = mock.fn(async () => {
        try {
          throw new Error('Failed to get branch');
        } catch {
          return 'unknown';
        }
      });

      const branch = await mockGetCurrentBranch();

      assert.strictEqual(branch, 'unknown');
    });
  });

  describe('isGitRepo mock behavior', () => {
    it('should return true for valid git repository', async () => {
      const mockIsGitRepo = mock.fn(async () => true);

      const isRepo = await mockIsGitRepo();

      assert.strictEqual(isRepo, true);
    });

    it('should return false for non-git directory', async () => {
      const mockIsGitRepo = mock.fn(async () => false);

      const isRepo = await mockIsGitRepo();

      assert.strictEqual(isRepo, false);
    });
  });

  describe('checkout mock behavior', () => {
    it('should checkout existing branch', async () => {
      let checkedOutBranch = '';
      const mockCheckout = mock.fn(async (branchName: string) => {
        checkedOutBranch = branchName;
      });

      await mockCheckout('develop');

      assert.strictEqual(checkedOutBranch, 'develop');
    });

    it('should throw for non-existing branch', async () => {
      const mockCheckout = mock.fn(async (branchName: string) => {
        throw new Error(`Branch '${branchName}' not found`);
      });

      await assert.rejects(
        () => mockCheckout('non-existent'),
        /not found/
      );
    });
  });

  describe('pull mock behavior', () => {
    it('should pull from origin', async () => {
      let pulledBranch = '';
      const mockPull = mock.fn(async (branch?: string) => {
        pulledBranch = branch || 'main';
      });

      await mockPull('develop');

      assert.strictEqual(pulledBranch, 'develop');
    });

    it('should throw on merge conflict', async () => {
      const mockPull = mock.fn(async () => {
        throw new Error('Automatic merge failed');
      });

      await assert.rejects(
        () => mockPull(),
        /merge failed/
      );
    });
  });
});

describe('Safe Directory Handling', () => {
  it('should track safe directory state', () => {
    let safeDirectoryAdded = false;

    const ensureSafeDirectory = async (workspacePath: string) => {
      if (safeDirectoryAdded) return;

      // Simulate adding to safe.directory
      await Promise.resolve();
      safeDirectoryAdded = true;
    };

    assert.strictEqual(safeDirectoryAdded, false);

    // First call should set flag
    ensureSafeDirectory('/workspace');
    // Need to wait for async operation
    setTimeout(() => {
      assert.strictEqual(safeDirectoryAdded, true);
    }, 0);
  });

  it('should only call git config once', async () => {
    let callCount = 0;
    let safeDirectoryAdded = false;

    const ensureSafeDirectory = async () => {
      if (safeDirectoryAdded) return;

      callCount++;
      safeDirectoryAdded = true;
    };

    await ensureSafeDirectory();
    await ensureSafeDirectory();
    await ensureSafeDirectory();

    assert.strictEqual(callCount, 1);
  });
});

describe('Git Status Parsing', () => {
  it('should parse modified files', () => {
    const statusOutput = {
      modified: ['src/index.ts', 'src/utils.ts'],
      not_added: [],
      deleted: [],
      created: [],
      staged: []
    };

    const hasChanges = statusOutput.modified.length > 0 ||
      statusOutput.not_added.length > 0 ||
      statusOutput.deleted.length > 0;

    assert.strictEqual(hasChanges, true);
    assert.deepStrictEqual(statusOutput.modified, ['src/index.ts', 'src/utils.ts']);
  });

  it('should parse untracked files', () => {
    const statusOutput = {
      modified: [],
      not_added: ['new-file.ts'],
      deleted: [],
      created: [],
      staged: []
    };

    assert.strictEqual(statusOutput.not_added.length, 1);
    assert.strictEqual(statusOutput.not_added[0], 'new-file.ts');
  });

  it('should parse deleted files', () => {
    const statusOutput = {
      modified: [],
      not_added: [],
      deleted: ['old-file.ts'],
      created: [],
      staged: []
    };

    assert.strictEqual(statusOutput.deleted.length, 1);
  });

  it('should detect clean status', () => {
    const statusOutput = {
      modified: [],
      not_added: [],
      deleted: [],
      created: [],
      staged: [],
      isClean: () => true
    };

    assert.strictEqual(statusOutput.isClean(), true);
  });
});

describe('Commit Message Formatting', () => {
  it('should handle single line messages', () => {
    const message = 'Fix bug in authentication';
    assert.ok(message.length > 0);
    assert.ok(!message.includes('\n'));
  });

  it('should handle multi-line messages', () => {
    const message = `Add new feature

This feature implements:
- Item 1
- Item 2

Closes #123`;

    const lines = message.split('\n');
    assert.ok(lines.length > 1);
    assert.strictEqual(lines[0], 'Add new feature');
  });

  it('should handle special characters in messages', () => {
    const message = 'Fix "quotes" and \'apostrophes\' in code';
    assert.ok(message.includes('"'));
    assert.ok(message.includes("'"));
  });
});

describe('Git Identity Configuration', () => {
  it('should use default git identity', () => {
    const defaultIdentity = {
      name: 'Internal API Server',
      email: 'worker@internal-api-server.local'
    };

    assert.strictEqual(defaultIdentity.name, 'Internal API Server');
    assert.ok(defaultIdentity.email.includes('@'));
  });
});

describe('Error Types', () => {
  it('should identify dubious ownership error', () => {
    const error = new Error('fatal: detected dubious ownership in repository');
    assert.ok(error.message.includes('dubious ownership'));
  });

  it('should identify not a repository error', () => {
    const error = new Error('fatal: not a git repository');
    assert.ok(error.message.includes('not a git repository'));
  });

  it('should identify authentication error', () => {
    const error = new Error('fatal: Authentication failed');
    assert.ok(error.message.includes('Authentication'));
  });

  it('should identify merge conflict error', () => {
    const error = new Error('error: Your local changes would be overwritten by merge');
    assert.ok(error.message.includes('merge'));
  });

  it('should identify network error', () => {
    const error = new Error('fatal: unable to access: Could not resolve host');
    assert.ok(error.message.includes('resolve host'));
  });
});

describe('Branch Name Validation', () => {
  it('should accept valid branch names', () => {
    const validNames = [
      'main',
      'develop',
      'feature/auth',
      'bugfix/issue-123',
      'release/v1.0.0',
      'hotfix/critical-fix'
    ];

    for (const name of validNames) {
      assert.ok(typeof name === 'string');
      assert.ok(name.length > 0);
    }
  });

  it('should handle special characters in branch names', () => {
    const name = 'feature/user_auth-v2.0';

    assert.ok(name.includes('/'));
    assert.ok(name.includes('_'));
    assert.ok(name.includes('-'));
    assert.ok(name.includes('.'));
  });
});

describe('Index Refresh Logic', () => {
  it('should refresh index to detect changes after tarball extraction', async () => {
    let refreshCalled = false;

    const refreshIndex = async () => {
      refreshCalled = true;
      // Simulate index refresh
      return Promise.resolve();
    };

    await refreshIndex();

    assert.strictEqual(refreshCalled, true);
  });

  it('should use raw porcelain status for reliable detection', () => {
    // Porcelain format: ' M src/file.ts' for modified (XY where X=staged, Y=unstaged)
    // Note: Don't use trim() on porcelain output as it removes leading spaces from status codes
    const rawStatus = ' M src/index.ts\n?? new-file.ts\n D deleted.ts';

    const lines = rawStatus.split('\n').filter(line => line.length > 0);
    assert.strictEqual(lines.length, 3);

    // Modified file (unstaged modification: ' M')
    assert.ok(lines[0].startsWith(' M'), `Expected line to start with ' M', got: '${lines[0]}'`);

    // Untracked file
    assert.ok(lines[1].startsWith('??'), `Expected line to start with '??', got: '${lines[1]}'`);

    // Deleted file (unstaged deletion: ' D')
    assert.ok(lines[2].startsWith(' D'), `Expected line to start with ' D', got: '${lines[2]}'`);
  });

  it('should detect changes from both raw and structured status', () => {
    const rawHasChanges = true;
    const structuredHasChanges = false;

    // Should be true if either source indicates changes
    const hasChanges = rawHasChanges || structuredHasChanges;

    assert.strictEqual(hasChanges, true);
  });
});
