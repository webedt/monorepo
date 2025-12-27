/**
 * Tests for the GitHub Issues Manager.
 * Covers issue CRUD, labeling, commenting, and graceful degradation.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createIssueManager,
  type Issue,
  type Comment,
  type IssueManager,
  type CreateIssueOptions,
  type DegradedResult,
} from '../../src/github/issues.js';
import { type GitHubClient, type ServiceHealth } from '../../src/github/client.js';

// Mock Octokit responses
function createMockOctokit() {
  return {
    issues: {
      listForRepo: mock.fn(),
      get: mock.fn(),
      create: mock.fn(),
      update: mock.fn(),
      addLabels: mock.fn(),
      removeLabel: mock.fn(),
      createComment: mock.fn(),
      listComments: mock.fn(),
      getComment: mock.fn(),
      updateComment: mock.fn(),
      deleteComment: mock.fn(),
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

// Helper to create mock API issue response
function createMockApiIssue(overrides: Record<string, any> = {}) {
  return {
    number: 1,
    title: 'Test Issue',
    body: 'Test description',
    state: 'open',
    labels: [],
    html_url: 'https://github.com/owner/repo/issues/1',
    created_at: new Date().toISOString(),
    assignee: null,
    pull_request: undefined,
    ...overrides,
  };
}

// Helper to create mock API comment response
function createMockApiComment(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    body: 'Test comment',
    html_url: 'https://github.com/owner/repo/issues/1#issuecomment-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    user: { login: 'test-user' },
    ...overrides,
  };
}

describe('IssueManager', () => {
  let issueManager: IssueManager;
  let mockClient: GitHubClient;
  let mockOctokit: ReturnType<typeof createMockOctokit>;

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    mockClient = createMockClient({ client: mockOctokit });
    issueManager = createIssueManager(mockClient);
  });

  describe('listOpenIssues', () => {
    it('should return list of open issues', async () => {
      const mockIssues = [
        createMockApiIssue({ number: 1, title: 'Issue 1' }),
        createMockApiIssue({ number: 2, title: 'Issue 2' }),
      ];

      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: mockIssues,
      }));

      const issues = await issueManager.listOpenIssues();

      assert.strictEqual(issues.length, 2);
      assert.strictEqual(issues[0].number, 1);
      assert.strictEqual(issues[0].title, 'Issue 1');
    });

    it('should filter out pull requests', async () => {
      const mockIssues = [
        createMockApiIssue({ number: 1, title: 'Real Issue' }),
        createMockApiIssue({ number: 2, title: 'PR', pull_request: { url: 'https://...' } }),
      ];

      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: mockIssues,
      }));

      const issues = await issueManager.listOpenIssues();

      assert.strictEqual(issues.length, 1);
      assert.strictEqual(issues[0].title, 'Real Issue');
    });

    it('should filter by label when provided', async () => {
      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: [],
      }));

      await issueManager.listOpenIssues('bug');

      const call = mockOctokit.issues.listForRepo.mock.calls[0];
      assert.strictEqual(call.arguments[0].labels, 'bug');
    });

    it('should map labels correctly', async () => {
      const mockIssues = [
        createMockApiIssue({
          labels: [
            { name: 'bug' },
            { name: 'priority-high' },
          ],
        }),
      ];

      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: mockIssues,
      }));

      const issues = await issueManager.listOpenIssues();

      assert.deepStrictEqual(issues[0].labels, ['bug', 'priority-high']);
    });

    it('should handle string labels', async () => {
      const mockIssues = [
        createMockApiIssue({
          labels: ['bug', 'enhancement'],
        }),
      ];

      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: mockIssues,
      }));

      const issues = await issueManager.listOpenIssues();

      assert.deepStrictEqual(issues[0].labels, ['bug', 'enhancement']);
    });
  });

  describe('listOpenIssuesWithFallback', () => {
    it('should return issues with degraded false on success', async () => {
      const mockIssues = [createMockApiIssue()];

      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => ({
        data: mockIssues,
      }));

      const result = await issueManager.listOpenIssuesWithFallback();

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.length, 1);
    });

    it('should return fallback with degraded true on failure', async () => {
      mockOctokit.issues.listForRepo.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const fallback: Issue[] = [
        {
          number: 99,
          title: 'Fallback Issue',
          body: 'From cache',
          state: 'open',
          labels: [],
          htmlUrl: 'https://github.com/owner/repo/issues/99',
          createdAt: new Date().toISOString(),
          assignee: null,
        },
      ];

      const result = await issueManager.listOpenIssuesWithFallback('test', fallback);

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value.length, 1);
      assert.strictEqual(result.value[0].number, 99);
    });
  });

  describe('getIssue', () => {
    it('should return issue details', async () => {
      mockOctokit.issues.get.mock.mockImplementation(async () => ({
        data: createMockApiIssue({ number: 42, title: 'Specific Issue' }),
      }));

      const issue = await issueManager.getIssue(42);

      assert.ok(issue);
      assert.strictEqual(issue.number, 42);
      assert.strictEqual(issue.title, 'Specific Issue');
    });

    it('should return null for non-existent issue', async () => {
      const notFoundError: any = new Error('Not Found');
      notFoundError.status = 404;
      mockOctokit.issues.get.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      const issue = await issueManager.getIssue(999);

      assert.strictEqual(issue, null);
    });

    it('should throw for other errors', async () => {
      const serverError: any = new Error('Server Error');
      serverError.status = 500;
      mockOctokit.issues.get.mock.mockImplementation(async () => {
        throw serverError;
      });

      await assert.rejects(
        async () => issueManager.getIssue(1),
        /Server Error/
      );
    });

    it('should map assignee correctly', async () => {
      mockOctokit.issues.get.mock.mockImplementation(async () => ({
        data: createMockApiIssue({
          assignee: { login: 'john-doe' },
        }),
      }));

      const issue = await issueManager.getIssue(1);

      assert.ok(issue);
      assert.strictEqual(issue.assignee, 'john-doe');
    });

    it('should handle null assignee', async () => {
      mockOctokit.issues.get.mock.mockImplementation(async () => ({
        data: createMockApiIssue({ assignee: null }),
      }));

      const issue = await issueManager.getIssue(1);

      assert.ok(issue);
      assert.strictEqual(issue.assignee, null);
    });
  });

  describe('createIssue', () => {
    it('should create issue with title and body', async () => {
      mockOctokit.issues.create.mock.mockImplementation(async () => ({
        data: createMockApiIssue({
          number: 123,
          title: 'New Issue',
          body: 'Issue body',
        }),
      }));

      const options: CreateIssueOptions = {
        title: 'New Issue',
        body: 'Issue body',
      };

      const issue = await issueManager.createIssue(options);

      assert.strictEqual(issue.number, 123);
      assert.strictEqual(issue.title, 'New Issue');
    });

    it('should create issue with labels', async () => {
      mockOctokit.issues.create.mock.mockImplementation(async () => ({
        data: createMockApiIssue({
          labels: [{ name: 'bug' }, { name: 'urgent' }],
        }),
      }));

      const options: CreateIssueOptions = {
        title: 'Bug Report',
        body: 'Description',
        labels: ['bug', 'urgent'],
      };

      await issueManager.createIssue(options);

      const call = mockOctokit.issues.create.mock.calls[0];
      assert.deepStrictEqual(call.arguments[0].labels, ['bug', 'urgent']);
    });

    it('should throw on creation failure', async () => {
      const error: any = new Error('Rate limited');
      error.status = 403;
      mockOctokit.issues.create.mock.mockImplementation(async () => {
        throw error;
      });

      await assert.rejects(
        async () => issueManager.createIssue({ title: 'Test', body: 'Test' }),
        /Rate limited/
      );
    });
  });

  describe('addLabels', () => {
    it('should add labels to issue', async () => {
      mockOctokit.issues.addLabels.mock.mockImplementation(async () => ({}));

      await issueManager.addLabels(1, ['bug', 'priority-high']);

      assert.strictEqual(mockOctokit.issues.addLabels.mock.callCount(), 1);
      const call = mockOctokit.issues.addLabels.mock.calls[0];
      assert.strictEqual(call.arguments[0].issue_number, 1);
      assert.deepStrictEqual(call.arguments[0].labels, ['bug', 'priority-high']);
    });

    it('should throw on failure', async () => {
      mockOctokit.issues.addLabels.mock.mockImplementation(async () => {
        throw new Error('Not authorized');
      });

      await assert.rejects(
        async () => issueManager.addLabels(1, ['test']),
        /Not authorized/
      );
    });
  });

  describe('addLabelsWithFallback', () => {
    it('should return degraded false on success', async () => {
      mockOctokit.issues.addLabels.mock.mockImplementation(async () => ({}));

      const result = await issueManager.addLabelsWithFallback(1, ['test']);

      assert.strictEqual(result.degraded, false);
    });

    it('should return degraded true on failure', async () => {
      mockOctokit.issues.addLabels.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const result = await issueManager.addLabelsWithFallback(1, ['test']);

      assert.strictEqual(result.degraded, true);
    });
  });

  describe('removeLabel', () => {
    it('should remove label from issue', async () => {
      mockOctokit.issues.removeLabel.mock.mockImplementation(async () => ({}));

      await issueManager.removeLabel(1, 'bug');

      assert.strictEqual(mockOctokit.issues.removeLabel.mock.callCount(), 1);
      const call = mockOctokit.issues.removeLabel.mock.calls[0];
      assert.strictEqual(call.arguments[0].issue_number, 1);
      assert.strictEqual(call.arguments[0].name, 'bug');
    });

    it('should not throw if label does not exist (404)', async () => {
      const notFoundError: any = new Error('Label not found');
      notFoundError.status = 404;
      mockOctokit.issues.removeLabel.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      // Should not throw
      await issueManager.removeLabel(1, 'nonexistent');
    });

    it('should throw for other errors', async () => {
      const serverError: any = new Error('Server error');
      serverError.status = 500;
      mockOctokit.issues.removeLabel.mock.mockImplementation(async () => {
        throw serverError;
      });

      await assert.rejects(
        async () => issueManager.removeLabel(1, 'test'),
        /Server error/
      );
    });
  });

  describe('closeIssue', () => {
    it('should close issue without comment', async () => {
      mockOctokit.issues.update.mock.mockImplementation(async () => ({}));

      await issueManager.closeIssue(1);

      assert.strictEqual(mockOctokit.issues.update.mock.callCount(), 1);
      assert.strictEqual(mockOctokit.issues.createComment.mock.callCount(), 0);
      const call = mockOctokit.issues.update.mock.calls[0];
      assert.strictEqual(call.arguments[0].state, 'closed');
    });

    it('should close issue with comment', async () => {
      mockOctokit.issues.createComment.mock.mockImplementation(async () => ({}));
      mockOctokit.issues.update.mock.mockImplementation(async () => ({}));

      await issueManager.closeIssue(1, 'Fixed in PR #42');

      assert.strictEqual(mockOctokit.issues.createComment.mock.callCount(), 1);
      assert.strictEqual(mockOctokit.issues.update.mock.callCount(), 1);
      const commentCall = mockOctokit.issues.createComment.mock.calls[0];
      assert.strictEqual(commentCall.arguments[0].body, 'Fixed in PR #42');
    });
  });

  describe('addComment', () => {
    it('should add comment to issue and return Comment', async () => {
      mockOctokit.issues.createComment.mock.mockImplementation(async () => ({
        data: createMockApiComment({ id: 123, body: 'This is a comment' }),
      }));

      const comment = await issueManager.addComment(1, 'This is a comment');

      assert.strictEqual(mockOctokit.issues.createComment.mock.callCount(), 1);
      const call = mockOctokit.issues.createComment.mock.calls[0];
      assert.strictEqual(call.arguments[0].issue_number, 1);
      assert.strictEqual(call.arguments[0].body, 'This is a comment');
      assert.strictEqual(comment.id, 123);
      assert.strictEqual(comment.body, 'This is a comment');
    });

    it('should throw on failure', async () => {
      mockOctokit.issues.createComment.mock.mockImplementation(async () => {
        throw new Error('Comment failed');
      });

      await assert.rejects(
        async () => issueManager.addComment(1, 'Test'),
        /Comment failed/
      );
    });
  });

  describe('addCommentWithFallback', () => {
    it('should return comment with degraded false on success', async () => {
      mockOctokit.issues.createComment.mock.mockImplementation(async () => ({
        data: createMockApiComment({ id: 456 }),
      }));

      const result = await issueManager.addCommentWithFallback(1, 'Test comment');

      assert.strictEqual(result.degraded, false);
      assert.ok(result.value);
      assert.strictEqual(result.value.id, 456);
    });

    it('should return null with degraded true on failure', async () => {
      mockOctokit.issues.createComment.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const result = await issueManager.addCommentWithFallback(1, 'Test');

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value, null);
    });
  });

  describe('listComments', () => {
    it('should return list of comments for an issue', async () => {
      const mockComments = [
        createMockApiComment({ id: 1, body: 'First comment' }),
        createMockApiComment({ id: 2, body: 'Second comment' }),
      ];

      mockOctokit.issues.listComments.mock.mockImplementation(async () => ({
        data: mockComments,
      }));

      const comments = await issueManager.listComments(1);

      assert.strictEqual(comments.length, 2);
      assert.strictEqual(comments[0].id, 1);
      assert.strictEqual(comments[0].body, 'First comment');
      assert.strictEqual(comments[1].id, 2);
    });

    it('should return empty array when no comments', async () => {
      mockOctokit.issues.listComments.mock.mockImplementation(async () => ({
        data: [],
      }));

      const comments = await issueManager.listComments(1);

      assert.deepStrictEqual(comments, []);
    });

    it('should map user correctly', async () => {
      mockOctokit.issues.listComments.mock.mockImplementation(async () => ({
        data: [createMockApiComment({ user: { login: 'jane-doe' } })],
      }));

      const comments = await issueManager.listComments(1);

      assert.strictEqual(comments[0].user, 'jane-doe');
    });

    it('should handle null user', async () => {
      mockOctokit.issues.listComments.mock.mockImplementation(async () => ({
        data: [createMockApiComment({ user: null })],
      }));

      const comments = await issueManager.listComments(1);

      assert.strictEqual(comments[0].user, null);
    });
  });

  describe('listCommentsWithFallback', () => {
    it('should return comments with degraded false on success', async () => {
      mockOctokit.issues.listComments.mock.mockImplementation(async () => ({
        data: [createMockApiComment()],
      }));

      const result = await issueManager.listCommentsWithFallback(1);

      assert.strictEqual(result.degraded, false);
      assert.strictEqual(result.value.length, 1);
    });

    it('should return fallback with degraded true on failure', async () => {
      mockOctokit.issues.listComments.mock.mockImplementation(async () => {
        throw new Error('API Error');
      });

      const fallback: Comment[] = [
        {
          id: 99,
          body: 'Cached comment',
          htmlUrl: 'https://github.com/owner/repo/issues/1#issuecomment-99',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          user: 'cached-user',
        },
      ];

      const result = await issueManager.listCommentsWithFallback(1, fallback);

      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.value.length, 1);
      assert.strictEqual(result.value[0].id, 99);
    });
  });

  describe('getComment', () => {
    it('should return comment details', async () => {
      mockOctokit.issues.getComment.mock.mockImplementation(async () => ({
        data: createMockApiComment({ id: 42, body: 'Specific comment' }),
      }));

      const comment = await issueManager.getComment(42);

      assert.ok(comment);
      assert.strictEqual(comment.id, 42);
      assert.strictEqual(comment.body, 'Specific comment');
    });

    it('should return null for non-existent comment', async () => {
      const notFoundError: any = new Error('Not Found');
      notFoundError.status = 404;
      mockOctokit.issues.getComment.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      const comment = await issueManager.getComment(999);

      assert.strictEqual(comment, null);
    });

    it('should throw for other errors', async () => {
      const serverError: any = new Error('Server Error');
      serverError.status = 500;
      mockOctokit.issues.getComment.mock.mockImplementation(async () => {
        throw serverError;
      });

      await assert.rejects(
        async () => issueManager.getComment(1),
        /Server Error/
      );
    });
  });

  describe('updateComment', () => {
    it('should update comment and return updated Comment', async () => {
      mockOctokit.issues.updateComment.mock.mockImplementation(async () => ({
        data: createMockApiComment({ id: 123, body: 'Updated body' }),
      }));

      const comment = await issueManager.updateComment(123, 'Updated body');

      assert.strictEqual(mockOctokit.issues.updateComment.mock.callCount(), 1);
      const call = mockOctokit.issues.updateComment.mock.calls[0];
      assert.strictEqual(call.arguments[0].comment_id, 123);
      assert.strictEqual(call.arguments[0].body, 'Updated body');
      assert.strictEqual(comment.body, 'Updated body');
    });

    it('should throw on failure', async () => {
      mockOctokit.issues.updateComment.mock.mockImplementation(async () => {
        throw new Error('Update failed');
      });

      await assert.rejects(
        async () => issueManager.updateComment(1, 'New body'),
        /Update failed/
      );
    });
  });

  describe('deleteComment', () => {
    it('should delete comment', async () => {
      mockOctokit.issues.deleteComment.mock.mockImplementation(async () => ({}));

      await issueManager.deleteComment(123);

      assert.strictEqual(mockOctokit.issues.deleteComment.mock.callCount(), 1);
      const call = mockOctokit.issues.deleteComment.mock.calls[0];
      assert.strictEqual(call.arguments[0].comment_id, 123);
    });

    it('should not throw if comment does not exist (404)', async () => {
      const notFoundError: any = new Error('Comment not found');
      notFoundError.status = 404;
      mockOctokit.issues.deleteComment.mock.mockImplementation(async () => {
        throw notFoundError;
      });

      // Should not throw
      await issueManager.deleteComment(999);
    });

    it('should throw for other errors', async () => {
      const serverError: any = new Error('Server error');
      serverError.status = 500;
      mockOctokit.issues.deleteComment.mock.mockImplementation(async () => {
        throw serverError;
      });

      await assert.rejects(
        async () => issueManager.deleteComment(1),
        /Server error/
      );
    });
  });

  describe('getServiceHealth', () => {
    it('should return service health from client', () => {
      const health = issueManager.getServiceHealth();

      assert.strictEqual(health.status, 'healthy');
      assert.strictEqual(health.circuitState, 'closed');
    });
  });

  describe('isAvailable', () => {
    it('should return availability from client', () => {
      const available = issueManager.isAvailable();

      assert.strictEqual(available, true);
    });
  });
});

describe('Issue interface', () => {
  it('should have all required properties', () => {
    const issue: Issue = {
      number: 1,
      title: 'Test Issue',
      body: 'Description',
      state: 'open',
      labels: ['bug'],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: 'john-doe',
    };

    assert.strictEqual(issue.number, 1);
    assert.strictEqual(issue.title, 'Test Issue');
    assert.strictEqual(issue.state, 'open');
  });

  it('should handle null body', () => {
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

  it('should handle closed state', () => {
    const issue: Issue = {
      number: 1,
      title: 'Closed Issue',
      body: 'Done',
      state: 'closed',
      labels: ['resolved'],
      htmlUrl: 'https://github.com/owner/repo/issues/1',
      createdAt: '2024-01-01T00:00:00Z',
      assignee: null,
    };

    assert.strictEqual(issue.state, 'closed');
  });
});

describe('Comment interface', () => {
  it('should have all required properties', () => {
    const comment: Comment = {
      id: 123,
      body: 'Test comment body',
      htmlUrl: 'https://github.com/owner/repo/issues/1#issuecomment-123',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T12:00:00Z',
      user: 'test-user',
    };

    assert.strictEqual(comment.id, 123);
    assert.strictEqual(comment.body, 'Test comment body');
    assert.ok(comment.htmlUrl.includes('issuecomment'));
  });

  it('should handle null user', () => {
    const comment: Comment = {
      id: 1,
      body: 'Anonymous comment',
      htmlUrl: 'https://github.com/owner/repo/issues/1#issuecomment-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      user: null,
    };

    assert.strictEqual(comment.user, null);
  });

  it('should handle empty body', () => {
    const comment: Comment = {
      id: 1,
      body: '',
      htmlUrl: 'https://github.com/owner/repo/issues/1#issuecomment-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      user: 'test-user',
    };

    assert.strictEqual(comment.body, '');
  });
});

describe('CreateIssueOptions interface', () => {
  it('should require title and body', () => {
    const options: CreateIssueOptions = {
      title: 'Required Title',
      body: 'Required Body',
    };

    assert.ok(options.title);
    assert.ok(options.body);
  });

  it('should have optional labels', () => {
    const options: CreateIssueOptions = {
      title: 'With Labels',
      body: 'Body',
      labels: ['enhancement', 'help-wanted'],
    };

    assert.deepStrictEqual(options.labels, ['enhancement', 'help-wanted']);
  });

  it('should work without optional labels', () => {
    const options: CreateIssueOptions = {
      title: 'No Labels',
      body: 'Body',
    };

    assert.strictEqual(options.labels, undefined);
  });
});

describe('DegradedResult interface', () => {
  it('should represent successful result', () => {
    const result: DegradedResult<Issue[]> = {
      value: [],
      degraded: false,
    };

    assert.strictEqual(result.degraded, false);
  });

  it('should represent degraded result', () => {
    const result: DegradedResult<void> = {
      value: undefined,
      degraded: true,
    };

    assert.strictEqual(result.degraded, true);
  });
});

describe('IssueManager edge cases', () => {
  let mockOctokit: ReturnType<typeof createMockOctokit>;
  let issueManager: IssueManager;

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    const mockClient = createMockClient({ client: mockOctokit });
    issueManager = createIssueManager(mockClient);
  });

  it('should handle issue with empty labels array', async () => {
    mockOctokit.issues.get.mock.mockImplementation(async () => ({
      data: createMockApiIssue({ labels: [] }),
    }));

    const issue = await issueManager.getIssue(1);

    assert.ok(issue);
    assert.deepStrictEqual(issue.labels, []);
  });

  it('should handle very long issue body', async () => {
    const longBody = 'A'.repeat(10000);
    mockOctokit.issues.get.mock.mockImplementation(async () => ({
      data: createMockApiIssue({ body: longBody }),
    }));

    const issue = await issueManager.getIssue(1);

    assert.ok(issue);
    assert.strictEqual(issue.body?.length, 10000);
  });

  it('should handle special characters in title', async () => {
    mockOctokit.issues.get.mock.mockImplementation(async () => ({
      data: createMockApiIssue({ title: 'Fix <script>alert("xss")</script>' }),
    }));

    const issue = await issueManager.getIssue(1);

    assert.ok(issue);
    assert.ok(issue.title.includes('<script>'));
  });

  it('should handle unicode in issue content', async () => {
    mockOctokit.issues.get.mock.mockImplementation(async () => ({
      data: createMockApiIssue({
        title: '修复中文问题 🐛',
        body: 'Description with emoji 🎉 and unicode: αβγ',
      }),
    }));

    const issue = await issueManager.getIssue(1);

    assert.ok(issue);
    assert.ok(issue.title.includes('🐛'));
    assert.ok(issue.body?.includes('🎉'));
  });

  it('should handle high issue numbers', async () => {
    mockOctokit.issues.get.mock.mockImplementation(async () => ({
      data: createMockApiIssue({ number: 99999 }),
    }));

    const issue = await issueManager.getIssue(99999);

    assert.ok(issue);
    assert.strictEqual(issue.number, 99999);
  });
});
