import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
  withRetry,
  type RetryConfig,
  type ErrorContext,
  StructuredError,
} from '../utils/errors.js';

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
  retryConfig?: Partial<RetryConfig>;
}

const DEFAULT_GITHUB_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

export class GitHubClient {
  private octokit: Octokit;
  public readonly owner: string;
  public readonly repo: string;
  private retryConfig: Partial<RetryConfig>;

  constructor(options: GitHubClientOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
  }

  get client(): Octokit {
    return this.octokit;
  }

  /**
   * Execute a GitHub API request with automatic retry for transient failures
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: ErrorContext
  ): Promise<T> {
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
        const statusCode = (error as any).status ?? (error as any).response?.status;
        if (statusCode === 429) return true; // Rate limited
        if (statusCode >= 500) return true; // Server errors
        // Network errors
        const code = (error as any).code;
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
  private handleError(error: any, endpoint: string, context?: ErrorContext): GitHubError {
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
  async verifyAuth(): Promise<{ login: string; name: string }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.users.getAuthenticated();
        return { login: data.login, name: data.name || data.login };
      },
      'GET /user',
      { operation: 'verifyAuth' }
    );
  }

  /**
   * Get repository info
   */
  async getRepo(): Promise<{
    defaultBranch: string;
    fullName: string;
    private: boolean;
  }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.repos.get({
          owner: this.owner,
          repo: this.repo,
        });
        return {
          defaultBranch: data.default_branch,
          fullName: data.full_name,
          private: data.private,
        };
      },
      `GET /repos/${this.owner}/${this.repo}`,
      { operation: 'getRepo' }
    );
  }

  /**
   * Check rate limit status
   */
  async getRateLimit(): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.rateLimit.get();
        return {
          limit: data.rate.limit,
          remaining: data.rate.remaining,
          resetAt: new Date(data.rate.reset * 1000),
        };
      },
      'GET /rate_limit',
      { operation: 'getRateLimit' }
    );
  }

  /**
   * Wait for rate limit to reset if necessary
   */
  async waitForRateLimitIfNeeded(): Promise<void> {
    try {
      const rateLimit = await this.getRateLimit();
      if (rateLimit.remaining < 10) {
        const waitMs = Math.max(0, rateLimit.resetAt.getTime() - Date.now());
        if (waitMs > 0) {
          logger.warn(`Rate limit low (${rateLimit.remaining} remaining), waiting ${Math.ceil(waitMs / 1000)}s`);
          await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
        }
      }
    } catch (error) {
      logger.debug('Failed to check rate limit', { error: (error as Error).message });
    }
  }
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new GitHubClient(options);
}
