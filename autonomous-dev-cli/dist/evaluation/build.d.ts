export interface BuildResult {
    success: boolean;
    output: string;
    duration: number;
    error?: string;
    cached?: boolean;
    cacheKey?: string;
}
export interface BuildOptions {
    repoPath: string;
    packages?: string[];
    timeout?: number;
    enableCache?: boolean;
    cache?: BuildCache;
}
export declare class BuildCache {
    private cache;
    private maxEntries;
    private ttlMs;
    private stats;
    constructor(options?: {
        maxEntries?: number;
        ttlMs?: number;
    });
    /**
     * Generate a content hash based on source files to detect changes
     */
    generateContentHash(repoPath: string, packages?: string[]): string;
    private collectSourceHashes;
    /**
     * Generate a cache key from build options
     */
    generateKey(repoPath: string, packages: string[]): string;
    /**
     * Get cached build result if valid
     */
    get(key: string, currentContentHash: string): BuildResult | null;
    /**
     * Store build result in cache
     */
    set(key: string, result: BuildResult, contentHash: string): void;
    /**
     * Clear all cache entries
     */
    clear(): void;
    /**
     * Get cache statistics
     */
    getStats(): {
        hits: number;
        misses: number;
        invalidations: number;
        size: number;
        hitRate: number;
    };
}
export declare function getBuildCache(): BuildCache;
export declare function initBuildCache(options?: {
    maxEntries?: number;
    ttlMs?: number;
}): BuildCache;
/**
 * Clear the package.json cache. Useful for testing or when files are known to have changed.
 */
export declare function clearPackageJsonCache(): void;
export declare function runBuild(options: BuildOptions): Promise<BuildResult>;
export declare function runTypeCheck(repoPath: string): Promise<BuildResult>;
//# sourceMappingURL=build.d.ts.map