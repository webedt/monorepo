import { Octokit } from '@octokit/rest';
import { type RetryConfig, type ErrorContext } from '../utils/errors.js';
import { GitHubRateLimiter, type RateLimiterConfig, type RateLimitStatus } from '../utils/rateLimiter.js';
import { GitHubCache, type GitHubCacheConfig, type CacheKeyType } from '../utils/githubCache.js';
export interface GitHubClientOptions {
    token: string;
    owner: string;
    repo: string;
    retryConfig?: Partial<RetryConfig>;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
    /** Timeout for individual API calls in milliseconds (default: 30000) */
    requestTimeoutMs?: number;
    /** Configuration for rate limit handling */
    rateLimitConfig?: Partial<RateLimitConfig>;
    /** Configuration for the enhanced rate limiter */
    rateLimiterConfig?: Partial<RateLimiterConfig>;
    /** Configuration for GitHub API caching */
    cacheConfig?: Partial<GitHubCacheConfig>;
    /** Whether this is a GitHub Enterprise instance (enables stricter rate limiting) */
    isEnterprise?: boolean;
    /** Custom base URL for GitHub Enterprise instances */
    baseUrl?: string;
}
/**
 * Configuration options for rate limit handling
 */
export interface RateLimitConfig {
    /** Threshold (remaining requests) at which to start queuing requests (default: 100) */
    queueThreshold: number;
    /** Maximum number of requests to queue before rejecting (default: 50) */
    maxQueueSize: number;
    /** Maximum time to wait in queue in milliseconds (default: 120000 = 2 minutes) */
    maxQueueWaitMs: number;
    /** Whether to preemptively wait when approaching rate limit (default: true) */
    preemptiveWait: boolean;
    /** Log rate limit status at debug level on every request (default: true) */
    logRateLimitStatus: boolean;
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
    /** Number of requests currently queued due to rate limiting */
    queuedRequests?: number;
}
export declare class GitHubClient {
    private octokit;
    readonly owner: string;
    readonly repo: string;
    private retryConfig;
    private circuitBreakerConfig;
    private rateLimitConfig;
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
    private requestQueue;
    private isProcessingQueue;
    private queueProcessorInterval;
    private rateLimiter;
    private cache;
    private isEnterprise;
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
     * Get the current queue status
     */
    getQueueStatus(): {
        size: number;
        isProcessing: boolean;
        config: RateLimitConfig;
    };
    /**
     * Get the enhanced rate limiter instance
     */
    getRateLimiter(): GitHubRateLimiter;
    /**
     * Get the enhanced rate limit status from the rate limiter
     */
    getEnhancedRateLimitStatus(): RateLimitStatus;
    /**
     * Get the cache instance
     */
    getCache(): GitHubCache;
    /**
     * Get cache statistics
     */
    getCacheStats(): import("../utils/githubCache.js").GitHubCacheStats;
    /**
     * Invalidate all cached data for this repository
     */
    invalidateCache(): number;
    /**
     * Invalidate cached data of a specific type
     */
    invalidateCacheType(type: CacheKeyType): number;
    /**
     * Get a cached value or fetch it
     */
    getCachedOrFetch<T>(type: CacheKeyType, key: string, fetcher: () => Promise<T>, options?: {
        customTtlMs?: number;
    }): Promise<T>;
    /**
     * Clear the request queue (e.g., on shutdown)
     */
    clearQueue(): void;
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
     * Check if rate limit is approaching and requests should be queued
     */
    private shouldQueueRequest;
    /**
     * Add a request to the queue when rate limit is approaching
     */
    private enqueueRequest;
    /**
     * Start the queue processor if not already running
     */
    private startQueueProcessor;
    /**
     * Stop the queue processor
     */
    private stopQueueProcessor;
    /**
     * Process queued requests when rate limit allows
     */
    private processQueue;
    /**
     * Log rate limit status at debug level
     */
    private logRateLimitStatus;
    /**
     * Execute a GitHub API request with rate limit awareness
     * Routes requests through the queue when approaching rate limits
     */
    execute<T>(operation: () => Promise<T>, endpoint: string, context?: ErrorContext): Promise<T>;
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
     * Get repository info (cached)
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