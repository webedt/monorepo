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
import { logger } from './logger.js';
import { generateCacheKey, calculateHitRate, logCacheOperation, logCachePerformanceSummary, } from './cache.js';
/**
 * Default cache configuration
 */
export const DEFAULT_GITHUB_CACHE_CONFIG = {
    repoInfoTtlMs: 5 * 60 * 1000, // 5 minutes
    issueListTtlMs: 60 * 1000, // 1 minute
    issueTtlMs: 30 * 1000, // 30 seconds
    branchListTtlMs: 2 * 60 * 1000, // 2 minutes
    branchTtlMs: 60 * 1000, // 1 minute
    prListTtlMs: 60 * 1000, // 1 minute
    prTtlMs: 30 * 1000, // 30 seconds
    rateLimitTtlMs: 60 * 1000, // 1 minute
    maxEntries: 1000,
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    useConditionalRequests: true,
};
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
export class GitHubCache {
    config;
    cache = new Map();
    hits = 0;
    misses = 0;
    evictions = 0;
    conditionalHits = 0;
    hitsByType = new Map();
    missesByType = new Map();
    log = logger.child('GitHubCache');
    constructor(config = {}) {
        this.config = { ...DEFAULT_GITHUB_CACHE_CONFIG, ...config };
        this.log.debug('GitHub cache initialized', { config: this.config });
    }
    /**
     * Generate a cache key for a GitHub resource
     */
    generateKey(type, owner, repo, ...parts) {
        return generateCacheKey('github', type, owner, repo, ...parts.filter(p => p !== undefined));
    }
    /**
     * Get TTL for a cache key type
     */
    getTtl(type) {
        switch (type) {
            case 'repo-info':
                return this.config.repoInfoTtlMs;
            case 'issue-list':
                return this.config.issueListTtlMs;
            case 'issue':
                return this.config.issueTtlMs;
            case 'branch-list':
                return this.config.branchListTtlMs;
            case 'branch':
            case 'branch-protection':
                return this.config.branchTtlMs;
            case 'pr-list':
                return this.config.prListTtlMs;
            case 'pr':
                return this.config.prTtlMs;
            case 'rate-limit':
                return this.config.rateLimitTtlMs;
            case 'user':
                return this.config.repoInfoTtlMs;
            case 'codeowners':
            case 'pr-template':
                return this.config.repoInfoTtlMs;
            default:
                return this.config.issueTtlMs;
        }
    }
    /**
     * Get a value from cache
     */
    get(key, type) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            this.missesByType.set(type, (this.missesByType.get(type) ?? 0) + 1);
            logCacheOperation('miss', { key: key.substring(0, 16), type });
            return undefined;
        }
        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.misses++;
            this.missesByType.set(type, (this.missesByType.get(type) ?? 0) + 1);
            logCacheOperation('miss', { key: key.substring(0, 16), type, reason: 'expired' });
            return undefined;
        }
        // Update access stats
        entry.accessCount++;
        entry.lastAccessedAt = Date.now();
        this.hits++;
        this.hitsByType.set(type, (this.hitsByType.get(type) ?? 0) + 1);
        logCacheOperation('hit', { key: key.substring(0, 16), type });
        return entry.data;
    }
    /**
     * Set a value in cache
     */
    set(key, type, data, options) {
        // Ensure we have space
        this.ensureCapacity();
        const ttl = options?.customTtlMs ?? this.getTtl(type);
        const now = Date.now();
        const entry = {
            data,
            createdAt: now,
            expiresAt: now + ttl,
            accessCount: 1,
            lastAccessedAt: now,
            etag: options?.etag,
            lastModified: options?.lastModified,
        };
        this.cache.set(key, entry);
        logCacheOperation('set', { key: key.substring(0, 16), type, ttlMs: ttl });
    }
    /**
     * Check if a key exists and is not expired
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * Get conditional request headers for a cached entry
     */
    getConditionalHeaders(key) {
        if (!this.config.useConditionalRequests)
            return undefined;
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        const headers = {};
        if (entry.etag) {
            headers['If-None-Match'] = entry.etag;
        }
        if (entry.lastModified) {
            headers['If-Modified-Since'] = entry.lastModified;
        }
        return Object.keys(headers).length > 0 ? headers : undefined;
    }
    /**
     * Handle a 304 Not Modified response - revalidate cache entry
     */
    revalidate(key, type) {
        const entry = this.cache.get(key);
        if (entry) {
            const ttl = this.getTtl(type);
            entry.expiresAt = Date.now() + ttl;
            entry.accessCount++;
            entry.lastAccessedAt = Date.now();
            this.conditionalHits++;
            logCacheOperation('hit', { key: key.substring(0, 16), type, conditional: true });
        }
    }
    /**
     * Invalidate a specific cache entry
     */
    invalidate(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            logCacheOperation('invalidate', { key: key.substring(0, 16) });
        }
        return deleted;
    }
    /**
     * Invalidate all entries matching a pattern
     */
    invalidatePattern(pattern) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        let count = 0;
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                count++;
            }
        }
        if (count > 0) {
            logCacheOperation('invalidate', { pattern: pattern.toString(), count });
        }
        return count;
    }
    /**
     * Invalidate all entries for a specific repository
     */
    invalidateRepo(owner, repo) {
        const prefix = generateCacheKey('github', '', owner, repo).substring(0, 24);
        return this.invalidatePattern(new RegExp(`^${prefix}`));
    }
    /**
     * Invalidate all entries of a specific type for a repository
     */
    invalidateType(type, owner, repo) {
        const prefix = generateCacheKey('github', type, owner, repo).substring(0, 24);
        return this.invalidatePattern(new RegExp(`^${prefix}`));
    }
    /**
     * Ensure cache has capacity for new entries
     */
    ensureCapacity() {
        // Check entry count
        while (this.cache.size >= this.config.maxEntries) {
            this.evictLRU();
        }
        // Check size (estimate)
        const estimatedSize = this.estimateSize();
        while (estimatedSize > this.config.maxSizeBytes && this.cache.size > 0) {
            this.evictLRU();
        }
    }
    /**
     * Evict least recently used entry
     */
    evictLRU() {
        let oldestKey;
        let oldestAccess = Infinity;
        for (const [key, entry] of this.cache) {
            if (entry.lastAccessedAt < oldestAccess) {
                oldestAccess = entry.lastAccessedAt;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.evictions++;
            logCacheOperation('evict', { key: oldestKey.substring(0, 16) });
        }
    }
    /**
     * Estimate cache size in bytes
     */
    estimateSize() {
        let size = 0;
        for (const [key, entry] of this.cache) {
            // Rough estimate: key length + JSON stringified data length + metadata overhead
            size += key.length * 2; // UTF-16
            size += JSON.stringify(entry.data).length * 2;
            size += 100; // Metadata overhead
        }
        return size;
    }
    /**
     * Clean up expired entries
     */
    cleanup() {
        const now = Date.now();
        let count = 0;
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                count++;
            }
        }
        if (count > 0) {
            logCacheOperation('cleanup', { removedCount: count });
        }
        return count;
    }
    /**
     * Clear all cache entries
     */
    clear() {
        const count = this.cache.size;
        this.cache.clear();
        this.log.info(`Cleared ${count} cache entries`);
    }
    /**
     * Get cache statistics
     */
    getStats() {
        const byType = {};
        const types = [
            'repo-info', 'issue-list', 'issue', 'branch-list', 'branch',
            'branch-protection', 'pr-list', 'pr', 'rate-limit', 'user',
            'codeowners', 'pr-template'
        ];
        for (const type of types) {
            byType[type] = {
                entries: 0,
                hits: this.hitsByType.get(type) ?? 0,
                misses: this.missesByType.get(type) ?? 0,
            };
        }
        return {
            totalEntries: this.cache.size,
            totalSizeBytes: this.estimateSize(),
            hits: this.hits,
            misses: this.misses,
            hitRate: calculateHitRate(this.hits, this.misses),
            evictions: this.evictions,
            conditionalHits: this.conditionalHits,
            byType,
        };
    }
    /**
     * Get performance metrics compatible with cache utilities
     */
    getPerformanceMetrics() {
        const stats = this.getStats();
        return {
            hitRate: stats.hitRate,
            missRate: 1 - stats.hitRate,
            averageAccessTimeMs: 0.1, // In-memory cache is fast
            totalLookups: stats.hits + stats.misses,
            totalHits: stats.hits,
            totalMisses: stats.misses,
            evictions: stats.evictions,
            invalidations: 0,
            sizeBytes: stats.totalSizeBytes,
            entryCount: stats.totalEntries,
        };
    }
    /**
     * Log performance summary
     */
    logPerformanceSummary() {
        logCachePerformanceSummary('GitHubCache', this.getPerformanceMetrics());
    }
    /**
     * Get or fetch a value with caching
     */
    async getOrFetch(key, type, fetcher) {
        // Check cache first
        const cached = this.get(key, type);
        if (cached !== undefined) {
            return cached;
        }
        // Get conditional headers for potential 304 response
        const conditionalHeaders = this.getConditionalHeaders(key);
        // Fetch from API
        const result = await fetcher(conditionalHeaders);
        // Handle 304 Not Modified
        if (result.notModified) {
            this.revalidate(key, type);
            const revalidated = this.get(key, type);
            if (revalidated !== undefined) {
                return revalidated;
            }
        }
        // Cache the new data
        this.set(key, type, result.data, {
            etag: result.headers?.etag ?? result.headers?.ETag,
            lastModified: result.headers?.['last-modified'] ?? result.headers?.['Last-Modified'],
        });
        return result.data;
    }
    /**
     * Warm the cache with frequently accessed data
     */
    async warm(entries) {
        let success = 0;
        let failed = 0;
        for (const entry of entries) {
            try {
                const data = await entry.fetcher();
                this.set(entry.key, entry.type, data);
                success++;
            }
            catch (error) {
                this.log.warn('Failed to warm cache entry', {
                    key: entry.key.substring(0, 16),
                    type: entry.type,
                    error: error.message,
                });
                failed++;
            }
        }
        logCacheOperation('warm', { success, failed });
        return { success, failed };
    }
}
/**
 * Create a GitHub cache instance
 */
export function createGitHubCache(config = {}) {
    return new GitHubCache(config);
}
// Singleton instance for shared caching
let sharedCache = null;
/**
 * Get the shared GitHub cache instance
 */
export function getSharedGitHubCache() {
    if (!sharedCache) {
        sharedCache = new GitHubCache();
    }
    return sharedCache;
}
/**
 * Reset the shared cache (useful for testing)
 */
export function resetSharedGitHubCache() {
    if (sharedCache) {
        sharedCache.clear();
        sharedCache = null;
    }
}
//# sourceMappingURL=githubCache.js.map