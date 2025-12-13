import type { CodebaseAnalysis, TodoComment, PackageInfo } from './analyzer.js';
/**
 * Configuration options for the analysis cache
 */
export interface CacheConfig {
    /** Whether caching is enabled (default: true) */
    enabled?: boolean;
    /** Directory to store cache files (default: .autonomous-dev-cache) */
    cacheDir?: string;
    /** Maximum age of cache in milliseconds before forced refresh (default: 1 hour) */
    maxAgeMs?: number;
    /** Whether to use git-based invalidation (default: true) */
    useGitInvalidation?: boolean;
}
/**
 * Result of cache validation check
 */
export interface CacheValidationResult {
    valid: boolean;
    reason?: string;
    changedFiles?: string[];
}
/**
 * AnalysisCache handles file-based caching of codebase analysis results.
 *
 * Features:
 * - Git SHA-based cache invalidation
 * - File modification time tracking
 * - Checksum verification for external changes
 * - Incremental updates for changed files only
 * - Graceful fallback on cache corruption
 */
export declare class AnalysisCache {
    private repoPath;
    private cacheDir;
    private maxAgeMs;
    private useGitInvalidation;
    private enabled;
    constructor(repoPath: string, config?: CacheConfig);
    /**
     * Get the path to the cache file
     */
    private getCachePath;
    /**
     * Ensure the cache directory exists
     */
    private ensureCacheDir;
    /**
     * Get the current git HEAD SHA
     */
    private getGitSha;
    /**
     * Get list of files changed since a specific commit
     */
    private getChangedFilesSince;
    /**
     * Calculate MD5 checksum of a file
     */
    private calculateChecksum;
    /**
     * Build file metadata for a list of files
     */
    private buildFileChecksums;
    /**
     * Get all tracked files in the repository
     */
    private getTrackedFiles;
    /**
     * Check if a path should be excluded
     */
    private shouldExclude;
    /**
     * Load the cache entry from disk
     */
    private loadCache;
    /**
     * Save analysis results to cache
     */
    saveCache(analysis: CodebaseAnalysis, excludePaths: string[], analyzerConfig: {
        maxDepth: number;
        maxFiles: number;
    }): void;
    /**
     * Validate the cache and determine if it's still valid
     */
    validateCache(excludePaths: string[], analyzerConfig: {
        maxDepth: number;
        maxFiles: number;
    }): CacheValidationResult;
    /**
     * Get cached analysis if valid, otherwise return null
     */
    getCachedAnalysis(excludePaths: string[], analyzerConfig: {
        maxDepth: number;
        maxFiles: number;
    }): CodebaseAnalysis | null;
    /**
     * Perform incremental update of cached analysis for changed files only.
     * This is more efficient than full re-analysis when only a few files changed.
     */
    getIncrementalUpdate(changedFiles: string[], fullAnalyze: () => Promise<{
        todos: TodoComment[];
        packages: PackageInfo[];
    }>): Promise<{
        todos: TodoComment[];
        packages: PackageInfo[];
    }> | null;
    /**
     * Invalidate the cache (force next analysis to be fresh)
     */
    invalidate(): void;
    /**
     * Get cache statistics for monitoring
     */
    getStats(): {
        exists: boolean;
        age: number | null;
        fileCount: number | null;
        gitSha: string | null;
    };
}
/**
 * Create an analysis cache instance with default configuration
 */
export declare function createAnalysisCache(repoPath: string, config?: CacheConfig): AnalysisCache;
//# sourceMappingURL=cache.d.ts.map