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
import { stat, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { simpleGit } from 'simple-git';
import { logger } from './logger.js';
// ============================================================================
// Cache Key Utilities
// ============================================================================
/**
 * Generate a deterministic cache key from components
 */
export function generateCacheKey(...components) {
    const keyData = components
        .map(c => {
        if (c === null || c === undefined)
            return '';
        if (typeof c === 'object')
            return JSON.stringify(c, Object.keys(c).sort());
        return String(c);
    })
        .join('|');
    return createHash('sha256').update(keyData).digest('hex').substring(0, 32);
}
/**
 * Generate a short cache key (16 chars) for display purposes
 */
export function generateShortCacheKey(...components) {
    return generateCacheKey(...components).substring(0, 16);
}
const DEFAULT_IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.cache',
    '.turbo',
    '__pycache__',
    '.venv',
    'venv',
]);
/**
 * Collect file modification info for a directory tree
 */
export async function collectFileModifications(rootPath, options = {}) {
    const { maxFiles = 100, maxDepth = 4, ignoreDirs = DEFAULT_IGNORED_DIRS, } = options;
    const modifications = [];
    const collect = async (dirPath, depth) => {
        if (depth > maxDepth || modifications.length >= maxFiles)
            return;
        try {
            const items = await readdir(dirPath);
            for (const item of items) {
                if (modifications.length >= maxFiles)
                    break;
                if (ignoreDirs.has(item))
                    continue;
                const fullPath = join(dirPath, item);
                try {
                    const fileStat = await stat(fullPath);
                    if (fileStat.isFile()) {
                        modifications.push({
                            path: relative(rootPath, fullPath),
                            mtimeMs: fileStat.mtimeMs,
                            size: fileStat.size,
                        });
                    }
                    else if (fileStat.isDirectory()) {
                        await collect(fullPath, depth + 1);
                    }
                }
                catch {
                    // Skip inaccessible files
                }
            }
        }
        catch {
            // Skip inaccessible directories
        }
    };
    await collect(rootPath, 0);
    return modifications;
}
/**
 * Generate a content hash from file modifications
 */
export function generateContentHashFromModifications(modifications) {
    const sortedMods = [...modifications].sort((a, b) => a.path.localeCompare(b.path));
    const hashData = sortedMods.map(m => `${m.path}:${m.mtimeMs}:${m.size}`).join('|');
    return createHash('sha256').update(hashData).digest('hex').substring(0, 32);
}
/**
 * Get git change information between commits or from working directory
 */
export async function getGitChangeInfo(repoPath, fromCommit) {
    try {
        const gitDir = join(repoPath, '.git');
        if (!existsSync(gitDir)) {
            return null;
        }
        const git = simpleGit(repoPath);
        // Get current commit hash
        const logResult = await git.log({ maxCount: 1 });
        const currentCommitHash = logResult.latest?.hash || '';
        // Get current branch
        const branchResult = await git.branch();
        const branch = branchResult.current || 'unknown';
        // If no fromCommit, just return current state
        if (!fromCommit) {
            return {
                currentCommitHash,
                changedFiles: [],
                hasChanges: false,
                branch,
            };
        }
        // Get changed files between commits
        try {
            const diff = await git.diff(['--name-only', fromCommit, currentCommitHash]);
            const changedFiles = diff
                .split('\n')
                .map(f => f.trim())
                .filter(f => f.length > 0);
            return {
                currentCommitHash,
                changedFiles,
                hasChanges: changedFiles.length > 0,
                branch,
            };
        }
        catch (error) {
            // Fallback if diff fails (e.g., fromCommit doesn't exist)
            logger.debug('Git diff failed, treating as full change', { error, fromCommit });
            return {
                currentCommitHash,
                changedFiles: [],
                hasChanges: true,
                branch,
            };
        }
    }
    catch (error) {
        logger.debug('Failed to get git change info', { error, repoPath });
        return null;
    }
}
/**
 * Check if specific files have changed since a commit
 */
export async function haveFilesChangedSinceCommit(repoPath, fromCommit, filePaths) {
    const changeInfo = await getGitChangeInfo(repoPath, fromCommit);
    if (!changeInfo)
        return true; // Assume changed if we can't check
    const changedSet = new Set(changeInfo.changedFiles);
    return filePaths.some(f => changedSet.has(f));
}
/**
 * Calculate cache hit rate
 */
export function calculateHitRate(hits, misses) {
    const total = hits + misses;
    return total > 0 ? hits / total : 0;
}
/**
 * Format cache metrics for logging
 */
export function formatCacheMetrics(metrics) {
    return [
        `Hit Rate: ${(metrics.hitRate * 100).toFixed(1)}%`,
        `Total Lookups: ${metrics.totalLookups}`,
        `Hits: ${metrics.totalHits}`,
        `Misses: ${metrics.totalMisses}`,
        `Evictions: ${metrics.evictions}`,
        `Invalidations: ${metrics.invalidations}`,
        `Entries: ${metrics.entryCount}`,
        `Size: ${formatBytes(metrics.sizeBytes)}`,
        `Avg Access: ${metrics.averageAccessTimeMs.toFixed(2)}ms`,
    ].join(' | ');
}
/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}
/**
 * Generate a configuration hash for cache invalidation
 * This ensures cache is invalidated when configuration changes
 */
export function generateConfigHash(config, version = 1) {
    // Create a deterministic hash of the configuration
    const sortedConfig = JSON.stringify(config, Object.keys(config).sort());
    const hash = createHash('sha256')
        .update(sortedConfig)
        .update(String(version))
        .digest('hex')
        .substring(0, 16);
    return {
        hash,
        version,
        timestamp: Date.now(),
    };
}
/**
 * Check if configuration has changed since last cache
 */
export function hasConfigChanged(currentConfig, cachedConfigHash) {
    if (!cachedConfigHash)
        return false; // No cached config, so can't have changed
    const currentHash = generateConfigHash(currentConfig).hash;
    return currentHash !== cachedConfigHash;
}
/**
 * Determine which entries should be cleaned up based on policy
 */
export function getEntriesToCleanup(entries, policy) {
    const now = Date.now();
    const entriesToRemove = [];
    const sortedEntries = [...entries];
    // Remove expired entries first
    const expiredKeys = sortedEntries
        .filter(e => now - e.timestamp > policy.maxAgeMs)
        .map(e => e.key);
    entriesToRemove.push(...expiredKeys);
    // Filter out expired entries for further processing
    const remainingEntries = sortedEntries.filter(e => !expiredKeys.includes(e.key));
    // Sort by LRU (least recently used first)
    remainingEntries.sort((a, b) => a.lastAccessTime - b.lastAccessTime);
    // Remove entries exceeding count limit
    if (remainingEntries.length > policy.maxEntries) {
        const countExcess = remainingEntries.length - policy.maxEntries;
        const countRemoveKeys = remainingEntries.slice(0, countExcess).map(e => e.key);
        entriesToRemove.push(...countRemoveKeys);
    }
    // Check size limit
    const activeEntries = remainingEntries.filter(e => !entriesToRemove.includes(e.key));
    let totalSize = activeEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
    // Remove entries until under size limit
    for (const entry of activeEntries) {
        if (totalSize <= policy.maxSizeBytes)
            break;
        entriesToRemove.push(entry.key);
        totalSize -= entry.sizeBytes;
    }
    return [...new Set(entriesToRemove)]; // Remove duplicates
}
/**
 * Log a cache operation with detailed context
 */
export function logCacheOperation(operation, details) {
    const message = `Cache ${operation}`;
    const logData = {
        operation,
        ...details,
        timestamp: Date.now(),
    };
    switch (operation) {
        case 'hit':
            logger.debug(message, { ...logData, cached: true });
            break;
        case 'miss':
            logger.debug(message, { ...logData, cached: false });
            break;
        case 'invalidate':
        case 'evict':
            logger.debug(message, logData);
            break;
        case 'cleanup':
            logger.info(message, logData);
            break;
        default:
            logger.debug(message, logData);
    }
}
/**
 * Log cache performance summary
 */
export function logCachePerformanceSummary(cacheName, metrics) {
    logger.info(`${cacheName} Performance Summary`, {
        cacheName,
        hitRate: `${(metrics.hitRate * 100).toFixed(1)}%`,
        lookups: metrics.totalLookups,
        hits: metrics.totalHits,
        misses: metrics.totalMisses,
        evictions: metrics.evictions,
        invalidations: metrics.invalidations,
        entries: metrics.entryCount,
        sizeBytes: metrics.sizeBytes,
        sizeFormatted: formatBytes(metrics.sizeBytes),
        avgAccessTimeMs: metrics.averageAccessTimeMs.toFixed(2),
    });
}
//# sourceMappingURL=cache.js.map