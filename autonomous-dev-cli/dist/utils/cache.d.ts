/**
 * Cache Utilities for Codebase Analysis
 *
 * Provides shared utilities for cache management:
 * - File modification tracking
 * - Git-based change detection
 * - Cache key generation
 * - Performance metrics helpers
 * - Configuration-based invalidation
 */
/**
 * Generate a deterministic cache key from components
 */
export declare function generateCacheKey(...components: (string | number | boolean | object | undefined | null)[]): string;
/**
 * Generate a short cache key (16 chars) for display purposes
 */
export declare function generateShortCacheKey(...components: (string | number | boolean | object | undefined | null)[]): string;
/**
 * File modification info for cache invalidation
 */
export interface FileModificationInfo {
    path: string;
    mtimeMs: number;
    size: number;
}
/**
 * Options for collecting file modifications
 */
export interface CollectModificationsOptions {
    maxFiles?: number;
    maxDepth?: number;
    ignoreDirs?: Set<string>;
}
/**
 * Collect file modification info for a directory tree
 */
export declare function collectFileModifications(rootPath: string, options?: CollectModificationsOptions): Promise<FileModificationInfo[]>;
/**
 * Generate a content hash from file modifications
 */
export declare function generateContentHashFromModifications(modifications: FileModificationInfo[]): string;
/**
 * Git change detection result
 */
export interface GitChangeInfo {
    currentCommitHash: string;
    changedFiles: string[];
    hasChanges: boolean;
    branch: string;
}
/**
 * Get git change information between commits or from working directory
 */
export declare function getGitChangeInfo(repoPath: string, fromCommit?: string): Promise<GitChangeInfo | null>;
/**
 * Check if specific files have changed since a commit
 */
export declare function haveFilesChangedSinceCommit(repoPath: string, fromCommit: string, filePaths: string[]): Promise<boolean>;
/**
 * Cache performance metrics
 */
export interface CachePerformanceMetrics {
    hitRate: number;
    missRate: number;
    averageAccessTimeMs: number;
    totalLookups: number;
    totalHits: number;
    totalMisses: number;
    evictions: number;
    invalidations: number;
    sizeBytes: number;
    entryCount: number;
}
/**
 * Calculate cache hit rate
 */
export declare function calculateHitRate(hits: number, misses: number): number;
/**
 * Format cache metrics for logging
 */
export declare function formatCacheMetrics(metrics: CachePerformanceMetrics): string;
/**
 * Format bytes to human readable string
 */
export declare function formatBytes(bytes: number): string;
/**
 * Configuration hash for cache invalidation
 */
export interface ConfigHash {
    hash: string;
    version: number;
    timestamp: number;
}
/**
 * Generate a configuration hash for cache invalidation
 * This ensures cache is invalidated when configuration changes
 */
export declare function generateConfigHash(config: object, version?: number): ConfigHash;
/**
 * Check if configuration has changed since last cache
 */
export declare function hasConfigChanged(currentConfig: object, cachedConfigHash: string | undefined): boolean;
/**
 * Cache cleanup policy
 */
export interface CacheCleanupPolicy {
    maxAgeMs: number;
    maxEntries: number;
    maxSizeBytes: number;
}
/**
 * Cache entry for cleanup evaluation
 */
export interface CleanupCacheEntry {
    key: string;
    timestamp: number;
    sizeBytes: number;
    lastAccessTime: number;
    accessCount: number;
}
/**
 * Determine which entries should be cleaned up based on policy
 */
export declare function getEntriesToCleanup(entries: CleanupCacheEntry[], policy: CacheCleanupPolicy): string[];
/**
 * Cache operation types for logging
 */
export type CacheOperation = 'lookup' | 'hit' | 'miss' | 'set' | 'invalidate' | 'evict' | 'cleanup' | 'warm' | 'incremental-update';
/**
 * Log a cache operation with detailed context
 */
export declare function logCacheOperation(operation: CacheOperation, details: {
    key?: string;
    repoPath?: string;
    duration?: number;
    reason?: string;
    stats?: Partial<CachePerformanceMetrics>;
    changedFiles?: number;
    [key: string]: unknown;
}): void;
/**
 * Log cache performance summary
 */
export declare function logCachePerformanceSummary(cacheName: string, metrics: CachePerformanceMetrics): void;
//# sourceMappingURL=cache.d.ts.map