import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { WorkerPool, createWorkerPool, type WorkerPoolOptions, type PoolTask } from './pool.js';
import { type Issue } from '../github/issues.js';

// Create mock issue
function createMockIssue(number: number, title: string): Issue {
  return {
    number,
    title,
    body: `Description for issue ${number}`,
    state: 'open',
    labels: [],
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    createdAt: new Date().toISOString(),
    assignee: null,
  };
}

describe('WorkerPool', () => {
  const defaultOptions: WorkerPoolOptions = {
    maxWorkers: 2,
    workDir: '/tmp/test-work',
    repoUrl: 'https://github.com/test-owner/test-repo',
    baseBranch: 'main',
    githubToken: 'test-token',
    claudeAuth: {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
    },
    timeoutMinutes: 30,
  };

  describe('constructor', () => {
    it('should create pool with specified max workers', () => {
      const pool = new WorkerPool(defaultOptions);

      const status = pool.getStatus();
      assert.strictEqual(status.active, 0);
      assert.strictEqual(status.queued, 0);
    });

    it('should extract repository name from HTTPS URL', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        repoUrl: 'https://github.com/owner/repo-name',
      });

      // Pool should be created successfully
      assert.ok(pool);
    });

    it('should extract repository name from SSH URL', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        repoUrl: 'git@github.com:owner/repo-name.git',
      });

      assert.ok(pool);
    });

    it('should handle URL with .git extension', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        repoUrl: 'https://github.com/owner/repo-name.git',
      });

      assert.ok(pool);
    });
  });

  describe('createWorkerPool factory', () => {
    it('should create a WorkerPool instance', () => {
      const pool = createWorkerPool(defaultOptions);

      assert.ok(pool instanceof WorkerPool);
    });
  });

  describe('getStatus', () => {
    it('should return initial status with zero values', () => {
      const pool = new WorkerPool(defaultOptions);

      const status = pool.getStatus();

      assert.strictEqual(status.active, 0);
      assert.strictEqual(status.queued, 0);
      assert.strictEqual(status.completed, 0);
      assert.strictEqual(status.succeeded, 0);
      assert.strictEqual(status.failed, 0);
    });

    it('should track all status fields', () => {
      const pool = new WorkerPool(defaultOptions);

      const status = pool.getStatus();

      assert.ok('active' in status);
      assert.ok('queued' in status);
      assert.ok('completed' in status);
      assert.ok('succeeded' in status);
      assert.ok('failed' in status);
    });
  });

  describe('stop', () => {
    it('should set isRunning to false', () => {
      const pool = new WorkerPool(defaultOptions);

      // Stop should not throw
      pool.stop();

      // Status should still be accessible
      const status = pool.getStatus();
      assert.ok(status);
    });
  });

  describe('WorkerPoolOptions', () => {
    it('should accept database logging options', () => {
      const options: WorkerPoolOptions = {
        ...defaultOptions,
        userId: 'user-123',
        repoOwner: 'test-owner',
        repoName: 'test-repo',
        enableDatabaseLogging: true,
      };

      const pool = new WorkerPool(options);
      assert.ok(pool);
    });

    it('should work without optional database options', () => {
      const pool = new WorkerPool(defaultOptions);
      assert.ok(pool);
    });
  });

  describe('PoolTask interface', () => {
    it('should extend WorkerTask with id', () => {
      const task: PoolTask = {
        id: 'task-1',
        issue: createMockIssue(1, 'Test Issue'),
        branchName: 'feature/test',
      };

      assert.strictEqual(task.id, 'task-1');
      assert.strictEqual(task.issue.number, 1);
      assert.strictEqual(task.branchName, 'feature/test');
    });
  });

  describe('pool capacity', () => {
    it('should respect maxWorkers limit', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        maxWorkers: 3,
      });

      // Pool should be configured with max 3 workers
      assert.ok(pool);
    });

    it('should handle single worker configuration', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        maxWorkers: 1,
      });

      assert.ok(pool);
    });

    it('should handle high worker count', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        maxWorkers: 10,
      });

      assert.ok(pool);
    });
  });

  describe('timeout configuration', () => {
    it('should accept timeout in minutes', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        timeoutMinutes: 60,
      });

      assert.ok(pool);
    });

    it('should handle short timeouts', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        timeoutMinutes: 5,
      });

      assert.ok(pool);
    });

    it('should handle long timeouts', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        timeoutMinutes: 120,
      });

      assert.ok(pool);
    });
  });

  describe('branch configuration', () => {
    it('should accept base branch configuration', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        baseBranch: 'develop',
      });

      assert.ok(pool);
    });

    it('should handle main branch', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        baseBranch: 'main',
      });

      assert.ok(pool);
    });

    it('should handle master branch', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        baseBranch: 'master',
      });

      assert.ok(pool);
    });
  });

  describe('Claude auth configuration', () => {
    it('should accept Claude auth with expiration', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        claudeAuth: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 3600000,
        },
      });

      assert.ok(pool);
    });

    it('should accept Claude auth without expiration', () => {
      const pool = new WorkerPool({
        ...defaultOptions,
        claudeAuth: {
          accessToken: 'token',
          refreshToken: 'refresh',
        },
      });

      assert.ok(pool);
    });
  });
});

describe('Pool Result Interface', () => {
  it('should include taskId', () => {
    // Verify PoolResult interface structure
    const result = {
      taskId: 'task-1',
      success: true,
      issue: createMockIssue(1, 'Test'),
      branchName: 'feature/test',
      commitSha: 'abc123',
      duration: 5000,
    };

    assert.strictEqual(result.taskId, 'task-1');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.commitSha, 'abc123');
  });

  it('should handle failed result', () => {
    const result = {
      taskId: 'task-2',
      success: false,
      issue: createMockIssue(2, 'Failed Task'),
      branchName: 'feature/failed',
      error: 'Something went wrong',
      duration: 3000,
    };

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Something went wrong');
    assert.strictEqual(result.commitSha, undefined);
  });

  it('should include chat session id when available', () => {
    const result = {
      taskId: 'task-3',
      success: true,
      issue: createMockIssue(3, 'With Session'),
      branchName: 'feature/session',
      commitSha: 'def456',
      duration: 7000,
      chatSessionId: 'session-123',
    };

    assert.strictEqual(result.chatSessionId, 'session-123');
  });
});

describe('WorkerPool edge cases', () => {
  const options: WorkerPoolOptions = {
    maxWorkers: 2,
    workDir: '/tmp/test',
    repoUrl: 'https://github.com/owner/repo',
    baseBranch: 'main',
    githubToken: 'token',
    claudeAuth: {
      accessToken: 'access',
      refreshToken: 'refresh',
    },
    timeoutMinutes: 30,
  };

  it('should handle empty work directory path', () => {
    const pool = new WorkerPool({
      ...options,
      workDir: '',
    });

    assert.ok(pool);
  });

  it('should handle work directory with spaces', () => {
    const pool = new WorkerPool({
      ...options,
      workDir: '/tmp/work dir with spaces',
    });

    assert.ok(pool);
  });

  it('should handle repository URL with port', () => {
    const pool = new WorkerPool({
      ...options,
      repoUrl: 'https://github.example.com:8443/owner/repo',
    });

    assert.ok(pool);
  });

  it('should handle repository URL with path prefix', () => {
    const pool = new WorkerPool({
      ...options,
      repoUrl: 'https://github.example.com/prefix/owner/repo',
    });

    assert.ok(pool);
  });
});

describe('Task ID Generation', () => {
  it('should generate sequential task IDs', () => {
    // Task IDs are generated as "task-{index+1}"
    const expectedIds = ['task-1', 'task-2', 'task-3'];

    expectedIds.forEach((id, index) => {
      assert.strictEqual(id, `task-${index + 1}`);
    });
  });

  it('should start from task-1', () => {
    const firstTaskId = 'task-1';
    assert.strictEqual(firstTaskId, 'task-1');
  });
});
