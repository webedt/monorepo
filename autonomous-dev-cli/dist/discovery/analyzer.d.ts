import { AnalyzerError } from '../utils/errors.js';
import { type CachePerformanceMetrics } from '../utils/cache.js';
import { PersistentAnalysisCache, type CacheConfig, type CacheStats as PersistentCacheStats } from './cache.js';
interface CacheStats {
    hits: number;
    misses: number;
    invalidations: number;
}
export declare class AnalysisCache {
    private cache;
    private stats;
    private maxEntries;
    private ttlMs;
    constructor(options?: {
        maxEntries?: number;
        ttlMs?: number;
    });
    /**
     * Generate a cache key from repository path and config
     */
    generateKey(repoPath: string, excludePaths: string[], config: AnalyzerConfig): string;
    /**
     * Generate a content hash based on file modification times
     * This allows for invalidation when files change
     */
    generateContentHash(repoPath: string, maxSamples?: number): Promise<string>;
    /**
     * Get cached analysis if valid
     */
    get(key: string, currentContentHash: string): CodebaseAnalysis | null;
    /**
     * Store analysis in cache
     */
    set(key: string, data: CodebaseAnalysis, contentHash: string): void;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Invalidate entries for a specific repository
     */
    invalidate(repoPath: string): void;
    /**
     * Get cache statistics
     */
    getStats(): CacheStats & {
        size: number;
        hitRate: number;
    };
}
export declare function getAnalysisCache(): AnalysisCache;
export declare function initAnalysisCache(options?: {
    maxEntries?: number;
    ttlMs?: number;
}): AnalysisCache;
export interface CodebaseAnalysis {
    structure: DirectoryEntry[];
    fileCount: number;
    todoComments: TodoComment[];
    recentChanges: string[];
    packages: PackageInfo[];
    configFiles: string[];
    gitAnalysis?: GitAnalysis;
}
export interface DirectoryEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: DirectoryEntry[];
}
export interface TodoComment {
    file: string;
    line: number;
    text: string;
    type: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
}
export interface PackageInfo {
    name: string;
    path: string;
    dependencies: string[];
    scripts: Record<string, string>;
}
/**
 * Information about a recent git commit
 */
export interface GitCommitInfo {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: Date;
    message: string;
    filesChanged: string[];
}
/**
 * File change statistics from git history
 */
export interface FileChangeStats {
    file: string;
    changeCount: number;
    lastModified: Date;
    authors: string[];
    impactScore: number;
}
/**
 * Dependency relationship between files
 */
export interface FileDependency {
    source: string;
    target: string;
    type: 'import' | 'require' | 'dynamic';
}
/**
 * Dependency graph for understanding file relationships
 */
export interface DependencyGraph {
    files: string[];
    dependencies: FileDependency[];
    entryPoints: string[];
    hotspots: string[];
}
/**
 * Complete git analysis results
 */
export interface GitAnalysis {
    recentCommits: GitCommitInfo[];
    fileChangeStats: FileChangeStats[];
    dependencyGraph: DependencyGraph;
    summary: {
        totalCommits: number;
        activeFiles: number;
        topContributors: string[];
        mostChangedFiles: string[];
    };
}
/**
 * Progress callback for reporting analysis progress
 */
export type ProgressCallback = (progress: AnalysisProgress) => void;
/**
 * Progress information during analysis
 */
export interface AnalysisProgress {
    phase: 'scanning' | 'analyzing-todos' | 'analyzing-packages' | 'analyzing-config' | 'analyzing-git' | 'complete';
    filesScanned: number;
    totalFiles?: number;
    currentFile?: string;
    percentComplete?: number;
}
/**
 * Configuration options for the analyzer
 */
export interface AnalyzerConfig {
    maxDepth?: number;
    maxFiles?: number;
    maxFileSizeBytes?: number;
    enableCache?: boolean;
    cache?: AnalysisCache;
    onProgress?: ProgressCallback;
    enableGitAnalysis?: boolean;
    gitAnalysisDays?: number;
    gitMaxCommits?: number;
    /** Enable persistent caching with git-based invalidation (default: true) */
    enablePersistentCache?: boolean;
    /** Custom persistent cache instance */
    persistentCache?: PersistentAnalysisCache;
    /** Persistent cache configuration */
    persistentCacheConfig?: Partial<CacheConfig>;
}
/**
 * Result type for validation operations
 */
export interface ValidationResult {
    valid: boolean;
    error?: AnalyzerError;
}
export declare class CodebaseAnalyzer {
    private repoPath;
    private excludePaths;
    private maxDepth;
    private maxFiles;
    private maxFileSizeBytes;
    private fileCount;
    private validationErrors;
    private enableCache;
    private cache;
    private config;
    private onProgress?;
    private enableGitAnalysis;
    private gitAnalysisDays;
    private gitMaxCommits;
    private git;
    private enablePersistentCache;
    private persistentCache;
    private persistentCacheInitialized;
    private configHash;
    constructor(repoPath: string, excludePaths?: string[], config?: AnalyzerConfig);
    /**
     * Initialize the persistent cache if not already done
     */
    private initializePersistentCache;
    /**
     * Get the persistent cache instance
     */
    getPersistentCache(): PersistentAnalysisCache | null;
    /**
     * Get combined cache statistics (in-memory + persistent)
     */
    getCombinedCacheStats(): {
        inMemory: CacheStats & {
            size: number;
            hitRate: number;
        };
        persistent: PersistentCacheStats | null;
    };
    /**
     * Get cache performance metrics for monitoring and reporting
     */
    getCachePerformanceMetrics(): CachePerformanceMetrics;
    /**
     * Log cache performance summary for debugging and monitoring
     */
    logCachePerformance(): void;
    /**
     * Get the configuration hash used for cache invalidation
     */
    getConfigHash(): string;
    /**
     * Report progress to the callback if registered
     */
    private reportProgress;
    /**
     * Clamp a value between min and max bounds
     */
    private clampValue;
    /**
     * Validate that a directory path exists and is readable
     */
    validateDirectoryPath(dirPath: string): Promise<ValidationResult>;
    /**
     * Validate and sanitize a glob pattern to prevent ReDoS attacks
     */
    validateGlobPattern(pattern: string): ValidationResult;
    /**
     * Validate that a pattern compiles as valid regex
     */
    validateRegexPattern(pattern: string): ValidationResult;
    /**
     * Validate analyzer configuration
     */
    validateConfig(): ValidationResult;
    /**
     * Perform all validations before analysis
     */
    private validateBeforeAnalysis;
    analyze(): Promise<CodebaseAnalysis>;
    /**
     * Check if a path should be excluded based on exclude patterns
     */
    private shouldExclude;
    private scanDirectory;
    private countFiles;
    private findTodoComments;
    /**
     * Find TODO comments in a specific list of files (for incremental analysis)
     * This is more efficient than scanning the entire codebase when only
     * a few files have changed. Uses parallel processing with concurrency limit.
     */
    private findTodoCommentsInFiles;
    /**
     * Scan a file using streaming (readline) for memory-efficient TODO detection
     */
    private scanFileWithStream;
    private findPackages;
    private findConfigFiles;
    generateSummary(analysis: CodebaseAnalysis): string;
    /**
     * Initialize the git instance for the repository
     */
    private initGit;
    /**
     * Get recent commits from git history
     */
    getRecentCommits(): Promise<GitCommitInfo[]>;
    /**
     * Calculate file change statistics from commit history
     */
    private calculateFileChangeStats;
    /**
     * Analyze dependency relationships between files
     */
    analyzeDependencyGraph(): Promise<DependencyGraph>;
    /**
     * Perform complete git analysis
     */
    analyzeGit(): Promise<GitAnalysis | undefined>;
}
export {};
//# sourceMappingURL=analyzer.d.ts.map