/**
 * Workspace cleanup utilities with verification, retry logic, and error recovery.
 * Provides robust cleanup operations for worker workspaces with fallback strategies.
 */

import { existsSync, rmSync, readdirSync, statSync, chmodSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { StructuredError, ErrorCode, withRetry } from './errors.js';

/**
 * Result of a cleanup operation
 */
export interface CleanupResult {
  success: boolean;
  path: string;
  duration: number;
  retries: number;
  error?: string;
  strategy?: CleanupStrategy;
}

/**
 * Cleanup strategy used
 */
export type CleanupStrategy = 'standard' | 'force_permissions' | 'incremental' | 'deferred';

/**
 * Configuration for cleanup operations
 */
export interface CleanupConfig {
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  enableDeferredCleanup: boolean;
}

export const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  maxRetries: 3,
  retryDelayMs: 500,
  timeoutMs: 30000,
  enableDeferredCleanup: true,
};

/**
 * Track directories that failed cleanup for deferred processing
 */
const deferredCleanupQueue: Set<string> = new Set();

/**
 * Track cleanup operations for disk usage monitoring
 */
let cleanupOperationCount = 0;
const DISK_USAGE_LOG_INTERVAL = 10;

/**
 * Get the current deferred cleanup queue size
 */
export function getDeferredCleanupQueueSize(): number {
  return deferredCleanupQueue.size;
}

/**
 * Get the deferred cleanup paths
 */
export function getDeferredCleanupPaths(): string[] {
  return Array.from(deferredCleanupQueue);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate directory size recursively
 */
function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  try {
    if (!existsSync(dirPath)) return 0;

    const stats = statSync(dirPath);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const files = readdirSync(dirPath);
    for (const file of files) {
      const filePath = join(dirPath, file);
      try {
        const fileStats = statSync(filePath);
        if (fileStats.isDirectory()) {
          totalSize += getDirectorySize(filePath);
        } else {
          totalSize += fileStats.size;
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Return what we have if we can't read the directory
  }

  return totalSize;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Standard cleanup strategy - basic rm with force
 */
function standardCleanup(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Force permissions cleanup strategy - chmod files before removal
 */
function forcePermissionsCleanup(path: string): void {
  try {
    // First try to fix permissions on all files
    fixPermissionsRecursive(path);
  } catch {
    // Ignore permission fix errors, try removal anyway
  }
  rmSync(path, { recursive: true, force: true });
}

/**
 * Recursively fix permissions to allow deletion
 */
function fixPermissionsRecursive(path: string): void {
  try {
    const stats = statSync(path);

    // Add write permission
    try {
      chmodSync(path, stats.mode | 0o222);
    } catch {
      // Ignore chmod errors
    }

    if (stats.isDirectory()) {
      const files = readdirSync(path);
      for (const file of files) {
        fixPermissionsRecursive(join(path, file));
      }
    }
  } catch {
    // Ignore errors during permission fixing
  }
}

/**
 * Incremental cleanup strategy - delete files one by one
 */
function incrementalCleanup(path: string): void {
  if (!existsSync(path)) return;

  const stats = statSync(path);
  if (!stats.isDirectory()) {
    unlinkSync(path);
    return;
  }

  const files = readdirSync(path);
  for (const file of files) {
    const filePath = join(path, file);
    try {
      const fileStats = statSync(filePath);
      if (fileStats.isDirectory()) {
        incrementalCleanup(filePath);
        rmSync(filePath, { recursive: true, force: true });
      } else {
        unlinkSync(filePath);
      }
    } catch (error) {
      // Log individual file cleanup failures but continue
      logger.debug(`Failed to delete ${filePath}: ${(error as Error).message}`);
    }
  }

  // Try to remove the now-empty directory
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Directory may still have locked files
  }
}

/**
 * Verify that a directory was successfully cleaned up
 */
function verifyCleanup(path: string): boolean {
  return !existsSync(path);
}

/**
 * Main cleanup function with verification and fallback strategies
 */
export async function cleanupWorkspace(
  path: string,
  config: Partial<CleanupConfig> = {},
  log?: ReturnType<typeof logger.child>
): Promise<CleanupResult> {
  const startTime = Date.now();
  const fullConfig = { ...DEFAULT_CLEANUP_CONFIG, ...config };
  const workspaceLog = log || logger.child('Cleanup');

  let retries = 0;
  let lastError: Error | undefined;
  let usedStrategy: CleanupStrategy = 'standard';

  // Check if path exists
  if (!existsSync(path)) {
    workspaceLog.debug(`Workspace already cleaned: ${path}`);
    return {
      success: true,
      path,
      duration: Date.now() - startTime,
      retries: 0,
    };
  }

  // Track directory size before cleanup for metrics
  const sizeBeforeCleanup = getDirectorySize(path);

  // Try cleanup strategies in order of aggressiveness
  const strategies: Array<{ name: CleanupStrategy; fn: (p: string) => void }> = [
    { name: 'standard', fn: standardCleanup },
    { name: 'force_permissions', fn: forcePermissionsCleanup },
    { name: 'incremental', fn: incrementalCleanup },
  ];

  for (const strategy of strategies) {
    usedStrategy = strategy.name;

    for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
      retries++;

      try {
        // Check timeout
        if (Date.now() - startTime > fullConfig.timeoutMs) {
          throw new Error(`Cleanup timeout exceeded (${fullConfig.timeoutMs}ms)`);
        }

        workspaceLog.debug(`Attempting cleanup with ${strategy.name} strategy (attempt ${attempt + 1})`);
        strategy.fn(path);

        // Verify cleanup succeeded
        if (verifyCleanup(path)) {
          const duration = Date.now() - startTime;

          // Remove from deferred queue if it was there
          deferredCleanupQueue.delete(path);

          // Record metrics
          metrics.cleanupOperationsTotal.inc({ status: 'success', strategy: usedStrategy });
          metrics.cleanupDurationMs.observe({}, duration);
          if (sizeBeforeCleanup > 0) {
            metrics.cleanupBytesFreed.inc({}, sizeBeforeCleanup);
          }

          // Log disk usage periodically
          cleanupOperationCount++;
          if (cleanupOperationCount % DISK_USAGE_LOG_INTERVAL === 0) {
            logDiskUsageStatus(workspaceLog);
          }

          workspaceLog.debug(`Cleanup successful: ${path} (${formatBytes(sizeBeforeCleanup)} freed, ${strategy.name} strategy, ${retries} attempts, ${duration}ms)`);

          return {
            success: true,
            path,
            duration,
            retries,
            strategy: usedStrategy,
          };
        }

        // Cleanup didn't fully succeed, retry
        workspaceLog.debug(`Cleanup verification failed, directory still exists: ${path}`);

      } catch (error) {
        lastError = error as Error;
        workspaceLog.debug(`Cleanup attempt failed: ${lastError.message}`);
      }

      // Wait before retry
      if (attempt < fullConfig.maxRetries) {
        await sleep(fullConfig.retryDelayMs * (attempt + 1));
      }
    }
  }

  // All strategies failed - add to deferred queue if enabled
  const duration = Date.now() - startTime;

  if (fullConfig.enableDeferredCleanup) {
    deferredCleanupQueue.add(path);
    usedStrategy = 'deferred';
    workspaceLog.warn(`Cleanup failed, added to deferred queue: ${path}`, {
      error: lastError?.message,
      queueSize: deferredCleanupQueue.size,
    });
  }

  // Record failure metrics
  metrics.cleanupOperationsTotal.inc({ status: 'failure', strategy: usedStrategy });
  metrics.cleanupFailuresTotal.inc({
    reason: categorizeCleanupError(lastError),
  });

  // Create structured error for logging
  const cleanupError = new StructuredError(
    ErrorCode.CLEANUP_FAILED,
    `Failed to cleanup workspace after ${retries} attempts: ${path}`,
    {
      severity: 'warning',
      context: {
        path,
        retries,
        duration,
        lastStrategy: usedStrategy,
        deferredQueueSize: deferredCleanupQueue.size,
        sizeBytes: sizeBeforeCleanup,
      },
      cause: lastError,
      recoveryActions: [
        {
          description: 'Directory will be retried on next cleanup cycle',
          automatic: true,
        },
        {
          description: 'Check for locked files or running processes',
          automatic: false,
        },
        {
          description: 'Manually delete the directory if problem persists',
          automatic: false,
        },
      ],
    }
  );

  workspaceLog.structuredError(cleanupError, {
    includeStack: false,
    includeRecovery: true,
  });

  return {
    success: false,
    path,
    duration,
    retries,
    error: lastError?.message || 'Unknown error',
    strategy: usedStrategy,
  };
}

/**
 * Categorize cleanup errors for metrics
 */
function categorizeCleanupError(error?: Error): string {
  if (!error) return 'unknown';

  const message = error.message.toLowerCase();

  if (message.includes('ebusy') || message.includes('locked')) {
    return 'file_locked';
  }
  if (message.includes('eacces') || message.includes('permission')) {
    return 'permission_denied';
  }
  if (message.includes('enoent')) {
    return 'not_found';
  }
  if (message.includes('timeout')) {
    return 'timeout';
  }

  return 'other';
}

/**
 * Process deferred cleanup queue
 */
export async function processDeferredCleanup(
  config: Partial<CleanupConfig> = {},
  log?: ReturnType<typeof logger.child>
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const cleanupLog = log || logger.child('DeferredCleanup');
  const paths = Array.from(deferredCleanupQueue);

  if (paths.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  cleanupLog.info(`Processing ${paths.length} deferred cleanup items`);

  let succeeded = 0;
  let failed = 0;

  for (const path of paths) {
    // Remove from queue before attempting (prevent duplicate processing)
    deferredCleanupQueue.delete(path);

    // Skip if already cleaned
    if (!existsSync(path)) {
      succeeded++;
      continue;
    }

    const result = await cleanupWorkspace(path, {
      ...config,
      enableDeferredCleanup: false, // Don't re-add to queue
    }, cleanupLog);

    if (result.success) {
      succeeded++;
    } else {
      failed++;
      // Re-add to queue for next cycle
      deferredCleanupQueue.add(path);
    }
  }

  cleanupLog.info(`Deferred cleanup complete: ${succeeded} succeeded, ${failed} failed`);

  return {
    processed: paths.length,
    succeeded,
    failed,
  };
}

/**
 * Clean up orphaned workspaces from previous runs
 */
export async function cleanupOrphanedWorkspaces(
  workDir: string,
  config: Partial<CleanupConfig> = {},
  log?: ReturnType<typeof logger.child>
): Promise<{ found: number; cleaned: number; failed: number; totalSize: number }> {
  const cleanupLog = log || logger.child('OrphanCleanup');

  if (!existsSync(workDir)) {
    cleanupLog.debug(`Work directory does not exist: ${workDir}`);
    return { found: 0, cleaned: 0, failed: 0, totalSize: 0 };
  }

  cleanupLog.info(`Scanning for orphaned workspaces in: ${workDir}`);

  let found = 0;
  let cleaned = 0;
  let failed = 0;
  let totalSize = 0;

  try {
    const entries = readdirSync(workDir);

    for (const entry of entries) {
      // Match task directories (task-{issueNumber}-{timestamp})
      if (!entry.startsWith('task-')) continue;

      const fullPath = join(workDir, entry);

      try {
        const stats = statSync(fullPath);
        if (!stats.isDirectory()) continue;

        found++;
        const size = getDirectorySize(fullPath);
        totalSize += size;

        cleanupLog.info(`Found orphaned workspace: ${entry} (${formatBytes(size)})`);

        const result = await cleanupWorkspace(fullPath, config, cleanupLog);

        if (result.success) {
          cleaned++;
        } else {
          failed++;
        }
      } catch (error) {
        cleanupLog.warn(`Error processing ${entry}: ${(error as Error).message}`);
        failed++;
      }
    }
  } catch (error) {
    cleanupLog.error(`Failed to scan work directory: ${(error as Error).message}`);
  }

  // Record orphan cleanup metrics
  metrics.orphanedWorkspacesFound.inc({}, found);
  metrics.orphanedWorkspacesCleaned.inc({}, cleaned);

  cleanupLog.info(`Orphan cleanup complete: ${found} found, ${cleaned} cleaned, ${failed} failed (${formatBytes(totalSize)} total)`);

  return { found, cleaned, failed, totalSize };
}

/**
 * Log current disk usage status
 */
function logDiskUsageStatus(log: ReturnType<typeof logger.child>): void {
  try {
    // Log deferred queue status
    if (deferredCleanupQueue.size > 0) {
      log.warn(`Deferred cleanup queue: ${deferredCleanupQueue.size} items pending`);
    }

    log.info(`Cleanup operations: ${cleanupOperationCount} total`);
  } catch {
    // Ignore errors in status logging
  }
}

/**
 * Get cleanup status for health checks
 */
export function getCleanupStatus(): {
  deferredQueueSize: number;
  operationCount: number;
  queuedPaths: string[];
} {
  return {
    deferredQueueSize: deferredCleanupQueue.size,
    operationCount: cleanupOperationCount,
    queuedPaths: Array.from(deferredCleanupQueue),
  };
}

/**
 * Reset cleanup state (useful for testing)
 */
export function resetCleanupState(): void {
  deferredCleanupQueue.clear();
  cleanupOperationCount = 0;
}
