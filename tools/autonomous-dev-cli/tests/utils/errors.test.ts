/**
 * Tests for the structured error handling system.
 * Covers error classes, error codes, recovery actions, and utilities.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  ErrorCode,
  ErrorSeverity,
  StructuredError,
  GitHubError,
  ClaudeError,
  ConfigError,
  ExecutionError,
  AnalyzerError,
  DEFAULT_RETRY_CONFIG,
  withRetry,
  wrapError,
  createGitHubErrorFromResponse,
  formatError,
  type RecoveryAction,
  type ErrorContext,
  type RetryConfig,
} from '../../src/utils/errors.js';

describe('ErrorCode enum', () => {
  it('should have GitHub error codes', () => {
    assert.ok(ErrorCode.GITHUB_AUTH_FAILED);
    assert.ok(ErrorCode.GITHUB_RATE_LIMITED);
    assert.ok(ErrorCode.GITHUB_REPO_NOT_FOUND);
    assert.ok(ErrorCode.GITHUB_PERMISSION_DENIED);
    assert.ok(ErrorCode.GITHUB_API_ERROR);
    assert.ok(ErrorCode.GITHUB_NETWORK_ERROR);
    assert.ok(ErrorCode.GITHUB_BRANCH_NOT_FOUND);
    assert.ok(ErrorCode.GITHUB_PR_CONFLICT);
    assert.ok(ErrorCode.GITHUB_ISSUE_NOT_FOUND);
    assert.ok(ErrorCode.GITHUB_CIRCUIT_OPEN);
    assert.ok(ErrorCode.GITHUB_SERVICE_DEGRADED);
  });

  it('should have Claude error codes', () => {
    assert.ok(ErrorCode.CLAUDE_AUTH_FAILED);
    assert.ok(ErrorCode.CLAUDE_QUOTA_EXCEEDED);
    assert.ok(ErrorCode.CLAUDE_RATE_LIMITED);
    assert.ok(ErrorCode.CLAUDE_TIMEOUT);
    assert.ok(ErrorCode.CLAUDE_NETWORK_ERROR);
    assert.ok(ErrorCode.CLAUDE_API_ERROR);
    assert.ok(ErrorCode.CLAUDE_INVALID_RESPONSE);
  });

  it('should have Config error codes', () => {
    assert.ok(ErrorCode.CONFIG_INVALID);
    assert.ok(ErrorCode.CONFIG_MISSING_REQUIRED);
    assert.ok(ErrorCode.CONFIG_FILE_NOT_FOUND);
    assert.ok(ErrorCode.CONFIG_PARSE_ERROR);
    assert.ok(ErrorCode.CONFIG_VALIDATION_FAILED);
  });

  it('should have Database error codes', () => {
    assert.ok(ErrorCode.DB_CONNECTION_FAILED);
    assert.ok(ErrorCode.DB_USER_NOT_FOUND);
    assert.ok(ErrorCode.DB_QUERY_FAILED);
  });

  it('should have Execution error codes', () => {
    assert.ok(ErrorCode.EXEC_WORKSPACE_FAILED);
    assert.ok(ErrorCode.EXEC_CLONE_FAILED);
    assert.ok(ErrorCode.EXEC_BRANCH_FAILED);
    assert.ok(ErrorCode.EXEC_NO_CHANGES);
    assert.ok(ErrorCode.EXEC_COMMIT_FAILED);
    assert.ok(ErrorCode.EXEC_PUSH_FAILED);
    assert.ok(ErrorCode.EXEC_TIMEOUT);
  });

  it('should have Analyzer error codes', () => {
    assert.ok(ErrorCode.ANALYZER_PATH_NOT_FOUND);
    assert.ok(ErrorCode.ANALYZER_PATH_NOT_READABLE);
    assert.ok(ErrorCode.ANALYZER_PATH_NOT_DIRECTORY);
    assert.ok(ErrorCode.ANALYZER_INVALID_GLOB_PATTERN);
    assert.ok(ErrorCode.ANALYZER_INVALID_REGEX_PATTERN);
    assert.ok(ErrorCode.ANALYZER_MAX_DEPTH_EXCEEDED);
    assert.ok(ErrorCode.ANALYZER_MAX_FILES_EXCEEDED);
    assert.ok(ErrorCode.ANALYZER_INVALID_CONFIG);
  });

  it('should have General error codes', () => {
    assert.ok(ErrorCode.INTERNAL_ERROR);
    assert.ok(ErrorCode.NETWORK_ERROR);
    assert.ok(ErrorCode.NOT_INITIALIZED);
    assert.ok(ErrorCode.UNKNOWN_ERROR);
    assert.ok(ErrorCode.SERVICE_DEGRADED);
    assert.ok(ErrorCode.CIRCUIT_BREAKER_OPEN);
    assert.ok(ErrorCode.OFFLINE_MODE);
  });
});

describe('StructuredError', () => {
  describe('constructor', () => {
    it('should create error with code and message', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test message');

      assert.strictEqual(error.code, ErrorCode.UNKNOWN_ERROR);
      assert.strictEqual(error.message, 'Test message');
      assert.strictEqual(error.name, 'StructuredError');
    });

    it('should infer severity from code', () => {
      const transientError = new StructuredError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limited');
      assert.strictEqual(transientError.severity, 'transient');

      const criticalError = new StructuredError(ErrorCode.GITHUB_AUTH_FAILED, 'Auth failed');
      assert.strictEqual(criticalError.severity, 'critical');

      const regularError = new StructuredError(ErrorCode.GITHUB_REPO_NOT_FOUND, 'Not found');
      assert.strictEqual(regularError.severity, 'error');
    });

    it('should accept custom severity', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
        severity: 'warning',
      });
      assert.strictEqual(error.severity, 'warning');
    });

    it('should infer isRetryable from code', () => {
      const retryableError = new StructuredError(ErrorCode.NETWORK_ERROR, 'Network');
      assert.strictEqual(retryableError.isRetryable, true);

      const nonRetryableError = new StructuredError(ErrorCode.CONFIG_INVALID, 'Invalid');
      assert.strictEqual(nonRetryableError.isRetryable, false);
    });

    it('should accept custom isRetryable', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
        isRetryable: true,
      });
      assert.strictEqual(error.isRetryable, true);
    });

    it('should store context', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
        context: { key: 'value', num: 42 },
      });
      assert.strictEqual(error.context.key, 'value');
      assert.strictEqual(error.context.num, 42);
    });

    it('should add timestamp to context', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test');
      assert.ok(error.context.timestamp);
    });

    it('should store cause', () => {
      const cause = new Error('Original error');
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Wrapped', {
        cause,
      });
      assert.strictEqual(error.cause, cause);
    });

    it('should store recovery actions', () => {
      const actions: RecoveryAction[] = [
        { description: 'Do this', automatic: false },
        { description: 'Try that', automatic: true },
      ];
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
        recoveryActions: actions,
      });
      assert.strictEqual(error.recoveryActions.length, 2);
    });
  });

  describe('toJSON', () => {
    it('should serialize error to JSON', () => {
      const error = new StructuredError(ErrorCode.NETWORK_ERROR, 'Network failed', {
        severity: 'transient',
        context: { endpoint: '/api/test' },
      });

      const json = error.toJSON();

      assert.strictEqual(json.code, ErrorCode.NETWORK_ERROR);
      assert.strictEqual(json.message, 'Network failed');
      assert.strictEqual(json.severity, 'transient');
      assert.strictEqual((json.context as any).endpoint, '/api/test');
      assert.ok(json.timestamp);
    });

    it('should include cause message', () => {
      const cause = new Error('Original');
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Wrapped', { cause });

      const json = error.toJSON();

      assert.strictEqual(json.cause, 'Original');
    });
  });

  describe('getRecoverySuggestions', () => {
    it('should return recovery descriptions', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
        recoveryActions: [
          { description: 'Step 1', automatic: false },
          { description: 'Step 2', automatic: true },
        ],
      });

      const suggestions = error.getRecoverySuggestions();

      assert.deepStrictEqual(suggestions, ['Step 1', 'Step 2']);
    });

    it('should return empty array if no recovery actions', () => {
      const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test');
      assert.deepStrictEqual(error.getRecoverySuggestions(), []);
    });
  });
});

describe('GitHubError', () => {
  it('should create GitHub error with code', () => {
    const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'API failed');

    assert.strictEqual(error.code, ErrorCode.GITHUB_API_ERROR);
    assert.strictEqual(error.name, 'GitHubError');
  });

  it('should include status code in context', () => {
    const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Error', {
      statusCode: 500,
    });

    assert.strictEqual(error.context.statusCode, 500);
  });

  it('should include endpoint in context', () => {
    const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Error', {
      endpoint: '/repos/owner/repo',
    });

    assert.strictEqual(error.context.endpoint, '/repos/owner/repo');
  });

  it('should set severity based on status code', () => {
    const rateLimited = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limited', {
      statusCode: 429,
    });
    assert.strictEqual(rateLimited.severity, 'transient');

    const authFailed = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Unauthorized', {
      statusCode: 401,
    });
    assert.strictEqual(authFailed.severity, 'critical');

    const serverError = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Server error', {
      statusCode: 500,
    });
    assert.strictEqual(serverError.severity, 'transient');
  });

  it('should set isRetryable based on status code', () => {
    const rateLimited = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limited', {
      statusCode: 429,
    });
    assert.strictEqual(rateLimited.isRetryable, true);

    const serverError = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Server error', {
      statusCode: 500,
    });
    assert.strictEqual(serverError.isRetryable, true);

    const notFound = new GitHubError(ErrorCode.GITHUB_REPO_NOT_FOUND, 'Not found', {
      statusCode: 404,
    });
    assert.strictEqual(notFound.isRetryable, false);
  });

  it('should include recovery actions for auth errors', () => {
    const error = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Auth failed');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('token')));
  });

  it('should include recovery actions for rate limit errors', () => {
    const error = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limited');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('rate limit')));
  });

  it('should include recovery actions for conflict errors', () => {
    const error = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, 'Conflict');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(
      error.recoveryActions.some(
        (a) => a.description.toLowerCase().includes('rebase') || a.description.toLowerCase().includes('conflict')
      )
    );
  });
});

describe('ClaudeError', () => {
  it('should create Claude error with code', () => {
    const error = new ClaudeError(ErrorCode.CLAUDE_API_ERROR, 'API failed');

    assert.strictEqual(error.code, ErrorCode.CLAUDE_API_ERROR);
    assert.strictEqual(error.name, 'ClaudeError');
  });

  it('should set severity based on code', () => {
    const authFailed = new ClaudeError(ErrorCode.CLAUDE_AUTH_FAILED, 'Auth failed');
    assert.strictEqual(authFailed.severity, 'critical');

    const timeout = new ClaudeError(ErrorCode.CLAUDE_TIMEOUT, 'Timeout');
    assert.strictEqual(timeout.severity, 'transient');
  });

  it('should include recovery actions for auth errors', () => {
    const error = new ClaudeError(ErrorCode.CLAUDE_AUTH_FAILED, 'Auth failed');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('credentials')));
  });

  it('should include recovery actions for quota errors', () => {
    const error = new ClaudeError(ErrorCode.CLAUDE_QUOTA_EXCEEDED, 'Quota exceeded');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('quota')));
  });

  it('should include recovery actions for timeout errors', () => {
    const error = new ClaudeError(ErrorCode.CLAUDE_TIMEOUT, 'Timeout');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('timeout')));
  });
});

describe('ConfigError', () => {
  it('should create config error with code', () => {
    const error = new ConfigError(ErrorCode.CONFIG_INVALID, 'Invalid config');

    assert.strictEqual(error.code, ErrorCode.CONFIG_INVALID);
    assert.strictEqual(error.name, 'ConfigError');
    assert.strictEqual(error.severity, 'critical');
    assert.strictEqual(error.isRetryable, false);
  });

  it('should include field in context', () => {
    const error = new ConfigError(ErrorCode.CONFIG_INVALID, 'Invalid', {
      field: 'maxWorkers',
    });

    assert.strictEqual(error.context.field, 'maxWorkers');
  });

  it('should include invalid value in context', () => {
    const error = new ConfigError(ErrorCode.CONFIG_INVALID, 'Invalid', {
      value: -1,
    });

    assert.strictEqual(error.context.invalidValue, -1);
  });

  it('should include expected type in context', () => {
    const error = new ConfigError(ErrorCode.CONFIG_INVALID, 'Invalid', {
      expectedType: 'number',
    });

    assert.strictEqual(error.context.expectedType, 'number');
  });

  it('should include field-specific recovery action', () => {
    const error = new ConfigError(ErrorCode.CONFIG_INVALID, 'Invalid', {
      field: 'apiKey',
    });

    assert.ok(error.recoveryActions.some((a) => a.description.includes('apiKey')));
  });
});

describe('ExecutionError', () => {
  it('should create execution error with code', () => {
    const error = new ExecutionError(ErrorCode.EXEC_CLONE_FAILED, 'Clone failed');

    assert.strictEqual(error.code, ErrorCode.EXEC_CLONE_FAILED);
    assert.strictEqual(error.name, 'ExecutionError');
  });

  it('should include issue number in context', () => {
    const error = new ExecutionError(ErrorCode.EXEC_NO_CHANGES, 'No changes', {
      issueNumber: 42,
    });

    assert.strictEqual(error.context.issueNumber, 42);
  });

  it('should include branch name in context', () => {
    const error = new ExecutionError(ErrorCode.EXEC_PUSH_FAILED, 'Push failed', {
      branchName: 'feature/test',
    });

    assert.strictEqual(error.context.branchName, 'feature/test');
  });

  it('should include recovery actions for clone errors', () => {
    const error = new ExecutionError(ErrorCode.EXEC_CLONE_FAILED, 'Clone failed');

    assert.ok(error.recoveryActions.length > 0);
  });

  it('should include recovery actions for push errors', () => {
    const error = new ExecutionError(ErrorCode.EXEC_PUSH_FAILED, 'Push failed');

    assert.ok(error.recoveryActions.length > 0);
  });
});

describe('AnalyzerError', () => {
  it('should create analyzer error with code', () => {
    const error = new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_FOUND, 'Path not found');

    assert.strictEqual(error.code, ErrorCode.ANALYZER_PATH_NOT_FOUND);
    assert.strictEqual(error.name, 'AnalyzerError');
    assert.strictEqual(error.severity, 'error');
    assert.strictEqual(error.isRetryable, false);
  });

  it('should include path in context', () => {
    const error = new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_FOUND, 'Not found', {
      path: '/nonexistent/path',
    });

    assert.strictEqual(error.context.path, '/nonexistent/path');
  });

  it('should include pattern in context', () => {
    const error = new AnalyzerError(ErrorCode.ANALYZER_INVALID_GLOB_PATTERN, 'Invalid', {
      pattern: '**/*[',
    });

    assert.strictEqual(error.context.pattern, '**/*[');
  });

  it('should include limit in context', () => {
    const error = new AnalyzerError(ErrorCode.ANALYZER_MAX_FILES_EXCEEDED, 'Too many', {
      limit: 10000,
    });

    assert.strictEqual(error.context.limit, 10000);
  });

  it('should include recovery actions', () => {
    const error = new AnalyzerError(ErrorCode.ANALYZER_MAX_DEPTH_EXCEEDED, 'Too deep');

    assert.ok(error.recoveryActions.length > 0);
    assert.ok(error.recoveryActions.some((a) => a.description.includes('maxDepth') || a.description.includes('Reduce')));
  });
});

describe('DEFAULT_RETRY_CONFIG', () => {
  it('should have reasonable defaults', () => {
    assert.strictEqual(DEFAULT_RETRY_CONFIG.maxRetries, 3);
    assert.strictEqual(DEFAULT_RETRY_CONFIG.baseDelayMs, 1000);
    assert.strictEqual(DEFAULT_RETRY_CONFIG.maxDelayMs, 30000);
    assert.strictEqual(DEFAULT_RETRY_CONFIG.backoffMultiplier, 2);
  });
});

describe('withRetry', () => {
  it('should succeed on first attempt', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return 'success';
    });

    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 1);
  });

  it('should retry on retryable error', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new StructuredError(ErrorCode.NETWORK_ERROR, 'Network error');
        }
        return 'success';
      },
      { config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 } }
    );

    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 3);
  });

  it('should not retry non-retryable error', async () => {
    let attempts = 0;

    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new StructuredError(ErrorCode.CONFIG_INVALID, 'Invalid config');
        },
        { config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 } }
      );
    });

    assert.strictEqual(attempts, 1);
  });

  it('should call onRetry callback', async () => {
    const retryCalls: number[] = [];

    await withRetry(
      (() => {
        let attempts = 0;
        return async () => {
          attempts++;
          if (attempts < 3) {
            throw new StructuredError(ErrorCode.NETWORK_ERROR, 'Error');
          }
          return 'done';
        };
      })(),
      {
        config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
        onRetry: (error, attempt) => {
          retryCalls.push(attempt);
        },
      }
    );

    assert.deepStrictEqual(retryCalls, [1, 2]);
  });

  it('should use custom shouldRetry function', async () => {
    let attempts = 0;

    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new Error('Custom error');
        },
        {
          config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
          shouldRetry: () => false,
        }
      );
    });

    assert.strictEqual(attempts, 1);
  });

  it('should exhaust retries', async () => {
    let attempts = 0;

    await assert.rejects(async () => {
      await withRetry(
        async () => {
          attempts++;
          throw new StructuredError(ErrorCode.NETWORK_ERROR, 'Always fails');
        },
        { config: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 } }
      );
    });

    assert.strictEqual(attempts, 3); // Initial + 2 retries
  });
});

describe('wrapError', () => {
  it('should return StructuredError unchanged', () => {
    const original = new StructuredError(ErrorCode.NETWORK_ERROR, 'Original');
    const wrapped = wrapError(original);

    assert.strictEqual(wrapped.code, ErrorCode.NETWORK_ERROR);
    assert.strictEqual(wrapped.message, 'Original');
  });

  it('should add context to StructuredError', () => {
    const original = new StructuredError(ErrorCode.NETWORK_ERROR, 'Original');
    const wrapped = wrapError(original, ErrorCode.UNKNOWN_ERROR, {
      extra: 'context',
    });

    assert.strictEqual(wrapped.context.extra, 'context');
  });

  it('should wrap regular Error', () => {
    const original = new Error('Regular error');
    const wrapped = wrapError(original);

    assert.ok(wrapped instanceof StructuredError);
    assert.strictEqual(wrapped.code, ErrorCode.UNKNOWN_ERROR);
    assert.strictEqual(wrapped.message, 'Regular error');
    assert.strictEqual(wrapped.cause, original);
  });

  it('should wrap string error', () => {
    const wrapped = wrapError('String error');

    assert.ok(wrapped instanceof StructuredError);
    assert.strictEqual(wrapped.message, 'String error');
  });

  it('should use provided default code', () => {
    const wrapped = wrapError(new Error('Error'), ErrorCode.NETWORK_ERROR);

    assert.strictEqual(wrapped.code, ErrorCode.NETWORK_ERROR);
  });
});

describe('createGitHubErrorFromResponse', () => {
  it('should create auth error for 401', () => {
    const error = createGitHubErrorFromResponse({ status: 401, message: 'Unauthorized' });

    assert.strictEqual(error.code, ErrorCode.GITHUB_AUTH_FAILED);
  });

  it('should create rate limit error for 403 with rate limit message', () => {
    const error = createGitHubErrorFromResponse({
      status: 403,
      message: 'Rate limit exceeded',
    });

    assert.strictEqual(error.code, ErrorCode.GITHUB_RATE_LIMITED);
  });

  it('should create permission error for 403 without rate limit', () => {
    const error = createGitHubErrorFromResponse({
      status: 403,
      message: 'Forbidden',
    });

    assert.strictEqual(error.code, ErrorCode.GITHUB_PERMISSION_DENIED);
  });

  it('should create not found error for 404', () => {
    const error = createGitHubErrorFromResponse({ status: 404, message: 'Not found' });

    assert.strictEqual(error.code, ErrorCode.GITHUB_REPO_NOT_FOUND);
  });

  it('should create conflict error for 409', () => {
    const error = createGitHubErrorFromResponse({ status: 409, message: 'Conflict' });

    assert.strictEqual(error.code, ErrorCode.GITHUB_PR_CONFLICT);
  });

  it('should create network error for network codes', () => {
    const error = createGitHubErrorFromResponse({ code: 'ENOTFOUND', message: 'DNS failed' });

    assert.strictEqual(error.code, ErrorCode.GITHUB_NETWORK_ERROR);
  });

  it('should include endpoint in context', () => {
    const error = createGitHubErrorFromResponse(
      { status: 500, message: 'Error' },
      '/repos/owner/repo'
    );

    assert.strictEqual(error.context.endpoint, '/repos/owner/repo');
  });

  it('should include additional context', () => {
    const error = createGitHubErrorFromResponse(
      { status: 500, message: 'Error' },
      '/api',
      { requestId: '123' }
    );

    assert.strictEqual(error.context.requestId, '123');
  });

  it('should include response data in context', () => {
    const error = createGitHubErrorFromResponse({
      status: 422,
      message: 'Validation failed',
      response: { data: { errors: ['Invalid input'] } },
    });

    assert.ok(error.context.responseData);
  });
});

describe('formatError', () => {
  it('should format error with code and message', () => {
    const error = new StructuredError(ErrorCode.NETWORK_ERROR, 'Connection failed');
    const formatted = formatError(error);

    assert.ok(formatted.includes('[NETWORK_ERROR]'));
    assert.ok(formatted.includes('Connection failed'));
  });

  it('should include severity', () => {
    const error = new StructuredError(ErrorCode.NETWORK_ERROR, 'Error', {
      severity: 'critical',
    });
    const formatted = formatError(error);

    assert.ok(formatted.includes('critical'));
  });

  it('should include retryable status', () => {
    const error = new StructuredError(ErrorCode.NETWORK_ERROR, 'Error');
    const formatted = formatError(error);

    assert.ok(formatted.includes('Retryable: yes'));
  });

  it('should include recovery suggestions', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Error', {
      recoveryActions: [
        { description: 'Try this', automatic: true },
        { description: 'Or that', automatic: false },
      ],
    });
    const formatted = formatError(error);

    assert.ok(formatted.includes('Recovery suggestions'));
    assert.ok(formatted.includes('Try this'));
    assert.ok(formatted.includes('(auto)'));
    assert.ok(formatted.includes('(manual)'));
  });

  it('should include context', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Error', {
      context: { endpoint: '/api', userId: '123' },
    });
    const formatted = formatError(error);

    assert.ok(formatted.includes('Context'));
    assert.ok(formatted.includes('endpoint'));
    assert.ok(formatted.includes('userId'));
  });
});

describe('Error inheritance', () => {
  it('should be instanceof Error', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test');
    assert.ok(error instanceof Error);
  });

  it('should be instanceof StructuredError', () => {
    const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Test');
    assert.ok(error instanceof StructuredError);
    assert.ok(error instanceof Error);
  });

  it('should have stack trace', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test');
    assert.ok(error.stack);
    assert.ok(error.stack?.includes('StructuredError'));
  });
});

describe('Error serialization edge cases', () => {
  it('should handle circular references in context', () => {
    const context: any = { key: 'value' };
    context.circular = context;

    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', { context });

    // toJSON should not throw
    assert.doesNotThrow(() => error.toJSON());
  });

  it('should handle undefined values in context', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
      context: { key: undefined },
    });

    const formatted = formatError(error);
    assert.ok(typeof formatted === 'string');
  });

  it('should handle empty recovery actions', () => {
    const error = new StructuredError(ErrorCode.UNKNOWN_ERROR, 'Test', {
      recoveryActions: [],
    });

    const suggestions = error.getRecoverySuggestions();
    assert.deepStrictEqual(suggestions, []);
  });
});
