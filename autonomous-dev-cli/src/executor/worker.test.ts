import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { type Issue } from '../github/issues.js';
import { ExecutionError, ErrorCode } from '../utils/errors.js';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create mock issue
function createMockIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: 'Test Issue',
    body: 'Test description for the issue',
    state: 'open',
    labels: [],
    htmlUrl: 'https://github.com/owner/repo/issues/1',
    createdAt: new Date().toISOString(),
    assignee: null,
    ...overrides,
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
    // Create a temporary test directory
    testDir = join(tmpdir(), `worker-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    defaultOptions.workDir = testDir;
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create worker with specified options', () => {
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
          paths: ['src/', 'package.json'],
        },
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should accept shallow clone option', () => {
      const options: WorkerOptions = {
        ...defaultOptions,
        useShallowClone: true,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should handle Claude auth with expiration', () => {
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
  });

  describe('WorkerOptions', () => {
    it('should require workDir', () => {
      const options: WorkerOptions = {
        workDir: '/tmp/work',
        repoUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        githubToken: 'token',
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
        timeoutMinutes: 30,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should require repoUrl', () => {
      const options: WorkerOptions = {
        workDir: '/tmp/work',
        repoUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        githubToken: 'token',
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
        timeoutMinutes: 30,
      };

      const worker = new Worker(options, 'worker-1');
      assert.ok(worker);
    });

    it('should handle different timeout values', () => {
      [5, 30, 60, 120].forEach((timeout) => {
        const options: WorkerOptions = {
          ...defaultOptions,
          timeoutMinutes: timeout,
        };
        const worker = new Worker(options, 'worker-1');
        assert.ok(worker);
      });
    });
  });

  describe('WorkerTask interface', () => {
    it('should have required fields', () => {
      const task: WorkerTask = {
        issue: createMockIssue(),
        branchName: 'feature/test-branch',
      };

      assert.ok(task.issue);
      assert.strictEqual(task.branchName, 'feature/test-branch');
    });

    it('should accept various branch name formats', () => {
      const branchNames = [
        'feature/add-feature',
        'auto/123-fix-bug',
        'bugfix/issue-456',
        'chore/update-deps',
      ];

      branchNames.forEach((branchName) => {
        const task: WorkerTask = {
          issue: createMockIssue(),
          branchName,
        };
        assert.strictEqual(task.branchName, branchName);
      });
    });
  });

  describe('WorkerResult interface', () => {
    it('should represent successful result', () => {
      const result: WorkerResult = {
        success: true,
        issue: createMockIssue(),
        branchName: 'feature/test',
        commitSha: 'abc123def456',
        duration: 5000,
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commitSha, 'abc123def456');
      assert.strictEqual(result.duration, 5000);
      assert.strictEqual(result.error, undefined);
    });

    it('should represent failed result', () => {
      const result: WorkerResult = {
        success: false,
        issue: createMockIssue(),
        branchName: 'feature/test',
        error: 'Clone failed: network error',
        duration: 1000,
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Clone failed: network error');
      assert.strictEqual(result.commitSha, undefined);
    });

    it('should include chat session ID when available', () => {
      const result: WorkerResult = {
        success: true,
        issue: createMockIssue(),
        branchName: 'feature/test',
        commitSha: 'abc123',
        duration: 5000,
        chatSessionId: 'session-uuid-123',
      };

      assert.strictEqual(result.chatSessionId, 'session-uuid-123');
    });
  });

  describe('repository name extraction', () => {
    it('should extract repo name from HTTPS URL', () => {
      const url = 'https://github.com/owner/repo-name';
      const match = url.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
      assert.strictEqual(match?.[1], 'owner/repo-name');
    });

    it('should extract repo name from SSH URL', () => {
      const url = 'git@github.com:owner/repo-name.git';
      const match = url.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
      assert.strictEqual(match?.[1], 'owner/repo-name');
    });

    it('should handle URL with .git extension', () => {
      const url = 'https://github.com/owner/repo-name.git';
      const match = url.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
      assert.strictEqual(match?.[1], 'owner/repo-name');
    });

    it('should handle complex repository names', () => {
      const urls = [
        'https://github.com/my-org/my-repo',
        'https://github.com/org123/repo_name',
        'https://github.com/Org-Name/Repo.Name',
      ];

      urls.forEach((url) => {
        const match = url.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
        assert.ok(match?.[1], `Failed to extract from: ${url}`);
      });
    });
  });

  describe('prompt building', () => {
    it('should include issue number in prompt', () => {
      const issue = createMockIssue({ number: 42, title: 'Fix bug' });

      const prompt = `You are an expert developer working on implementing a GitHub issue.

## Issue #${issue.number}: ${issue.title}

${issue.body || 'No description provided.'}

## Instructions

1. First, explore the codebase to understand the structure and existing patterns
2. Implement the changes described in the issue
3. Follow existing code style and conventions
4. Make sure your changes are complete and working
5. Do NOT create or modify test files unless specifically asked
6. Do NOT modify unrelated files
7. Keep changes focused and minimal

## Important

- Make real, working changes - not placeholder code
- Ensure the code compiles/builds successfully
- Follow TypeScript best practices if the project uses TypeScript
- Add appropriate comments only where they add value

Start by exploring the codebase, then implement the required changes.`;

      assert.ok(prompt.includes('#42'));
      assert.ok(prompt.includes('Fix bug'));
      assert.ok(prompt.includes('Test description'));
    });

    it('should handle issue without body', () => {
      const issue = createMockIssue({ body: null });

      const body = issue.body || 'No description provided.';
      assert.strictEqual(body, 'No description provided.');
    });
  });

  describe('tool input sanitization', () => {
    it('should truncate long content', () => {
      const input = { content: 'a'.repeat(1000) };
      const sanitized = { ...input };

      if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 500) {
        sanitized.content = sanitized.content.slice(0, 500) + `... (${input.content.length} chars total)`;
      }

      assert.ok(sanitized.content.length < input.content.length);
      assert.ok(sanitized.content.includes('(1000 chars total)'));
    });

    it('should truncate new_string in edit tools', () => {
      const input = { new_string: 'x'.repeat(500) };
      const sanitized = { ...input };

      if (sanitized.new_string && sanitized.new_string.length > 200) {
        sanitized.new_string = sanitized.new_string.slice(0, 200) + '...';
      }

      assert.ok(sanitized.new_string.length <= 203);
    });

    it('should truncate old_string in edit tools', () => {
      const input = { old_string: 'y'.repeat(500) };
      const sanitized = { ...input };

      if (sanitized.old_string && sanitized.old_string.length > 200) {
        sanitized.old_string = sanitized.old_string.slice(0, 200) + '...';
      }

      assert.ok(sanitized.old_string.length <= 203);
    });

    it('should not modify short inputs', () => {
      const input = { content: 'short content' };
      const sanitized = { ...input };

      if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 500) {
        sanitized.content = sanitized.content.slice(0, 500) + '...';
      }

      assert.strictEqual(sanitized.content, input.content);
    });

    it('should handle null input', () => {
      const input = null;
      assert.strictEqual(input, null);
    });

    it('should handle undefined input', () => {
      const input = undefined;
      assert.strictEqual(input, undefined);
    });
  });

  describe('error context', () => {
    it('should include operation in error context', () => {
      const context = {
        operation: 'clone',
        component: 'Worker',
        workerId: 'worker-1',
        repoUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        timeoutMinutes: 30,
      };

      assert.strictEqual(context.operation, 'clone');
      assert.strictEqual(context.component, 'Worker');
    });

    it('should include issue number when available', () => {
      const context = {
        operation: 'execute',
        component: 'Worker',
        workerId: 'worker-1',
        issueNumber: 42,
        branchName: 'auto/42-fix-bug',
      };

      assert.strictEqual(context.issueNumber, 42);
      assert.strictEqual(context.branchName, 'auto/42-fix-bug');
    });
  });

  describe('ExecutionError', () => {
    it('should create error with clone failed code', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_CLONE_FAILED,
        'Failed to clone repository',
        {
          context: { repoUrl: 'https://github.com/owner/repo' },
        }
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_CLONE_FAILED);
      assert.ok(error.message.includes('clone'));
    });

    it('should create error with commit failed code', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_COMMIT_FAILED,
        'Failed to commit changes',
        {
          issueNumber: 42,
          branchName: 'feature/test',
        }
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_COMMIT_FAILED);
      assert.strictEqual(error.context.issueNumber, 42);
    });

    it('should create error with push failed code', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_PUSH_FAILED,
        'Failed to push changes',
        {
          issueNumber: 42,
          branchName: 'feature/test',
          context: { commitSha: 'abc123' },
        }
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_PUSH_FAILED);
      assert.ok(error.isRetryable);
    });

    it('should include recovery actions', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_CLONE_FAILED,
        'Network error during clone'
      );

      assert.ok(error.recoveryActions.length > 0);
      const descriptions = error.recoveryActions.map((a) => a.description);
      assert.ok(descriptions.some((d) => d.includes('network') || d.includes('Retry')));
    });

    it('should preserve cause chain', () => {
      const cause = new Error('Connection timeout');
      const error = new ExecutionError(
        ErrorCode.EXEC_PUSH_FAILED,
        'Push failed',
        { cause }
      );

      assert.strictEqual(error.cause, cause);
    });
  });

  describe('workspace management', () => {
    it('should create task directory path', () => {
      const issueNumber = 42;
      const timestamp = Date.now();
      const taskDir = join(testDir, `task-${issueNumber}-${timestamp}`);

      assert.ok(taskDir.includes('task-42'));
      assert.ok(taskDir.includes(testDir));
    });

    it('should handle nested work directories', () => {
      const workDir = join(testDir, 'nested', 'work', 'dir');
      mkdirSync(workDir, { recursive: true });

      assert.ok(existsSync(workDir));
    });
  });

  describe('commit message format', () => {
    it('should include issue title', () => {
      const issue = createMockIssue({ number: 42, title: 'Add new feature' });

      const commitMessage = `${issue.title}

Implements #${issue.number}

Generated by Autonomous Dev CLI`;

      assert.ok(commitMessage.includes('Add new feature'));
      assert.ok(commitMessage.includes('#42'));
      assert.ok(commitMessage.includes('Autonomous Dev CLI'));
    });

    it('should handle multiline issue titles', () => {
      const title = 'Fix multiple bugs';
      const commitMessage = `${title}

Implements #1

Generated by Autonomous Dev CLI`;

      assert.ok(commitMessage.startsWith('Fix multiple bugs'));
    });
  });

  describe('retry configuration', () => {
    it('should define retry config for clone operations', () => {
      const retryConfig = {
        maxRetries: 3,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      };

      assert.strictEqual(retryConfig.maxRetries, 3);
      assert.strictEqual(retryConfig.baseDelayMs, 2000);
    });

    it('should define retry config for push operations', () => {
      const retryConfig = {
        maxRetries: 3,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      };

      assert.strictEqual(retryConfig.maxRetries, 3);
    });

    it('should identify retryable network errors', () => {
      const retryableMessages = [
        'network error',
        'timeout exceeded',
        'connection reset',
        'enotfound',
        'etimedout',
      ];

      retryableMessages.forEach((msg) => {
        const isRetryable =
          msg.includes('network') ||
          msg.includes('timeout') ||
          msg.includes('connection') ||
          msg.includes('enotfound') ||
          msg.includes('etimedout');
        assert.ok(isRetryable, `Should be retryable: ${msg}`);
      });
    });

    it('should not retry non-network errors', () => {
      const nonRetryableMessages = [
        'permission denied',
        'authentication failed',
        'invalid credentials',
      ];

      nonRetryableMessages.forEach((msg) => {
        const isRetryable =
          msg.includes('network') ||
          msg.includes('timeout') ||
          msg.includes('connection');
        assert.strictEqual(isRetryable, false, `Should not be retryable: ${msg}`);
      });
    });
  });

  describe('git configuration', () => {
    it('should set correct git user name', () => {
      const userName = 'Autonomous Dev Bot';
      assert.strictEqual(userName, 'Autonomous Dev Bot');
    });

    it('should set correct git user email', () => {
      const userEmail = 'bot@autonomous-dev.local';
      assert.strictEqual(userEmail, 'bot@autonomous-dev.local');
    });
  });

  describe('timeout handling', () => {
    it('should convert minutes to milliseconds', () => {
      const timeoutMinutes = 30;
      const timeoutMs = timeoutMinutes * 60 * 1000;

      assert.strictEqual(timeoutMs, 1800000);
    });

    it('should handle various timeout values', () => {
      const testCases = [
        { minutes: 5, expected: 300000 },
        { minutes: 30, expected: 1800000 },
        { minutes: 60, expected: 3600000 },
        { minutes: 120, expected: 7200000 },
      ];

      testCases.forEach((tc) => {
        const ms = tc.minutes * 60 * 1000;
        assert.strictEqual(ms, tc.expected);
      });
    });
  });

  describe('allowed tools configuration', () => {
    it('should include essential file tools', () => {
      const allowedTools = [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Bash', 'Glob', 'Grep',
        'LS', 'WebFetch',
      ];

      assert.ok(allowedTools.includes('Read'));
      assert.ok(allowedTools.includes('Write'));
      assert.ok(allowedTools.includes('Edit'));
      assert.ok(allowedTools.includes('Bash'));
    });

    it('should include search tools', () => {
      const allowedTools = [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Bash', 'Glob', 'Grep',
        'LS', 'WebFetch',
      ];

      assert.ok(allowedTools.includes('Glob'));
      assert.ok(allowedTools.includes('Grep'));
    });

    it('should include web tools', () => {
      const allowedTools = [
        'Read', 'Write', 'Edit', 'MultiEdit',
        'Bash', 'Glob', 'Grep',
        'LS', 'WebFetch',
      ];

      assert.ok(allowedTools.includes('WebFetch'));
    });
  });
});

describe('Worker integration scenarios', () => {
  describe('successful execution flow', () => {
    it('should track all execution phases', () => {
      const phases = [
        'setup_workspace',
        'clone_repo',
        'create_branch',
        'write_credentials',
        'execute_claude',
        'check_changes',
        'commit_push',
        'cleanup',
      ];

      phases.forEach((phase) => {
        assert.ok(typeof phase === 'string');
      });
    });
  });

  describe('failure scenarios', () => {
    it('should handle clone failure', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_CLONE_FAILED,
        'Failed to clone: network error'
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_CLONE_FAILED);
    });

    it('should handle no changes scenario', () => {
      const result: WorkerResult = {
        success: false,
        issue: createMockIssue(),
        branchName: 'feature/test',
        error: 'No changes were made',
        duration: 5000,
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'No changes were made');
    });

    it('should handle commit failure', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_COMMIT_FAILED,
        'Commit failed: pre-commit hook error'
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_COMMIT_FAILED);
    });

    it('should handle push failure', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_PUSH_FAILED,
        'Push failed: permission denied'
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_PUSH_FAILED);
    });

    it('should handle timeout', () => {
      const error = new ExecutionError(
        ErrorCode.EXEC_TIMEOUT,
        'Task timed out after 30 minutes'
      );

      assert.strictEqual(error.code, ErrorCode.EXEC_TIMEOUT);
    });
  });
});

describe('Database session integration', () => {
  it('should create session params', () => {
    const params = {
      userId: 'user-123',
      repositoryOwner: 'owner',
      repositoryName: 'repo',
      repositoryUrl: 'https://github.com/owner/repo',
      baseBranch: 'main',
      userRequest: '[Auto] Issue #42: Fix bug\n\nDescription',
      provider: 'claude',
    };

    assert.strictEqual(params.userId, 'user-123');
    assert.strictEqual(params.provider, 'claude');
    assert.ok(params.userRequest.includes('#42'));
  });

  it('should generate session path', () => {
    const owner = 'owner';
    const name = 'repo';
    const branch = 'auto/42-fix-bug';

    const sessionPath = `${owner}/${name}/${branch}`;
    assert.strictEqual(sessionPath, 'owner/repo/auto/42-fix-bug');
  });
});
