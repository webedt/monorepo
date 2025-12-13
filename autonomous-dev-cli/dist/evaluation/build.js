import { execSync } from 'child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';
export class BuildCache {
    cache = new Map();
    maxEntries;
    ttlMs;
    stats = { hits: 0, misses: 0, invalidations: 0 };
    constructor(options = {}) {
        this.maxEntries = options.maxEntries ?? 50;
        this.ttlMs = options.ttlMs ?? 10 * 60 * 1000; // 10 minutes default
    }
    /**
     * Generate a content hash based on source files to detect changes
     */
    generateContentHash(repoPath, packages = []) {
        const hashData = [];
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
                }
                catch {
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
            }
            catch {
                // Skip
            }
        }
        return createHash('md5').update(hashData.join('|')).digest('hex');
    }
    collectSourceHashes(dirPath, maxFiles) {
        const hashes = [];
        let count = 0;
        const scanDir = (path, depth = 0) => {
            if (depth > 5 || count >= maxFiles)
                return;
            try {
                const items = readdirSync(path);
                for (const item of items) {
                    if (count >= maxFiles)
                        break;
                    if (['node_modules', 'dist', 'build', '.git'].includes(item))
                        continue;
                    const fullPath = join(path, item);
                    try {
                        const stat = statSync(fullPath);
                        if (stat.isFile() && /\.(ts|tsx|js|jsx|json)$/.test(item)) {
                            hashes.push(`${fullPath}:${stat.mtimeMs}`);
                            count++;
                        }
                        else if (stat.isDirectory()) {
                            scanDir(fullPath, depth + 1);
                        }
                    }
                    catch {
                        // Skip inaccessible
                    }
                }
            }
            catch {
                // Skip inaccessible directories
            }
        };
        scanDir(dirPath);
        return hashes;
    }
    /**
     * Generate a cache key from build options
     */
    generateKey(repoPath, packages) {
        const keyData = JSON.stringify({ repoPath, packages });
        return createHash('md5').update(keyData).digest('hex');
    }
    /**
     * Get cached build result if valid
     */
    get(key, currentContentHash) {
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
    set(key, result, contentHash) {
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
    clear() {
        this.cache.clear();
    }
    /**
     * Get cache statistics
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.cache.size,
            hitRate: total > 0 ? this.stats.hits / total : 0,
        };
    }
}
// Global build cache instance
let globalBuildCache = null;
export function getBuildCache() {
    if (!globalBuildCache) {
        globalBuildCache = new BuildCache();
    }
    return globalBuildCache;
}
export function initBuildCache(options) {
    globalBuildCache = new BuildCache(options);
    return globalBuildCache;
}
export async function runBuild(options) {
    const { repoPath, packages = [], timeout = 5 * 60 * 1000, enableCache = true, cache: customCache, } = options;
    const startTime = Date.now();
    logger.info('Running build verification...');
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
            }
            catch (execError) {
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
        logger.success('Build completed successfully');
        const result = {
            success: true,
            output: combinedOutput,
            duration: Date.now() - startTime,
        };
        // Cache the successful result
        if (enableCache) {
            const cacheKey = buildCache.generateKey(repoPath, packages);
            const contentHash = buildCache.generateContentHash(repoPath, packages);
            buildCache.set(cacheKey, result, contentHash);
        }
        return result;
    }
    catch (error) {
        logger.error('Build verification failed', { error: error.message });
        return {
            success: false,
            output: '',
            duration: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function determineBuildCommands(repoPath, packages) {
    const commands = [];
    // Check for root package.json
    const rootPackageJson = join(repoPath, 'package.json');
    if (existsSync(rootPackageJson)) {
        try {
            const pkg = require(rootPackageJson);
            // Check if it's a monorepo with workspaces
            const hasWorkspaces = pkg.workspaces && pkg.workspaces.length > 0;
            if (hasWorkspaces && pkg.scripts?.build) {
                // Monorepo with root build script (e.g., turbo, nx, lerna)
                commands.push({
                    command: 'npm run build',
                    cwd: repoPath,
                });
            }
            else if (pkg.scripts?.build) {
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
        catch {
            // Ignore JSON parse errors
        }
    }
    // If specific packages provided, add their build commands
    if (packages.length > 0) {
        for (const pkgPath of packages) {
            const fullPath = join(repoPath, pkgPath);
            const pkgJsonPath = join(fullPath, 'package.json');
            if (existsSync(pkgJsonPath)) {
                try {
                    const pkg = require(pkgJsonPath);
                    if (pkg.scripts?.build) {
                        commands.push({
                            command: 'npm run build',
                            cwd: fullPath,
                        });
                    }
                }
                catch {
                    // Ignore
                }
            }
        }
    }
    return commands;
}
// Type-check only (faster than full build)
export async function runTypeCheck(repoPath) {
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
    }
    catch (error) {
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
//# sourceMappingURL=build.js.map