/**
 * GitHub API Cache Utility
 *
 * Provides caching for frequently accessed GitHub API data:
 * - Repository information (default branch, visibility, etc.)
 * - Issue lists with pagination support
 * - Branch information and protection rules
 * - PR lists and details
 * - Rate limit-aware cache invalidation
 * - TTL-based expiration with configurable durations
 */
import { type CachePerformanceMetrics } from './cache.js';
/**
 * Cache configuration for different data types
 */
export interface GitHubCacheConfig {
    /** TTL for repository info in ms (default: 5 minutes) */
    repoInfoTtlMs: number;
    /** TTL for issue lists in ms (default: 1 minute) */
    issueListTtlMs: number;
    /** TTL for individual issues in ms (default: 30 seconds) */
    issueTtlMs: number;
    /** TTL for branch lists in ms (default: 2 minutes) */
    branchListTtlMs: number;
    /** TTL for individual branches in ms (default: 1 minute) */
    branchTtlMs: number;
    /** TTL for PR lists in ms (default: 1 minute) */
    prListTtlMs: number;
    /** TTL for individual PRs in ms (default: 30 seconds) */
    prTtlMs: number;
    /** TTL for rate limit info in ms (default: 1 minute) */
    rateLimitTtlMs: number;
    /** Maximum number of cache entries (default: 1000) */
    maxEntries: number;
    /** Maximum cache size in bytes (default: 10MB) */
    maxSizeBytes: number;
    /** Whether to use conditional requests with ETags (default: true) */
    useConditionalRequests: boolean;
}
/**
 * Default cache configuration
 */
export declare const DEFAULT_GITHUB_CACHE_CONFIG: GitHubCacheConfig;
/**
 * Cache key types for different GitHub resources
 */
export type CacheKeyType = 'repo-info' | 'issue-list' | 'issue' | 'branch-list' | 'branch' | 'branch-protection' | 'pr-list' | 'pr' | 'rate-limit' | 'user' | 'codeowners' | 'pr-template';
/**
 * Conditional request headers for cache validation
 */
export interface ConditionalHeaders {
    'If-None-Match'?: string;
    'If-Modified-Since'?: string;
}
/**
 * Cache statistics
 */
export interface GitHubCacheStats {
    totalEntries: number;
    totalSizeBytes: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    conditionalHits: number;
    byType: Record<CacheKeyType, {
        entries: number;
        hits: number;
        misses: number;
    }>;
}
/**
 * GitHub API Cache
 *
 * Provides intelligent caching for GitHub API responses with:
 * - Type-specific TTLs for different resources
 * - Conditional request support (ETags)
 * - LRU eviction policy
 * - Memory-aware size limits
 * - Cache warming support
 */
export declare class GitHubCache {
    private config;
    private cache;
    private hits;
    private misses;
    private evictions;
    private conditionalHits;
    private hitsByType;
    private missesByType;
    private log;
    constructor(config?: Partial<GitHubCacheConfig>);
    /**
     * Generate a cache key for a GitHub resource
     */
    generateKey(type: CacheKeyType, owner: string, repo: string, ...parts: (string | number | undefined)[]): string;
    /**
     * Get TTL for a cache key type
     */
    private getTtl;
    /**
     * Get a value from cache
     */
    get<T>(key: string, type: CacheKeyType): T | undefined;
    /**
     * Set a value in cache
     */
    set<T>(key: string, type: CacheKeyType, data: T, options?: {
        etag?: string;
        lastModified?: string;
        customTtlMs?: number;
    }): void;
    /**
     * Check if a key exists and is not expired
     */
    has(key: string): boolean;
    /**
     * Get conditional request headers for a cached entry
     */
    getConditionalHeaders(key: string): ConditionalHeaders | undefined;
    /**
     * Handle a 304 Not Modified response - revalidate cache entry
     */
    revalidate(key: string, type: CacheKeyType): void;
    /**
     * Invalidate a specific cache entry
     */
    invalidate(key: string): boolean;
    /**
     * Invalidate all entries matching a pattern
     */
    invalidatePattern(pattern: string | RegExp): number;
    /**
     * Invalidate all entries for a specific repository
     */
    invalidateRepo(owner: string, repo: string): number;
    /**
     * Invalidate all entries of a specific type for a repository
     */
    invalidateType(type: CacheKeyType, owner: string, repo: string): number;
    /**
     * Ensure cache has capacity for new entries
     */
    private ensureCapacity;
    /**
     * Evict least recently used entry
     */
    private evictLRU;
    /**
     * Estimate cache size in bytes
     */
    private estimateSize;
    /**
     * Clean up expired entries
     */
    cleanup(): number;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    getStats(): GitHubCacheStats;
    /**
     * Get performance metrics compatible with cache utilities
     */
    getPerformanceMetrics(): CachePerformanceMetrics;
    /**
     * Log performance summary
     */
    logPerformanceSummary(): void;
    /**
     * Get or fetch a value with caching
     */
    getOrFetch<T>(key: string, type: CacheKeyType, fetcher: (conditionalHeaders?: ConditionalHeaders) => Promise<{
        data: T;
        headers?: Record<string, string>;
        notModified?: boolean;
    }>): Promise<T>;
    /**
     * Warm the cache with frequently accessed data
     */
    warm(entries: Array<{
        key: string;
        type: CacheKeyType;
        fetcher: () => Promise<unknown>;
    }>): Promise<{
        success: number;
        failed: number;
    }>;
}
/**
 * Create a GitHub cache instance
 */
export declare function createGitHubCache(config?: Partial<GitHubCacheConfig>): GitHubCache;
/**
 * Get the shared GitHub cache instance
 */
export declare function getSharedGitHubCache(): GitHubCache;
/**
 * Reset the shared cache (useful for testing)
 */
export declare function resetSharedGitHubCache(): void;
//# sourceMappingURL=githubCache.d.ts.map