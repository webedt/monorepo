/**
 * Workspace cleanup utilities with verification, retry logic, and error recovery.
 * Provides robust cleanup operations for worker workspaces with fallback strategies.
 */
import { logger } from './logger.js';
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
export declare const DEFAULT_CLEANUP_CONFIG: CleanupConfig;
/**
 * Get the current deferred cleanup queue size
 */
export declare function getDeferredCleanupQueueSize(): number;
/**
 * Get the deferred cleanup paths
 */
export declare function getDeferredCleanupPaths(): string[];
/**
 * Main cleanup function with verification and fallback strategies
 */
export declare function cleanupWorkspace(path: string, config?: Partial<CleanupConfig>, log?: ReturnType<typeof logger.child>): Promise<CleanupResult>;
/**
 * Process deferred cleanup queue
 */
export declare function processDeferredCleanup(config?: Partial<CleanupConfig>, log?: ReturnType<typeof logger.child>): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
}>;
/**
 * Clean up orphaned workspaces from previous runs
 */
export declare function cleanupOrphanedWorkspaces(workDir: string, config?: Partial<CleanupConfig>, log?: ReturnType<typeof logger.child>): Promise<{
    found: number;
    cleaned: number;
    failed: number;
    totalSize: number;
}>;
/**
 * Get cleanup status for health checks
 */
export declare function getCleanupStatus(): {
    deferredQueueSize: number;
    operationCount: number;
    queuedPaths: string[];
};
/**
 * Reset cleanup state (useful for testing)
 */
export declare function resetCleanupState(): void;
//# sourceMappingURL=cleanup.d.ts.map