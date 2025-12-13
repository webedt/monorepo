/**
 * Dead Letter Queue (DLQ) implementation for tasks that fail after max retries.
 * Provides persistent storage and detailed error context for failed tasks.
 */
import { type ErrorCode } from './errors.js';
/**
 * Retry attempt information
 */
export interface RetryAttempt {
    attemptNumber: number;
    timestamp: string;
    errorCode?: ErrorCode | string;
    errorMessage: string;
    delayMs: number;
    duration?: number;
    context?: Record<string, unknown>;
}
/**
 * Dead letter entry with full error context
 */
export interface DeadLetterEntry {
    id: string;
    taskId: string;
    taskType: 'issue' | 'pr' | 'evaluation' | 'merge';
    createdAt: string;
    lastAttemptAt: string;
    totalAttempts: number;
    maxRetries: number;
    issueNumber?: number;
    branchName?: string;
    repository: string;
    finalError: {
        code: ErrorCode | string;
        message: string;
        severity: string;
        isRetryable: boolean;
        stack?: string;
    };
    retryHistory: RetryAttempt[];
    context: {
        workerId?: string;
        correlationId?: string;
        originalTimeout?: number;
        systemState?: Record<string, unknown>;
        [key: string]: unknown;
    };
    canReprocess: boolean;
    reprocessAfter?: string;
    reprocessAttempts: number;
}
/**
 * DLQ statistics
 */
export interface DLQStats {
    totalEntries: number;
    entriesByType: Record<string, number>;
    entriesByErrorCode: Record<string, number>;
    oldestEntry?: string;
    newestEntry?: string;
    reprocessableCount: number;
}
/**
 * DLQ configuration
 */
export interface DLQConfig {
    maxEntries: number;
    retentionDays: number;
    persistPath?: string;
    enablePersistence: boolean;
    reprocessDelayMs: number;
    maxReprocessAttempts: number;
}
/**
 * Dead Letter Queue for failed tasks
 */
export declare class DeadLetterQueue {
    private entries;
    private config;
    private persistPath;
    private log;
    constructor(config?: Partial<DLQConfig>, workDir?: string);
    /**
     * Add a failed task to the dead letter queue
     */
    addEntry(entry: Omit<DeadLetterEntry, 'id' | 'createdAt' | 'reprocessAttempts'>): string;
    /**
     * Create a DLQ entry from retry context
     */
    createEntryFromRetryContext(taskId: string, taskType: DeadLetterEntry['taskType'], repository: string, retryHistory: RetryAttempt[], finalError: DeadLetterEntry['finalError'], context: DeadLetterEntry['context'], options?: {
        issueNumber?: number;
        branchName?: string;
        maxRetries?: number;
    }): string;
    /**
     * Get an entry by ID
     */
    getEntry(id: string): DeadLetterEntry | undefined;
    /**
     * Get all entries
     */
    getAllEntries(): DeadLetterEntry[];
    /**
     * Get entries ready for reprocessing
     */
    getReprocessableEntries(): DeadLetterEntry[];
    /**
     * Mark an entry as being reprocessed
     */
    markReprocessing(id: string): boolean;
    /**
     * Remove an entry from the queue (after successful reprocessing)
     */
    removeEntry(id: string): boolean;
    /**
     * Get queue statistics
     */
    getStats(): DLQStats;
    /**
     * Get entries by task type
     */
    getEntriesByType(taskType: DeadLetterEntry['taskType']): DeadLetterEntry[];
    /**
     * Get entries by error code
     */
    getEntriesByErrorCode(errorCode: string): DeadLetterEntry[];
    /**
     * Clean up old entries based on retention policy
     */
    cleanupExpired(): number;
    /**
     * Generate a unique ID for DLQ entries
     */
    private generateId;
    /**
     * Evict the oldest entry when at capacity
     */
    private evictOldest;
    /**
     * Load entries from disk
     */
    private loadFromDisk;
    /**
     * Persist entries to disk
     */
    private persistToDisk;
}
/**
 * Get or create the dead letter queue instance
 */
export declare function getDeadLetterQueue(config?: Partial<DLQConfig>, workDir?: string): DeadLetterQueue;
/**
 * Reset the DLQ instance (for testing)
 */
export declare function resetDeadLetterQueue(): void;
//# sourceMappingURL=dead-letter-queue.d.ts.map