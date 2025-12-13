import { Octokit } from '@octokit/rest';
import { type RetryConfig } from '../utils/errors.js';
export interface GitHubClientOptions {
    token: string;
    owner: string;
    repo: string;
    retryConfig?: Partial<RetryConfig>;
}
export declare class GitHubClient {
    private octokit;
    readonly owner: string;
    readonly repo: string;
    private retryConfig;
    constructor(options: GitHubClientOptions);
    get client(): Octokit;
    /**
     * Execute a GitHub API request with automatic retry for transient failures
     */
    private executeWithRetry;
    /**
     * Convert an error to a structured GitHubError
     */
    private handleError;
    /**
     * Verify authentication works
     */
    verifyAuth(): Promise<{
        login: string;
        name: string;
    }>;
    /**
     * Get repository info
     */
    getRepo(): Promise<{
        defaultBranch: string;
        fullName: string;
        private: boolean;
    }>;
    /**
     * Check rate limit status
     */
    getRateLimit(): Promise<{
        limit: number;
        remaining: number;
        resetAt: Date;
    }>;
    /**
     * Wait for rate limit to reset if necessary
     */
    waitForRateLimitIfNeeded(): Promise<void>;
}
export declare function createGitHubClient(options: GitHubClientOptions): GitHubClient;
//# sourceMappingURL=client.d.ts.map