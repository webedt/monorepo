/**
 * GitHub API Manager
 *
 * Centralized manager for coordinating all GitHub API operations with:
 * - Exponential backoff with jitter for all API calls
 * - Rate limit header parsing and adaptive throttling
 * - Request queuing to prevent burst limit violations
 * - Automatic retry logic for transient failures
 * - Graceful degradation during rate limit periods
 * - Unified health monitoring and status reporting
 */
import { GitHubClient, type GitHubClientOptions, type ServiceHealth, type RateLimitState } from './client.js';
import { type PRManager } from './pulls.js';
import { type IssueManager } from './issues.js';
import { type BranchManager } from './branches.js';
import { type ChecksManager } from './checks.js';
import { type RateLimitStatus, type RateLimiterConfig } from '../utils/rateLimiter.js';
/**
 * Configuration for the GitHub API Manager
 */
export interface GitHubManagerConfig extends GitHubClientOptions {
    /** Configuration for rate limiting behavior */
    rateLimiter?: Partial<RateLimiterConfig>;
    /** Whether to enable request queuing (default: true) */
    enableQueuing?: boolean;
    /** Maximum concurrent requests (default: 10) */
    maxConcurrentRequests?: number;
    /** Enable adaptive throttling based on rate limit state (default: true) */
    adaptiveThrottling?: boolean;
    /** Threshold (percentage of limit remaining) to start throttling (default: 0.2 = 20%) */
    throttleThresholdPercent?: number;
}
/**
 * Operation priority levels for queue ordering
 */
export declare enum OperationPriority {
    /** Critical operations that should be processed first */
    CRITICAL = 100,
    /** High priority operations (e.g., merges, PR creation) */
    HIGH = 75,
    /** Normal priority operations (default) */
    NORMAL = 50,
    /** Low priority operations (e.g., listing, fetching) */
    LOW = 25,
    /** Background operations that can wait */
    BACKGROUND = 0
}
/**
 * Request statistics for monitoring
 */
export interface RequestStats {
    /** Total requests made */
    totalRequests: number;
    /** Successful requests */
    successfulRequests: number;
    /** Failed requests */
    failedRequests: number;
    /** Requests that were rate limited */
    rateLimitedRequests: number;
    /** Requests that were retried */
    retriedRequests: number;
    /** Requests currently in queue */
    queuedRequests: number;
    /** Average response time in ms */
    averageResponseTimeMs: number;
    /** Last request timestamp */
    lastRequestAt: Date | null;
}
/**
 * Manager health status
 */
export interface ManagerHealth {
    /** Overall health status */
    status: 'healthy' | 'degraded' | 'unavailable';
    /** Client health */
    clientHealth: ServiceHealth;
    /** Rate limit status */
    rateLimitStatus: RateLimitStatus;
    /** Request statistics */
    requestStats: RequestStats;
    /** Number of operations in queue */
    queueSize: number;
    /** Whether rate limiting is active */
    isThrottling: boolean;
    /** Time until rate limit resets (ms) */
    rateLimitResetInMs: number;
}
/**
 * GitHub API Manager
 *
 * Provides unified access to all GitHub API operations with:
 * - Centralized rate limiting and request queuing
 * - Automatic retry with exponential backoff
 * - Graceful degradation during outages
 * - Comprehensive health monitoring
 */
export declare class GitHubManager {
    readonly client: GitHubClient;
    readonly pulls: PRManager;
    readonly issues: IssueManager;
    readonly branches: BranchManager;
    readonly checks: ChecksManager;
    private readonly config;
    private readonly rateLimiter;
    private readonly log;
    private operationQueue;
    private isProcessingQueue;
    private queueProcessorInterval;
    private operationCounter;
    private activeRequests;
    private stats;
    private totalResponseTimeMs;
    constructor(config: GitHubManagerConfig);
    /**
     * Get comprehensive health status
     */
    getHealth(): ManagerHealth;
    /**
     * Check if rate limiting is currently active
     */
    isThrottling(): boolean;
    /**
     * Check if the service is available
     */
    isAvailable(): boolean;
    /**
     * Get current rate limit state
     */
    getRateLimitState(): RateLimitState;
    /**
     * Get rate limit status
     */
    getRateLimitStatus(): RateLimitStatus;
    /**
     * Get request statistics
     */
    getStats(): RequestStats;
    /**
     * Execute an operation with full rate limiting, retry, and queuing support
     */
    execute<T>(operation: () => Promise<T>, options?: {
        description?: string;
        priority?: OperationPriority;
        resource?: string;
        skipQueue?: boolean;
        maxRetries?: number;
    }): Promise<T>;
    /**
     * Execute an operation with fallback for graceful degradation
     */
    executeWithFallback<T>(operation: () => Promise<T>, fallback: T, options?: {
        description?: string;
        priority?: OperationPriority;
        resource?: string;
    }): Promise<{
        value: T;
        degraded: boolean;
    }>;
    /**
     * Enqueue an operation for later execution
     */
    private enqueueOperation;
    /**
     * Start the queue processor
     */
    private startQueueProcessor;
    /**
     * Stop the queue processor
     */
    private stopQueueProcessor;
    /**
     * Process queued operations
     */
    private processQueue;
    /**
     * Record response time for statistics
     */
    private recordResponseTime;
    /**
     * Clear the operation queue
     */
    clearQueue(): void;
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Wait for rate limit to reset
     */
    waitForRateLimitReset(): Promise<void>;
    /**
     * Verify authentication
     */
    verifyAuth(): Promise<{
        login: string;
        name: string;
    }>;
    /**
     * Get repository information
     */
    getRepo(): Promise<{
        defaultBranch: string;
        fullName: string;
        private: boolean;
    }>;
    /**
     * Get rate limit from API
     */
    getRateLimit(): Promise<{
        limit: number;
        remaining: number;
        resetAt: Date;
    }>;
    /**
     * Invalidate cache
     */
    invalidateCache(): number;
    /**
     * Get cache statistics
     */
    getCacheStats(): import("../utils/githubCache.js").GitHubCacheStats;
    /**
     * Shutdown the manager, clearing queues and stopping processors
     */
    shutdown(): void;
}
/**
 * Create a GitHubManager instance
 */
export declare function createGitHubManager(config: GitHubManagerConfig): GitHubManager;
//# sourceMappingURL=manager.d.ts.map