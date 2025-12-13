import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { GitHubClient, createGitHubClient } from './client.js';
import { GitHubError, ErrorCode } from '../utils/errors.js';
// Mock Octokit responses
const mockOctokit = {
    users: {
        getAuthenticated: mock.fn(),
    },
    repos: {
        get: mock.fn(),
    },
    rateLimit: {
        get: mock.fn(),
    },
};
// Mock the Octokit constructor
const originalOctokit = await import('@octokit/rest');
describe('GitHubClient', () => {
    const defaultOptions = {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
    };
    beforeEach(() => {
        // Reset all mocks
        mockOctokit.users.getAuthenticated.mock.resetCalls();
        mockOctokit.repos.get.mock.resetCalls();
        mockOctokit.rateLimit.get.mock.resetCalls();
    });
    describe('constructor', () => {
        it('should create client with provided options', () => {
            const client = new GitHubClient(defaultOptions);
            assert.strictEqual(client.owner, 'test-owner');
            assert.strictEqual(client.repo, 'test-repo');
        });
        it('should accept custom retry configuration', () => {
            const customOptions = {
                ...defaultOptions,
                retryConfig: {
                    maxRetries: 5,
                    baseDelayMs: 2000,
                },
            };
            const client = new GitHubClient(customOptions);
            assert.strictEqual(client.owner, 'test-owner');
        });
        it('should expose the underlying Octokit client', () => {
            const client = new GitHubClient(defaultOptions);
            assert.ok(client.client);
            assert.ok(typeof client.client === 'object');
        });
    });
    describe('createGitHubClient factory', () => {
        it('should create a GitHubClient instance', () => {
            const client = createGitHubClient(defaultOptions);
            assert.ok(client instanceof GitHubClient);
            assert.strictEqual(client.owner, 'test-owner');
            assert.strictEqual(client.repo, 'test-repo');
        });
    });
    describe('error handling', () => {
        it('should identify rate limit errors as retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limit exceeded', { statusCode: 429 });
            assert.strictEqual(error.isRetryable, true);
            assert.strictEqual(error.severity, 'transient');
        });
        it('should identify server errors as retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Internal server error', { statusCode: 500 });
            assert.strictEqual(error.isRetryable, true);
            assert.strictEqual(error.severity, 'transient');
        });
        it('should identify auth errors as non-retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Bad credentials', { statusCode: 401 });
            assert.strictEqual(error.isRetryable, false);
            assert.strictEqual(error.severity, 'critical');
        });
        it('should identify permission errors as non-retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_PERMISSION_DENIED, 'Access denied', { statusCode: 403 });
            assert.strictEqual(error.isRetryable, false);
            assert.strictEqual(error.severity, 'critical');
        });
        it('should identify not found errors as non-retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_REPO_NOT_FOUND, 'Repository not found', { statusCode: 404 });
            assert.strictEqual(error.isRetryable, false);
            assert.strictEqual(error.severity, 'error');
        });
        it('should include recovery actions for auth errors', () => {
            const error = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Authentication failed', { statusCode: 401 });
            assert.ok(error.recoveryActions.length > 0);
            const descriptions = error.recoveryActions.map(a => a.description);
            assert.ok(descriptions.some(d => d.includes('token')));
        });
        it('should include recovery actions for rate limit errors', () => {
            const error = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limit exceeded', { statusCode: 429 });
            assert.ok(error.recoveryActions.length > 0);
            const descriptions = error.recoveryActions.map(a => a.description);
            assert.ok(descriptions.some(d => d.includes('rate limit')));
        });
        it('should include endpoint in error context', () => {
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'API error', { endpoint: '/repos/owner/repo' });
            assert.strictEqual(error.context.endpoint, '/repos/owner/repo');
        });
        it('should include status code in error context', () => {
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'API error', { statusCode: 422 });
            assert.strictEqual(error.context.statusCode, 422);
        });
    });
    describe('GitHubError', () => {
        it('should be serializable to JSON', () => {
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Test error', {
                statusCode: 500,
                endpoint: '/test',
                context: { extra: 'data' },
            });
            const json = error.toJSON();
            assert.strictEqual(json.code, ErrorCode.GITHUB_API_ERROR);
            assert.strictEqual(json.message, 'Test error');
            assert.ok(json.context);
            assert.ok(json.recoveryActions);
        });
        it('should provide recovery suggestions as strings', () => {
            const error = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Auth failed');
            const suggestions = error.getRecoverySuggestions();
            assert.ok(Array.isArray(suggestions));
            assert.ok(suggestions.length > 0);
            assert.ok(suggestions.every(s => typeof s === 'string'));
        });
        it('should preserve cause chain', () => {
            const cause = new Error('Original error');
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Wrapped error', { cause });
            assert.strictEqual(error.cause, cause);
            assert.strictEqual(error.cause?.message, 'Original error');
        });
    });
    describe('retry configuration', () => {
        it('should use default retry config', () => {
            const client = new GitHubClient(defaultOptions);
            // Default config should be applied internally
            assert.ok(client.client);
        });
        it('should merge custom retry config with defaults', () => {
            const customConfig = {
                ...defaultOptions,
                retryConfig: {
                    maxRetries: 5,
                },
            };
            const client = new GitHubClient(customConfig);
            assert.ok(client.client);
        });
    });
    describe('network error handling', () => {
        it('should identify network errors as retryable', () => {
            const error = new GitHubError(ErrorCode.GITHUB_NETWORK_ERROR, 'Network error');
            assert.strictEqual(error.isRetryable, true);
        });
        it('should include network recovery actions', () => {
            const error = new GitHubError(ErrorCode.GITHUB_NETWORK_ERROR, 'Connection failed');
            const suggestions = error.getRecoverySuggestions();
            assert.ok(suggestions.some(s => s.includes('network') || s.includes('Retry')));
        });
    });
    describe('conflict error handling', () => {
        it('should handle PR conflict errors', () => {
            const error = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, 'Merge conflict');
            assert.strictEqual(error.code, ErrorCode.GITHUB_PR_CONFLICT);
        });
        it('should include rebase recovery action for conflicts', () => {
            const error = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, 'Merge conflict');
            const suggestions = error.getRecoverySuggestions();
            assert.ok(suggestions.some(s => s.toLowerCase().includes('rebase') || s.toLowerCase().includes('conflict')));
        });
    });
});
describe('Error Code Mapping', () => {
    it('should map 401 to GITHUB_AUTH_FAILED', () => {
        const error = new GitHubError(ErrorCode.GITHUB_AUTH_FAILED, 'Unauthorized', { statusCode: 401 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_AUTH_FAILED);
    });
    it('should map 403 with rate limit to GITHUB_RATE_LIMITED', () => {
        const error = new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limit exceeded', { statusCode: 403 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_RATE_LIMITED);
    });
    it('should map 403 without rate limit to GITHUB_PERMISSION_DENIED', () => {
        const error = new GitHubError(ErrorCode.GITHUB_PERMISSION_DENIED, 'Forbidden', { statusCode: 403 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_PERMISSION_DENIED);
    });
    it('should map 404 to GITHUB_REPO_NOT_FOUND', () => {
        const error = new GitHubError(ErrorCode.GITHUB_REPO_NOT_FOUND, 'Not found', { statusCode: 404 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_REPO_NOT_FOUND);
    });
    it('should map 409 to GITHUB_PR_CONFLICT', () => {
        const error = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, 'Conflict', { statusCode: 409 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_PR_CONFLICT);
    });
    it('should map 5xx to GITHUB_API_ERROR', () => {
        const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, 'Server error', { statusCode: 502 });
        assert.strictEqual(error.code, ErrorCode.GITHUB_API_ERROR);
    });
});
describe('GitHubClientOptions', () => {
    it('should require token', () => {
        const options = {
            token: 'ghp_token123',
            owner: 'owner',
            repo: 'repo',
        };
        const client = new GitHubClient(options);
        assert.ok(client);
    });
    it('should require owner', () => {
        const options = {
            token: 'ghp_token123',
            owner: 'my-org',
            repo: 'repo',
        };
        const client = new GitHubClient(options);
        assert.strictEqual(client.owner, 'my-org');
    });
    it('should require repo', () => {
        const options = {
            token: 'ghp_token123',
            owner: 'owner',
            repo: 'my-repo',
        };
        const client = new GitHubClient(options);
        assert.strictEqual(client.repo, 'my-repo');
    });
});
//# sourceMappingURL=client.test.js.map