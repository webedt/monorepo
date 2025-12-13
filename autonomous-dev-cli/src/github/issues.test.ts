import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createIssueManager,
  type IssueManager,
  type Issue,
  type CreateIssueOptions,
  type DegradedResult,
} from './issues.js';
import { GitHubClient, type ServiceHealth } from './client.js';

// Create mock issue data
function createMockIssueData(number: number, title: string, overrides: Partial<any> = {}): any {
  return {
    number,
    title,
    body: `Description for issue ${number}`,
    state: 'open',
    labels: [],
    html_url: `https://github.com/owner/repo/issues/${number}`,
    created_at: new Date().toISOString(),
    assignee: null,
    pull_request: undefined,
    ...overrides,
  };
}

// Create mock Issue type
function createMockIssue(number: number, title: string, overrides: Partial<Issue> = {}): Issue {
  return {
    number,
    title,
    body: `Description for issue ${number}`,
    state: 'open',
    labels: [],
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    createdAt: new Date().toISOString(),
    assignee: null,
    ...overrides,
  };
}

// Create mock GitHub client
function createMockGitHubClient(overrides: Partial<{
  issues: any;
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
      issues: {
        listForRepo: mock.fn(async () => ({ data: [] })),
        get: mock.fn(async () => ({ data: createMockIssueData(1, 'Test') })),
        create: mock.fn(async () => ({ data: createMockIssueData(1, 'New Issue') })),
        addLabels: mock.fn(async () => ({})),
        removeLabel: mock.fn(async () => ({})),
        update: mock.fn(async () => ({})),
        createComment: mock.fn(async () => ({})),
        ...overrides.issues,
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

describe('IssueManager', () => {
  describe('createIssueManager factory', () => {
    it('should create an IssueManager instance', () => {
      const client = createMockGitHubClient();
      const manager = createIssueManager(client);

      assert.ok(manager);
      assert.ok(typeof manager.listOpenIssues === 'function');
      assert.ok(typeof manager.getIssue === 'function');
      assert.ok(typeof manager.createIssue === 'function');
    });
  });

  describe('listOpenIssues', () => {
    it('should return empty array when no issues', async () => {
      const client = createMockGitHubClient();
      const manager = createIssueManager(client);

      const issues = await manager.listOpenIssues();

      assert.deepStrictEqual(issues, []);
    });

    it('should return issues from repository', async () => {
      const mockIssues = [
        createMockIssueData(1, 'First Issue'),
        createMockIssueData(2, 'Second Issue'),
      ];

      const client = createMockGitHubClient({
        issues: {
          listForRepo: mock.fn(async () => ({ data: mockIssues })),
        },
      });
      const manager = createIssueManager(client);

      const issues = await manager.listOpenIssues();

      assert.strictEqual(issues.length, 2);
      assert.strictEqual(issues[0].number, 1);
      assert.strictEqual(issues[1].number, 2);
    });

    it('should filter by label when provided', async () => {
      const listForRepo = mock.fn(async () => ({
        data: [createMockIssueData(1, 'Labeled Issue')],
      }));

      const client = createMockGitHubClient({
        issues: { listForRepo },
      });
      const manager = createIssueManager(client);

      await manager.listOpenIssues('bug');

      assert.strictEqual(listForRepo.mock.calls.length, 1);
      const callArgs = listForRepo.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.labels, 'bug');
    });

    it('should filter out pull requests', async () => {
      const mockData = [
        createMockIssueData(1, 'Regular Issue'),
        createMockIssueData(2, 'Pull Request', { pull_request: { url: 'https://...' } }),
      ];

      const client = createMockGitHubClient({
        issues: {
          listForRepo: mock.fn(async () => ({ data: mockData })),
        },
      });
      const manager = createIssueManager(client);

      const issues = await manager.listOpenIssues();

      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].number, 1);
    });

    it('should map labels correctly', async () => {
      const mockData = [
        createMockIssueData(1, 'Labeled Issue', {
          labels: [{ name: 'bug' }, { name: 'urgent' }],
        }),
      ];

      const client = createMockGitHubClient({
        issues: {
          listForRepo: mock.fn(async () => ({ data: mockData })),
        },
      });
      const manager = createIssueManager(client);

      const issues = await manager.listOpenIssues();

      assert.deepStrictEqual(issues[0].labels, ['bug', 'urgent']);
    });

    it('should handle string labels', async () => {
      const mockData = [
        createMockIssueData(1, 'Issue', {
          labels: ['string-label'],
        }),
      ];

      const client = createMockGitHubClient({
        issues: {
          listForRepo: mock.fn(async () => ({ data: mockData })),
        },
      });
      const manager = createIssueManager(client);

      const issues = await manager.listOpenIssues();

      assert.deepStrictEqual(issues[0].labels, ['string-label']);
    });
  });

  describe('listOpenIssuesWithFallback', () => {
    it('should return issues when service is healthy', async () => {
      const mockIssues = [createMockIssueData(1, 'Issue')];

      const client = createMockGitHubClient({
        issues: {
          listForRepo: mock.fn(async () => ({ data: mockIssues })),
        },
        executeWithFallback: mock.fn(async (fn: any) => ({
          value: await fn(),
          degraded: false,
        })),
      });
      const manager = createIssueManager(client);

      const result = await manager.listOpenIssuesWithFallback();

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.length, 1);
    });

    it('should return fallback when service is degraded', async () => {
      const fallbackIssues = [createMockIssue(99, 'Fallback Issue')];

      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async (_fn: any, fallback: any) => ({
          value: fallback,
          degraded: true,
        })),
      });
      const manager = createIssueManager(client);

      const result = await manager.listOpenIssuesWithFallback('label', fallbackIssues);

      assert.strictEqual(result.degraded, true);
      assert.deepStrictEqual(result.value, fallbackIssues);
    });
  });

  describe('getIssue', () => {
    it('should return issue when found', async () => {
      const mockIssue = createMockIssueData(42, 'Found Issue');

      const client = createMockGitHubClient({
        issues: {
          get: mock.fn(async () => ({ data: mockIssue })),
        },
      });
      const manager = createIssueManager(client);

      const issue = await manager.getIssue(42);

      assert.ok(issue);
      assert.strictEqual(issue.number, 42);
      assert.strictEqual(issue.title, 'Found Issue');
    });

    it('should return null when issue not found', async () => {
      const client = createMockGitHubClient({
        issues: {
          get: mock.fn(async () => {
            const error: any = new Error('Not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createIssueManager(client);

      const issue = await manager.getIssue(999);

      assert.strictEqual(issue, null);
    });

    it('should throw on other errors', async () => {
      const client = createMockGitHubClient({
        issues: {
          get: mock.fn(async () => {
            const error: any = new Error('Server error');
            error.status = 500;
            throw error;
          }),
        },
      });
      const manager = createIssueManager(client);

      await assert.rejects(
        () => manager.getIssue(1),
        (error: Error) => error.message.includes('Server error')
      );
    });
  });

  describe('createIssue', () => {
    it('should create issue with required fields', async () => {
      const create = mock.fn(async () => ({
        data: createMockIssueData(123, 'New Issue'),
      }));

      const client = createMockGitHubClient({
        issues: { create },
      });
      const manager = createIssueManager(client);

      const issue = await manager.createIssue({
        title: 'New Issue',
        body: 'Issue description',
      });

      assert.strictEqual(issue.number, 123);
      assert.strictEqual(issue.title, 'New Issue');
      assert.strictEqual(create.mock.calls.length, 1);
    });

    it('should create issue with labels', async () => {
      const create = mock.fn(async () => ({
        data: createMockIssueData(124, 'Labeled Issue'),
      }));

      const client = createMockGitHubClient({
        issues: { create },
      });
      const manager = createIssueManager(client);

      await manager.createIssue({
        title: 'Labeled Issue',
        body: 'Description',
        labels: ['bug', 'help wanted'],
      });

      const callArgs = create.mock.calls[0].arguments[0];
      assert.deepStrictEqual(callArgs.labels, ['bug', 'help wanted']);
    });
  });

  describe('addLabels', () => {
    it('should add labels to issue', async () => {
      const addLabels = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { addLabels },
      });
      const manager = createIssueManager(client);

      await manager.addLabels(1, ['new-label']);

      assert.strictEqual(addLabels.mock.calls.length, 1);
      const callArgs = addLabels.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.issue_number, 1);
      assert.deepStrictEqual(callArgs.labels, ['new-label']);
    });

    it('should add multiple labels', async () => {
      const addLabels = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { addLabels },
      });
      const manager = createIssueManager(client);

      await manager.addLabels(1, ['label1', 'label2', 'label3']);

      const callArgs = addLabels.mock.calls[0].arguments[0];
      assert.deepStrictEqual(callArgs.labels, ['label1', 'label2', 'label3']);
    });
  });

  describe('addLabelsWithFallback', () => {
    it('should return non-degraded result on success', async () => {
      const client = createMockGitHubClient({
        issues: {
          addLabels: mock.fn(async () => ({})),
        },
        executeWithFallback: mock.fn(async (fn: any) => {
          await fn();
          return { value: undefined, degraded: false };
        }),
      });
      const manager = createIssueManager(client);

      const result = await manager.addLabelsWithFallback(1, ['label']);

      assert.strictEqual(result.degraded, false);
    });

    it('should return degraded result on failure', async () => {
      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async () => ({
          value: undefined,
          degraded: true,
        })),
      });
      const manager = createIssueManager(client);

      const result = await manager.addLabelsWithFallback(1, ['label']);

      assert.strictEqual(result.degraded, true);
    });
  });

  describe('removeLabel', () => {
    it('should remove label from issue', async () => {
      const removeLabel = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { removeLabel },
      });
      const manager = createIssueManager(client);

      await manager.removeLabel(1, 'old-label');

      assert.strictEqual(removeLabel.mock.calls.length, 1);
      const callArgs = removeLabel.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.issue_number, 1);
      assert.strictEqual(callArgs.name, 'old-label');
    });

    it('should ignore 404 errors silently', async () => {
      const client = createMockGitHubClient({
        issues: {
          removeLabel: mock.fn(async () => {
            const error: any = new Error('Label not found');
            error.status = 404;
            throw error;
          }),
        },
      });
      const manager = createIssueManager(client);

      // Should not throw
      await manager.removeLabel(1, 'nonexistent-label');
    });

    it('should throw on other errors', async () => {
      const client = createMockGitHubClient({
        issues: {
          removeLabel: mock.fn(async () => {
            const error: any = new Error('Server error');
            error.status = 500;
            throw error;
          }),
        },
      });
      const manager = createIssueManager(client);

      await assert.rejects(
        () => manager.removeLabel(1, 'label'),
        (error: Error) => error.message.includes('Server error')
      );
    });
  });

  describe('closeIssue', () => {
    it('should close issue without comment', async () => {
      const update = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { update },
      });
      const manager = createIssueManager(client);

      await manager.closeIssue(1);

      assert.strictEqual(update.mock.calls.length, 1);
      const callArgs = update.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.state, 'closed');
    });

    it('should close issue with comment', async () => {
      const update = mock.fn(async () => ({}));
      const createComment = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { update, createComment },
      });
      const manager = createIssueManager(client);

      await manager.closeIssue(1, 'Closing comment');

      assert.strictEqual(createComment.mock.calls.length, 1);
      assert.strictEqual(update.mock.calls.length, 1);

      const commentArgs = createComment.mock.calls[0].arguments[0];
      assert.strictEqual(commentArgs.body, 'Closing comment');
    });
  });

  describe('addComment', () => {
    it('should add comment to issue', async () => {
      const createComment = mock.fn(async () => ({}));

      const client = createMockGitHubClient({
        issues: { createComment },
      });
      const manager = createIssueManager(client);

      await manager.addComment(1, 'Test comment');

      assert.strictEqual(createComment.mock.calls.length, 1);
      const callArgs = createComment.mock.calls[0].arguments[0];
      assert.strictEqual(callArgs.issue_number, 1);
      assert.strictEqual(callArgs.body, 'Test comment');
    });
  });

  describe('addCommentWithFallback', () => {
    it('should return non-degraded result on success', async () => {
      const client = createMockGitHubClient({
        issues: {
          createComment: mock.fn(async () => ({})),
        },
        executeWithFallback: mock.fn(async (fn: any) => {
          await fn();
          return { value: undefined, degraded: false };
        }),
      });
      const manager = createIssueManager(client);

      const result = await manager.addCommentWithFallback(1, 'Comment');

      assert.strictEqual(result.degraded, false);
    });

    it('should return degraded result on failure', async () => {
      const client = createMockGitHubClient({
        executeWithFallback: mock.fn(async () => ({
          value: undefined,
          degraded: true,
        })),
      });
      const manager = createIssueManager(client);

      const result = await manager.addCommentWithFallback(1, 'Comment');

      assert.strictEqual(result.degraded, true);
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
      const manager = createIssueManager(client);

      const result = manager.getServiceHealth();

      assert.strictEqual(result.state, 'healthy');
      assert.strictEqual(result.isOperational, true);
    });
  });

  describe('isAvailable', () => {
    it('should return true when service is available', () => {
      const client = createMockGitHubClient({
        isAvailable: mock.fn(() => true),
      });
      const manager = createIssueManager(client);

      assert.strictEqual(manager.isAvailable(), true);
    });

    it('should return false when service is unavailable', () => {
      const client = createMockGitHubClient({
        isAvailable: mock.fn(() => false),
      });
      const manager = createIssueManager(client);

      assert.strictEqual(manager.isAvailable(), false);
    });
  });
});

describe('Issue interface', () => {
  it('should have required fields', () => {
    const issue: Issue = {
      number: 1,
      title: 'Test',
      body: 'Description',
      state: 'open',
      labels: [],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: null,
    };

    assert.strictEqual(issue.number, 1);
    assert.strictEqual(issue.title, 'Test');
    assert.strictEqual(issue.state, 'open');
  });

  it('should allow closed state', () => {
    const issue: Issue = {
      number: 1,
      title: 'Closed Issue',
      body: null,
      state: 'closed',
      labels: [],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: null,
    };

    assert.strictEqual(issue.state, 'closed');
  });

  it('should allow null body', () => {
    const issue: Issue = {
      number: 1,
      title: 'No Body',
      body: null,
      state: 'open',
      labels: [],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: null,
    };

    assert.strictEqual(issue.body, null);
  });

  it('should allow assignee', () => {
    const issue: Issue = {
      number: 1,
      title: 'Assigned',
      body: 'Description',
      state: 'open',
      labels: ['bug'],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: 'developer',
    };

    assert.strictEqual(issue.assignee, 'developer');
  });
});

describe('CreateIssueOptions interface', () => {
  it('should have required fields', () => {
    const options: CreateIssueOptions = {
      title: 'New Issue',
      body: 'Description',
    };

    assert.strictEqual(options.title, 'New Issue');
    assert.strictEqual(options.body, 'Description');
  });

  it('should allow optional labels', () => {
    const options: CreateIssueOptions = {
      title: 'Issue with Labels',
      body: 'Description',
      labels: ['bug', 'urgent'],
    };

    assert.deepStrictEqual(options.labels, ['bug', 'urgent']);
  });
});

describe('DegradedResult interface', () => {
  it('should include value and degraded flag', () => {
    const result: DegradedResult<Issue[]> = {
      value: [],
      degraded: false,
    };

    assert.deepStrictEqual(result.value, []);
    assert.strictEqual(result.degraded, false);
  });

  it('should work with any value type', () => {
    const voidResult: DegradedResult<void> = {
      value: undefined,
      degraded: true,
    };

    assert.strictEqual(voidResult.value, undefined);
    assert.strictEqual(voidResult.degraded, true);
  });
});
