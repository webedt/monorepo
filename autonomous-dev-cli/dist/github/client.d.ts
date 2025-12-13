import { Octokit } from '@octokit/rest';
import { type RetryConfig, type ErrorContext } from '../utils/errors.js';
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
    failureThreshold: number;
    successThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
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
export declare class GitHubClient {
    private octokit;
    readonly owner: string;
    readonly repo: string;
    private retryConfig;
    private circuitBreakerConfig;
    private circuitState;
    private consecutiveFailures;
    private consecutiveSuccesses;
    private lastFailureTime;
    private lastSuccessTime;
    private lastErrorMessage;
    private halfOpenAttempts;
    private rateLimitRemaining;
    private rateLimitResetAt;
    constructor(options: GitHubClientOptions);
    get client(): Octokit;
    /**
     * Get the current service health status
     */
    getServiceHealth(): ServiceHealth;
    /**
     * Check if the circuit breaker allows requests
     */
    private canMakeRequest;
    /**
     * Record a successful request
     */
    private recordSuccess;
    /**
     * Record a failed request
     */
    private recordFailure;
    /**
     * Check if an error is due to rate limiting and update rate limit state
     */
    private updateRateLimitState;
    /**
     * Execute a GitHub API request with automatic retry for transient failures
     * Integrates with circuit breaker for graceful degradation
     */
    private executeWithRetry;
    /**
     * Extract HTTP method from endpoint string
     */
    private extractMethodFromEndpoint;
    /**
     * Execute a GitHub API request with graceful degradation support.
     * Returns the fallback value if the circuit breaker is open or all retries fail.
     */
    executeWithFallback<T>(operation: () => Promise<T>, fallback: T, endpoint: string, context?: ErrorContext): Promise<{
        value: T;
        degraded: boolean;
    }>;
    /**
     * Check if the GitHub API is currently available
     */
    isAvailable(): boolean;
    /**
     * Reset the circuit breaker state (for testing or manual recovery)
     */
    resetCircuitBreaker(): void;
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