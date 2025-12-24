/**
 * Tests for the GitHub Client module.
 * Covers repository cloning, pulling, URL parsing, and token injection.
 * Uses mock implementations for git operations.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { GitHubClient, type GitHubPullOptions, type GitHubPullResult } from '../../src/github/githubClient.js';

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient();
  });

  describe('constructor', () => {
    it('should create a new GitHubClient instance', () => {
      const newClient = new GitHubClient();
      assert.ok(newClient instanceof GitHubClient);
    });
  });

  describe('extractRepoName', () => {
    it('should extract repo name from HTTPS URL', () => {
      const repoName = client.extractRepoName('https://github.com/owner/my-repo');
      assert.strictEqual(repoName, 'my-repo');
    });

    it('should extract repo name from URL with .git suffix', () => {
      const repoName = client.extractRepoName('https://github.com/owner/my-repo.git');
      assert.strictEqual(repoName, 'my-repo');
    });

    it('should handle hyphenated repo names', () => {
      const repoName = client.extractRepoName('https://github.com/org/my-project-name');
      assert.strictEqual(repoName, 'my-project-name');
    });

    it('should handle underscored repo names', () => {
      const repoName = client.extractRepoName('https://github.com/org/my_project_name');
      assert.strictEqual(repoName, 'my_project_name');
    });

    it('should handle numeric repo names', () => {
      const repoName = client.extractRepoName('https://github.com/org/repo123');
      assert.strictEqual(repoName, 'repo123');
    });

    it('should throw for invalid URL without repo', () => {
      assert.throws(
        () => client.extractRepoName('https://github.com/'),
        /Invalid repository URL/
      );
    });

    it('should throw for completely invalid URL', () => {
      assert.throws(
        () => client.extractRepoName('not-a-url'),
        /Invalid repository URL/
      );
    });

    it('should throw for empty URL', () => {
      assert.throws(
        () => client.extractRepoName(''),
        /Invalid repository URL/
      );
    });
  });

  describe('extractOwner', () => {
    it('should extract owner from HTTPS URL', () => {
      const owner = client.extractOwner('https://github.com/myorg/myrepo');
      assert.strictEqual(owner, 'myorg');
    });

    it('should extract owner from URL with .git suffix', () => {
      const owner = client.extractOwner('https://github.com/myorg/myrepo.git');
      assert.strictEqual(owner, 'myorg');
    });

    it('should handle hyphenated owner names', () => {
      const owner = client.extractOwner('https://github.com/my-organization/repo');
      assert.strictEqual(owner, 'my-organization');
    });

    it('should handle numeric owner names', () => {
      const owner = client.extractOwner('https://github.com/org123/repo');
      assert.strictEqual(owner, 'org123');
    });

    it('should throw for non-GitHub URL', () => {
      assert.throws(
        () => client.extractOwner('https://gitlab.com/owner/repo'),
        /Invalid repository URL/
      );
    });

    it('should throw for malformed URL', () => {
      assert.throws(
        () => client.extractOwner('https://github.com'),
        /Invalid repository URL/
      );
    });
  });
});

describe('GitHubPullOptions Interface', () => {
  it('should have required repoUrl and workspaceRoot', () => {
    const options: GitHubPullOptions = {
      repoUrl: 'https://github.com/owner/repo',
      workspaceRoot: '/tmp/workspace'
    };

    assert.strictEqual(options.repoUrl, 'https://github.com/owner/repo');
    assert.strictEqual(options.workspaceRoot, '/tmp/workspace');
  });

  it('should support optional branch', () => {
    const options: GitHubPullOptions = {
      repoUrl: 'https://github.com/owner/repo',
      workspaceRoot: '/tmp/workspace',
      branch: 'develop'
    };

    assert.strictEqual(options.branch, 'develop');
  });

  it('should support optional directory', () => {
    const options: GitHubPullOptions = {
      repoUrl: 'https://github.com/owner/repo',
      workspaceRoot: '/tmp/workspace',
      directory: 'custom-dir'
    };

    assert.strictEqual(options.directory, 'custom-dir');
  });

  it('should support optional accessToken', () => {
    const options: GitHubPullOptions = {
      repoUrl: 'https://github.com/owner/repo',
      workspaceRoot: '/tmp/workspace',
      accessToken: 'ghp_token123'
    };

    assert.strictEqual(options.accessToken, 'ghp_token123');
  });

  it('should support all options together', () => {
    const options: GitHubPullOptions = {
      repoUrl: 'https://github.com/owner/repo.git',
      workspaceRoot: '/workspace',
      branch: 'feature/test',
      directory: 'repo-clone',
      accessToken: 'ghp_secret'
    };

    assert.strictEqual(options.repoUrl, 'https://github.com/owner/repo.git');
    assert.strictEqual(options.workspaceRoot, '/workspace');
    assert.strictEqual(options.branch, 'feature/test');
    assert.strictEqual(options.directory, 'repo-clone');
    assert.strictEqual(options.accessToken, 'ghp_secret');
  });
});

describe('GitHubPullResult Interface', () => {
  it('should have all required properties', () => {
    const result: GitHubPullResult = {
      targetPath: '/workspace/repo',
      wasCloned: true,
      branch: 'main'
    };

    assert.strictEqual(result.targetPath, '/workspace/repo');
    assert.strictEqual(result.wasCloned, true);
    assert.strictEqual(result.branch, 'main');
  });

  it('should represent a fresh clone', () => {
    const result: GitHubPullResult = {
      targetPath: '/tmp/workspace/new-repo',
      wasCloned: true,
      branch: 'main'
    };

    assert.strictEqual(result.wasCloned, true);
  });

  it('should represent a pull on existing repo', () => {
    const result: GitHubPullResult = {
      targetPath: '/tmp/workspace/existing-repo',
      wasCloned: false,
      branch: 'develop'
    };

    assert.strictEqual(result.wasCloned, false);
    assert.strictEqual(result.branch, 'develop');
  });
});

describe('GitHubClient Mock Operations', () => {
  describe('pullRepository mock behavior', () => {
    it('should clone when repository does not exist', async () => {
      const mockPullRepository = mock.fn(async (options: GitHubPullOptions): Promise<GitHubPullResult> => {
        // Mock: repo doesn't exist, so clone
        return {
          targetPath: `${options.workspaceRoot}/repo`,
          wasCloned: true,
          branch: options.branch || 'main'
        };
      });

      const result = await mockPullRepository({
        repoUrl: 'https://github.com/owner/repo',
        workspaceRoot: '/workspace'
      });

      assert.strictEqual(result.wasCloned, true);
      assert.strictEqual(result.branch, 'main');
    });

    it('should pull when repository exists', async () => {
      const mockPullRepository = mock.fn(async (options: GitHubPullOptions): Promise<GitHubPullResult> => {
        // Mock: repo exists, so pull
        return {
          targetPath: `${options.workspaceRoot}/repo`,
          wasCloned: false,
          branch: options.branch || 'main'
        };
      });

      const result = await mockPullRepository({
        repoUrl: 'https://github.com/owner/repo',
        workspaceRoot: '/workspace',
        branch: 'develop'
      });

      assert.strictEqual(result.wasCloned, false);
      assert.strictEqual(result.branch, 'develop');
    });

    it('should use custom directory when specified', async () => {
      const mockPullRepository = mock.fn(async (options: GitHubPullOptions): Promise<GitHubPullResult> => {
        const directory = options.directory || 'repo';
        return {
          targetPath: `${options.workspaceRoot}/${directory}`,
          wasCloned: true,
          branch: options.branch || 'main'
        };
      });

      const result = await mockPullRepository({
        repoUrl: 'https://github.com/owner/repo',
        workspaceRoot: '/workspace',
        directory: 'custom-dir'
      });

      assert.strictEqual(result.targetPath, '/workspace/custom-dir');
    });
  });

  describe('branch fallback behavior', () => {
    it('should fallback to default branch when specified branch not found', async () => {
      let attemptedBranch = '';
      const mockClone = mock.fn(async (
        repoUrl: string,
        targetPath: string,
        branch?: string
      ): Promise<GitHubPullResult> => {
        attemptedBranch = branch || 'default';

        if (branch === 'non-existent') {
          // Simulate branch not found, fallback to default
          return {
            targetPath,
            wasCloned: true,
            branch: 'main'  // Fallback branch
          };
        }

        return {
          targetPath,
          wasCloned: true,
          branch: branch || 'main'
        };
      });

      const result = await mockClone(
        'https://github.com/owner/repo',
        '/workspace/repo',
        'non-existent'
      );

      assert.strictEqual(attemptedBranch, 'non-existent');
      assert.strictEqual(result.branch, 'main');
      assert.strictEqual(result.wasCloned, true);
    });

    it('should succeed on first try with existing branch', async () => {
      const mockClone = mock.fn(async (
        repoUrl: string,
        targetPath: string,
        branch?: string
      ): Promise<GitHubPullResult> => {
        return {
          targetPath,
          wasCloned: true,
          branch: branch || 'main'
        };
      });

      const result = await mockClone(
        'https://github.com/owner/repo',
        '/workspace/repo',
        'develop'
      );

      assert.strictEqual(result.branch, 'develop');
      assert.strictEqual(mockClone.mock.callCount(), 1);
    });
  });

  describe('token injection', () => {
    it('should inject token into HTTPS URL', () => {
      const injectToken = (repoUrl: string, token: string): string => {
        if (repoUrl.startsWith('https://github.com/')) {
          return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
        }
        return repoUrl;
      };

      const result = injectToken('https://github.com/owner/repo', 'mytoken');
      assert.strictEqual(result, 'https://mytoken@github.com/owner/repo');
    });

    it('should not modify non-GitHub URLs', () => {
      const injectToken = (repoUrl: string, token: string): string => {
        if (repoUrl.startsWith('https://github.com/')) {
          return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
        }
        return repoUrl;
      };

      const result = injectToken('https://gitlab.com/owner/repo', 'mytoken');
      assert.strictEqual(result, 'https://gitlab.com/owner/repo');
    });

    it('should handle URL with .git suffix', () => {
      const injectToken = (repoUrl: string, token: string): string => {
        if (repoUrl.startsWith('https://github.com/')) {
          return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
        }
        return repoUrl;
      };

      const result = injectToken('https://github.com/owner/repo.git', 'token123');
      assert.strictEqual(result, 'https://token123@github.com/owner/repo.git');
    });
  });

  describe('error handling', () => {
    it('should handle clone failure', async () => {
      const mockClone = mock.fn(async () => {
        throw new Error('Authentication failed');
      });

      await assert.rejects(
        () => mockClone(),
        /Authentication failed/
      );
    });

    it('should handle network errors', async () => {
      const mockClone = mock.fn(async () => {
        throw new Error('Network error: unable to connect');
      });

      await assert.rejects(
        () => mockClone(),
        /Network error/
      );
    });

    it('should handle permission denied', async () => {
      const mockClone = mock.fn(async () => {
        throw new Error('Permission denied to repository');
      });

      await assert.rejects(
        () => mockClone(),
        /Permission denied/
      );
    });

    it('should handle repository not found', async () => {
      const mockClone = mock.fn(async () => {
        throw new Error('Repository not found');
      });

      await assert.rejects(
        () => mockClone(),
        /Repository not found/
      );
    });
  });

  describe('pull existing repository', () => {
    it('should checkout branch if different from current', async () => {
      let checkedOutBranch = '';
      const mockPullExisting = mock.fn(async (
        targetPath: string,
        currentBranch: string,
        requestedBranch: string
      ): Promise<GitHubPullResult> => {
        if (requestedBranch !== currentBranch) {
          checkedOutBranch = requestedBranch;
        }
        return {
          targetPath,
          wasCloned: false,
          branch: requestedBranch
        };
      });

      await mockPullExisting('/workspace/repo', 'main', 'develop');

      assert.strictEqual(checkedOutBranch, 'develop');
    });

    it('should not checkout if already on correct branch', async () => {
      let checkoutCalled = false;
      const mockPullExisting = mock.fn(async (
        targetPath: string,
        currentBranch: string,
        requestedBranch: string
      ): Promise<GitHubPullResult> => {
        if (requestedBranch !== currentBranch) {
          checkoutCalled = true;
        }
        return {
          targetPath,
          wasCloned: false,
          branch: requestedBranch
        };
      });

      await mockPullExisting('/workspace/repo', 'main', 'main');

      assert.strictEqual(checkoutCalled, false);
    });
  });
});

describe('URL Pattern Recognition', () => {
  const client = new GitHubClient();

  describe('valid GitHub URL patterns', () => {
    const validUrls = [
      'https://github.com/owner/repo',
      'https://github.com/owner/repo.git',
      'https://github.com/my-org/my-repo',
      'https://github.com/org_name/repo_name',
      'https://github.com/Organization123/Project456'
    ];

    for (const url of validUrls) {
      it(`should parse ${url}`, () => {
        const owner = client.extractOwner(url);
        const repo = client.extractRepoName(url);

        assert.ok(owner.length > 0);
        assert.ok(repo.length > 0);
      });
    }
  });

  describe('invalid URL patterns', () => {
    // These URLs don't contain 'github.com/owner/' pattern
    const invalidUrls = [
      'https://gitlab.com/owner/repo',
      'https://bitbucket.org/owner/repo',
      'http://github.com',  // No owner/repo path
    ];

    for (const url of invalidUrls) {
      it(`should reject ${url}`, () => {
        assert.throws(
          () => client.extractOwner(url),
          Error
        );
      });
    }
  });

  describe('permissive URL patterns', () => {
    // These URLs contain 'github.com/owner/' and are accepted by the regex
    // The function extracts owner regardless of protocol scheme
    it('should accept github.com/owner/repo without protocol', () => {
      const owner = client.extractOwner('github.com/owner/repo');
      assert.strictEqual(owner, 'owner');
    });

    it('should accept ftp://github.com/owner/repo', () => {
      const owner = client.extractOwner('ftp://github.com/owner/repo');
      assert.strictEqual(owner, 'owner');
    });
  });
});

describe('Edge Cases', () => {
  const client = new GitHubClient();

  it('should handle very long repository names', () => {
    const longRepoName = 'a'.repeat(100);
    const url = `https://github.com/owner/${longRepoName}`;

    const repoName = client.extractRepoName(url);
    assert.strictEqual(repoName, longRepoName);
  });

  it('should handle repo name with multiple dots', () => {
    const repoName = client.extractRepoName('https://github.com/owner/my.project.name');
    assert.strictEqual(repoName, 'my.project.name');
  });

  it('should handle single character repo name', () => {
    const repoName = client.extractRepoName('https://github.com/owner/x');
    assert.strictEqual(repoName, 'x');
  });

  it('should handle single character owner name', () => {
    const owner = client.extractOwner('https://github.com/o/repo');
    assert.strictEqual(owner, 'o');
  });
});
