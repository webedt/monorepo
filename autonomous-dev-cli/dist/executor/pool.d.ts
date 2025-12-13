import { type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { getDeadLetterQueue, type DeadLetterEntry } from '../utils/dead-letter-queue.js';
import { type CircuitBreakerHealth } from '../utils/circuit-breaker.js';
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
    /** Enable graceful degradation when services fail */
    enableGracefulDegradation?: boolean;
    /** Retry configuration passed to workers */
    retryConfig?: {
        maxRetries?: number;
        enableDeadLetterQueue?: boolean;
        progressiveTimeout?: boolean;
    };
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
}
export interface PoolTask extends WorkerTask {
    id: string;
    /** Task metadata for prioritization and grouping */
    metadata?: TaskMetadata;
    /** Computed priority score (higher = more important) */
    priorityScore?: number;
    /** Group ID for related tasks */
    groupId?: string;
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
    private workerIdCounter;
    private repository;
    private scalingConfig;
    private currentWorkerLimit;
    private scaleCheckInterval;
    private workerTaskMap;
    private taskGroupWorkers;
    private degradationStatus;
    private degradationCheckInterval;
    private consecutiveFailures;
    private failureThreshold;
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
     * Start degradation monitoring
     */
    private startDegradationMonitor;
    /**
     * Stop degradation monitoring
     */
    private stopDegradationMonitor;
    /**
     * Check and update degradation status
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
     * Get dead letter queue stats
     */
    getDeadLetterQueueStats(): import("../utils/dead-letter-queue.js").DLQStats;
    /**
     * Get reprocessable tasks from dead letter queue
     */
    getReprocessableTasks(): DeadLetterEntry[];
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
        completed: number;
        succeeded: number;
        failed: number;
        currentWorkerLimit: number;
        systemResources: SystemResources;
        taskGroups: number;
        degradationStatus: DegradationStatus;
        dlqStats: ReturnType<typeof getDeadLetterQueue>['getStats'] extends () => infer R ? R : never;
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