import { readFile, readdir, stat, access, constants } from 'fs/promises';
import { existsSync } from 'fs';
import { createReadStream } from 'fs';
import { join, relative, extname, isAbsolute, resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { createInterface } from 'readline';
import { simpleGit, type SimpleGit, type LogResult, type DefaultLogFields } from 'simple-git';
import {
  logger,
  getCorrelationId,
  getMemoryUsageMB,
  timeOperation,
  createOperationContext,
  finalizeOperationContext,
} from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { AnalyzerError, ErrorCode } from '../utils/errors.js';
import {
  logCacheOperation,
  logCachePerformanceSummary,
  generateConfigHash,
  hasConfigChanged,
  formatBytes,
  type CachePerformanceMetrics,
} from '../utils/cache.js';
import {
  PersistentAnalysisCache,
  getPersistentCache,
  initPersistentCache,
  type CacheConfig,
  type CacheLookupResult,
  type CacheStats as PersistentCacheStats,
} from './cache.js';

// ============================================================================
// Analysis Cache
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  contentHash: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

export class AnalysisCache {
  private cache: Map<string, CacheEntry<CodebaseAnalysis>> = new Map();
  private stats: CacheStats = { hits: 0, misses: 0, invalidations: 0 };
  private maxEntries: number;
  private ttlMs: number;

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 100;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Generate a cache key from repository path and config
   */
  generateKey(repoPath: string, excludePaths: string[], config: AnalyzerConfig): string {
    const keyData = JSON.stringify({ repoPath, excludePaths, config });
    return createHash('md5').update(keyData).digest('hex');
  }

  /**
   * Generate a content hash based on file modification times
   * This allows for invalidation when files change
   */
  async generateContentHash(repoPath: string, maxSamples: number = 50): Promise<string> {
    const hashData: string[] = [];
    let sampleCount = 0;

    const collectSamples = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (depth > 3 || sampleCount >= maxSamples) return;

      try {
        const items = await readdir(dirPath);
        for (const item of items) {
          if (sampleCount >= maxSamples) break;
          if (['node_modules', '.git', 'dist', 'build', '.next'].includes(item)) continue;

          const fullPath = join(dirPath, item);
          try {
            const fileStat = await stat(fullPath);
            if (fileStat.isFile()) {
              hashData.push(`${fullPath}:${fileStat.mtimeMs}`);
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
    return createHash('md5').update(hashData.join('|')).digest('hex');
  }

  /**
   * Get cached analysis if valid
   */
  get(key: string, currentContentHash: string): CodebaseAnalysis | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.stats.invalidations++;
      this.stats.misses++;
      logger.debug('Cache entry expired', { key });
      return null;
    }

    // Check content hash (invalidate if files changed)
    if (entry.contentHash !== currentContentHash) {
      this.cache.delete(key);
      this.stats.invalidations++;
      this.stats.misses++;
      logger.debug('Cache invalidated due to file changes', { key });
      return null;
    }

    this.stats.hits++;
    logger.debug('Cache hit', { key });
    return entry.data;
  }

  /**
   * Store analysis in cache
   */
  set(key: string, data: CodebaseAnalysis, contentHash: string): void {
    // Enforce max entries with LRU eviction
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      contentHash,
    });
    logger.debug('Cached analysis', { key });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    logger.debug('Cache cleared');
  }

  /**
   * Invalidate entries for a specific repository
   */
  invalidate(repoPath: string): void {
    const keysToDelete: string[] = [];
    this.cache.forEach((entry, key) => {
      keysToDelete.push(key);
    });
    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.stats.invalidations++;
    }
    logger.debug('Invalidated cache for repo', { repoPath });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

// Global cache instance
let globalCache: AnalysisCache | null = null;

export function getAnalysisCache(): AnalysisCache {
  if (!globalCache) {
    globalCache = new AnalysisCache();
  }
  return globalCache;
}

export function initAnalysisCache(options?: { maxEntries?: number; ttlMs?: number }): AnalysisCache {
  globalCache = new AnalysisCache(options);
  return globalCache;
}

export interface CodebaseAnalysis {
  structure: DirectoryEntry[];
  fileCount: number;
  recentChanges: string[];
  packages: PackageInfo[];
  configFiles: string[];
  gitAnalysis?: GitAnalysis; // Git integration for recent changes tracking
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: DirectoryEntry[];
}

export interface PackageInfo {
  name: string;
  path: string;
  dependencies: string[];
  scripts: Record<string, string>;
}

// ============================================================================
// Git Analysis Types
// ============================================================================

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
  impactScore: number; // Calculated based on frequency and recency
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
  entryPoints: string[]; // Files with no incoming dependencies
  hotspots: string[]; // Files with many dependencies (high impact)
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
  phase: 'scanning' | 'analyzing-packages' | 'analyzing-config' | 'analyzing-git' | 'complete';
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
  maxFileSizeBytes?: number; // Maximum file size to read (default: 10MB)
  enableCache?: boolean; // Enable caching of analysis results (default: true)
  cache?: AnalysisCache; // Custom cache instance (in-memory)
  onProgress?: ProgressCallback; // Optional progress callback
  enableGitAnalysis?: boolean; // Enable git history analysis (default: true)
  gitAnalysisDays?: number; // Number of days of git history to analyze (default: 30)
  gitMaxCommits?: number; // Maximum commits to analyze (default: 500)
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

// Analyzer configuration bounds
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 20;
const DEFAULT_MAX_DEPTH = 10;

const MIN_MAX_FILES = 100;
const MAX_MAX_FILES = 50000;
const DEFAULT_MAX_FILES = 10000;

// Default maximum file size (10MB) - files larger than this will be skipped or streamed
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// Patterns known to cause ReDoS vulnerabilities
const REDOS_PATTERNS = [
  /\(\.\*\)\+/,           // (.*)+
  /\(\.\+\)\+/,           // (.+)+
  /\(\[^\\s\]\*\)\+/,     // ([^\s]*)+
  /\(\.\*\)\{\d+,\}/,     // (.*){\d+,}
  /\(\[^\\]\]\*\)\+/,     // ([^]]*)+
  /\(\.\*\?\)\+/,         // (.*?)+
];

// Maximum length for glob patterns to prevent excessive processing
const MAX_PATTERN_LENGTH = 500;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.cpp',
  '.c',
  '.h',
]);

const CONFIG_EXTENSIONS = new Set([
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
  '.env',
]);

// Git analysis configuration defaults
const DEFAULT_GIT_ANALYSIS_DAYS = 30;
const DEFAULT_GIT_MAX_COMMITS = 500;

export class CodebaseAnalyzer {
  private repoPath: string;
  private excludePaths: string[];
  private maxDepth: number;
  private maxFiles: number;
  private maxFileSizeBytes: number;
  private fileCount: number = 0;
  private validationErrors: AnalyzerError[] = [];
  private enableCache: boolean;
  private cache: AnalysisCache;
  private config: AnalyzerConfig;
  private onProgress?: ProgressCallback;
  private enableGitAnalysis: boolean;
  private gitAnalysisDays: number;
  private gitMaxCommits: number;
  private git: SimpleGit | null = null;
  // Persistent cache integration
  private enablePersistentCache: boolean;
  private persistentCache: PersistentAnalysisCache | null = null;
  private persistentCacheInitialized: boolean = false;
  // Configuration hash for cache invalidation
  private configHash: string;

  constructor(repoPath: string, excludePaths: string[] = [], config: AnalyzerConfig = {}) {
    // Normalize and resolve the path
    this.repoPath = isAbsolute(repoPath) ? repoPath : resolve(repoPath);
    this.excludePaths = excludePaths;
    this.config = config;

    // Apply bounds to configuration
    this.maxDepth = this.clampValue(
      config.maxDepth ?? DEFAULT_MAX_DEPTH,
      MIN_MAX_DEPTH,
      MAX_MAX_DEPTH
    );
    this.maxFiles = this.clampValue(
      config.maxFiles ?? DEFAULT_MAX_FILES,
      MIN_MAX_FILES,
      MAX_MAX_FILES
    );
    this.maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;

    // In-memory cache configuration
    this.enableCache = config.enableCache !== false; // Default true
    this.cache = config.cache ?? getAnalysisCache();

    // Persistent cache configuration
    this.enablePersistentCache = config.enablePersistentCache !== false; // Default true
    if (config.persistentCache) {
      this.persistentCache = config.persistentCache;
      this.persistentCacheInitialized = true;
    }

    // Progress callback
    this.onProgress = config.onProgress;

    // Git analysis configuration
    this.enableGitAnalysis = config.enableGitAnalysis !== false; // Default true
    this.gitAnalysisDays = config.gitAnalysisDays ?? DEFAULT_GIT_ANALYSIS_DAYS;
    this.gitMaxCommits = config.gitMaxCommits ?? DEFAULT_GIT_MAX_COMMITS;

    // Generate configuration hash for cache invalidation on config changes
    this.configHash = generateConfigHash({
      maxDepth: this.maxDepth,
      maxFiles: this.maxFiles,
      maxFileSizeBytes: this.maxFileSizeBytes,
      excludePaths: this.excludePaths,
      enableGitAnalysis: this.enableGitAnalysis,
      gitAnalysisDays: this.gitAnalysisDays,
      gitMaxCommits: this.gitMaxCommits,
    }).hash;

    logger.debug('CodebaseAnalyzer initialized', {
      repoPath: this.repoPath,
      configHash: this.configHash,
      enableCache: this.enableCache,
      enablePersistentCache: this.enablePersistentCache,
    });
  }

  /**
   * Initialize the persistent cache if not already done
   */
  private async initializePersistentCache(): Promise<void> {
    if (this.persistentCacheInitialized || !this.enablePersistentCache) return;

    try {
      if (this.config.persistentCacheConfig) {
        this.persistentCache = await initPersistentCache(this.config.persistentCacheConfig);
      } else {
        this.persistentCache = getPersistentCache();
        await this.persistentCache.initialize();
      }
      this.persistentCacheInitialized = true;
    } catch (error) {
      logger.warn('Failed to initialize persistent cache, falling back to in-memory', { error });
      this.enablePersistentCache = false;
    }
  }

  /**
   * Get the persistent cache instance
   */
  getPersistentCache(): PersistentAnalysisCache | null {
    return this.persistentCache;
  }

  /**
   * Get combined cache statistics (in-memory + persistent)
   */
  getCombinedCacheStats(): { inMemory: CacheStats & { size: number; hitRate: number }; persistent: PersistentCacheStats | null } {
    return {
      inMemory: this.cache.getStats(),
      persistent: this.persistentCache?.getStats() ?? null,
    };
  }

  /**
   * Get cache performance metrics for monitoring and reporting
   */
  getCachePerformanceMetrics(): CachePerformanceMetrics {
    const inMemoryStats = this.cache.getStats();
    const persistentStats = this.persistentCache?.getStats();

    // Combine in-memory and persistent cache stats
    const totalHits = inMemoryStats.hits + (persistentStats?.hits ?? 0);
    const totalMisses = inMemoryStats.misses + (persistentStats?.misses ?? 0);
    const totalLookups = totalHits + totalMisses;

    return {
      hitRate: totalLookups > 0 ? totalHits / totalLookups : 0,
      missRate: totalLookups > 0 ? totalMisses / totalLookups : 0,
      averageAccessTimeMs: persistentStats?.averageAccessTime ?? 0,
      totalLookups,
      totalHits,
      totalMisses,
      evictions: persistentStats?.evictions ?? 0,
      invalidations: inMemoryStats.invalidations + (persistentStats?.invalidations ?? 0),
      sizeBytes: persistentStats?.totalSizeBytes ?? 0,
      entryCount: inMemoryStats.size + (persistentStats?.totalEntries ?? 0),
    };
  }

  /**
   * Log cache performance summary for debugging and monitoring
   */
  logCachePerformance(): void {
    const metrics = this.getCachePerformanceMetrics();
    logCachePerformanceSummary('CodebaseAnalyzer', metrics);
  }

  /**
   * Get the configuration hash used for cache invalidation
   */
  getConfigHash(): string {
    return this.configHash;
  }

  /**
   * Report progress to the callback if registered
   */
  private reportProgress(progress: AnalysisProgress): void {
    if (this.onProgress) {
      try {
        this.onProgress(progress);
      } catch {
        // Ignore errors from progress callback
      }
    }
  }

  /**
   * Clamp a value between min and max bounds
   */
  private clampValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Validate that a directory path exists and is readable
   */
  async validateDirectoryPath(dirPath: string): Promise<ValidationResult> {
    // Check if path exists
    if (!existsSync(dirPath)) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_PATH_NOT_FOUND,
          `Directory path does not exist: ${dirPath}`,
          { path: dirPath }
        ),
      };
    }

    // Check if path is a directory
    try {
      const fileStat = await stat(dirPath);
      if (!fileStat.isDirectory()) {
        return {
          valid: false,
          error: new AnalyzerError(
            ErrorCode.ANALYZER_PATH_NOT_DIRECTORY,
            `Path is not a directory: ${dirPath}`,
            { path: dirPath }
          ),
        };
      }
    } catch (err) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_PATH_NOT_READABLE,
          `Cannot access path: ${dirPath}`,
          { path: dirPath, cause: err as Error }
        ),
      };
    }

    // Check if path is readable
    try {
      await access(dirPath, constants.R_OK);
    } catch (err) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_PATH_NOT_READABLE,
          `Directory is not readable: ${dirPath}`,
          { path: dirPath, cause: err as Error }
        ),
      };
    }

    return { valid: true };
  }

  /**
   * Validate and sanitize a glob pattern to prevent ReDoS attacks
   */
  validateGlobPattern(pattern: string): ValidationResult {
    // Check pattern length
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_INVALID_GLOB_PATTERN,
          `Glob pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
          { pattern: pattern.substring(0, 50) + '...' }
        ),
      };
    }

    // Check for potentially dangerous patterns
    for (const redosPattern of REDOS_PATTERNS) {
      if (redosPattern.test(pattern)) {
        return {
          valid: false,
          error: new AnalyzerError(
            ErrorCode.ANALYZER_INVALID_GLOB_PATTERN,
            `Glob pattern contains potentially dangerous regex sequence that could cause ReDoS`,
            { pattern }
          ),
        };
      }
    }

    // Check for excessive wildcards (more than 10 ** or * sequences)
    const wildcardCount = (pattern.match(/\*+/g) || []).length;
    if (wildcardCount > 10) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_INVALID_GLOB_PATTERN,
          `Glob pattern contains too many wildcards (${wildcardCount}), maximum is 10`,
          { pattern }
        ),
      };
    }

    return { valid: true };
  }

  /**
   * Validate that a pattern compiles as valid regex
   */
  validateRegexPattern(pattern: string): ValidationResult {
    // Check pattern length
    if (pattern.length > MAX_PATTERN_LENGTH) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_INVALID_REGEX_PATTERN,
          `Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
          { pattern: pattern.substring(0, 50) + '...' }
        ),
      };
    }

    // Check for ReDoS patterns before attempting to compile
    for (const redosPattern of REDOS_PATTERNS) {
      if (redosPattern.test(pattern)) {
        return {
          valid: false,
          error: new AnalyzerError(
            ErrorCode.ANALYZER_INVALID_REGEX_PATTERN,
            `Regex pattern contains potentially dangerous sequence that could cause ReDoS`,
            { pattern }
          ),
        };
      }
    }

    // Try to compile the pattern
    try {
      new RegExp(pattern);
    } catch (err) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_INVALID_REGEX_PATTERN,
          `Invalid regex pattern: ${(err as Error).message}`,
          { pattern, cause: err as Error }
        ),
      };
    }

    return { valid: true };
  }

  /**
   * Validate analyzer configuration
   */
  validateConfig(): ValidationResult {
    const errors: string[] = [];

    if (this.maxDepth < MIN_MAX_DEPTH || this.maxDepth > MAX_MAX_DEPTH) {
      errors.push(`maxDepth must be between ${MIN_MAX_DEPTH} and ${MAX_MAX_DEPTH}, got ${this.maxDepth}`);
    }

    if (this.maxFiles < MIN_MAX_FILES || this.maxFiles > MAX_MAX_FILES) {
      errors.push(`maxFiles must be between ${MIN_MAX_FILES} and ${MAX_MAX_FILES}, got ${this.maxFiles}`);
    }

    // Validate exclude paths
    for (const pattern of this.excludePaths) {
      const result = this.validateGlobPattern(pattern);
      if (!result.valid) {
        errors.push(`Invalid exclude pattern "${pattern}": ${result.error?.message}`);
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: new AnalyzerError(
          ErrorCode.ANALYZER_INVALID_CONFIG,
          `Invalid analyzer configuration: ${errors.join('; ')}`,
          { context: { errors } }
        ),
      };
    }

    return { valid: true };
  }

  /**
   * Perform all validations before analysis
   */
  private async validateBeforeAnalysis(): Promise<ValidationResult> {
    // Validate configuration
    const configResult = this.validateConfig();
    if (!configResult.valid) {
      return configResult;
    }

    // Validate repository path
    const pathResult = await this.validateDirectoryPath(this.repoPath);
    if (!pathResult.valid) {
      return pathResult;
    }

    return { valid: true };
  }

  async analyze(): Promise<CodebaseAnalysis> {
    const startTime = Date.now();
    const startMemory = getMemoryUsageMB();
    const correlationId = getCorrelationId();

    // Create operation context for structured logging
    const operationContext = createOperationContext('Analyzer', 'analyze', {
      repoPath: this.repoPath,
      excludePaths: this.excludePaths.length,
      maxDepth: this.maxDepth,
      maxFiles: this.maxFiles,
    });

    logger.info('Analyzing codebase...', {
      path: this.repoPath,
      correlationId,
      startMemoryMB: startMemory,
    });

    // Validate inputs before processing
    const validationResult = await this.validateBeforeAnalysis();
    if (!validationResult.valid && validationResult.error) {
      logger.structuredError(validationResult.error);
      throw validationResult.error;
    }

    // Initialize persistent cache if enabled
    await this.initializePersistentCache();

    // Track cache hit status and type
    let cacheHit = false;
    let persistentCacheHit = false;
    let incrementalUpdate = false;
    let changedFilesForIncremental: string[] | undefined;

    // Check persistent cache first (if enabled)
    if (this.enablePersistentCache && this.persistentCache) {
      const persistentCacheKey = this.persistentCache.generateKey(
        this.repoPath,
        this.excludePaths,
        this.configHash // Use config hash for better cache invalidation on config changes
      );
      const currentCommitHash = await this.persistentCache.getGitCommitHash(this.repoPath);

      logCacheOperation('lookup', {
        key: persistentCacheKey,
        repoPath: this.repoPath,
        cacheType: 'persistent',
        configHash: this.configHash,
        commitHash: currentCommitHash || 'unknown',
      });

      const lookupStartTime = Date.now();
      const persistentResult = await this.persistentCache.get(
        persistentCacheKey,
        this.repoPath,
        currentCommitHash || undefined
      );
      const lookupDuration = Date.now() - lookupStartTime;

      if (persistentResult.hit && persistentResult.data) {
        if (!persistentResult.requiresFullAnalysis) {
          // Full cache hit from persistent storage
          persistentCacheHit = true;
          cacheHit = true;
          const duration = Date.now() - startTime;

          // Log cache hit with detailed metrics
          logCacheOperation('hit', {
            key: persistentCacheKey,
            repoPath: this.repoPath,
            duration: lookupDuration,
            cacheType: 'persistent',
            fileCount: persistentResult.data.fileCount,
            stats: this.getCachePerformanceMetrics(),
          });

          // Record discovery metrics for cache hit
          const repoName = this.repoPath.split('/').slice(-2).join('/');
          metrics.recordDiscovery(0, duration, true, { repository: repoName });

          const persistentStats = this.persistentCache.getStats();
          logger.info('Using persistent cached codebase analysis', {
            path: this.repoPath,
            cacheType: 'persistent',
            hitRate: `${(persistentStats.hitRate * 100).toFixed(1)}%`,
            duration,
            cacheHit: true,
            fileCount: persistentResult.data.fileCount,
          });

          // Log operation completion
          const operationMetadata = finalizeOperationContext(operationContext, true, {
            cacheHit: true,
            cacheType: 'persistent',
            fileCount: persistentResult.data.fileCount,
          });
          logger.operationComplete('Analyzer', 'analyze', true, operationMetadata);

          // Report progress complete
          this.reportProgress({
            phase: 'complete',
            filesScanned: persistentResult.data.fileCount,
            totalFiles: persistentResult.data.fileCount,
            percentComplete: 100,
          });

          return persistentResult.data;
        } else if (persistentResult.changedFiles && persistentResult.changedFiles.length > 0) {
          // Incremental update possible
          incrementalUpdate = true;
          changedFilesForIncremental = persistentResult.changedFiles;

          logCacheOperation('incremental-update', {
            key: persistentCacheKey,
            repoPath: this.repoPath,
            changedFiles: changedFilesForIncremental.length,
            reason: persistentResult.reason,
          });

          logger.info('Performing incremental analysis', {
            changedFiles: changedFilesForIncremental.length,
            changedFilesList: changedFilesForIncremental.slice(0, 10),
            reason: persistentResult.reason,
          });
        }
      } else {
        // Log cache miss
        logCacheOperation('miss', {
          key: persistentCacheKey,
          repoPath: this.repoPath,
          duration: lookupDuration,
          reason: persistentResult.reason || 'No cache entry found',
          cacheType: 'persistent',
        });
      }
    }

    // Fall back to in-memory cache if persistent cache didn't hit
    if (!cacheHit && this.enableCache) {
      const cacheKey = this.cache.generateKey(this.repoPath, this.excludePaths, this.config);
      const contentHash = await this.cache.generateContentHash(this.repoPath);

      logCacheOperation('lookup', {
        key: cacheKey,
        repoPath: this.repoPath,
        cacheType: 'in-memory',
        contentHash,
      });

      const inMemoryLookupStart = Date.now();
      const cached = this.cache.get(cacheKey, contentHash);
      const inMemoryLookupDuration = Date.now() - inMemoryLookupStart;

      if (cached) {
        cacheHit = true;
        const duration = Date.now() - startTime;

        logCacheOperation('hit', {
          key: cacheKey,
          repoPath: this.repoPath,
          duration: inMemoryLookupDuration,
          cacheType: 'in-memory',
          fileCount: cached.fileCount,
        });

        // Record discovery metrics for cache hit
        const repoName = this.repoPath.split('/').slice(-2).join('/');
        metrics.recordDiscovery(0, duration, true, { repository: repoName });

        const inMemoryStats = this.cache.getStats();
        logger.info('Using in-memory cached codebase analysis', {
          path: this.repoPath,
          cacheType: 'in-memory',
          hitRate: `${(inMemoryStats.hitRate * 100).toFixed(1)}%`,
          cacheSize: inMemoryStats.size,
          duration,
          cacheHit: true,
          fileCount: cached.fileCount,
        });

        // Log operation completion
        const operationMetadata = finalizeOperationContext(operationContext, true, {
          cacheHit: true,
          cacheType: 'in-memory',
          fileCount: cached.fileCount,
        });
        logger.operationComplete('Analyzer', 'analyze', true, operationMetadata);

        // Report progress complete
        this.reportProgress({
          phase: 'complete',
          filesScanned: cached.fileCount,
          totalFiles: cached.fileCount,
          percentComplete: 100,
        });

        return cached;
      } else {
        logCacheOperation('miss', {
          key: cacheKey,
          repoPath: this.repoPath,
          duration: inMemoryLookupDuration,
          cacheType: 'in-memory',
          reason: 'Cache entry not found or expired',
        });
      }
    }

    // Reset file count for this analysis
    this.fileCount = 0;
    this.validationErrors = [];

    // Report progress: starting scan
    this.reportProgress({
      phase: 'scanning',
      filesScanned: 0,
    });

    let structure: DirectoryEntry[] = [];
    let scanDuration: number = 0;
    let packages: PackageInfo[] = [];
    let configFiles: string[] = [];
    let gitAnalysis: GitAnalysis | undefined;

    // Check if we can perform incremental analysis
    if (incrementalUpdate && changedFilesForIncremental && this.persistentCache) {
      // Incremental analysis: only re-analyze changed files
      const incrementalStartTime = Date.now();
      logger.info('Starting incremental analysis', {
        changedFileCount: changedFilesForIncremental.length,
      });

      // Get cached data as base
      const persistentCacheKey = this.persistentCache.generateKey(
        this.repoPath,
        this.excludePaths,
        this.configHash
      );
      const currentCommitHash = await this.persistentCache.getGitCommitHash(this.repoPath);
      const cachedResult = await this.persistentCache.get(
        persistentCacheKey,
        this.repoPath,
        currentCommitHash || undefined
      );

      if (cachedResult.data) {
        // Use cached structure as base
        structure = cachedResult.data.structure;
        this.fileCount = cachedResult.data.fileCount;

        // For packages and config, do a quick check if any changed files affect them
        const packageFilesChanged = changedFilesForIncremental.some(
          f => f.endsWith('package.json')
        );
        const configFilesChanged = changedFilesForIncremental.some(
          f => f.includes('config') || f.startsWith('.') || f.endsWith('.json')
        );

        if (packageFilesChanged) {
          packages = await this.findPackages();
        } else {
          packages = cachedResult.data.packages;
        }

        if (configFilesChanged) {
          configFiles = await this.findConfigFiles();
        } else {
          configFiles = cachedResult.data.configFiles;
        }

        // Always refresh git analysis for incremental updates
        gitAnalysis = await this.analyzeGit();

        scanDuration = Date.now() - incrementalStartTime;
        logger.info('Incremental analysis complete', {
          duration: scanDuration,
          changedFiles: changedFilesForIncremental.length,
          packagesRefreshed: packageFilesChanged,
          configRefreshed: configFilesChanged,
        });
      } else {
        // Fall back to full analysis if cached data not available
        logger.warn('Incremental analysis failed, falling back to full analysis');
        incrementalUpdate = false;
      }
    }

    // Full analysis (when not doing incremental)
    if (!incrementalUpdate) {
      // Time directory scanning (async) - must complete first for file count
      const scanResult = await timeOperation(
        () => this.scanDirectory(this.repoPath),
        'scanDirectory'
      );
      structure = scanResult.result;
      scanDuration = scanResult.duration;

      logger.debug('Directory scan complete', {
        duration: scanDuration,
        fileCount: this.fileCount,
      });

      // Check if we hit the file limit
      if (this.fileCount >= this.maxFiles) {
        logger.warn(`File limit reached (${this.maxFiles}). Some files may not be included in analysis.`);
      }

      // Report progress: starting parallel analysis phase
      this.reportProgress({
        phase: 'analyzing-packages',
        filesScanned: this.fileCount,
        totalFiles: this.fileCount,
        percentComplete: 25,
      });

      // Run independent analysis tasks in parallel for better performance
      // This significantly improves analysis time for large codebases
      const parallelAnalysisStart = Date.now();

      const [packagesResult, configResult, gitResult] = await Promise.all([
        // Package analysis (independent of other analyses)
        this.findPackages().then(result => {
          this.reportProgress({
            phase: 'analyzing-config',
            filesScanned: this.fileCount,
            totalFiles: this.fileCount,
            percentComplete: 50,
          });
          return result;
        }),
        // Config file analysis (independent of other analyses)
        this.findConfigFiles().then(result => {
          return result;
        }),
        // Git analysis (independent of other analyses)
        this.analyzeGit().then(result => {
          this.reportProgress({
            phase: 'analyzing-git',
            filesScanned: this.fileCount,
            totalFiles: this.fileCount,
            percentComplete: 75,
          });
          return result;
        }),
      ]);

      packages = packagesResult;
      configFiles = configResult;
      gitAnalysis = gitResult;

      const parallelDuration = Date.now() - parallelAnalysisStart;
      logger.debug('Parallel analysis complete', {
        duration: parallelDuration,
        packageCount: packages.length,
        configCount: configFiles.length,
        hasGitAnalysis: !!gitAnalysis,
      });
    }

    // Generate recentChanges from git analysis for backward compatibility
    const recentChanges: string[] = [];
    if (gitAnalysis) {
      for (const commit of gitAnalysis.recentCommits.slice(0, 20)) {
        recentChanges.push(`[${commit.shortHash}] ${commit.message.split('\n')[0]} (${commit.author})`);
      }
    }

    const fileCount = this.countFiles(structure);
    const duration = Date.now() - startTime;
    const endMemory = getMemoryUsageMB();
    const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

    logger.info(`Analysis complete`, {
      fileCount,
      packageCount: packages.length,
      configFileCount: configFiles.length,
      gitCommits: gitAnalysis?.recentCommits.length ?? 0,
      gitActiveFiles: gitAnalysis?.fileChangeStats.length ?? 0,
      duration,
      memoryDeltaMB: memoryDelta,
    });

    // Log any validation warnings collected during analysis
    if (this.validationErrors.length > 0) {
      logger.warn(`Encountered ${this.validationErrors.length} validation issues during analysis`);
    }

    const result: CodebaseAnalysis = {
      structure,
      fileCount,
      recentChanges,
      packages,
      configFiles,
      gitAnalysis,
    };

    // Store in in-memory cache if enabled
    if (this.enableCache) {
      const cacheKey = this.cache.generateKey(this.repoPath, this.excludePaths, this.config);
      const contentHash = await this.cache.generateContentHash(this.repoPath);
      this.cache.set(cacheKey, result, contentHash);

      logCacheOperation('set', {
        key: cacheKey,
        repoPath: this.repoPath,
        cacheType: 'in-memory',
        fileCount: result.fileCount,
      });
    }

    // Store in persistent cache if enabled
    if (this.enablePersistentCache && this.persistentCache) {
      const persistentCacheKey = this.persistentCache.generateKey(
        this.repoPath,
        this.excludePaths,
        this.configHash // Use config hash for consistency with lookup
      );
      await this.persistentCache.set(
        persistentCacheKey,
        this.repoPath,
        result,
        this.excludePaths
      );

      const persistentStats = this.persistentCache.getStats();
      logCacheOperation('set', {
        key: persistentCacheKey,
        repoPath: this.repoPath,
        cacheType: 'persistent',
        fileCount: result.fileCount,
        stats: {
          hitRate: persistentStats.hitRate,
          totalHits: persistentStats.hits,
          totalMisses: persistentStats.misses,
          entryCount: persistentStats.totalEntries,
          sizeBytes: persistentStats.totalSizeBytes,
        } as Partial<CachePerformanceMetrics>,
      });

      logger.debug('Stored analysis in persistent cache', {
        key: persistentCacheKey,
        totalEntries: persistentStats.totalEntries,
        totalSize: formatBytes(persistentStats.totalSizeBytes),
        hitRate: `${(persistentStats.hitRate * 100).toFixed(1)}%`,
      });
    }

    // Record discovery metrics
    const repoName = this.repoPath.split('/').slice(-2).join('/');
    metrics.recordDiscovery(0, duration, cacheHit, { repository: repoName });

    // Log operation completion with full metrics
    const operationMetadata = finalizeOperationContext(operationContext, true, {
      cacheHit: false,
      fileCount,
      packageCount: packages.length,
      gitCommits: gitAnalysis?.recentCommits.length ?? 0,
      gitActiveFiles: gitAnalysis?.fileChangeStats.length ?? 0,
      memoryDeltaMB: memoryDelta,
      scanDuration,
    });
    logger.operationComplete('Analyzer', 'analyze', true, operationMetadata);

    // Report progress: complete
    this.reportProgress({
      phase: 'complete',
      filesScanned: fileCount,
      totalFiles: fileCount,
      percentComplete: 100,
    });

    return result;
  }

  /**
   * Check if a path should be excluded based on exclude patterns
   */
  private shouldExclude(relativePath: string): boolean {
    for (const pattern of this.excludePaths) {
      try {
        // First try as a simple prefix match
        if (relativePath.startsWith(pattern)) {
          return true;
        }
        // Then try as a regex pattern (with safety check already done in validateConfig)
        if (relativePath.match(pattern)) {
          return true;
        }
      } catch {
        // If the pattern fails to match, skip it and log a warning
        logger.debug(`Skipping invalid exclude pattern: ${pattern}`);
      }
    }
    return false;
  }

  private async scanDirectory(dirPath: string, depth: number = 0): Promise<DirectoryEntry[]> {
    // Enforce depth limit
    if (depth > this.maxDepth) {
      return [];
    }

    // Check file count limit
    if (this.fileCount >= this.maxFiles) {
      return [];
    }

    const entries: DirectoryEntry[] = [];

    try {
      const items = await readdir(dirPath);

      for (const item of items) {
        // Check file count limit on each iteration
        if (this.fileCount >= this.maxFiles) {
          break;
        }

        if (IGNORED_DIRS.has(item) || IGNORED_FILES.has(item)) {
          continue;
        }

        const fullPath = join(dirPath, item);
        const relativePath = relative(this.repoPath, fullPath);

        // Check exclude paths using safe matching
        if (this.shouldExclude(relativePath)) {
          continue;
        }

        try {
          const fileStat = await stat(fullPath);

          if (fileStat.isDirectory()) {
            entries.push({
              name: item,
              path: relativePath,
              type: 'directory',
              children: await this.scanDirectory(fullPath, depth + 1),
            });
          } else if (fileStat.isFile()) {
            this.fileCount++;
            entries.push({
              name: item,
              path: relativePath,
              type: 'file',
            });

            // Report progress periodically during scan
            if (this.fileCount % 100 === 0) {
              this.reportProgress({
                phase: 'scanning',
                filesScanned: this.fileCount,
                currentFile: relativePath,
              });
            }
          }
        } catch {
          // Skip files we can't access
        }
      }
    } catch (error) {
      logger.warn(`Failed to scan directory: ${dirPath}`, { error });
    }

    return entries;
  }

  private countFiles(entries: DirectoryEntry[]): number {
    let count = 0;
    for (const entry of entries) {
      if (entry.type === 'file') {
        count++;
      } else if (entry.children) {
        count += this.countFiles(entry.children);
      }
    }
    return count;
  }

  private async findPackages(): Promise<PackageInfo[]> {
    const packages: PackageInfo[] = [];
    let scannedDirs = 0;
    const maxDirsToScan = Math.min(this.maxFiles, 1000); // Limit package.json searching

    const findPackageJson = async (dirPath: string, depth: number = 0): Promise<void> => {
      // Enforce depth limit
      if (depth > this.maxDepth) {
        return;
      }

      if (scannedDirs >= maxDirsToScan) {
        return;
      }

      const packageJsonPath = join(dirPath, 'package.json');

      try {
        // Check if package.json exists and read it
        const fileStat = await stat(packageJsonPath);
        if (fileStat.isFile()) {
          const content = await readFile(packageJsonPath, 'utf-8');
          const pkg = JSON.parse(content);

          packages.push({
            name: pkg.name || relative(this.repoPath, dirPath),
            path: relative(this.repoPath, dirPath) || '.',
            dependencies: Object.keys(pkg.dependencies || {}),
            scripts: pkg.scripts || {},
          });
        }
      } catch {
        // package.json doesn't exist or is invalid - continue
      }

      scannedDirs++;

      // Check subdirectories
      try {
        const items = await readdir(dirPath);

        for (const item of items) {
          if (scannedDirs >= maxDirsToScan) {
            break;
          }

          if (IGNORED_DIRS.has(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);
          const relativePath = relative(this.repoPath, fullPath);

          // Check exclude paths
          if (this.shouldExclude(relativePath)) {
            continue;
          }

          try {
            const fileStat = await stat(fullPath);
            if (fileStat.isDirectory()) {
              await findPackageJson(fullPath, depth + 1);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await findPackageJson(this.repoPath);

    return packages;
  }

  private async findConfigFiles(): Promise<string[]> {
    const configFiles: string[] = [];
    const configPatterns = [
      /^\..*rc$/,
      /^\..*rc\.js$/,
      /^\..*rc\.json$/,
      /\.config\.(js|ts|json|mjs|cjs)$/,
      /^tsconfig.*\.json$/,
      /^package\.json$/,
      /^docker-compose.*\.ya?ml$/,
      /^Dockerfile$/,
      /^\.github/,
    ];

    // Only scan top-level config files (depth 2)
    const maxConfigDepth = Math.min(2, this.maxDepth);

    const scanDir = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (depth > maxConfigDepth) return;

      try {
        const items = await readdir(dirPath);

        for (const item of items) {
          if (IGNORED_DIRS.has(item)) {
            continue;
          }

          const fullPath = join(dirPath, item);
          const relativePath = relative(this.repoPath, fullPath);

          try {
            const fileStat = await stat(fullPath);

            if (fileStat.isFile()) {
              const isConfig = configPatterns.some((pattern) => pattern.test(item));
              if (isConfig) {
                configFiles.push(relativePath);
              }
            } else if (fileStat.isDirectory() && item === '.github') {
              // Include .github directory
              configFiles.push(relativePath);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await scanDir(this.repoPath);

    return configFiles;
  }

  // Generate a summary suitable for Claude
  generateSummary(analysis: CodebaseAnalysis): string {
    const lines: string[] = [];

    lines.push('## Codebase Structure\n');

    // Package overview
    if (analysis.packages.length > 0) {
      lines.push('### Packages\n');
      for (const pkg of analysis.packages) {
        lines.push(`- **${pkg.name}** (${pkg.path})`);
        if (Object.keys(pkg.scripts).length > 0) {
          const scriptNames = Object.keys(pkg.scripts).slice(0, 5).join(', ');
          lines.push(`  - Scripts: ${scriptNames}${Object.keys(pkg.scripts).length > 5 ? '...' : ''}`);
        }
      }
      lines.push('');
    }

    // Directory structure (top-level only)
    lines.push('### Top-Level Structure\n');
    for (const entry of analysis.structure) {
      const icon = entry.type === 'directory' ? '📁' : '📄';
      lines.push(`- ${icon} ${entry.name}`);
    }
    lines.push('');

    // Config files
    if (analysis.configFiles.length > 0) {
      lines.push('### Configuration Files\n');
      for (const file of analysis.configFiles.slice(0, 10)) {
        lines.push(`- ${file}`);
      }
      if (analysis.configFiles.length > 10) {
        lines.push(`- ... and ${analysis.configFiles.length - 10} more`);
      }
      lines.push('');
    }

    lines.push(`\n**Total Files:** ${analysis.fileCount}`);

    // Git analysis section
    if (analysis.gitAnalysis) {
      lines.push('\n### Recent Changes\n');
      const { summary, fileChangeStats } = analysis.gitAnalysis;

      lines.push(`**Commits (last ${this.gitAnalysisDays} days):** ${summary.totalCommits}`);
      lines.push(`**Active Files:** ${summary.activeFiles}`);

      if (summary.topContributors.length > 0) {
        lines.push(`**Top Contributors:** ${summary.topContributors.slice(0, 5).join(', ')}`);
      }

      if (summary.mostChangedFiles.length > 0) {
        lines.push('\n**Most Frequently Changed Files:**');
        for (const file of summary.mostChangedFiles.slice(0, 5)) {
          const stats = fileChangeStats.find(s => s.file === file);
          if (stats) {
            lines.push(`- ${file} (${stats.changeCount} changes, impact: ${stats.impactScore.toFixed(1)})`);
          }
        }
      }

      // Recent commit summaries
      if (analysis.gitAnalysis.recentCommits.length > 0) {
        lines.push('\n**Recent Commits:**');
        for (const commit of analysis.gitAnalysis.recentCommits.slice(0, 5)) {
          const date = commit.date.toISOString().split('T')[0];
          lines.push(`- [${commit.shortHash}] ${commit.message.split('\n')[0]} (${date})`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Git Analysis Methods
  // ============================================================================

  /**
   * Initialize the git instance for the repository
   */
  private async initGit(): Promise<SimpleGit | null> {
    if (this.git) return this.git;

    try {
      const gitDir = join(this.repoPath, '.git');
      if (!existsSync(gitDir)) {
        logger.debug('No .git directory found, skipping git analysis', { path: this.repoPath });
        return null;
      }

      const git = simpleGit(this.repoPath);
      // Verify it's a valid git repo
      await git.status();
      this.git = git;
      return git;
    } catch (error) {
      logger.debug('Failed to initialize git', { error, path: this.repoPath });
      return null;
    }
  }

  /**
   * Get recent commits from git history
   */
  async getRecentCommits(): Promise<GitCommitInfo[]> {
    const git = await this.initGit();
    if (!git) return [];

    try {
      const since = new Date();
      since.setDate(since.getDate() - this.gitAnalysisDays);
      const sinceStr = since.toISOString().split('T')[0];

      const logResult: LogResult<DefaultLogFields> = await git.log({
        maxCount: this.gitMaxCommits,
        '--since': sinceStr,
      });

      const commits: GitCommitInfo[] = [];

      for (const commit of logResult.all) {
        // Get files changed for this commit
        let filesChanged: string[] = [];
        try {
          const showResult = await git.show([
            commit.hash,
            '--name-only',
            '--format=',
          ]);
          filesChanged = showResult
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0);
        } catch {
          // Some commits might not have file info accessible
        }

        commits.push({
          hash: commit.hash,
          shortHash: commit.hash.substring(0, 7),
          author: commit.author_name,
          email: commit.author_email,
          date: new Date(commit.date),
          message: commit.message,
          filesChanged,
        });
      }

      logger.debug(`Retrieved ${commits.length} recent commits`, {
        days: this.gitAnalysisDays,
        maxCommits: this.gitMaxCommits,
      });

      return commits;
    } catch (error) {
      logger.warn('Failed to get recent commits', { error });
      return [];
    }
  }

  /**
   * Calculate file change statistics from commit history
   */
  private calculateFileChangeStats(commits: GitCommitInfo[]): FileChangeStats[] {
    const fileStats = new Map<string, {
      changeCount: number;
      lastModified: Date;
      authors: Set<string>;
      dates: Date[];
    }>();

    for (const commit of commits) {
      for (const file of commit.filesChanged) {
        const existing = fileStats.get(file) || {
          changeCount: 0,
          lastModified: new Date(0),
          authors: new Set<string>(),
          dates: [],
        };

        existing.changeCount++;
        existing.authors.add(commit.author);
        existing.dates.push(commit.date);

        if (commit.date > existing.lastModified) {
          existing.lastModified = commit.date;
        }

        fileStats.set(file, existing);
      }
    }

    // Calculate impact scores and convert to array
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const maxAge = this.gitAnalysisDays * dayMs;

    const results: FileChangeStats[] = [];
    for (const [file, stats] of fileStats) {
      // Impact score = change frequency weighted by recency
      // Higher score = more frequently changed AND changed recently
      const recencyWeight = stats.dates.reduce((sum, date) => {
        const age = now - date.getTime();
        return sum + (1 - Math.min(age / maxAge, 1));
      }, 0);

      const impactScore = stats.changeCount * (recencyWeight / Math.max(stats.dates.length, 1));

      results.push({
        file,
        changeCount: stats.changeCount,
        lastModified: stats.lastModified,
        authors: Array.from(stats.authors),
        impactScore: Math.round(impactScore * 10) / 10,
      });
    }

    // Sort by impact score descending
    results.sort((a, b) => b.impactScore - a.impactScore);

    return results;
  }

  /**
   * Analyze dependency relationships between files
   */
  async analyzeDependencyGraph(): Promise<DependencyGraph> {
    const dependencies: FileDependency[] = [];
    const filesWithDeps = new Set<string>();
    const filesAsDeps = new Set<string>();

    const importPatterns = [
      // ES6 imports: import x from 'y', import { x } from 'y'
      /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
      // CommonJS require: require('x'), require("x")
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      // Dynamic imports: import('x')
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    const scanFileForDeps = async (filePath: string): Promise<void> => {
      const ext = extname(filePath);
      if (!CODE_EXTENSIONS.has(ext)) return;

      try {
        const fileStat = await stat(filePath);
        if (fileStat.size > this.maxFileSizeBytes) return;

        const content = await readFile(filePath, 'utf-8');
        const relPath = relative(this.repoPath, filePath);

        for (let i = 0; i < importPatterns.length; i++) {
          const pattern = importPatterns[i];
          // Reset lastIndex for global regex
          pattern.lastIndex = 0;
          let match;

          while ((match = pattern.exec(content)) !== null) {
            const importPath = match[1];

            // Skip external packages (node_modules, bare imports)
            if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
              continue;
            }

            // Resolve the import path
            const sourceDir = dirname(filePath);
            let resolvedPath = importPath;

            if (importPath.startsWith('.')) {
              resolvedPath = relative(this.repoPath, resolve(sourceDir, importPath));
            }

            // Try to resolve file extensions
            const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '', '/index.ts', '/index.js'];
            let targetPath = resolvedPath;

            for (const ext of possibleExtensions) {
              const fullPath = join(this.repoPath, resolvedPath + ext);
              if (existsSync(fullPath)) {
                targetPath = resolvedPath + ext;
                break;
              }
            }

            const depType = i === 0 ? 'import' : i === 1 ? 'require' : 'dynamic';

            dependencies.push({
              source: relPath,
              target: targetPath,
              type: depType as 'import' | 'require' | 'dynamic',
            });

            filesWithDeps.add(relPath);
            filesAsDeps.add(targetPath);
          }
        }
      } catch {
        // Skip files we can't read
      }
    };

    // Scan all files for dependencies
    const scanDir = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (depth > this.maxDepth) return;

      try {
        const items = await readdir(dirPath);

        for (const item of items) {
          if (IGNORED_DIRS.has(item)) continue;

          const fullPath = join(dirPath, item);
          const relativePath = relative(this.repoPath, fullPath);

          if (this.shouldExclude(relativePath)) continue;

          try {
            const fileStat = await stat(fullPath);

            if (fileStat.isDirectory()) {
              await scanDir(fullPath, depth + 1);
            } else if (fileStat.isFile()) {
              await scanFileForDeps(fullPath);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await scanDir(this.repoPath);

    // Calculate entry points (files with no incoming dependencies)
    const allFiles = new Set([...filesWithDeps, ...filesAsDeps]);
    const entryPoints = [...allFiles].filter(f => !filesAsDeps.has(f));

    // Calculate hotspots (files imported by many others)
    const depCounts = new Map<string, number>();
    for (const dep of dependencies) {
      depCounts.set(dep.target, (depCounts.get(dep.target) || 0) + 1);
    }

    const hotspots = [...depCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file]) => file);

    return {
      files: [...allFiles],
      dependencies,
      entryPoints,
      hotspots,
    };
  }

  /**
   * Perform complete git analysis
   */
  async analyzeGit(): Promise<GitAnalysis | undefined> {
    if (!this.enableGitAnalysis) {
      logger.debug('Git analysis disabled');
      return undefined;
    }

    const git = await this.initGit();
    if (!git) {
      logger.debug('No git repository found');
      return undefined;
    }

    try {
      logger.debug('Starting git analysis', {
        days: this.gitAnalysisDays,
        maxCommits: this.gitMaxCommits,
      });

      // Get recent commits
      const recentCommits = await this.getRecentCommits();

      // Calculate file change stats
      const fileChangeStats = this.calculateFileChangeStats(recentCommits);

      // Analyze dependency graph
      const dependencyGraph = await this.analyzeDependencyGraph();

      // Generate summary
      const authorCounts = new Map<string, number>();
      for (const commit of recentCommits) {
        authorCounts.set(commit.author, (authorCounts.get(commit.author) || 0) + 1);
      }

      const topContributors = [...authorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([author]) => author);

      const mostChangedFiles = fileChangeStats
        .slice(0, 20)
        .map(s => s.file);

      const summary = {
        totalCommits: recentCommits.length,
        activeFiles: fileChangeStats.length,
        topContributors,
        mostChangedFiles,
      };

      logger.debug('Git analysis complete', {
        commits: recentCommits.length,
        activeFiles: fileChangeStats.length,
        dependencies: dependencyGraph.dependencies.length,
      });

      return {
        recentCommits,
        fileChangeStats,
        dependencyGraph,
        summary,
      };
    } catch (error) {
      logger.warn('Git analysis failed', { error });
      return undefined;
    }
  }
}
