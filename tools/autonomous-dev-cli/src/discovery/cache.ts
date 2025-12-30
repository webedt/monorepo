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

import { readFile, writeFile, stat, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  logger,
  getCorrelationId,
} from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import type { CodebaseAnalysis, PackageInfo, DirectoryEntry } from './analyzer.js';

// ============================================================================
// Cache Configuration Types
// ============================================================================

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
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  maxEntries: 100,
  ttlMs: 30 * 60 * 1000, // 30 minutes
  maxSizeBytes: 100 * 1024 * 1024, // 100MB
  cacheDir: '.autonomous-dev-cache',
  persistToDisk: true,
  useGitInvalidation: true,
  enableIncrementalAnalysis: true,
};

// ============================================================================
// Cache Entry Types
// ============================================================================

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
 * Serializable format for persisting cache entries
 */
interface SerializedCacheEntry {
  key: string;
  repoPath: string;
  gitCommitHash: string;
  gitBranch: string;
  timestamp: number;
  contentHash: string;
  data: CodebaseAnalysis;
  fileCache: Array<[string, FileCacheEntry]>;
  sizeBytes: number;
  accessCount: number;
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

// ============================================================================
// Persistent Analysis Cache
// ============================================================================

/**
 * Advanced caching layer with persistence, git-based invalidation,
 * and incremental analysis support.
 */
export class PersistentAnalysisCache {
  private cache: Map<string, RepoCacheEntry> = new Map();
  private config: CacheConfig;
  private stats: CacheStats;
  private accessTimeHistory: number[] = [];
  private initialized: boolean = false;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      evictions: 0,
      persistWrites: 0,
      persistReads: 0,
      incrementalUpdates: 0,
      totalEntries: 0,
      totalSizeBytes: 0,
      hitRate: 0,
      averageAccessTime: 0,
    };
  }

  /**
   * Initialize the cache, loading persisted entries from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.persistToDisk) {
      await this.loadFromDisk();
    }

    this.initialized = true;
    logger.debug('Persistent analysis cache initialized', {
      entriesLoaded: this.cache.size,
      config: {
        maxEntries: this.config.maxEntries,
        maxSizeBytes: this.config.maxSizeBytes,
        ttlMs: this.config.ttlMs,
      },
    });
  }

  /**
   * Generate a unique cache key for a repository + configuration combination
   */
  generateKey(repoPath: string, excludePaths: string[], configHash?: string): string {
    const keyData = JSON.stringify({
      repoPath,
      excludePaths: excludePaths.sort(),
      configHash,
    });
    return createHash('sha256').update(keyData).digest('hex').substring(0, 16);
  }

  /**
   * Get the current git commit hash for a repository
   */
  async getGitCommitHash(repoPath: string): Promise<string | null> {
    try {
      const gitDir = join(repoPath, '.git');
      if (!existsSync(gitDir)) {
        return null;
      }

      const git: SimpleGit = simpleGit(repoPath);
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash || null;
    } catch (error) {
      logger.debug('Failed to get git commit hash', { error, repoPath });
      return null;
    }
  }

  /**
   * Get the current git branch name
   */
  async getGitBranch(repoPath: string): Promise<string> {
    try {
      const git: SimpleGit = simpleGit(repoPath);
      const branchResult = await git.branch();
      return branchResult.current || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate a content hash based on file modification times
   */
  async generateContentHash(repoPath: string, maxSamples: number = 100): Promise<string> {
    const hashData: string[] = [];
    let sampleCount = 0;

    const ignoredDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '.next', '.cache', '.turbo', '__pycache__',
    ]);

    const collectSamples = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (depth > 4 || sampleCount >= maxSamples) return;

      try {
        const items = await readdir(dirPath);
        for (const item of items) {
          if (sampleCount >= maxSamples) break;
          if (ignoredDirs.has(item)) continue;

          const fullPath = join(dirPath, item);
          try {
            const fileStat = await stat(fullPath);
            if (fileStat.isFile()) {
              hashData.push(`${fullPath}:${fileStat.mtimeMs}:${fileStat.size}`);
              sampleCount++;
            } else if (fileStat.isDirectory()) {
              await collectSamples(fullPath, depth + 1);
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await collectSamples(repoPath);
    hashData.sort(); // Ensure consistent ordering
    return createHash('sha256').update(hashData.join('|')).digest('hex').substring(0, 32);
  }

  /**
   * Get cached analysis if valid, with support for incremental updates
   */
  async get(
    key: string,
    repoPath: string,
    currentCommitHash?: string
  ): Promise<CacheLookupResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return { hit: false, requiresFullAnalysis: true, reason: 'Cache disabled' };
    }

    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.recordAccessTime(Date.now() - startTime);
      return { hit: false, requiresFullAnalysis: true, reason: 'No cache entry found' };
    }

    // Check TTL expiration
    if (Date.now() - entry.timestamp > this.config.ttlMs) {
      this.cache.delete(key);
      this.stats.invalidations++;
      this.stats.misses++;
      this.recordAccessTime(Date.now() - startTime);
      logger.debug('Cache entry expired', { key, age: Date.now() - entry.timestamp });
      return { hit: false, requiresFullAnalysis: true, reason: 'Cache entry expired' };
    }

    // Git-based invalidation if enabled
    if (this.config.useGitInvalidation && currentCommitHash) {
      if (entry.gitCommitHash !== currentCommitHash) {
        // Check if we can do an incremental update
        if (this.config.enableIncrementalAnalysis) {
          const changedFiles = await this.getChangedFilesSinceCommit(
            repoPath,
            entry.gitCommitHash,
            currentCommitHash
          );

          if (changedFiles && changedFiles.length > 0) {
            this.stats.hits++;
            this.recordAccessTime(Date.now() - startTime);
            this.updateAccessStats(entry);

            logger.debug('Cache hit with incremental update needed', {
              key,
              changedFiles: changedFiles.length,
            });

            return {
              hit: true,
              data: entry.data,
              changedFiles,
              requiresFullAnalysis: false,
              reason: 'Incremental update available',
            };
          }
        }

        // Full invalidation required
        this.cache.delete(key);
        this.stats.invalidations++;
        this.stats.misses++;
        this.recordAccessTime(Date.now() - startTime);
        logger.debug('Cache invalidated due to git changes', {
          key,
          oldCommit: entry.gitCommitHash,
          newCommit: currentCommitHash,
        });
        return { hit: false, requiresFullAnalysis: true, reason: 'Git commit changed' };
      }
    }

    // Content hash validation (fallback for non-git repos or when git validation disabled)
    if (!this.config.useGitInvalidation) {
      const currentContentHash = await this.generateContentHash(repoPath);
      if (entry.contentHash !== currentContentHash) {
        this.cache.delete(key);
        this.stats.invalidations++;
        this.stats.misses++;
        this.recordAccessTime(Date.now() - startTime);
        logger.debug('Cache invalidated due to content changes', { key });
        return { hit: false, requiresFullAnalysis: true, reason: 'Content hash changed' };
      }
    }

    // Cache hit!
    this.stats.hits++;
    this.recordAccessTime(Date.now() - startTime);
    this.updateAccessStats(entry);

    logger.debug('Cache hit', { key, age: Date.now() - entry.timestamp });

    return {
      hit: true,
      data: entry.data,
      requiresFullAnalysis: false,
    };
  }

  /**
   * Get list of files changed between two git commits
   */
  private async getChangedFilesSinceCommit(
    repoPath: string,
    fromCommit: string,
    toCommit: string
  ): Promise<string[] | null> {
    try {
      const git: SimpleGit = simpleGit(repoPath);
      const diff = await git.diff([
        '--name-only',
        fromCommit,
        toCommit,
      ]);

      return diff
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);
    } catch (error) {
      logger.debug('Failed to get changed files from git', { error, fromCommit, toCommit });
      return null;
    }
  }

  /**
   * Store analysis in cache with automatic eviction if needed
   */
  async set(
    key: string,
    repoPath: string,
    data: CodebaseAnalysis,
    excludePaths: string[]
  ): Promise<void> {
    if (!this.config.enabled) return;

    const startTime = Date.now();

    // Get git information
    const [gitCommitHash, gitBranch, contentHash] = await Promise.all([
      this.getGitCommitHash(repoPath),
      this.getGitBranch(repoPath),
      this.generateContentHash(repoPath),
    ]);

    // Calculate size of serialized data
    const serialized = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    // Check if we need to evict entries
    await this.evictIfNeeded(sizeBytes);

    const entry: RepoCacheEntry = {
      key,
      repoPath,
      gitCommitHash: gitCommitHash || '',
      gitBranch,
      timestamp: Date.now(),
      contentHash,
      data,
      fileCache: new Map(),
      sizeBytes,
      accessCount: 1,
      lastAccessTime: Date.now(),
    };

    this.cache.set(key, entry);
    this.updateStats();

    // Persist to disk if enabled
    if (this.config.persistToDisk) {
      await this.persistEntry(entry);
    }

    logger.debug('Cached analysis', {
      key,
      sizeBytes,
      gitCommitHash,
      duration: Date.now() - startTime,
    });
  }

  /**
   * Update analysis with incremental changes for specific files
   */
  async updateIncremental(
    key: string,
    _changedFiles: string[],
    updatedData: Partial<CodebaseAnalysis>
  ): Promise<void> {
    const entry = this.cache.get(key);
    if (!entry) return;

    if (updatedData.packages) {
      entry.data.packages = updatedData.packages;
    }

    if (updatedData.configFiles) {
      entry.data.configFiles = updatedData.configFiles;
    }

    if (updatedData.gitAnalysis) {
      entry.data.gitAnalysis = updatedData.gitAnalysis;
    }

    // Update metadata
    entry.timestamp = Date.now();
    entry.gitCommitHash = await this.getGitCommitHash(entry.repoPath) || entry.gitCommitHash;
    entry.contentHash = await this.generateContentHash(entry.repoPath);

    this.stats.incrementalUpdates++;
    this.updateStats();

    // Persist updated entry
    if (this.config.persistToDisk) {
      await this.persistEntry(entry);
    }

    logger.debug('Incremental cache update', {
      key,
    });
  }

  /**
   * Evict entries if needed to stay within limits
   */
  private async evictIfNeeded(newEntrySizeBytes: number): Promise<void> {
    // Check entry count limit
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    // Check size limit
    let totalSize = this.getTotalSizeBytes();
    while (totalSize + newEntrySizeBytes > this.config.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
      totalSize = this.getTotalSizeBytes();
    }
  }

  /**
   * Evict the least recently used entry
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessTime < lruTime) {
        lruTime = entry.lastAccessTime;
        lruKey = key;
      }
    }

    if (lruKey) {
      const entry = this.cache.get(lruKey);
      this.cache.delete(lruKey);
      this.stats.evictions++;

      // Delete persisted file (fire-and-forget with logging)
      if (this.config.persistToDisk && entry) {
        this.deletePersistedEntry(entry.key).catch((error) => {
          logger.debug('Failed to delete persisted cache entry during LRU eviction', {
            key: entry.key,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      logger.debug('Evicted LRU cache entry', { key: lruKey });
    }
  }

  /**
   * Get total size of all cached entries
   */
  private getTotalSizeBytes(): number {
    let total = 0;
    for (const entry of this.cache.values()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  /**
   * Update access statistics for an entry
   */
  private updateAccessStats(entry: RepoCacheEntry): void {
    entry.accessCount++;
    entry.lastAccessTime = Date.now();
  }

  /**
   * Record access time for performance metrics
   */
  private recordAccessTime(timeMs: number): void {
    this.accessTimeHistory.push(timeMs);
    if (this.accessTimeHistory.length > 1000) {
      this.accessTimeHistory = this.accessTimeHistory.slice(-500);
    }
  }

  /**
   * Update overall statistics
   */
  private updateStats(): void {
    this.stats.totalEntries = this.cache.size;
    this.stats.totalSizeBytes = this.getTotalSizeBytes();
    const totalLookups = this.stats.hits + this.stats.misses;
    this.stats.hitRate = totalLookups > 0 ? this.stats.hits / totalLookups : 0;

    if (this.accessTimeHistory.length > 0) {
      this.stats.averageAccessTime =
        this.accessTimeHistory.reduce((a, b) => a + b, 0) / this.accessTimeHistory.length;
    }
  }

  /**
   * Get current cache statistics
   */
  getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      evictions: 0,
      persistWrites: 0,
      persistReads: 0,
      incrementalUpdates: 0,
      totalEntries: 0,
      totalSizeBytes: 0,
      hitRate: 0,
      averageAccessTime: 0,
    };

    if (this.config.persistToDisk) {
      await this.clearPersistedCache();
    }

    logger.debug('Cache cleared');
  }

  /**
   * Invalidate entries for a specific repository
   */
  async invalidate(repoPath: string): Promise<number> {
    let invalidated = 0;
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (entry.repoPath === repoPath) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.cache.get(key);
      this.cache.delete(key);
      this.stats.invalidations++;
      invalidated++;

      if (this.config.persistToDisk && entry) {
        await this.deletePersistedEntry(entry.key).catch((error) => {
          logger.debug('Failed to delete persisted cache entry during invalidation', {
            key: entry.key,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    logger.debug('Invalidated cache entries for repo', { repoPath, count: invalidated });
    return invalidated;
  }

  /**
   * Warm the cache by pre-loading entries
   */
  async warmCache(repoPaths: string[], excludePaths: string[] = []): Promise<void> {
    logger.info('Warming cache', { repoPaths: repoPaths.length });

    for (const repoPath of repoPaths) {
      const key = this.generateKey(repoPath, excludePaths);
      const entry = this.cache.get(key);

      if (entry) {
        // Validate existing entry
        const currentCommitHash = await this.getGitCommitHash(repoPath);
        if (currentCommitHash && entry.gitCommitHash === currentCommitHash) {
          logger.debug('Cache warm: entry valid', { repoPath, key });
          continue;
        }
      }

      // Entry needs refresh - will be populated on next analysis
      logger.debug('Cache warm: entry needs refresh', { repoPath, key });
    }
  }

  // ============================================================================
  // Persistence Methods
  // ============================================================================

  /**
   * Get the cache directory path
   */
  private getCacheDir(): string {
    return this.config.cacheDir;
  }

  /**
   * Get the file path for a cached entry
   */
  private getCacheFilePath(key: string): string {
    return join(this.getCacheDir(), `${key}.json`);
  }

  /**
   * Load cached entries from disk
   */
  private async loadFromDisk(): Promise<void> {
    const cacheDir = this.getCacheDir();

    if (!existsSync(cacheDir)) {
      return;
    }

    try {
      const files = await readdir(cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = join(cacheDir, file);
          const content = await readFile(filePath, 'utf-8');
          const serialized: SerializedCacheEntry = JSON.parse(content);

          // Convert to RepoCacheEntry
          const entry: RepoCacheEntry = {
            ...serialized,
            fileCache: new Map(serialized.fileCache),
          };

          // Check if entry is still valid (TTL)
          if (Date.now() - entry.timestamp <= this.config.ttlMs) {
            this.cache.set(entry.key, entry);
            this.stats.persistReads++;
          } else {
            // Delete expired entry
            await unlink(filePath).catch((error) => {
              logger.debug('Failed to delete expired cache file', {
                filePath,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        } catch (error) {
          logger.debug('Failed to load cache entry', { file, error });
        }
      }

      this.updateStats();
      logger.debug('Loaded cache from disk', { entriesLoaded: this.cache.size });
    } catch (error) {
      logger.debug('Failed to load cache from disk', { error });
    }
  }

  /**
   * Persist a cache entry to disk
   */
  private async persistEntry(entry: RepoCacheEntry): Promise<void> {
    const cacheDir = this.getCacheDir();

    try {
      // Ensure cache directory exists
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
      }

      // Convert to serializable format
      const serialized: SerializedCacheEntry = {
        ...entry,
        fileCache: Array.from(entry.fileCache.entries()),
      };

      const filePath = this.getCacheFilePath(entry.key);
      await writeFile(filePath, JSON.stringify(serialized, null, 2), 'utf-8');
      this.stats.persistWrites++;

      logger.debug('Persisted cache entry', { key: entry.key });
    } catch (error) {
      logger.debug('Failed to persist cache entry', { key: entry.key, error });
    }
  }

  /**
   * Delete a persisted cache entry
   * Throws on failure - callers should handle errors appropriately
   */
  private async deletePersistedEntry(key: string): Promise<void> {
    const filePath = this.getCacheFilePath(key);
    await unlink(filePath);
  }

  /**
   * Clear all persisted cache entries
   */
  private async clearPersistedCache(): Promise<void> {
    const cacheDir = this.getCacheDir();

    if (!existsSync(cacheDir)) {
      return;
    }

    try {
      const files = await readdir(cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const deleteResults = await Promise.allSettled(
        jsonFiles.map(file => unlink(join(cacheDir, file)))
      );

      const failedDeletes = deleteResults.filter(r => r.status === 'rejected');
      if (failedDeletes.length > 0) {
        logger.debug('Some cache files failed to delete during clear', {
          totalFiles: jsonFiles.length,
          failedCount: failedDeletes.length,
        });
      }

      logger.debug('Cleared persisted cache', { filesDeleted: jsonFiles.length - failedDeletes.length });
    } catch (error) {
      logger.debug('Failed to clear persisted cache', { error });
    }
  }
}

// ============================================================================
// Global Cache Instance
// ============================================================================

let globalPersistentCache: PersistentAnalysisCache | null = null;

/**
 * Get the global persistent cache instance
 */
export function getPersistentCache(): PersistentAnalysisCache {
  if (!globalPersistentCache) {
    globalPersistentCache = new PersistentAnalysisCache();
  }
  return globalPersistentCache;
}

/**
 * Initialize the global persistent cache with custom configuration
 */
export async function initPersistentCache(
  config?: Partial<CacheConfig>
): Promise<PersistentAnalysisCache> {
  globalPersistentCache = new PersistentAnalysisCache(config);
  await globalPersistentCache.initialize();
  return globalPersistentCache;
}

/**
 * Reset the global persistent cache (mainly for testing)
 */
export function resetPersistentCache(): void {
  globalPersistentCache = null;
}
