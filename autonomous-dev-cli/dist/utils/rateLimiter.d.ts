/**
 * GitHub API Rate Limiter Utility
 *
 * Provides intelligent rate limiting for GitHub API operations:
 * - Tracks rate limit status from API response headers
 * - Queues requests during rate limit periods with exponential backoff
 * - Supports multiple rate limit resources (core, search, graphql)
 * - Handles enterprise GitHub instances with stricter limits
 * - Provides batch operation support to reduce total API calls
 */
/**
 * Rate limit status for a specific GitHub API resource
 */
export interface RateLimitResource {
    /** Name of the resource (core, search, graphql, etc.) */
    name: string;
    /** Total request limit for the current window */
    limit: number;
    /** Remaining requests in current window */
    remaining: number;
    /** When the rate limit resets (Unix timestamp in seconds) */
    resetAt: number;
    /** Number of requests used in current window */
    used: number;
    /** Whether currently rate limited */
    isLimited: boolean;
    /** Last updated timestamp */
    lastUpdated: number;
}
/**
 * Combined rate limit status for all resources
 */
export interface RateLimitStatus {
    /** Core API rate limit (most common) */
    core: RateLimitResource;
    /** Search API rate limit (more restrictive) */
    search: RateLimitResource;
    /** GraphQL API rate limit */
    graphql: RateLimitResource;
    /** Whether any resource is currently rate limited */
    isAnyLimited: boolean;
    /** Delay in ms until next request is allowed */
    requiredDelayMs: number;
}
/**
 * Configuration for the rate limiter
 */
export interface RateLimiterConfig {
    /** Threshold (remaining requests) at which to start throttling (default: 100) */
    throttleThreshold: number;
    /** Maximum number of requests to queue before rejecting (default: 100) */
    maxQueueSize: number;
    /** Maximum time to wait in queue in milliseconds (default: 300000 = 5 minutes) */
    maxQueueWaitMs: number;
    /** Minimum delay between requests in ms when throttling (default: 100) */
    minThrottleDelayMs: number;
    /** Whether to enable request batching (default: true) */
    enableBatching: boolean;
    /** Maximum batch size for combined requests (default: 10) */
    maxBatchSize: number;
    /** Delay before processing a batch in ms (default: 50) */
    batchDelayMs: number;
    /** Enterprise instance configuration (stricter limits) */
    enterprise?: {
        /** Whether this is an enterprise instance */
        enabled: boolean;
        /** Custom rate limit threshold for enterprise */
        throttleThreshold?: number;
        /** Custom max queue wait for enterprise */
        maxQueueWaitMs?: number;
    };
}
/**
 * Default rate limiter configuration
 */
export declare const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig;
/**
 * Enterprise rate limiter configuration (more conservative)
 */
export declare const ENTERPRISE_RATE_LIMITER_CONFIG: RateLimiterConfig;
/**
 * GitHub API Rate Limiter
 *
 * Manages rate limiting for GitHub API operations with:
 * - Automatic throttling based on remaining quota
 * - Request queuing during rate limit periods
 * - Exponential backoff for retries
 * - Support for multiple rate limit resources
 * - Batch operation support
 */
export declare class GitHubRateLimiter {
    private config;
    private resources;
    private requestQueue;
    private batches;
    private isProcessingQueue;
    private queueProcessorInterval;
    private requestCounter;
    private log;
    constructor(config?: Partial<RateLimiterConfig>);
    /**
     * Get current rate limit status
     */
    getStatus(): RateLimitStatus;
    /**
     * Get rate limit for a specific resource
     */
    getResourceLimit(resource: string): RateLimitResource;
    /**
     * Update rate limit status from GitHub API response headers
     */
    updateFromHeaders(headers: Record<string, string | undefined>): void;
    /**
     * Update rate limit status from error response
     */
    updateFromError(error: unknown): void;
    /**
     * Calculate delay needed before making a request
     */
    private calculateRequiredDelay;
    /**
     * Calculate delay for a specific resource
     */
    private calculateDelayForResource;
    /**
     * Check if we should throttle requests
     */
    shouldThrottle(resource?: string): boolean;
    /**
     * Wait for rate limit to reset if needed
     */
    waitForRateLimitReset(resource?: string): Promise<void>;
    /**
     * Execute a request with rate limiting awareness
     */
    execute<T>(operation: () => Promise<T>, options?: {
        resource?: string;
        priority?: number;
        skipQueue?: boolean;
    }): Promise<T>;
    /**
     * Enqueue a request to be executed when rate limit allows
     */
    private enqueueRequest;
    /**
     * Start the queue processor
     */
    private startQueueProcessor;
    /**
     * Stop the queue processor
     */
    private stopQueueProcessor;
    /**
     * Process queued requests
     */
    private processQueue;
    /**
     * Add a request to a batch for combined execution
     */
    addToBatch<T>(batchKey: string, operation: () => Promise<T>, resource?: string): Promise<T>;
    /**
     * Process a batch of requests
     */
    private processBatch;
    /**
     * Clear all queued requests
     */
    clearQueue(): void;
    /**
     * Get queue statistics
     */
    getQueueStats(): {
        size: number;
        isProcessing: boolean;
        oldestRequestAge: number | null;
        batchCount: number;
    };
    /**
     * Reset all rate limit state
     */
    reset(): void;
}
/**
 * Create a rate limiter instance
 */
export declare function createRateLimiter(config?: Partial<RateLimiterConfig>): GitHubRateLimiter;
/**
 * Create a rate limiter for enterprise GitHub instances
 */
export declare function createEnterpriseRateLimiter(): GitHubRateLimiter;
//# sourceMappingURL=rateLimiter.d.ts.map