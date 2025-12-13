import { Octokit } from '@octokit/rest';
import { type RetryConfig, type ErrorContext } from '../utils/errors.js';
export interface GitHubClientOptions {
    token: string;
    owner: string;
    repo: string;
    retryConfig?: Partial<RetryConfig>;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
    /** Timeout for individual API calls in milliseconds (default: 30000) */
    requestTimeoutMs?: number;
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
 * Rate limit state tracking
 */
export interface RateLimitState {
    /** Remaining requests in current window */
    remaining: number;
    /** Total limit for current window */
    limit: number;
    /** When the rate limit resets (Unix timestamp in seconds) */
    resetAt: number;
    /** Resource type (core, search, graphql, etc.) */
    resource: string;
    /** Whether currently rate limited */
    isLimited: boolean;
    /** Delay until rate limit resets in ms */
    retryAfterMs?: number;
}
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
    rateLimitState?: RateLimitState;
}
export declare class GitHubClient {
    private octokit;
    readonly owner: string;
    readonly repo: string;
    private retryConfig;
    private circuitBreakerConfig;
    private requestTimeoutMs;
    private circuitState;
    private consecutiveFailures;
    private consecutiveSuccesses;
    private lastFailureTime;
    private lastSuccessTime;
    private lastErrorMessage;
    private halfOpenAttempts;
    private rateLimitRemaining;
    private rateLimitResetAt;
    private rateLimitState;
    private log;
    constructor(options: GitHubClientOptions);
    get client(): Octokit;
    /**
     * Get the current service health status
     */
    getServiceHealth(): ServiceHealth;
    /**
     * Get the current rate limit state
     */
    getRateLimitState(): RateLimitState;
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
     * Update rate limit state from response headers
     */
    private updateRateLimitFromHeaders;
    /**
     * Check if an error is due to rate limiting and update rate limit state
     */
    private updateRateLimitState;
    /**
     * Get the delay needed before making a request (respects rate limits)
     */
    getRequiredDelay(): number;
    /**
     * Wait for rate limit if needed before making a request
     */
    waitForRateLimitReset(): Promise<void>;
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
    /**
     * Execute an operation with automatic rate limit backoff.
     * Waits for rate limit reset when receiving 429 status, using header-based timing.
     */
    executeWithRateLimitBackoff<T>(operation: () => Promise<T>, endpoint: string, context?: ErrorContext): Promise<T>;
    /**
     * Preemptively check rate limit and wait if running low.
     * Uses header-based timing from the last response.
     */
    preemptiveRateLimitCheck(): Promise<void>;
}
export declare function createGitHubClient(options: GitHubClientOptions): GitHubClient;
//# sourceMappingURL=client.d.ts.map