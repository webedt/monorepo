import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { type Issue } from '../github/issues.js';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// Create mock issue
function createMockIssue(number: number, title: string, body?: string): Issue {
  return {
    number,
    title,
    body: body ?? `Description for issue ${number}`,
    state: 'open',
    labels: [],
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    createdAt: new Date().toISOString(),
    assignee: null,
  };
}

describe('Worker', () => {
  let testDir: string;
  const defaultOptions: WorkerOptions = {
    workDir: '',
    repoUrl: 'https://github.com/test-owner/test-repo',
    baseBranch: 'main',
    githubToken: 'test-token',
    claudeAuth: {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    },
    timeoutMinutes: 30,
  };

  beforeEach(() => {
    testDir = join(tmpdir(), `worker-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    defaultOptions.workDir = testDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create worker with provided options', () => {
      const worker = new Worker(defaultOptions, 'worker-1');
      assert.ok(worker);
    });

    it('should accept different worker IDs', () => {
      const worker1 = new Worker(defaultOptions, 'worker-1');
      const worker2 = new Worker(defaultOptions, 'worker-2');
      assert.ok(worker1);
      assert.ok(worker2);
    });

    it('should accept database logging options', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        userId: 'user-123',
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        enableDatabaseLogging: true,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept sparse checkout options', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        sparseCheckout: {
          enabled: true,
          paths: ['src/', 'tests/'],
        },
        useShallowClone: true,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should extract repository name from HTTPS URL', () => {
      const worker = new Worker({
        ...defaultOptions,
        repoUrl: 'https://github.com/owner/repo-name',
      }, 'worker-1');
      assert.ok(worker);
    });

    it('should extract repository name from SSH URL', () => {
      const worker = new Worker({
        ...defaultOptions,
        repoUrl: 'git@github.com:owner/repo-name.git',
      }, 'worker-1');
      assert.ok(worker);
    });

    it('should handle URL with .git extension', () => {
      const worker = new Worker({
        ...defaultOptions,
        repoUrl: 'https://github.com/owner/repo-name.git',
      }, 'worker-1');
      assert.ok(worker);
    });
  });

  describe('WorkerOptions', () => {
    it('should require workDir', () => {
      const options: WorkerOptions = {
        workDir: '/tmp/work',
        repoUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        githubToken: 'token',
        claudeAuth: {
          accessToken: 'access',
          refreshToken: 'refresh',
        },
        timeoutMinutes: 30,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept Claude auth with expiration', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        claudeAuth: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 3600000,
        },
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept Claude auth without expiration', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        claudeAuth: {
          accessToken: 'token',
          refreshToken: 'refresh',
        },
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });
  });

  describe('WorkerTask interface', () => {
    it('should contain issue and branchName', () => {
      const task: WorkerTask = {
        issue: createMockIssue(1, 'Test Issue'),
        branchName: 'feature/test',
      };

      assert.strictEqual(task.issue.number, 1);
      assert.strictEqual(task.branchName, 'feature/test');
    });

    it('should accept issue with body', () => {
      const task: WorkerTask = {
        issue: createMockIssue(1, 'Test', 'Detailed description'),
        branchName: 'feature/test',
      };

      assert.strictEqual(task.issue.body, 'Detailed description');
    });

    it('should accept issue without body', () => {
      const issue = createMockIssue(1, 'Test');
      issue.body = null;
      const task: WorkerTask = {
        issue,
        branchName: 'feature/test',
      };

      assert.strictEqual(task.issue.body, null);
    });
  });

  describe('WorkerResult interface', () => {
    it('should include all required fields for success', () => {
      const result: WorkerResult = {
        success: true,
        issue: createMockIssue(1, 'Test'),
        branchName: 'feature/test',
        commitSha: 'abc123',
        duration: 5000,
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commitSha, 'abc123');
      assert.strictEqual(result.duration, 5000);
    });

    it('should include all required fields for failure', () => {
      const result: WorkerResult = {
        success: false,
        issue: createMockIssue(1, 'Test'),
        branchName: 'feature/test',
        error: 'Something went wrong',
        duration: 3000,
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Something went wrong');
      assert.strictEqual(result.commitSha, undefined);
    });

    it('should include chat session id when available', () => {
      const result: WorkerResult = {
        success: true,
        issue: createMockIssue(1, 'Test'),
        branchName: 'feature/test',
        commitSha: 'def456',
        duration: 7000,
        chatSessionId: 'session-123',
      };

      assert.strictEqual(result.chatSessionId, 'session-123');
    });

    it('should allow optional fields to be undefined', () => {
      const result: WorkerResult = {
        success: true,
        issue: createMockIssue(1, 'Test'),
        branchName: 'feature/test',
        duration: 1000,
      };

      assert.strictEqual(result.commitSha, undefined);
      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.chatSessionId, undefined);
    });
  });

  describe('timeout configuration', () => {
    it('should accept timeout in minutes', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        timeoutMinutes: 60,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should handle short timeouts', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        timeoutMinutes: 5,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should handle long timeouts', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        timeoutMinutes: 120,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });
  });

  describe('branch configuration', () => {
    it('should accept main branch', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        baseBranch: 'main',
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept master branch', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        baseBranch: 'master',
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept develop branch', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        baseBranch: 'develop',
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });
  });

  describe('work directory configuration', () => {
    it('should accept work directory with spaces', () => {
      const workDirWithSpaces = join(testDir, 'work dir with spaces');
      mkdirSync(workDirWithSpaces, { recursive: true });

      const options: WorkerOptions = {
        ...defaultOptions,
        workDir: workDirWithSpaces,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept absolute paths', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        workDir: '/tmp/absolute/path',
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });
  });

  describe('performance options', () => {
    it('should accept sparse checkout enabled', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        sparseCheckout: {
          enabled: true,
          paths: ['src/', 'lib/'],
        },
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept sparse checkout disabled', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        sparseCheckout: {
          enabled: false,
        },
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept useShallowClone true', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        useShallowClone: true,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept useShallowClone false', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        useShallowClone: false,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });
  });
});

describe('Worker Edge Cases', () => {
  it('should handle empty work directory path', () => {
    const options: WorkerOptions = {
      workDir: '',
      repoUrl: 'https://github.com/owner/repo',
      baseBranch: 'main',
      githubToken: 'token',
      claudeAuth: {
        accessToken: 'access',
        refreshToken: 'refresh',
      },
      timeoutMinutes: 30,
    };

    const worker = new Worker(options, 'worker-1');
    assert.ok(worker);
  });

  it('should handle repository URL with port', () => {
    const options: WorkerOptions = {
      workDir: '/tmp/test',
      repoUrl: 'https://github.example.com:8443/owner/repo',
      baseBranch: 'main',
      githubToken: 'token',
      claudeAuth: {
        accessToken: 'access',
        refreshToken: 'refresh',
      },
      timeoutMinutes: 30,
    };

    const worker = new Worker(options, 'worker-1');
    assert.ok(worker);
  });

  it('should handle repository URL with path prefix', () => {
    const options: WorkerOptions = {
      workDir: '/tmp/test',
      repoUrl: 'https://github.example.com/prefix/owner/repo',
      baseBranch: 'main',
      githubToken: 'token',
      claudeAuth: {
        accessToken: 'access',
        refreshToken: 'refresh',
      },
      timeoutMinutes: 30,
    };

    const worker = new Worker(options, 'worker-1');
    assert.ok(worker);
  });
});

describe('Issue to Task conversion', () => {
  it('should create task from issue with title', () => {
    const issue = createMockIssue(1, 'Add new feature');
    const task: WorkerTask = {
      issue,
      branchName: 'feature/add-new-feature',
    };

    assert.strictEqual(task.issue.title, 'Add new feature');
  });

  it('should create task from issue with labels', () => {
    const issue = createMockIssue(1, 'Fix bug');
    issue.labels = ['bug', 'high-priority'];
    const task: WorkerTask = {
      issue,
      branchName: 'fix/fix-bug',
    };

    assert.deepStrictEqual(task.issue.labels, ['bug', 'high-priority']);
  });

  it('should create task from issue with assignee', () => {
    const issue = createMockIssue(1, 'Implement feature');
    issue.assignee = 'developer';
    const task: WorkerTask = {
      issue,
      branchName: 'feature/implement-feature',
    };

    assert.strictEqual(task.issue.assignee, 'developer');
  });
});
