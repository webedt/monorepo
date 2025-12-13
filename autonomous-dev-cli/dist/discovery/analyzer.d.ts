import { AnalyzerError } from '../utils/errors.js';
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
 * Progress callback for reporting analysis progress
 */
export type ProgressCallback = (progress: AnalysisProgress) => void;
/**
 * Progress information during analysis
 */
export interface AnalysisProgress {
    phase: 'scanning' | 'analyzing-todos' | 'analyzing-packages' | 'analyzing-config' | 'complete';
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
    constructor(repoPath: string, excludePaths?: string[], config?: AnalyzerConfig);
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
     * Scan a file using streaming (readline) for memory-efficient TODO detection
     */
    private scanFileWithStream;
    private findPackages;
    private findConfigFiles;
    generateSummary(analysis: CodebaseAnalysis): string;
}
export {};
//# sourceMappingURL=analyzer.d.ts.map