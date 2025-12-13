import { type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
/** Retry strategy configuration for worker pool */
export interface RetryStrategyConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterEnabled: boolean;
    jitterFactor: number;
    enableWorkerRetry: boolean;
}
/** Default retry strategy configuration */
export declare const DEFAULT_RETRY_STRATEGY: RetryStrategyConfig;
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
export interface WorkerPoolOptions extends Omit<WorkerOptions, 'workDir'> {
    maxWorkers: number;
    workDir: string;
    /** Optional scaling configuration for dynamic worker management */
    scalingConfig?: Partial<ScalingConfig>;
    /** Enable dynamic scaling based on system resources */
    enableDynamicScaling?: boolean;
    /** Retry strategy configuration for failed tasks */
    retryStrategy?: Partial<RetryStrategyConfig>;
}
export interface PoolTask extends WorkerTask {
    id: string;
    /** Task metadata for prioritization and grouping */
    metadata?: TaskMetadata;
    /** Computed priority score (higher = more important) */
    priorityScore?: number;
    /** Group ID for related tasks */
    groupId?: string;
    /** Current retry count for this task */
    retryCount?: number;
    /** Last error message if task failed */
    lastError?: string;
    /** Timestamp when task can be retried */
    nextRetryTime?: number;
}
export interface PoolResult extends WorkerResult {
    taskId: string;
}
export declare class WorkerPool {
    private options;
    private activeWorkers;
    private taskQueue;
    private retryQueue;
    private results;
    private isRunning;
    private workerIdCounter;
    private repository;
    private scalingConfig;
    private retryStrategy;
    private currentWorkerLimit;
    private scaleCheckInterval;
    private retryCheckInterval;
    private workerTaskMap;
    private taskGroupWorkers;
    /** Default scaling configuration */
    private static readonly DEFAULT_SCALING_CONFIG;
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
     * Calculate exponential backoff delay with optional jitter
     * Formula: delay = baseDelay * (multiplier ^ retryCount) + jitter
     */
    private calculateRetryDelay;
    /**
     * Determine if a task failure is retryable based on error type
     */
    private isRetryableError;
    /**
     * Schedule a failed task for retry with exponential backoff
     */
    private scheduleRetry;
    /**
     * Check and process tasks ready for retry
     */
    private processRetryQueue;
    /**
     * Start retry queue monitor
     */
    private startRetryMonitor;
    /**
     * Stop retry queue monitor
     */
    private stopRetryMonitor;
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
    getStatus(): {
        active: number;
        queued: number;
        pendingRetries: number;
        completed: number;
        succeeded: number;
        failed: number;
        currentWorkerLimit: number;
        systemResources: SystemResources;
        taskGroups: number;
        retryStrategy: RetryStrategyConfig;
    };
    /**
     * Get the current scaling configuration
     */
    getScalingConfig(): ScalingConfig;
    /**
     * Get the current retry strategy configuration
     */
    getRetryStrategy(): RetryStrategyConfig;
    /**
     * Update retry strategy configuration at runtime
     */
    updateRetryStrategy(config: Partial<RetryStrategyConfig>): void;
    /**
     * Update scaling configuration at runtime
     */
    updateScalingConfig(config: Partial<ScalingConfig>): void;
}
export declare function createWorkerPool(options: WorkerPoolOptions): WorkerPool;
//# sourceMappingURL=pool.d.ts.map