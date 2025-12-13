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
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
}

/**
 * Circuit breaker configuration for graceful degradation
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening circuit
  successThreshold: number;      // Number of successes to close circuit
  resetTimeoutMs: number;        // Time to wait before attempting half-open
  halfOpenMaxAttempts: number;   // Max attempts in half-open state
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Service health status for monitoring
 */
export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  circuitState: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastError?: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: Date;
}

const DEFAULT_GITHUB_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
};

export class GitHubClient {
  private octokit: Octokit;
  public readonly owner: string;
  public readonly repo: string;
  private retryConfig: Partial<RetryConfig>;
  private circuitBreakerConfig: CircuitBreakerConfig;

  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime: Date | undefined;
  private lastSuccessTime: Date | undefined;
  private lastErrorMessage: string | undefined;
  private halfOpenAttempts: number = 0;

  // Rate limit tracking
  private rateLimitRemaining: number | undefined;
  private rateLimitResetAt: Date | undefined;

  constructor(options: GitHubClientOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
    this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...options.circuitBreakerConfig };
  }

  get client(): Octokit {
    return this.octokit;
  }

  /**
   * Get the current service health status
   */
  getServiceHealth(): ServiceHealth {
    let status: ServiceHealth['status'] = 'healthy';

    if (this.circuitState === 'open') {
      status = 'unavailable';
    } else if (this.circuitState === 'half-open' || this.consecutiveFailures > 0) {
      status = 'degraded';
    }

    return {
      status,
      circuitState: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      lastError: this.lastErrorMessage,
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitResetAt: this.rateLimitResetAt,
    };
  }

  /**
   * Check if the circuit breaker allows requests
   */
  private canMakeRequest(): boolean {
    if (this.circuitState === 'closed') {
      return true;
    }

    if (this.circuitState === 'open') {
      // Check if enough time has passed to try half-open
      const timeSinceFailure = this.lastFailureTime
        ? Date.now() - this.lastFailureTime.getTime()
        : Infinity;

      if (timeSinceFailure >= this.circuitBreakerConfig.resetTimeoutMs) {
        this.circuitState = 'half-open';
        this.halfOpenAttempts = 0;
        logger.info('Circuit breaker transitioning to half-open state', {
          component: 'GitHubClient',
          timeSinceLastFailure: timeSinceFailure,
        });
        return true;
      }
      return false;
    }

    // Half-open state: allow limited attempts
    return this.halfOpenAttempts < this.circuitBreakerConfig.halfOpenMaxAttempts;
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = new Date();

    if (this.circuitState === 'half-open') {
      if (this.consecutiveSuccesses >= this.circuitBreakerConfig.successThreshold) {
        this.circuitState = 'closed';
        logger.info('Circuit breaker closed after successful recovery', {
          component: 'GitHubClient',
          consecutiveSuccesses: this.consecutiveSuccesses,
        });
      }
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(error: Error): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.lastFailureTime = new Date();
    this.lastErrorMessage = error.message;

    if (this.circuitState === 'half-open') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.circuitBreakerConfig.halfOpenMaxAttempts) {
        this.circuitState = 'open';
        logger.warn('Circuit breaker reopened after half-open failures', {
          component: 'GitHubClient',
          halfOpenAttempts: this.halfOpenAttempts,
        });
      }
    } else if (this.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold) {
      this.circuitState = 'open';
      logger.warn('Circuit breaker opened due to consecutive failures', {
        component: 'GitHubClient',
        consecutiveFailures: this.consecutiveFailures,
        lastError: error.message,
      });
    }
  }

  /**
   * Check if an error is due to rate limiting and update rate limit state
   */
  private updateRateLimitState(error: any): void {
    const statusCode = error.status ?? error.response?.status;
    if (statusCode === 429 || error.message?.toLowerCase().includes('rate limit')) {
      const resetHeader = error.response?.headers?.['x-ratelimit-reset'];
      if (resetHeader) {
        this.rateLimitResetAt = new Date(parseInt(resetHeader) * 1000);
        this.rateLimitRemaining = 0;
      }
    }
  }

  /**
   * Execute a GitHub API request with automatic retry for transient failures
   * Integrates with circuit breaker for graceful degradation
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: ErrorContext
  ): Promise<T> {
    // Check circuit breaker state
    if (!this.canMakeRequest()) {
      const error = new GitHubError(
        ErrorCode.GITHUB_API_ERROR,
        `GitHub API unavailable (circuit breaker open). Will retry after ${this.circuitBreakerConfig.resetTimeoutMs / 1000}s`,
        {
          statusCode: 503,
          endpoint,
          context: {
            ...context,
            circuitState: this.circuitState,
            lastFailure: this.lastFailureTime?.toISOString(),
          },
        }
      );
      logger.warn('GitHub API request blocked by circuit breaker', {
        endpoint,
        circuitState: this.circuitState,
        lastFailure: this.lastFailureTime?.toISOString(),
      });
      throw error;
    }

    try {
      const result = await withRetry(operation, {
        config: this.retryConfig,
        onRetry: (error, attempt, delay) => {
          this.updateRateLimitState(error);
          logger.warn(`GitHub API retry (attempt ${attempt}): ${endpoint}`, {
            error: error.message,
            retryInMs: delay,
            circuitState: this.circuitState,
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
      });

      // Success - record it
      this.recordSuccess();
      return result;
    } catch (error) {
      // Failure - record it and update rate limit state
      this.updateRateLimitState(error);
      this.recordFailure(error as Error);
      throw this.handleError(error, endpoint, context);
    }
  }

  /**
   * Execute a GitHub API request with graceful degradation support.
   * Returns the fallback value if the circuit breaker is open or all retries fail.
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T,
    endpoint: string,
    context?: ErrorContext
  ): Promise<{ value: T; degraded: boolean }> {
    try {
      const value = await this.executeWithRetry(operation, endpoint, context);
      return { value, degraded: false };
    } catch (error) {
      logger.warn(`GitHub API degraded - using fallback for ${endpoint}`, {
        error: (error as Error).message,
        circuitState: this.circuitState,
      });
      return { value: fallback, degraded: true };
    }
  }

  /**
   * Check if the GitHub API is currently available
   */
  isAvailable(): boolean {
    return this.circuitState !== 'open';
  }

  /**
   * Reset the circuit breaker state (for testing or manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenAttempts = 0;
    logger.info('Circuit breaker manually reset', { component: 'GitHubClient' });
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
