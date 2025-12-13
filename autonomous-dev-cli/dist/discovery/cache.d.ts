/**
 * Persistent Caching Layer for Codebase Analysis
 *
 * Provides intelligent caching with:
 * - Git commit hash invalidation for repository-level changes
 * - File modification time (mtime) tracking for file-level invalidation
 * - LRU eviction policy with configurable size limits
 * - File-based persistence for cache survival across daemon restarts
 * - Cache hit/miss metrics and logging
 * - Incremental analysis support for changed files only
 */
import type { CodebaseAnalysis, TodoComment } from './analyzer.js';
/**
 * Configuration for the persistent analysis cache
 */
export interface CacheConfig {
    /** Enable caching (default: true) */
    enabled: boolean;
    /** Maximum number of cache entries (default: 100) */
    maxEntries: number;
    /** Time-to-live in milliseconds (default: 30 minutes) */
    ttlMs: number;
    /** Maximum cache size in bytes (default: 100MB) */
    maxSizeBytes: number;
    /** Directory for cache files (default: .autonomous-dev-cache) */
    cacheDir: string;
    /** Enable persistent file-based caching (default: true) */
    persistToDisk: boolean;
    /** Enable git-based invalidation (default: true) */
    useGitInvalidation: boolean;
    /** Enable incremental analysis for changed files (default: true) */
    enableIncrementalAnalysis: boolean;
}
/**
 * Default cache configuration
 */
export declare const DEFAULT_CACHE_CONFIG: CacheConfig;
/**
 * Metadata about a cached file for incremental analysis
 */
export interface CachedFileInfo {
    path: string;
    mtimeMs: number;
    size: number;
    contentHash: string;
}
/**
 * File-level cache entry for incremental analysis
 */
export interface FileCacheEntry {
    fileInfo: CachedFileInfo;
    todos: TodoComment[];
    lastAnalyzed: number;
}
/**
 * Repository-level cache entry
 */
export interface RepoCacheEntry {
    /** Unique key for this cache entry */
    key: string;
    /** Repository path */
    repoPath: string;
    /** Git commit hash at time of caching */
    gitCommitHash: string;
    /** Git branch name */
    gitBranch: string;
    /** Timestamp when cached */
    timestamp: number;
    /** Content hash based on file mtimes */
    contentHash: string;
    /** Cached analysis data */
    data: CodebaseAnalysis;
    /** File-level cache for incremental updates */
    fileCache: Map<string, FileCacheEntry>;
    /** Size of serialized data in bytes */
    sizeBytes: number;
    /** Access count for LRU tracking */
    accessCount: number;
    /** Last access time for LRU tracking */
    lastAccessTime: number;
}
/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
    hits: number;
    misses: number;
    invalidations: number;
    evictions: number;
    persistWrites: number;
    persistReads: number;
    incrementalUpdates: number;
    totalEntries: number;
    totalSizeBytes: number;
    hitRate: number;
    averageAccessTime: number;
}
/**
 * Result of a cache lookup
 */
export interface CacheLookupResult {
    hit: boolean;
    data?: CodebaseAnalysis;
    changedFiles?: string[];
    requiresFullAnalysis: boolean;
    reason?: string;
}
/**
 * Advanced caching layer with persistence, git-based invalidation,
 * and incremental analysis support.
 */
export declare class PersistentAnalysisCache {
    private cache;
    private config;
    private stats;
    private accessTimeHistory;
    private initialized;
    constructor(config?: Partial<CacheConfig>);
    /**
     * Initialize the cache, loading persisted entries from disk
     */
    initialize(): Promise<void>;
    /**
     * Generate a unique cache key for a repository + configuration combination
     */
    generateKey(repoPath: string, excludePaths: string[], configHash?: string): string;
    /**
     * Get the current git commit hash for a repository
     */
    getGitCommitHash(repoPath: string): Promise<string | null>;
    /**
     * Get the current git branch name
     */
    getGitBranch(repoPath: string): Promise<string>;
    /**
     * Generate a content hash based on file modification times
     */
    generateContentHash(repoPath: string, maxSamples?: number): Promise<string>;
    /**
     * Get cached analysis if valid, with support for incremental updates
     */
    get(key: string, repoPath: string, currentCommitHash?: string): Promise<CacheLookupResult>;
    /**
     * Get list of files changed between two git commits
     */
    private getChangedFilesSinceCommit;
    /**
     * Store analysis in cache with automatic eviction if needed
     */
    set(key: string, repoPath: string, data: CodebaseAnalysis, excludePaths: string[]): Promise<void>;
    /**
     * Build file-level cache for incremental analysis
     */
    private buildFileCache;
    /**
     * Update analysis with incremental changes for specific files
     */
    updateIncremental(key: string, changedFiles: string[], updatedData: Partial<CodebaseAnalysis>): Promise<void>;
    /**
     * Evict entries if needed to stay within limits
     */
    private evictIfNeeded;
    /**
     * Evict the least recently used entry
     */
    private evictLRU;
    /**
     * Get total size of all cached entries
     */
    private getTotalSizeBytes;
    /**
     * Update access statistics for an entry
     */
    private updateAccessStats;
    /**
     * Record access time for performance metrics
     */
    private recordAccessTime;
    /**
     * Update overall statistics
     */
    private updateStats;
    /**
     * Get current cache statistics
     */
    getStats(): CacheStats;
    /**
     * Clear all cache entries
     */
    clear(): Promise<void>;
    /**
     * Invalidate entries for a specific repository
     */
    invalidate(repoPath: string): Promise<number>;
    /**
     * Warm the cache by pre-loading entries
     */
    warmCache(repoPaths: string[], excludePaths?: string[]): Promise<void>;
    /**
     * Get the cache directory path
     */
    private getCacheDir;
    /**
     * Get the file path for a cached entry
     */
    private getCacheFilePath;
    /**
     * Load cached entries from disk
     */
    private loadFromDisk;
    /**
     * Persist a cache entry to disk
     */
    private persistEntry;
    /**
     * Delete a persisted cache entry
     */
    private deletePersistedEntry;
    /**
     * Clear all persisted cache entries
     */
    private clearPersistedCache;
}
/**
 * Get the global persistent cache instance
 */
export declare function getPersistentCache(): PersistentAnalysisCache;
/**
 * Initialize the global persistent cache with custom configuration
 */
export declare function initPersistentCache(config?: Partial<CacheConfig>): Promise<PersistentAnalysisCache>;
/**
 * Reset the global persistent cache (mainly for testing)
 */
export declare function resetPersistentCache(): void;
//# sourceMappingURL=cache.d.ts.map