import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import { GitHubError, createGitHubErrorFromResponse, withRetry, StructuredError, } from '../utils/errors.js';
const DEFAULT_GITHUB_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
};
export class GitHubClient {
    octokit;
    owner;
    repo;
    retryConfig;
    constructor(options) {
        this.octokit = new Octokit({ auth: options.token });
        this.owner = options.owner;
        this.repo = options.repo;
        this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
    }
    get client() {
        return this.octokit;
    }
    /**
     * Execute a GitHub API request with automatic retry for transient failures
     */
    async executeWithRetry(operation, endpoint, context) {
        return withRetry(operation, {
            config: this.retryConfig,
            onRetry: (error, attempt, delay) => {
                logger.warn(`GitHub API retry (attempt ${attempt}): ${endpoint}`, {
                    error: error.message,
                    retryInMs: delay,
                });
            },
            shouldRetry: (error) => {
                // Check if it's a StructuredError with retry flag
                if (error instanceof StructuredError) {
                    return error.isRetryable;
                }
                // Check for common retryable HTTP status codes
                const statusCode = error.status ?? error.response?.status;
                if (statusCode === 429)
                    return true; // Rate limited
                if (statusCode >= 500)
                    return true; // Server errors
                // Network errors
                const code = error.code;
                if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
                    return true;
                }
                return false;
            },
        }).catch((error) => {
            throw this.handleError(error, endpoint, context);
        });
    }
    /**
     * Convert an error to a structured GitHubError
     */
    handleError(error, endpoint, context) {
        if (error instanceof GitHubError) {
            return error;
        }
        return createGitHubErrorFromResponse(error, endpoint, {
            ...context,
            owner: this.owner,
            repo: this.repo,
        });
    }
    /**
     * Verify authentication works
     */
    async verifyAuth() {
        return this.executeWithRetry(async () => {
            const { data } = await this.octokit.users.getAuthenticated();
            return { login: data.login, name: data.name || data.login };
        }, 'GET /user', { operation: 'verifyAuth' });
    }
    /**
     * Get repository info
     */
    async getRepo() {
        return this.executeWithRetry(async () => {
            const { data } = await this.octokit.repos.get({
                owner: this.owner,
                repo: this.repo,
            });
            return {
                defaultBranch: data.default_branch,
                fullName: data.full_name,
                private: data.private,
            };
        }, `GET /repos/${this.owner}/${this.repo}`, { operation: 'getRepo' });
    }
    /**
     * Check rate limit status
     */
    async getRateLimit() {
        return this.executeWithRetry(async () => {
            const { data } = await this.octokit.rateLimit.get();
            return {
                limit: data.rate.limit,
                remaining: data.rate.remaining,
                resetAt: new Date(data.rate.reset * 1000),
            };
        }, 'GET /rate_limit', { operation: 'getRateLimit' });
    }
    /**
     * Wait for rate limit to reset if necessary
     */
    async waitForRateLimitIfNeeded() {
        try {
            const rateLimit = await this.getRateLimit();
            if (rateLimit.remaining < 10) {
                const waitMs = Math.max(0, rateLimit.resetAt.getTime() - Date.now());
                if (waitMs > 0) {
                    logger.warn(`Rate limit low (${rateLimit.remaining} remaining), waiting ${Math.ceil(waitMs / 1000)}s`);
                    await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
                }
            }
        }
        catch (error) {
            logger.debug('Failed to check rate limit', { error: error.message });
        }
    }
}
export function createGitHubClient(options) {
    return new GitHubClient(options);
}
//# sourceMappingURL=client.js.map