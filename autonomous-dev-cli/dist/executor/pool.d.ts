import { type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { getDeadLetterQueue, type DeadLetterEntry } from '../utils/dead-letter-queue.js';
import { type CircuitBreakerHealth } from '../utils/circuit-breaker.js';
import { getErrorAggregator, type RecoveryStrategy } from '../errors/executor-errors.js';
/** Task priority levels - higher value = higher priority */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
/** Task category for classification */
export type TaskCategory = 'security' | 'bugfix' | 'feature' | 'refactor' | 'docs' | 'test' | 'chore';
/** Task complexity affects timeout and resource allocation */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';
/** Extended task metadata for prioritization and grouping */
export interface TaskMetadata {
    priority?: TaskPriority;
    category?: TaskCategory;
    complexity?: TaskComplexity;
    affectedPaths?: string[];
    estimatedDurationMinutes?: number;
}
/** System resource snapshot for scaling decisions */
export interface SystemResources {
    cpuCores: number;
    cpuUsagePercent: number;
    freeMemoryMB: number;
    totalMemoryMB: number;
    memoryUsagePercent: number;
}
/** Scaling configuration */
export interface ScalingConfig {
    minWorkers: number;
    maxWorkers: number;
    cpuThresholdHigh: number;
    cpuThresholdLow: number;
    memoryThresholdHigh: number;
    memoryThresholdLow: number;
    scaleCheckIntervalMs: number;
}
/** Queue configuration for memory management and overflow handling */
export interface QueueConfig {
    /** Maximum number of tasks allowed in queue (default: 100) */
    maxQueueSize: number;
    /** Strategy when queue is full: 'reject' | 'drop-lowest' | 'pause' */
    overflowStrategy: 'reject' | 'drop-lowest' | 'pause';
    /** Emit warning when queue reaches this percentage (default: 80) */
    queueWarningThreshold: number;
    /** Enable queue persistence for graceful shutdown (default: true) */
    enablePersistence: boolean;
}
/** Execution history entry for audit trail */
export interface ExecutionHistoryEntry {
    taskId: string;
    issueNumber?: number;
    branchName?: string;
    priority: TaskPriority;
    category?: TaskCategory;
    status: 'queued' | 'started' | 'completed' | 'failed' | 'dropped';
    queuedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    duration?: number;
    workerId?: string;
    retryCount: number;
    error?: {
        code: string;
        message: string;
        isRetryable: boolean;
    };
    metadata?: Record<string, unknown>;
}
/** Queue overflow event for monitoring */
export interface QueueOverflowEvent {
    timestamp: Date;
    queueSize: number;
    maxQueueSize: number;
    strategy: QueueConfig['overflowStrategy'];
    droppedTaskId?: string;
    droppedTaskPriority?: TaskPriority;
}
export interface WorkerPoolOptions extends Omit<WorkerOptions, 'workDir'> {
    maxWorkers: number;
    workDir: string;
    /** Optional scaling configuration for dynamic worker management */
    scalingConfig?: Partial<ScalingConfig>;
    /** Optional queue configuration for memory management */
    queueConfig?: Partial<QueueConfig>;
    /** Enable dynamic scaling based on system resources */
    enableDynamicScaling?: boolean;
    /** Enable graceful degradation when services fail */
    enableGracefulDegradation?: boolean;
    /** Retry configuration passed to workers */
    retryConfig?: {
        maxRetries?: number;
        enableDeadLetterQueue?: boolean;
        progressiveTimeout?: boolean;
    };
    /** Enable execution history tracking for audit trail */
    enableExecutionHistory?: boolean;
}
/**
 * Degradation status for the worker pool
 */
export interface DegradationStatus {
    /** Whether the pool is operating in degraded mode */
    isDegraded: boolean;
    /** Reason for degradation */
    reason?: string;
    /** Which services are affected */
    affectedServices: string[];
    /** Circuit breaker states */
    circuitBreakers: Record<string, CircuitBreakerHealth>;
    /** When degradation started */
    startedAt?: Date;
    /** Suggested recovery actions */
    recoveryActions: string[];
    /** Error statistics for pattern analysis */
    errorStats?: {
        totalErrors: number;
        byRecoveryStrategy: Record<RecoveryStrategy, number>;
        mostCommonErrorCode?: string;
        retriesExhausted: number;
    };
}
export interface PoolTask extends WorkerTask {
    id: string;
    /** Task metadata for prioritization and grouping */
    metadata?: TaskMetadata;
    /** Computed priority score (higher = more important) */
    priorityScore?: number;
    /** Group ID for related tasks */
    groupId?: string;
    /** Time when task was added to queue */
    queuedAt?: Date;
    /** Current retry count for this task */
    retryCount?: number;
    /** Maximum retries allowed for this task */
    maxRetries?: number;
}
export interface PoolResult extends WorkerResult {
    taskId: string;
}
export declare class WorkerPool {
    private options;
    private activeWorkers;
    private taskQueue;
    private results;
    private isRunning;
    private isShuttingDown;
    private workerIdCounter;
    private repository;
    private scalingConfig;
    private queueConfig;
    private currentWorkerLimit;
    private scaleCheckInterval;
    private workerTaskMap;
    private taskGroupWorkers;
    private executionHistory;
    private maxHistoryEntries;
    private overflowEvents;
    private degradationStatus;
    private degradationCheckInterval;
    private consecutiveFailures;
    private failureThreshold;
    /** Default scaling configuration */
    private static readonly DEFAULT_SCALING_CONFIG;
    /** Default queue configuration */
    private static readonly DEFAULT_QUEUE_CONFIG;
    constructor(options: WorkerPoolOptions);
    /**
     * Extract repository name from URL for metrics labeling
     */
    private extractRepoName;
    /**
     * Update worker pool metrics
     */
    private updateMetrics;
    /**
     * Get current system resource utilization
     */
    private getSystemResources;
    /**
     * Compute optimal worker count based on system resources
     */
    private computeOptimalWorkerCount;
    /**
     * Start dynamic scaling monitor
     */
    private startScalingMonitor;
    /**
     * Stop dynamic scaling monitor
     */
    private stopScalingMonitor;
    /**
     * Start degradation monitoring
     */
    private startDegradationMonitor;
    /**
     * Stop degradation monitoring
     */
    private stopDegradationMonitor;
    /**
     * Check and update degradation status with error aggregation statistics
     */
    private checkDegradationStatus;
    /**
     * Record a task result and update failure tracking
     */
    private recordTaskResult;
    /**
     * Get current degradation status
     */
    getDegradationStatus(): DegradationStatus;
    /**
     * Check if the pool can accept new tasks
     */
    canAcceptTasks(): boolean;
    /**
     * Get current queue utilization percentage
     */
    getQueueUtilization(): number;
    /**
     * Check if queue is approaching capacity and emit warning
     */
    private checkQueueCapacity;
    /**
     * Handle queue overflow based on configured strategy
     * @returns true if task was added, false if rejected
     */
    private handleQueueOverflow;
    /**
     * Find the index of the lowest priority task in the queue
     */
    private findLowestPriorityTaskIndex;
    /**
     * Record task execution in history for audit trail
     */
    private recordExecutionHistory;
    /**
     * Get execution history with optional filtering
     */
    getExecutionHistory(options?: {
        status?: ExecutionHistoryEntry['status'];
        priority?: TaskPriority;
        limit?: number;
        since?: Date;
    }): ExecutionHistoryEntry[];
    /**
     * Get execution statistics from history
     */
    getExecutionStats(): {
        total: number;
        byStatus: Record<string, number>;
        byPriority: Record<string, number>;
        avgDuration: number;
        successRate: number;
        retriesTotal: number;
    };
    /**
     * Get queue overflow events
     */
    getOverflowEvents(limit?: number): QueueOverflowEvent[];
    /**
     * Gracefully shutdown the worker pool, preserving queued tasks
     * @param timeoutMs Maximum time to wait for active workers to complete
     * @returns Remaining queued tasks that were not processed
     */
    gracefulShutdown(timeoutMs?: number): Promise<PoolTask[]>;
    /**
     * Persist queued tasks to disk for recovery
     */
    private persistQueuedTasks;
    /**
     * Load previously persisted queued tasks
     */
    loadPersistedTasks(): Promise<PoolTask[]>;
    /**
     * Get dead letter queue stats
     */
    getDeadLetterQueueStats(): import("../utils/dead-letter-queue.js").DLQStats;
    /**
     * Get reprocessable tasks from dead letter queue
     */
    getReprocessableTasks(): DeadLetterEntry[];
    /**
     * Get error aggregation summary for pattern analysis.
     * Provides insight into error patterns across the pool.
     */
    getErrorAggregationSummary(): {
        totalErrors: number;
        bySeverity: Record<import("../utils/errors.js").ErrorSeverity, number>;
        byCode: Record<string, number>;
        retryStats: ReturnType<import("../errors/executor-errors.js").ErrorAggregator["getRetryStats"]>;
        mostCommon: ReturnType<import("../errors/executor-errors.js").ErrorAggregator["getMostCommonErrors"]>;
        timeSpan: {
            start?: Date;
            end?: Date;
        };
    };
    /**
     * Get recent errors within a time window for debugging.
     * @param windowMs Time window in milliseconds (default: 5 minutes)
     */
    getRecentErrors(windowMs?: number): {
        code: import("../utils/errors.js").ErrorCode;
        message: string;
        severity: import("../utils/errors.js").ErrorSeverity;
        isRetryable: boolean;
        recoveryStrategy: RecoveryStrategy;
        timestamp: string;
    }[];
    /**
     * Clear error aggregation data (useful after recovery or for testing)
     */
    clearErrorAggregation(): void;
    /**
     * Calculate priority score for a task
     */
    private calculatePriorityScore;
    /**
     * Generate a group ID for a task based on affected paths
     */
    private generateGroupId;
    /**
     * Sort task queue by priority (highest first)
     */
    private sortTaskQueue;
    /**
     * Select the next task, preferring tasks from the same group as a worker
     */
    private selectNextTask;
    /**
     * Get task-specific timeout based on complexity
     */
    getTaskTimeout(task: PoolTask): number;
    executeTasks(tasks: WorkerTask[]): Promise<PoolResult[]>;
    /**
     * Extract task metadata from issue labels and body
     */
    private extractTaskMetadata;
    private startNextTask;
    stop(): void;
    /**
     * Check if the pool is currently shutting down
     */
    isInShutdown(): boolean;
    /**
     * Get the current queue configuration
     */
    getQueueConfig(): QueueConfig;
    /**
     * Update queue configuration at runtime
     */
    updateQueueConfig(config: Partial<QueueConfig>): void;
    getStatus(): {
        active: number;
        queued: number;
        completed: number;
        succeeded: number;
        failed: number;
        currentWorkerLimit: number;
        systemResources: SystemResources;
        taskGroups: number;
        degradationStatus: DegradationStatus;
        dlqStats: ReturnType<typeof getDeadLetterQueue>['getStats'] extends () => infer R ? R : never;
        errorAggregation: ReturnType<typeof getErrorAggregator>['getSummary'] extends () => infer R ? R : never;
        queueStatus: {
            utilization: number;
            maxSize: number;
            isAtCapacity: boolean;
            overflowStrategy: QueueConfig['overflowStrategy'];
            recentOverflowCount: number;
        };
        executionStats: ReturnType<WorkerPool['getExecutionStats']>;
        isShuttingDown: boolean;
    };
    /**
     * Get the current scaling configuration
     */
    getScalingConfig(): ScalingConfig;
    /**
     * Update scaling configuration at runtime
     */
    updateScalingConfig(config: Partial<ScalingConfig>): void;
}
export declare function createWorkerPool(options: WorkerPoolOptions): WorkerPool;
//# sourceMappingURL=pool.d.ts.map