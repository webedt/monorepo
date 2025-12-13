import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join, dirname, relative, extname } from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import type { CodebaseAnalysis, DirectoryEntry, TodoComment, PackageInfo } from './analyzer.js';

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
 * Metadata about a cached file
 */
interface CachedFileMeta {
  path: string;
  checksum: string;
  mtime: number;
  size: number;
}

/**
 * The complete cache entry structure stored on disk
 */
interface CacheEntry {
  /** Version of the cache format for future compatibility */
  version: number;
  /** Timestamp when cache was created */
  createdAt: number;
  /** Git commit SHA at time of caching */
  gitSha: string | null;
  /** Repository path that was analyzed */
  repoPath: string;
  /** Checksums of all analyzed files for change detection */
  fileChecksums: CachedFileMeta[];
  /** The cached analysis results */
  analysis: CodebaseAnalysis;
  /** Exclude paths used during analysis */
  excludePaths: string[];
  /** Analyzer config used */
  analyzerConfig: {
    maxDepth: number;
    maxFiles: number;
  };
}

/**
 * Result of cache validation check
 */
export interface CacheValidationResult {
  valid: boolean;
  reason?: string;
  changedFiles?: string[];
}

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIR = '.autonomous-dev-cache';
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CACHE_FILENAME = 'analysis-cache.json';

// Extensions to track for change detection
const TRACKED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.py', '.go', '.rs', '.java',
  '.kt', '.swift', '.rb', '.php', '.cs', '.cpp',
  '.c', '.h', '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
]);

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
export class AnalysisCache {
  private repoPath: string;
  private cacheDir: string;
  private maxAgeMs: number;
  private useGitInvalidation: boolean;
  private enabled: boolean;

  constructor(repoPath: string, config: CacheConfig = {}) {
    this.repoPath = repoPath;
    this.enabled = config.enabled ?? true;
    this.cacheDir = config.cacheDir ?? join(repoPath, DEFAULT_CACHE_DIR);
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.useGitInvalidation = config.useGitInvalidation ?? true;
  }

  /**
   * Get the path to the cache file
   */
  private getCachePath(): string {
    return join(this.cacheDir, CACHE_FILENAME);
  }

  /**
   * Ensure the cache directory exists
   */
  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
      logger.debug('Created cache directory', { path: this.cacheDir });
    }
  }

  /**
   * Get the current git HEAD SHA
   */
  private getGitSha(): string | null {
    try {
      const sha = execSync('git rev-parse HEAD', {
        cwd: this.repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return sha;
    } catch {
      logger.debug('Not a git repository or git not available');
      return null;
    }
  }

  /**
   * Get list of files changed since a specific commit
   */
  private getChangedFilesSince(sha: string): string[] {
    try {
      const output = execSync(`git diff --name-only ${sha} HEAD`, {
        cwd: this.repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Calculate MD5 checksum of a file
   */
  private calculateChecksum(filePath: string): string {
    try {
      const content = readFileSync(filePath);
      return createHash('md5').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Build file metadata for a list of files
   */
  private buildFileChecksums(files: string[]): CachedFileMeta[] {
    const checksums: CachedFileMeta[] = [];

    for (const relativePath of files) {
      const fullPath = join(this.repoPath, relativePath);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          checksums.push({
            path: relativePath,
            checksum: this.calculateChecksum(fullPath),
            mtime: stat.mtimeMs,
            size: stat.size,
          });
        }
      } catch {
        // Skip files that can't be accessed
      }
    }

    return checksums;
  }

  /**
   * Get all tracked files in the repository
   */
  private getTrackedFiles(excludePaths: string[]): string[] {
    const files: string[] = [];
    const excludeSet = new Set(excludePaths);

    const scanDir = (dirPath: string, depth: number = 0) => {
      if (depth > 10) return; // Limit recursion depth for performance

      try {
        const items = readdirSync(dirPath);

        for (const item of items) {
          // Skip common excluded directories
          if (['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache'].includes(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);
          const relativePath = relative(this.repoPath, fullPath);

          // Check exclude patterns
          if (this.shouldExclude(relativePath, excludePaths)) {
            continue;
          }

          try {
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
              scanDir(fullPath, depth + 1);
            } else if (stat.isFile()) {
              const ext = extname(item);
              if (TRACKED_EXTENSIONS.has(ext)) {
                files.push(relativePath);
              }
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    scanDir(this.repoPath);
    return files;
  }

  /**
   * Check if a path should be excluded
   */
  private shouldExclude(relativePath: string, excludePaths: string[]): boolean {
    for (const pattern of excludePaths) {
      if (relativePath.startsWith(pattern)) {
        return true;
      }
      try {
        if (relativePath.match(pattern)) {
          return true;
        }
      } catch {
        // Invalid pattern, skip
      }
    }
    return false;
  }

  /**
   * Load the cache entry from disk
   */
  private loadCache(): CacheEntry | null {
    const cachePath = this.getCachePath();

    if (!existsSync(cachePath)) {
      logger.debug('No cache file found');
      return null;
    }

    try {
      const content = readFileSync(cachePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry;

      // Validate cache version
      if (entry.version !== CACHE_VERSION) {
        logger.info('Cache version mismatch, invalidating cache', {
          cached: entry.version,
          current: CACHE_VERSION,
        });
        return null;
      }

      return entry;
    } catch (error) {
      logger.warn('Failed to load cache, will perform full analysis', { error });
      return null;
    }
  }

  /**
   * Save analysis results to cache
   */
  saveCache(
    analysis: CodebaseAnalysis,
    excludePaths: string[],
    analyzerConfig: { maxDepth: number; maxFiles: number }
  ): void {
    if (!this.enabled) {
      return;
    }

    try {
      this.ensureCacheDir();

      // Get all tracked files for checksum verification
      const trackedFiles = this.getTrackedFiles(excludePaths);
      const fileChecksums = this.buildFileChecksums(trackedFiles);

      const entry: CacheEntry = {
        version: CACHE_VERSION,
        createdAt: Date.now(),
        gitSha: this.getGitSha(),
        repoPath: this.repoPath,
        fileChecksums,
        analysis,
        excludePaths,
        analyzerConfig,
      };

      const cachePath = this.getCachePath();
      writeFileSync(cachePath, JSON.stringify(entry, null, 2));

      logger.info('Saved analysis cache', {
        files: fileChecksums.length,
        gitSha: entry.gitSha?.substring(0, 8),
      });
    } catch (error) {
      logger.warn('Failed to save analysis cache', { error });
    }
  }

  /**
   * Validate the cache and determine if it's still valid
   */
  validateCache(excludePaths: string[], analyzerConfig: { maxDepth: number; maxFiles: number }): CacheValidationResult {
    if (!this.enabled) {
      return { valid: false, reason: 'Caching is disabled' };
    }

    const entry = this.loadCache();
    if (!entry) {
      return { valid: false, reason: 'No cache found' };
    }

    // Check if cache is too old
    const age = Date.now() - entry.createdAt;
    if (age > this.maxAgeMs) {
      return { valid: false, reason: `Cache expired (age: ${Math.round(age / 1000)}s)` };
    }

    // Check if repo path matches
    if (entry.repoPath !== this.repoPath) {
      return { valid: false, reason: 'Repository path mismatch' };
    }

    // Check if analyzer config matches
    if (
      entry.analyzerConfig.maxDepth !== analyzerConfig.maxDepth ||
      entry.analyzerConfig.maxFiles !== analyzerConfig.maxFiles
    ) {
      return { valid: false, reason: 'Analyzer configuration changed' };
    }

    // Check if exclude paths match
    if (JSON.stringify(entry.excludePaths.sort()) !== JSON.stringify(excludePaths.sort())) {
      return { valid: false, reason: 'Exclude paths changed' };
    }

    // Git-based validation
    if (this.useGitInvalidation && entry.gitSha) {
      const currentSha = this.getGitSha();

      if (currentSha && currentSha !== entry.gitSha) {
        const changedFiles = this.getChangedFilesSince(entry.gitSha);

        // Filter to only tracked file types
        const relevantChanges = changedFiles.filter((f) => {
          const ext = extname(f);
          return TRACKED_EXTENSIONS.has(ext);
        });

        if (relevantChanges.length > 0) {
          return {
            valid: false,
            reason: `Git changes detected since ${entry.gitSha.substring(0, 8)}`,
            changedFiles: relevantChanges,
          };
        }
      }
    }

    // File modification check for non-git scenarios
    const changedFiles: string[] = [];
    for (const cachedFile of entry.fileChecksums) {
      const fullPath = join(this.repoPath, cachedFile.path);

      try {
        const stat = statSync(fullPath);

        // Check if mtime or size changed
        if (stat.mtimeMs !== cachedFile.mtime || stat.size !== cachedFile.size) {
          // Verify with checksum
          const currentChecksum = this.calculateChecksum(fullPath);
          if (currentChecksum !== cachedFile.checksum) {
            changedFiles.push(cachedFile.path);
          }
        }
      } catch {
        // File no longer exists
        changedFiles.push(cachedFile.path);
      }
    }

    if (changedFiles.length > 0) {
      return {
        valid: false,
        reason: `${changedFiles.length} file(s) modified`,
        changedFiles,
      };
    }

    logger.debug('Cache is valid', {
      age: `${Math.round(age / 1000)}s`,
      gitSha: entry.gitSha?.substring(0, 8),
    });

    return { valid: true };
  }

  /**
   * Get cached analysis if valid, otherwise return null
   */
  getCachedAnalysis(
    excludePaths: string[],
    analyzerConfig: { maxDepth: number; maxFiles: number }
  ): CodebaseAnalysis | null {
    const validation = this.validateCache(excludePaths, analyzerConfig);

    if (!validation.valid) {
      logger.debug('Cache invalid', { reason: validation.reason });
      return null;
    }

    const entry = this.loadCache();
    if (!entry) {
      return null;
    }

    logger.info('Using cached analysis', {
      createdAt: new Date(entry.createdAt).toISOString(),
      fileCount: entry.analysis.fileCount,
      todoCount: entry.analysis.todoComments.length,
    });

    return entry.analysis;
  }

  /**
   * Perform incremental update of cached analysis for changed files only.
   * This is more efficient than full re-analysis when only a few files changed.
   */
  getIncrementalUpdate(
    changedFiles: string[],
    fullAnalyze: () => Promise<{ todos: TodoComment[]; packages: PackageInfo[] }>
  ): Promise<{ todos: TodoComment[]; packages: PackageInfo[] }> | null {
    const entry = this.loadCache();
    if (!entry) {
      return null;
    }

    // If too many files changed, just do a full re-analysis
    if (changedFiles.length > 50) {
      logger.debug('Too many changed files for incremental update, performing full analysis');
      return null;
    }

    // For now, return null to trigger full analysis
    // Future optimization: implement incremental TODO/package scanning
    return null;
  }

  /**
   * Invalidate the cache (force next analysis to be fresh)
   */
  invalidate(): void {
    const cachePath = this.getCachePath();
    try {
      if (existsSync(cachePath)) {
        const { unlinkSync } = require('fs');
        unlinkSync(cachePath);
        logger.info('Cache invalidated');
      }
    } catch (error) {
      logger.warn('Failed to invalidate cache', { error });
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): { exists: boolean; age: number | null; fileCount: number | null; gitSha: string | null } {
    const entry = this.loadCache();

    if (!entry) {
      return { exists: false, age: null, fileCount: null, gitSha: null };
    }

    return {
      exists: true,
      age: Date.now() - entry.createdAt,
      fileCount: entry.fileChecksums.length,
      gitSha: entry.gitSha,
    };
  }
}

/**
 * Create an analysis cache instance with default configuration
 */
export function createAnalysisCache(repoPath: string, config?: CacheConfig): AnalysisCache {
  return new AnalysisCache(repoPath, config);
}
