import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  logger,
  getCorrelationId,
  timeOperation,
  createOperationContext,
  finalizeOperationContext,
  startPhase,
  endPhase,
  recordPhaseOperation,
  recordPhaseError,
} from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

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
  packages?: string[]; // Specific packages to build, or all if empty
  timeout?: number; // Timeout in ms (default: 5 minutes)
  enableCache?: boolean; // Enable build caching (default: true)
  cache?: BuildCache; // Custom cache instance
}

// ============================================================================
// Build Cache
// ============================================================================

interface BuildCacheEntry {
  result: BuildResult;
  timestamp: number;
  contentHash: string;
}

export class BuildCache {
  private cache: Map<string, BuildCacheEntry> = new Map();
  private maxEntries: number;
  private ttlMs: number;
  private stats = { hits: 0, misses: 0, invalidations: 0 };

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 50;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000; // 10 minutes default
  }

  /**
   * Generate a content hash based on source files to detect changes
   */
  generateContentHash(repoPath: string, packages: string[] = []): string {
    const hashData: string[] = [];

    // Include package.json files
    const packageJsonPaths = packages.length > 0
      ? packages.map(p => join(repoPath, p, 'package.json'))
      : [join(repoPath, 'package.json')];

    for (const pkgPath of packageJsonPaths) {
      if (existsSync(pkgPath)) {
        try {
          const stat = statSync(pkgPath);
          const content = readFileSync(pkgPath, 'utf-8');
          hashData.push(`${pkgPath}:${stat.mtimeMs}:${content.length}`);
        } catch {
          // Skip inaccessible files
        }
      }
    }

    // Include source file modifications (sample)
    const srcDirs = packages.length > 0
      ? packages.map(p => join(repoPath, p, 'src'))
      : [join(repoPath, 'src')];

    for (const srcDir of srcDirs) {
      if (existsSync(srcDir)) {
        const sourceHashes = this.collectSourceHashes(srcDir, 100);
        hashData.push(...sourceHashes);
      }
    }

    // Include tsconfig if exists
    const tsconfigPath = join(repoPath, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      try {
        const stat = statSync(tsconfigPath);
        hashData.push(`${tsconfigPath}:${stat.mtimeMs}`);
      } catch {
        // Skip
      }
    }

    return createHash('md5').update(hashData.join('|')).digest('hex');
  }

  private collectSourceHashes(dirPath: string, maxFiles: number): string[] {
    const hashes: string[] = [];
    let count = 0;

    const scanDir = (path: string, depth: number = 0) => {
      if (depth > 5 || count >= maxFiles) return;

      try {
        const items = readdirSync(path);
        for (const item of items) {
          if (count >= maxFiles) break;
          if (['node_modules', 'dist', 'build', '.git'].includes(item)) continue;

          const fullPath = join(path, item);
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && /\.(ts|tsx|js|jsx|json)$/.test(item)) {
              hashes.push(`${fullPath}:${stat.mtimeMs}`);
              count++;
            } else if (stat.isDirectory()) {
              scanDir(fullPath, depth + 1);
            }
          } catch {
            // Skip inaccessible
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    scanDir(dirPath);
    return hashes;
  }

  /**
   * Generate a cache key from build options
   */
  generateKey(repoPath: string, packages: string[]): string {
    const keyData = JSON.stringify({ repoPath, packages });
    return createHash('md5').update(keyData).digest('hex');
  }

  /**
   * Get cached build result if valid
   */
  get(key: string, currentContentHash: string): BuildResult | null {
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
      logger.debug('Build cache entry expired', { key });
      return null;
    }

    // Check content hash
    if (entry.contentHash !== currentContentHash) {
      this.cache.delete(key);
      this.stats.invalidations++;
      this.stats.misses++;
      logger.debug('Build cache invalidated due to source changes', { key });
      return null;
    }

    this.stats.hits++;
    logger.debug('Build cache hit', { key });
    return { ...entry.result, cached: true, cacheKey: key };
  }

  /**
   * Store build result in cache
   */
  set(key: string, result: BuildResult, contentHash: string): void {
    // Only cache successful builds
    if (!result.success) {
      logger.debug('Skipping cache for failed build', { key });
      return;
    }

    // Enforce max entries
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      result: { ...result, cached: false },
      timestamp: Date.now(),
      contentHash,
    });
    logger.debug('Cached build result', { key });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; invalidations: number; size: number; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }
}

// Global build cache instance
let globalBuildCache: BuildCache | null = null;

export function getBuildCache(): BuildCache {
  if (!globalBuildCache) {
    globalBuildCache = new BuildCache();
  }
  return globalBuildCache;
}

export function initBuildCache(options?: { maxEntries?: number; ttlMs?: number }): BuildCache {
  globalBuildCache = new BuildCache(options);
  return globalBuildCache;
}

// ============================================================================
// Package.json Cache for async loading
// ============================================================================

/**
 * Workspace configuration can be:
 * - An array of glob patterns (npm/yarn workspaces)
 * - An object with packages array (yarn workspaces extended format)
 * - An object with packages and nohoist arrays (yarn workspaces)
 */
interface WorkspacesConfig {
  packages?: string[];
  nohoist?: string[];
}

interface PackageJson {
  name?: string;
  type?: 'module' | 'commonjs';
  scripts?: Record<string, string>;
  workspaces?: string[] | WorkspacesConfig;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Error class for package.json parsing and validation errors
 */
export class PackageJsonError extends Error {
  public readonly filePath: string;
  public readonly errorType: 'not_found' | 'malformed_json' | 'invalid_structure' | 'read_error';
  public readonly cause?: Error;

  constructor(
    message: string,
    filePath: string,
    errorType: 'not_found' | 'malformed_json' | 'invalid_structure' | 'read_error',
    cause?: Error
  ) {
    super(message);
    this.name = 'PackageJsonError';
    this.filePath = filePath;
    this.errorType = errorType;
    this.cause = cause;
  }
}

interface PackageJsonCacheEntry {
  data: PackageJson;
  timestamp: number;
}

const packageJsonCache = new Map<string, PackageJsonCacheEntry>();
const PACKAGE_JSON_CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Validates basic package.json structure
 */
function validatePackageJsonStructure(data: unknown, filePath: string): data is PackageJson {
  if (data === null || typeof data !== 'object') {
    logger.warn(`Invalid package.json structure in ${filePath}: expected object, got ${typeof data}`);
    return false;
  }

  const pkg = data as Record<string, unknown>;

  // Validate scripts if present
  if (pkg.scripts !== undefined && (typeof pkg.scripts !== 'object' || pkg.scripts === null)) {
    logger.warn(`Invalid scripts field in ${filePath}: expected object`);
    return false;
  }

  // Validate workspaces if present
  if (pkg.workspaces !== undefined) {
    if (!Array.isArray(pkg.workspaces) && (typeof pkg.workspaces !== 'object' || pkg.workspaces === null)) {
      logger.warn(`Invalid workspaces field in ${filePath}: expected array or object`);
      return false;
    }
  }

  // Validate type field if present
  if (pkg.type !== undefined && pkg.type !== 'module' && pkg.type !== 'commonjs') {
    logger.warn(`Invalid type field in ${filePath}: expected 'module' or 'commonjs', got '${pkg.type}'`);
    // Don't fail validation, just warn - some packages have non-standard values
  }

  return true;
}

/**
 * Asynchronously load and parse a package.json file using ES module compatible approach.
 * Uses dynamic import() for ES module compatibility while falling back to fs.readFile
 * for environments where import() of JSON is not supported.
 *
 * Returns null if the file doesn't exist or contains malformed JSON.
 * Throws PackageJsonError for recoverable errors that callers may want to handle.
 */
async function loadPackageJson(filePath: string, options: { throwOnError?: boolean } = {}): Promise<PackageJson | null> {
  const { throwOnError = false } = options;

  // Check cache first
  const cached = packageJsonCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < PACKAGE_JSON_CACHE_TTL_MS) {
    return cached.data;
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    if (throwOnError) {
      throw new PackageJsonError(
        `Package.json not found: ${filePath}`,
        filePath,
        'not_found'
      );
    }
    return null;
  }

  try {
    // Use fs.readFile for ES module compatibility
    // Note: dynamic import() of JSON requires experimental flags in Node.js
    // and has inconsistent support across environments
    const content = await readFile(filePath, 'utf-8');

    // Handle empty files
    if (!content.trim()) {
      const error = new PackageJsonError(
        `Empty package.json file: ${filePath}`,
        filePath,
        'malformed_json'
      );
      if (throwOnError) throw error;
      logger.warn(error.message);
      return null;
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (parseError) {
      const error = new PackageJsonError(
        `Malformed JSON in ${filePath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        filePath,
        'malformed_json',
        parseError instanceof Error ? parseError : undefined
      );
      if (throwOnError) throw error;
      logger.warn(error.message);
      return null;
    }

    // Validate structure
    if (!validatePackageJsonStructure(data, filePath)) {
      const error = new PackageJsonError(
        `Invalid package.json structure in ${filePath}`,
        filePath,
        'invalid_structure'
      );
      if (throwOnError) throw error;
      return null;
    }

    // Cache the result
    packageJsonCache.set(filePath, {
      data: data as PackageJson,
      timestamp: Date.now(),
    });

    return data as PackageJson;
  } catch (error) {
    // Re-throw PackageJsonError
    if (error instanceof PackageJsonError) {
      throw error;
    }

    const pkgError = new PackageJsonError(
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      'read_error',
      error instanceof Error ? error : undefined
    );

    if (throwOnError) throw pkgError;
    logger.debug(pkgError.message);
    return null;
  }
}

/**
 * Clear the package.json cache. Useful for testing or when files are known to have changed.
 */
export function clearPackageJsonCache(): void {
  packageJsonCache.clear();
}

export async function runBuild(options: BuildOptions): Promise<BuildResult> {
  const {
    repoPath,
    packages = [],
    timeout = 5 * 60 * 1000,
    enableCache = true,
    cache: customCache,
  } = options;
  const startTime = Date.now();
  const correlationId = getCorrelationId();

  // Start evaluation phase if tracking
  if (correlationId) {
    startPhase(correlationId, 'evaluation', {
      operation: 'build',
      repoPath,
      packageCount: packages.length,
    });
    recordPhaseOperation(correlationId, 'evaluation', 'runBuild');
  }

  // Create operation context for structured logging
  const operationContext = createOperationContext('Build', 'runBuild', {
    repoPath,
    packages,
    timeout,
    enableCache,
  });

  logger.info('Running build verification...', {
    correlationId,
    repoPath,
    packageCount: packages.length,
  });

  const buildCache = customCache ?? getBuildCache();

  // Check cache if enabled
  if (enableCache) {
    const cacheKey = buildCache.generateKey(repoPath, packages);
    const contentHash = buildCache.generateContentHash(repoPath, packages);

    const cached = buildCache.get(cacheKey, contentHash);
    if (cached) {
      logger.info('Using cached build result', {
        repoPath,
        stats: buildCache.getStats(),
      });
      return {
        ...cached,
        duration: 0, // Cached builds are instant
        cached: true,
        cacheKey,
      };
    }
  }

  try {
    // Determine build commands based on project structure
    const buildCommands = await determineBuildCommands(repoPath, packages);

    if (buildCommands.length === 0) {
      logger.warn('No build commands found');
      return {
        success: true,
        output: 'No build configuration found, skipping build',
        duration: Date.now() - startTime,
      };
    }

    let combinedOutput = '';

    for (const { command, cwd } of buildCommands) {
      logger.info(`Running: ${command} in ${cwd}`);

      try {
        const output = execSync(command, {
          cwd,
          timeout,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            CI: 'true',
            NODE_ENV: 'production',
          },
        });

        combinedOutput += `\n=== ${command} ===\n${output}`;
      } catch (execError: any) {
        const stderr = execError.stderr?.toString() || '';
        const stdout = execError.stdout?.toString() || '';

        logger.error(`Build failed: ${command}`, { stderr, stdout });

        return {
          success: false,
          output: `${combinedOutput}\n=== ${command} (FAILED) ===\n${stdout}\n${stderr}`,
          duration: Date.now() - startTime,
          error: `Build command failed: ${command}`,
        };
      }
    }

    const duration = Date.now() - startTime;

    logger.success('Build completed successfully');

    const result: BuildResult = {
      success: true,
      output: combinedOutput,
      duration,
    };

    // Cache the successful result
    if (enableCache) {
      const cacheKey = buildCache.generateKey(repoPath, packages);
      const contentHash = buildCache.generateContentHash(repoPath, packages);
      buildCache.set(cacheKey, result, contentHash);
    }

    // End evaluation phase successfully
    if (correlationId) {
      endPhase(correlationId, 'evaluation', true, {
        operation: 'build',
        duration,
        commandCount: buildCommands.length,
      });
    }

    // Log operation completion with metrics
    const operationMetadata = finalizeOperationContext(operationContext, true, {
      duration,
      commandCount: buildCommands.length,
    });
    logger.operationComplete('Build', 'runBuild', true, operationMetadata);

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Record error in phase tracking
    if (correlationId) {
      recordPhaseError(correlationId, 'evaluation', 'BUILD_FAILED');
      endPhase(correlationId, 'evaluation', false, {
        operation: 'build',
        error: error.message,
        duration,
      });
    }

    // Log operation failure
    const operationMetadata = finalizeOperationContext(operationContext, false, {
      error: error.message,
      duration,
    });
    logger.operationComplete('Build', 'runBuild', false, operationMetadata);

    logger.error('Build verification failed', {
      error: error.message,
      correlationId,
      duration,
    });

    return {
      success: false,
      output: '',
      duration,
      error: error.message,
    };
  }
}

interface BuildCommand {
  command: string;
  cwd: string;
}

/**
 * Result of workspace detection
 */
interface WorkspaceDetectionResult {
  hasWorkspaces: boolean;
  workspacePatterns: string[];
  format: 'array' | 'object' | 'none';
}

/**
 * Detects and normalizes workspace configuration from package.json.
 * Supports both ESM (array) and CJS/Yarn (object with packages) formats:
 *
 * ESM/npm format:
 *   "workspaces": ["packages/star", "apps/star"]
 *
 * Yarn/CJS object format:
 *   "workspaces": { "packages": ["packages/star"], "nohoist": ["star-star/react-native"] }
 *
 * (Note: 'star' represents glob asterisk patterns in the above examples)
 *
 * @param pkg - The parsed package.json object
 * @returns Normalized workspace detection result
 */
function detectWorkspaces(pkg: PackageJson | null): WorkspaceDetectionResult {
  const noWorkspaces: WorkspaceDetectionResult = {
    hasWorkspaces: false,
    workspacePatterns: [],
    format: 'none',
  };

  if (!pkg || pkg.workspaces === undefined) {
    return noWorkspaces;
  }

  const workspaces = pkg.workspaces;

  // Handle array format (ESM/npm workspaces)
  if (Array.isArray(workspaces)) {
    const validPatterns = workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0
    );

    if (validPatterns.length === 0) {
      logger.debug('Workspaces array is empty or contains no valid patterns');
      return noWorkspaces;
    }

    return {
      hasWorkspaces: true,
      workspacePatterns: validPatterns,
      format: 'array',
    };
  }

  // Handle object format (Yarn workspaces extended)
  if (typeof workspaces === 'object' && workspaces !== null) {
    const wsConfig = workspaces as WorkspacesConfig;

    // Check for packages array in object format
    if (Array.isArray(wsConfig.packages)) {
      const validPatterns = wsConfig.packages.filter(
        (pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0
      );

      if (validPatterns.length === 0) {
        logger.debug('Workspaces.packages array is empty or contains no valid patterns');
        return noWorkspaces;
      }

      return {
        hasWorkspaces: true,
        workspacePatterns: validPatterns,
        format: 'object',
      };
    }

    logger.debug('Workspaces object does not contain valid packages array');
    return noWorkspaces;
  }

  logger.warn(`Unexpected workspaces format: ${typeof workspaces}`);
  return noWorkspaces;
}

/**
 * Checks if a project has monorepo indicators beyond just workspaces.
 * This helps validate workspace detection and identify monorepo tooling.
 */
function detectMonorepoTooling(repoPath: string): {
  hasTurbo: boolean;
  hasNx: boolean;
  hasLerna: boolean;
  hasPnpmWorkspace: boolean;
} {
  return {
    hasTurbo: existsSync(join(repoPath, 'turbo.json')),
    hasNx: existsSync(join(repoPath, 'nx.json')),
    hasLerna: existsSync(join(repoPath, 'lerna.json')),
    hasPnpmWorkspace: existsSync(join(repoPath, 'pnpm-workspace.yaml')),
  };
}

async function determineBuildCommands(repoPath: string, packages: string[]): Promise<BuildCommand[]> {
  const commands: BuildCommand[] = [];

  // Check for root package.json
  const rootPackageJson = join(repoPath, 'package.json');
  const pkg = await loadPackageJson(rootPackageJson);

  if (pkg) {
    // Detect workspace configuration with support for both ESM and CJS formats
    const workspaceInfo = detectWorkspaces(pkg);
    const monorepoTooling = detectMonorepoTooling(repoPath);

    // Check if it's a monorepo (has workspaces or monorepo tooling)
    const isMonorepo = workspaceInfo.hasWorkspaces ||
      monorepoTooling.hasTurbo ||
      monorepoTooling.hasNx ||
      monorepoTooling.hasLerna ||
      monorepoTooling.hasPnpmWorkspace;

    if (isMonorepo) {
      logger.debug('Detected monorepo configuration', {
        workspaceFormat: workspaceInfo.format,
        workspacePatterns: workspaceInfo.workspacePatterns,
        tooling: monorepoTooling,
      });
    }

    if (isMonorepo && pkg.scripts?.build) {
      // Monorepo with root build script (e.g., turbo, nx, lerna)
      commands.push({
        command: 'npm run build',
        cwd: repoPath,
      });
    } else if (pkg.scripts?.build) {
      // Simple project with build script
      commands.push({
        command: 'npm run build',
        cwd: repoPath,
      });
    }

    // Check for TypeScript
    if (existsSync(join(repoPath, 'tsconfig.json')) && !pkg.scripts?.build) {
      commands.push({
        command: 'npx tsc --noEmit',
        cwd: repoPath,
      });
    }
  }

  // If specific packages provided, add their build commands
  if (packages.length > 0) {
    for (const pkgPath of packages) {
      const fullPath = join(repoPath, pkgPath);
      const pkgJsonPath = join(fullPath, 'package.json');

      try {
        const subPkg = await loadPackageJson(pkgJsonPath);

        if (subPkg?.scripts?.build) {
          commands.push({
            command: 'npm run build',
            cwd: fullPath,
          });
        }
      } catch (error) {
        // Log but continue with other packages
        if (error instanceof PackageJsonError) {
          logger.warn(`Skipping package at ${pkgPath}: ${error.message}`);
        } else {
          logger.warn(`Failed to load package.json at ${pkgPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  return commands;
}

/**
 * Export workspace detection for testing and external use
 */
export { detectWorkspaces, detectMonorepoTooling, type WorkspaceDetectionResult };

// Type-check only (faster than full build)
export async function runTypeCheck(repoPath: string): Promise<BuildResult> {
  const startTime = Date.now();

  logger.info('Running TypeScript type check...');

  // Find tsconfig
  const tsconfigPath = join(repoPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return {
      success: true,
      output: 'No tsconfig.json found, skipping type check',
      duration: Date.now() - startTime,
    };
  }

  try {
    const output = execSync('npx tsc --noEmit', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 3 * 60 * 1000, // 3 minutes
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    logger.success('Type check passed');

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    const stdout = error.stdout?.toString() || '';

    logger.error('Type check failed');

    return {
      success: false,
      output: `${stdout}\n${stderr}`,
      duration: Date.now() - startTime,
      error: 'TypeScript type check failed',
    };
  }
}
