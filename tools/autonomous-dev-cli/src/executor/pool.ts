import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { logger, generateCorrelationId, setCorrelationId, clearCorrelationId, getMemoryUsageMB } from '../utils/logger.js';
import {
  getProgressManager,
  createProgressBar,
  formatDuration,
  formatETA,
  ETACalculator,
  type ProgressManager,
} from '../utils/progress.js';
import { metrics } from '../utils/metrics.js';
import {
  getDeadLetterQueue,
  type DeadLetterEntry,
} from '../utils/dead-letter-queue.js';
import {
  getAllCircuitBreakerHealth,
  type CircuitBreakerHealth,
} from '../utils/circuit-breaker.js';
import {
  ExecutorError,
  getErrorAggregator,
  type RecoveryStrategy,
} from '../errors/executor-errors.js';
import { StructuredError } from '../utils/errors.js';
import * as os from 'os';
import { EventEmitter } from 'events';

/** Task priority levels - higher value = higher priority */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/** Task category for classification */
export type TaskCategory = 'security' | 'bugfix' | 'feature' | 'refactor' | 'docs' | 'test' | 'chore';

/** Task complexity affects timeout and resource allocation */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

/** Priority weights for sorting tasks */
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

/** Category-based priority adjustments */
const CATEGORY_PRIORITY_BOOST: Record<TaskCategory, number> = {
  security: 30,
  bugfix: 20,
  feature: 0,
  refactor: -5,
  docs: -10,
  test: -5,
  chore: -15,
};

/** Timeout multipliers based on complexity */
const COMPLEXITY_TIMEOUT_MULTIPLIER: Record<TaskComplexity, number> = {
  simple: 0.5,
  moderate: 1.0,
  complex: 2.0,
};

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
  cpuThresholdHigh: number;  // Scale down above this CPU %
  cpuThresholdLow: number;   // Scale up below this CPU %
  memoryThresholdHigh: number; // Scale down above this memory %
  memoryThresholdLow: number;  // Scale up below this memory %
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

/** Concurrency configuration for fine-grained control */
export interface ConcurrencyConfig {
  /** Minimum number of concurrent workers (default: 1) */
  minConcurrency: number;
  /** Maximum number of concurrent workers (default: CPU cores) */
  maxConcurrency: number;
  /** Target concurrency when system is idle (default: maxConcurrency / 2) */
  targetConcurrency: number;
  /** Time in ms to wait before scaling up (default: 5000) */
  scaleUpDelayMs: number;
  /** Time in ms to wait before scaling down (default: 10000) */
  scaleDownDelayMs: number;
  /** Enable adaptive concurrency based on task success rate (default: true) */
  enableAdaptiveConcurrency: boolean;
  /** Reduce concurrency when success rate drops below this (default: 0.7) */
  successRateThreshold: number;
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
  /** Optional concurrency configuration for fine-grained control */
  concurrencyConfig?: Partial<ConcurrencyConfig>;
  /** Optional memory configuration for automatic cleanup */
  memoryConfig?: Partial<MemoryConfig>;
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

/** Worker pool metrics for monitoring and observability */
export interface WorkerPoolMetrics {
  /** Number of currently active workers */
  activeWorkers: number;
  /** Number of tasks in queue */
  queuedTasks: number;
  /** Total tasks completed successfully */
  completedTasks: number;
  /** Total tasks failed */
  failedTasks: number;
  /** Total tasks processed (completed + failed) */
  totalProcessed: number;
  /** Success rate as percentage (0-100) */
  successRate: number;
  /** Average task duration in milliseconds */
  avgTaskDurationMs: number;
  /** Maximum concurrent workers reached */
  peakConcurrency: number;
  /** Current memory usage in MB */
  memoryUsageMB: number;
  /** Memory usage at peak concurrency in MB */
  peakMemoryUsageMB: number;
  /** Current worker limit (may be adjusted by scaling) */
  currentWorkerLimit: number;
  /** Configured max workers */
  maxWorkers: number;
  /** Worker utilization percentage (0-100) */
  utilizationPercent: number;
  /** Time since pool started in milliseconds */
  uptimeMs: number;
  /** Tasks per minute throughput */
  tasksPerMinute: number;
}

/** Event emitted when a worker completes */
interface WorkerCompletionEvent {
  taskId: string;
  workerId: string;
  success: boolean;
  duration: number;
  groupId?: string;
  result: WorkerResult;
}

/** Memory monitoring configuration */
export interface MemoryConfig {
  /** Memory usage threshold in MB to trigger cleanup (default: 80% of available) */
  cleanupThresholdMB: number;
  /** Interval for memory checks in milliseconds (default: 30000) */
  checkIntervalMs: number;
  /** Enable automatic memory cleanup between tasks (default: true) */
  enableAutoCleanup: boolean;
  /** Force garbage collection if available (default: false) */
  forceGC: boolean;
}

export class WorkerPool extends EventEmitter {
  private options: WorkerPoolOptions;
  private activeWorkers: Map<string, Promise<WorkerResult>> = new Map();
  private taskQueue: PoolTask[] = [];
  private results: PoolResult[] = [];
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private workerIdCounter: number = 0;
  private repository: string;
  private scalingConfig: ScalingConfig;
  private queueConfig: QueueConfig;
  private currentWorkerLimit: number;
  private scaleCheckInterval: NodeJS.Timeout | null = null;
  private workerTaskMap: Map<string, PoolTask> = new Map(); // Maps worker ID to assigned task
  private taskGroupWorkers: Map<string, string> = new Map(); // Maps group ID to preferred worker ID

  // Execution history for audit trail
  private executionHistory: ExecutionHistoryEntry[] = [];
  private maxHistoryEntries: number = 1000;

  // Queue overflow tracking
  private overflowEvents: QueueOverflowEvent[] = [];

  // Progress tracking
  private progressManager: ProgressManager;
  private taskETACalculator: ETACalculator = new ETACalculator();
  private executionStartTime: number = 0;

  // Graceful degradation state
  private degradationStatus: DegradationStatus = {
    isDegraded: false,
    affectedServices: [],
    circuitBreakers: {},
    recoveryActions: [],
  };
  private degradationCheckInterval: NodeJS.Timeout | null = null;
  private consecutiveFailures: number = 0;
  private failureThreshold: number = 5; // Number of consecutive failures before degradation

  // Event-based worker completion tracking (replaces Promise.race pattern)
  private completionQueue: WorkerCompletionEvent[] = [];
  private completionResolver: ((event: WorkerCompletionEvent) => void) | null = null;

  // Enhanced metrics tracking
  private poolStartTime: number = 0;
  private peakConcurrency: number = 0;
  private peakMemoryUsageMB: number = 0;
  private totalTaskDurationMs: number = 0;
  private completedTaskCount: number = 0;
  private failedTaskCount: number = 0;

  // Memory monitoring
  private memoryConfig: MemoryConfig;
  private memoryCheckInterval: NodeJS.Timeout | null = null;
  private lastMemoryCleanup: number = 0;

  // Concurrency control
  private concurrencyConfig: ConcurrencyConfig;
  private lastScaleUpTime: number = 0;
  private lastScaleDownTime: number = 0;
  private recentSuccessRate: number = 1.0;
  private adaptiveConcurrencyLimit: number = 0;

  /** Default scaling configuration */
  private static readonly DEFAULT_SCALING_CONFIG: ScalingConfig = {
    minWorkers: 1,
    maxWorkers: 10,
    cpuThresholdHigh: 80,
    cpuThresholdLow: 40,
    memoryThresholdHigh: 85,
    memoryThresholdLow: 50,
    scaleCheckIntervalMs: 10000,
  };

  /** Default queue configuration */
  private static readonly DEFAULT_QUEUE_CONFIG: QueueConfig = {
    maxQueueSize: 100,
    overflowStrategy: 'drop-lowest',
    queueWarningThreshold: 80,
    enablePersistence: true,
  };

  /** Default memory configuration */
  private static readonly DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    cleanupThresholdMB: Math.round(os.totalmem() / (1024 * 1024) * 0.8),
    checkIntervalMs: 30000,
    enableAutoCleanup: true,
    forceGC: false,
  };

  /** Default concurrency configuration */
  private static readonly DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
    minConcurrency: 1,
    maxConcurrency: os.cpus().length,
    targetConcurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    scaleUpDelayMs: 5000,
    scaleDownDelayMs: 10000,
    enableAdaptiveConcurrency: true,
    successRateThreshold: 0.7,
  };

  constructor(options: WorkerPoolOptions) {
    super(); // Initialize EventEmitter
    this.options = options;
    this.repository = this.extractRepoName(options.repoUrl);

    // Initialize progress manager
    this.progressManager = getProgressManager();

    // Initialize scaling configuration
    this.scalingConfig = {
      ...WorkerPool.DEFAULT_SCALING_CONFIG,
      maxWorkers: options.maxWorkers,
      ...options.scalingConfig,
    };

    // Initialize queue configuration
    this.queueConfig = {
      ...WorkerPool.DEFAULT_QUEUE_CONFIG,
      ...options.queueConfig,
    };

    // Initialize memory configuration
    this.memoryConfig = {
      ...WorkerPool.DEFAULT_MEMORY_CONFIG,
    };

    // Initialize concurrency configuration
    this.concurrencyConfig = {
      ...WorkerPool.DEFAULT_CONCURRENCY_CONFIG,
      ...options.concurrencyConfig,
    };

    // Compute initial worker limit based on system resources
    this.currentWorkerLimit = this.computeOptimalWorkerCount();

    // Initialize pool start time for metrics
    this.poolStartTime = Date.now();

    logger.info(`Worker pool initialized`, {
      maxWorkers: options.maxWorkers,
      initialWorkerLimit: this.currentWorkerLimit,
      maxQueueSize: this.queueConfig.maxQueueSize,
      overflowStrategy: this.queueConfig.overflowStrategy,
      enableDynamicScaling: options.enableDynamicScaling ?? false,
      enableExecutionHistory: options.enableExecutionHistory ?? false,
      repository: this.repository,
    });

    // Initialize worker pool metrics
    metrics.updateWorkerPoolStatus(0, 0);
  }

  /**
   * Extract repository name from URL for metrics labeling
   */
  private extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
    return match ? match[1] : repoUrl;
  }

  /**
   * Update worker pool metrics
   */
  private updateMetrics(): void {
    metrics.updateWorkerPoolStatus(this.activeWorkers.size, this.taskQueue.length);
  }

  /**
   * Get current system resource utilization
   */
  private getSystemResources(): SystemResources {
    const cpuCores = os.cpus().length;
    const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemoryMB = Math.round(os.freemem() / (1024 * 1024));
    const memoryUsagePercent = Math.round(((totalMemoryMB - freeMemoryMB) / totalMemoryMB) * 100);

    // Calculate CPU usage from load average (1 minute)
    const loadAvg = os.loadavg()[0];
    const cpuUsagePercent = Math.round((loadAvg / cpuCores) * 100);

    return {
      cpuCores,
      cpuUsagePercent,
      freeMemoryMB,
      totalMemoryMB,
      memoryUsagePercent,
    };
  }

  /**
   * Compute optimal worker count based on system resources
   */
  private computeOptimalWorkerCount(): number {
    const resources = this.getSystemResources();
    const { minWorkers, maxWorkers, cpuThresholdHigh, cpuThresholdLow, memoryThresholdHigh, memoryThresholdLow } = this.scalingConfig;

    // Start with CPU-based scaling
    let targetWorkers: number;

    if (resources.cpuUsagePercent >= cpuThresholdHigh || resources.memoryUsagePercent >= memoryThresholdHigh) {
      // High resource usage - use minimum workers
      targetWorkers = minWorkers;
    } else if (resources.cpuUsagePercent <= cpuThresholdLow && resources.memoryUsagePercent <= memoryThresholdLow) {
      // Low resource usage - can use more workers
      // Scale based on available CPU cores, but cap at maxWorkers
      targetWorkers = Math.min(resources.cpuCores, maxWorkers);
    } else {
      // Medium resource usage - scale proportionally
      const cpuFactor = 1 - (resources.cpuUsagePercent - cpuThresholdLow) / (cpuThresholdHigh - cpuThresholdLow);
      const memFactor = 1 - (resources.memoryUsagePercent - memoryThresholdLow) / (memoryThresholdHigh - memoryThresholdLow);
      const scaleFactor = Math.min(cpuFactor, memFactor);
      targetWorkers = Math.round(minWorkers + (maxWorkers - minWorkers) * scaleFactor);
    }

    // Clamp to valid range
    return Math.max(minWorkers, Math.min(maxWorkers, targetWorkers));
  }

  /**
   * Start dynamic scaling monitor
   */
  private startScalingMonitor(): void {
    if (!this.options.enableDynamicScaling || this.scaleCheckInterval) {
      return;
    }

    this.scaleCheckInterval = setInterval(() => {
      const newLimit = this.computeOptimalWorkerCount();
      if (newLimit !== this.currentWorkerLimit) {
        const oldLimit = this.currentWorkerLimit;
        this.currentWorkerLimit = newLimit;

        logger.info(`Dynamic scaling: worker limit changed ${oldLimit} -> ${newLimit}`, {
          resources: this.getSystemResources(),
          activeWorkers: this.activeWorkers.size,
          queuedTasks: this.taskQueue.length,
        });

        // If we can add more workers and have tasks, start them
        if (newLimit > oldLimit) {
          while (this.activeWorkers.size < this.currentWorkerLimit && this.taskQueue.length > 0 && this.isRunning) {
            this.startNextTask();
          }
        }
      }
    }, this.scalingConfig.scaleCheckIntervalMs);
  }

  /**
   * Stop dynamic scaling monitor
   */
  private stopScalingMonitor(): void {
    if (this.scaleCheckInterval) {
      clearInterval(this.scaleCheckInterval);
      this.scaleCheckInterval = null;
    }
  }

  /**
   * Start memory monitoring for automatic cleanup
   */
  private startMemoryMonitor(): void {
    if (!this.memoryConfig.enableAutoCleanup || this.memoryCheckInterval) {
      return;
    }

    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, this.memoryConfig.checkIntervalMs);

    logger.debug('Memory monitor started', {
      cleanupThresholdMB: this.memoryConfig.cleanupThresholdMB,
      checkIntervalMs: this.memoryConfig.checkIntervalMs,
    });
  }

  /**
   * Stop memory monitoring
   */
  private stopMemoryMonitor(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  /**
   * Check memory usage and trigger cleanup if needed
   */
  private checkMemoryUsage(): void {
    const currentMemoryMB = getMemoryUsageMB();

    // Track peak memory usage
    if (currentMemoryMB > this.peakMemoryUsageMB) {
      this.peakMemoryUsageMB = currentMemoryMB;
    }

    // Update metrics
    metrics.updateMemoryUsage(currentMemoryMB);

    if (currentMemoryMB > this.memoryConfig.cleanupThresholdMB) {
      this.performMemoryCleanup(currentMemoryMB);
    }
  }

  /**
   * Perform memory cleanup operations
   */
  private performMemoryCleanup(currentMemoryMB: number): void {
    const timeSinceLastCleanup = Date.now() - this.lastMemoryCleanup;

    // Avoid cleanup too frequently (min 10 seconds between cleanups)
    if (timeSinceLastCleanup < 10000) {
      return;
    }

    logger.info('Performing memory cleanup', {
      currentMemoryMB,
      thresholdMB: this.memoryConfig.cleanupThresholdMB,
      activeWorkers: this.activeWorkers.size,
    });

    // Clear old overflow events (keep last 100)
    if (this.overflowEvents.length > 100) {
      this.overflowEvents = this.overflowEvents.slice(-100);
    }

    // Trim execution history if it exceeds limit
    if (this.executionHistory.length > this.maxHistoryEntries) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistoryEntries);
    }

    // Clear completed results if we have too many
    if (this.results.length > 1000) {
      this.results = this.results.slice(-1000);
    }

    // Force garbage collection if enabled and available
    if (this.memoryConfig.forceGC && global.gc) {
      try {
        global.gc();
        logger.debug('Forced garbage collection completed');
      } catch (error) {
        logger.warn('Failed to force garbage collection', { error });
      }
    }

    this.lastMemoryCleanup = Date.now();
    const afterCleanupMB = getMemoryUsageMB();

    logger.info('Memory cleanup completed', {
      beforeMB: currentMemoryMB,
      afterMB: afterCleanupMB,
      freedMB: Math.round((currentMemoryMB - afterCleanupMB) * 100) / 100,
    });
  }

  /**
   * Signal that a worker has completed (event-based tracking)
   * This replaces the O(n) Promise.race() pattern with O(1) event-based completion
   */
  private signalWorkerCompletion(event: WorkerCompletionEvent): void {
    // Emit event for external listeners
    this.emit('workerComplete', event);

    // If there's a pending resolver, resolve immediately (O(1) completion detection)
    if (this.completionResolver) {
      const resolver = this.completionResolver;
      this.completionResolver = null;
      resolver(event);
    } else {
      // Queue for later consumption
      this.completionQueue.push(event);
    }
  }

  /**
   * Wait for the next worker completion using event-based tracking
   * This is O(1) complexity compared to O(n) Promise.race()
   */
  private waitForWorkerCompletion(): Promise<WorkerCompletionEvent> {
    // Check if we already have a completed event queued
    if (this.completionQueue.length > 0) {
      return Promise.resolve(this.completionQueue.shift()!);
    }

    // Wait for the next completion event
    return new Promise<WorkerCompletionEvent>((resolve) => {
      this.completionResolver = resolve;
    });
  }

  /**
   * Get comprehensive worker pool metrics
   */
  getPoolMetrics(): WorkerPoolMetrics {
    const currentMemoryMB = getMemoryUsageMB();
    const uptimeMs = Date.now() - this.poolStartTime;
    const totalProcessed = this.completedTaskCount + this.failedTaskCount;
    const avgDuration = totalProcessed > 0 ? this.totalTaskDurationMs / totalProcessed : 0;
    const successRate = totalProcessed > 0 ? (this.completedTaskCount / totalProcessed) * 100 : 0;

    // Calculate tasks per minute
    const uptimeMinutes = uptimeMs / 60000;
    const tasksPerMinute = uptimeMinutes > 0 ? totalProcessed / uptimeMinutes : 0;

    // Calculate utilization
    const utilizationPercent = this.options.maxWorkers > 0
      ? (this.activeWorkers.size / this.options.maxWorkers) * 100
      : 0;

    return {
      activeWorkers: this.activeWorkers.size,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTaskCount,
      failedTasks: this.failedTaskCount,
      totalProcessed,
      successRate: Math.round(successRate * 100) / 100,
      avgTaskDurationMs: Math.round(avgDuration),
      peakConcurrency: this.peakConcurrency,
      memoryUsageMB: Math.round(currentMemoryMB * 100) / 100,
      peakMemoryUsageMB: Math.round(this.peakMemoryUsageMB * 100) / 100,
      currentWorkerLimit: this.currentWorkerLimit,
      maxWorkers: this.options.maxWorkers,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
      uptimeMs,
      tasksPerMinute: Math.round(tasksPerMinute * 100) / 100,
    };
  }

  /**
   * Update peak concurrency tracking
   */
  private updatePeakConcurrency(): void {
    if (this.activeWorkers.size > this.peakConcurrency) {
      this.peakConcurrency = this.activeWorkers.size;

      // Also track memory at peak
      const currentMemory = getMemoryUsageMB();
      if (currentMemory > this.peakMemoryUsageMB) {
        this.peakMemoryUsageMB = currentMemory;
      }
    }
  }

  /**
   * Start degradation monitoring
   */
  private startDegradationMonitor(): void {
    if (!this.options.enableGracefulDegradation || this.degradationCheckInterval) {
      return;
    }

    this.degradationCheckInterval = setInterval(() => {
      this.checkDegradationStatus();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop degradation monitoring
   */
  private stopDegradationMonitor(): void {
    if (this.degradationCheckInterval) {
      clearInterval(this.degradationCheckInterval);
      this.degradationCheckInterval = null;
    }
  }

  /**
   * Check and update degradation status with error aggregation statistics
   */
  private checkDegradationStatus(): void {
    const circuitBreakers = getAllCircuitBreakerHealth();
    const affectedServices: string[] = [];
    const recoveryActions: string[] = [];

    // Check circuit breaker states
    for (const [name, health] of Object.entries(circuitBreakers)) {
      this.degradationStatus.circuitBreakers[name] = health;

      if (health.state === 'open') {
        affectedServices.push(name);
        recoveryActions.push(`Wait for ${name} circuit breaker timeout to reset`);
      } else if (health.state === 'half_open') {
        affectedServices.push(`${name} (recovering)`);
      }
    }

    // Check consecutive failures
    if (this.consecutiveFailures >= this.failureThreshold) {
      affectedServices.push('worker-execution');
      recoveryActions.push('Check system resources and external service availability');
      recoveryActions.push('Review recent error logs for patterns');
    }

    // Get error aggregation statistics for pattern analysis
    const errorAggregator = getErrorAggregator();
    const recentErrors = errorAggregator.getErrorsInWindow(60000); // Last minute
    const retryStats = errorAggregator.getRetryStats();
    const mostCommon = errorAggregator.getMostCommonErrors(1);

    // Add error-based recovery actions
    if (retryStats.totalNonRetryable > 5) {
      affectedServices.push('error-threshold-exceeded');
      recoveryActions.push('Multiple non-retryable errors detected - review configuration');
    }

    if (mostCommon.length > 0 && mostCommon[0].count > 10) {
      recoveryActions.push(`Most common error: ${mostCommon[0].code} (${mostCommon[0].count} occurrences)`);
    }

    // Update error statistics
    this.degradationStatus.errorStats = {
      totalErrors: recentErrors.length,
      byRecoveryStrategy: retryStats.byStrategy,
      mostCommonErrorCode: mostCommon.length > 0 ? mostCommon[0].code : undefined,
      retriesExhausted: retryStats.totalNonRetryable,
    };

    // Update degradation status
    const wasDegraded = this.degradationStatus.isDegraded;
    this.degradationStatus.isDegraded = affectedServices.length > 0;
    this.degradationStatus.affectedServices = affectedServices;
    this.degradationStatus.recoveryActions = recoveryActions;

    if (this.degradationStatus.isDegraded) {
      this.degradationStatus.reason = `Services affected: ${affectedServices.join(', ')}`;
      if (!wasDegraded) {
        this.degradationStatus.startedAt = new Date();
        logger.warn('Worker pool entering degraded mode', {
          affectedServices,
          circuitBreakers,
          consecutiveFailures: this.consecutiveFailures,
          errorStats: this.degradationStatus.errorStats,
        });
      }
    } else if (wasDegraded) {
      logger.info('Worker pool recovered from degraded mode', {
        recoveryDuration: this.degradationStatus.startedAt
          ? Date.now() - this.degradationStatus.startedAt.getTime()
          : 0,
        errorStats: this.degradationStatus.errorStats,
      });
      this.degradationStatus.startedAt = undefined;
      this.degradationStatus.reason = undefined;
    }
  }

  /**
   * Record a task result and update failure tracking
   */
  private recordTaskResult(success: boolean): void {
    if (success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;

      // Check if we should enter degraded mode
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.checkDegradationStatus();
      }
    }
  }

  /**
   * Get current degradation status
   */
  getDegradationStatus(): DegradationStatus {
    return { ...this.degradationStatus };
  }

  /**
   * Check if the pool can accept new tasks
   */
  canAcceptTasks(): boolean {
    // Don't accept new tasks during shutdown
    if (this.isShuttingDown) {
      return false;
    }

    // Check queue size limit
    if (this.taskQueue.length >= this.queueConfig.maxQueueSize) {
      // In 'pause' strategy, reject new tasks when full
      if (this.queueConfig.overflowStrategy === 'pause') {
        return false;
      }
    }

    // In degraded mode, we can still accept tasks but with reduced capacity
    if (this.degradationStatus.isDegraded) {
      // Only accept if we have workers available and queue isn't critically full
      return this.taskQueue.length < this.queueConfig.maxQueueSize * 0.9;
    }
    return true;
  }

  /**
   * Get current queue utilization percentage
   */
  getQueueUtilization(): number {
    return (this.taskQueue.length / this.queueConfig.maxQueueSize) * 100;
  }

  /**
   * Check if queue is approaching capacity and emit warning
   */
  private checkQueueCapacity(): void {
    const utilization = this.getQueueUtilization();
    if (utilization >= this.queueConfig.queueWarningThreshold) {
      logger.warn(`Queue approaching capacity: ${utilization.toFixed(1)}%`, {
        currentSize: this.taskQueue.length,
        maxSize: this.queueConfig.maxQueueSize,
        warningThreshold: this.queueConfig.queueWarningThreshold,
      });
    }
  }

  /**
   * Handle queue overflow based on configured strategy
   * @returns true if task was added, false if rejected
   */
  private handleQueueOverflow(newTask: PoolTask): boolean {
    if (this.taskQueue.length < this.queueConfig.maxQueueSize) {
      return true; // No overflow, task can be added
    }

    const overflowEvent: QueueOverflowEvent = {
      timestamp: new Date(),
      queueSize: this.taskQueue.length,
      maxQueueSize: this.queueConfig.maxQueueSize,
      strategy: this.queueConfig.overflowStrategy,
    };

    switch (this.queueConfig.overflowStrategy) {
      case 'reject':
        // Reject the new task
        logger.warn(`Queue full, rejecting task: ${newTask.id}`, {
          taskId: newTask.id,
          issueNumber: newTask.issue.number,
          priority: newTask.metadata?.priority ?? 'medium',
          queueSize: this.taskQueue.length,
        });

        // Record in execution history as dropped
        this.recordExecutionHistory(newTask, 'dropped');

        this.overflowEvents.push(overflowEvent);
        return false;

      case 'drop-lowest':
        // Find and remove the lowest priority task
        const lowestPriorityIndex = this.findLowestPriorityTaskIndex();
        if (lowestPriorityIndex !== -1) {
          const droppedTask = this.taskQueue[lowestPriorityIndex];

          // Only drop if new task has higher priority
          if ((newTask.priorityScore ?? 0) > (droppedTask.priorityScore ?? 0)) {
            this.taskQueue.splice(lowestPriorityIndex, 1);

            logger.warn(`Queue full, dropped lowest priority task: ${droppedTask.id}`, {
              droppedTaskId: droppedTask.id,
              droppedPriority: droppedTask.metadata?.priority ?? 'medium',
              droppedScore: droppedTask.priorityScore,
              newTaskId: newTask.id,
              newPriority: newTask.metadata?.priority ?? 'medium',
              newScore: newTask.priorityScore,
            });

            // Record dropped task in history
            this.recordExecutionHistory(droppedTask, 'dropped');

            overflowEvent.droppedTaskId = droppedTask.id;
            overflowEvent.droppedTaskPriority = droppedTask.metadata?.priority;
            this.overflowEvents.push(overflowEvent);
            return true;
          }
        }

        // New task has lower or equal priority, reject it
        logger.warn(`Queue full, new task has lower priority, rejecting: ${newTask.id}`, {
          taskId: newTask.id,
          priority: newTask.metadata?.priority ?? 'medium',
        });
        this.recordExecutionHistory(newTask, 'dropped');
        this.overflowEvents.push(overflowEvent);
        return false;

      case 'pause':
        // Should not reach here as canAcceptTasks returns false
        logger.warn(`Queue full in pause mode, rejecting task: ${newTask.id}`);
        this.overflowEvents.push(overflowEvent);
        return false;

      default:
        return false;
    }
  }

  /**
   * Find the index of the lowest priority task in the queue
   */
  private findLowestPriorityTaskIndex(): number {
    if (this.taskQueue.length === 0) return -1;

    let lowestIndex = 0;
    let lowestScore = this.taskQueue[0].priorityScore ?? 0;

    for (let i = 1; i < this.taskQueue.length; i++) {
      const score = this.taskQueue[i].priorityScore ?? 0;
      if (score < lowestScore) {
        lowestScore = score;
        lowestIndex = i;
      }
    }

    return lowestIndex;
  }

  /**
   * Record task execution in history for audit trail
   */
  private recordExecutionHistory(
    task: PoolTask,
    status: ExecutionHistoryEntry['status'],
    workerId?: string,
    error?: ExecutionHistoryEntry['error']
  ): void {
    if (!this.options.enableExecutionHistory) return;

    const existingEntry = this.executionHistory.find(e => e.taskId === task.id);

    if (existingEntry) {
      // Update existing entry
      existingEntry.status = status;
      if (status === 'started') {
        existingEntry.startedAt = new Date();
        existingEntry.workerId = workerId;
      } else if (status === 'completed' || status === 'failed') {
        existingEntry.completedAt = new Date();
        if (existingEntry.startedAt) {
          existingEntry.duration = existingEntry.completedAt.getTime() - existingEntry.startedAt.getTime();
        }
        if (error) {
          existingEntry.error = error;
        }
      }
      existingEntry.retryCount = task.retryCount ?? 0;
    } else {
      // Create new entry
      const entry: ExecutionHistoryEntry = {
        taskId: task.id,
        issueNumber: task.issue.number,
        branchName: task.branchName,
        priority: task.metadata?.priority ?? 'medium',
        category: task.metadata?.category,
        status,
        queuedAt: task.queuedAt ?? new Date(),
        retryCount: task.retryCount ?? 0,
        workerId,
        error,
        metadata: {
          priorityScore: task.priorityScore,
          groupId: task.groupId,
          complexity: task.metadata?.complexity,
        },
      };

      if (status === 'started') {
        entry.startedAt = new Date();
      } else if (status === 'completed' || status === 'failed') {
        entry.startedAt = new Date();
        entry.completedAt = new Date();
      }

      this.executionHistory.push(entry);

      // Trim history if exceeds max
      if (this.executionHistory.length > this.maxHistoryEntries) {
        this.executionHistory.shift();
      }
    }
  }

  /**
   * Get execution history with optional filtering
   */
  getExecutionHistory(options?: {
    status?: ExecutionHistoryEntry['status'];
    priority?: TaskPriority;
    limit?: number;
    since?: Date;
  }): ExecutionHistoryEntry[] {
    let filtered = [...this.executionHistory];

    if (options?.status) {
      filtered = filtered.filter(e => e.status === options.status);
    }
    if (options?.priority) {
      filtered = filtered.filter(e => e.priority === options.priority);
    }
    if (options?.since) {
      filtered = filtered.filter(e => e.queuedAt >= options.since!);
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

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
  } {
    const stats = {
      total: this.executionHistory.length,
      byStatus: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
      avgDuration: 0,
      successRate: 0,
      retriesTotal: 0,
    };

    let totalDuration = 0;
    let completedCount = 0;
    let successCount = 0;

    for (const entry of this.executionHistory) {
      // Count by status
      stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;

      // Count by priority
      stats.byPriority[entry.priority] = (stats.byPriority[entry.priority] || 0) + 1;

      // Sum durations
      if (entry.duration) {
        totalDuration += entry.duration;
        completedCount++;
      }

      // Count successes
      if (entry.status === 'completed') {
        successCount++;
      }

      // Sum retries
      stats.retriesTotal += entry.retryCount;
    }

    stats.avgDuration = completedCount > 0 ? totalDuration / completedCount : 0;
    stats.successRate = stats.total > 0 ? (successCount / stats.total) * 100 : 0;

    return stats;
  }

  /**
   * Get queue overflow events
   */
  getOverflowEvents(limit?: number): QueueOverflowEvent[] {
    const events = [...this.overflowEvents];
    return limit ? events.slice(-limit) : events;
  }

  /**
   * Gracefully shutdown the worker pool, preserving queued tasks
   * @param timeoutMs Maximum time to wait for active workers to complete
   * @returns Remaining queued tasks that were not processed
   */
  async gracefulShutdown(timeoutMs: number = 60000): Promise<PoolTask[]> {
    if (this.isShuttingDown) {
      logger.warn('Graceful shutdown already in progress');
      return [...this.taskQueue];
    }

    this.isShuttingDown = true;
    logger.info('Initiating graceful shutdown of worker pool', {
      activeWorkers: this.activeWorkers.size,
      queuedTasks: this.taskQueue.length,
      timeoutMs,
    });

    // Stop accepting new tasks and all monitors
    this.isRunning = false;
    this.stopScalingMonitor();
    this.stopDegradationMonitor();
    this.stopMemoryMonitor();

    // Wait for active workers to complete (with timeout)
    if (this.activeWorkers.size > 0) {
      const startTime = Date.now();
      const activePromises = Array.from(this.activeWorkers.values());

      try {
        await Promise.race([
          Promise.all(activePromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)
          ),
        ]);
        logger.info('All active workers completed during graceful shutdown');
      } catch (error) {
        const elapsed = Date.now() - startTime;
        logger.warn(`Shutdown timeout reached after ${elapsed}ms, ${this.activeWorkers.size} workers still active`);
      }
    }

    // Persist remaining queue if enabled
    const remainingTasks = [...this.taskQueue];
    if (this.queueConfig.enablePersistence && remainingTasks.length > 0) {
      await this.persistQueuedTasks(remainingTasks);
    }

    // Update history for remaining queued tasks
    for (const task of remainingTasks) {
      this.recordExecutionHistory(task, 'dropped', undefined, {
        code: 'SHUTDOWN',
        message: 'Task dropped due to graceful shutdown',
        isRetryable: true,
      });
    }

    logger.info('Graceful shutdown completed', {
      preservedTasks: remainingTasks.length,
      completedResults: this.results.length,
    });

    this.isShuttingDown = false;
    return remainingTasks;
  }

  /**
   * Persist queued tasks to disk for recovery
   */
  private async persistQueuedTasks(tasks: PoolTask[]): Promise<void> {
    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');

      const persistDir = join(this.options.workDir, 'queue-persist');
      if (!existsSync(persistDir)) {
        mkdirSync(persistDir, { recursive: true });
      }

      const persistPath = join(persistDir, `queue-${Date.now()}.json`);
      const persistData = tasks.map(task => ({
        id: task.id,
        issue: task.issue,
        branchName: task.branchName,
        metadata: task.metadata,
        priorityScore: task.priorityScore,
        groupId: task.groupId,
        queuedAt: task.queuedAt?.toISOString(),
        retryCount: task.retryCount,
      }));

      writeFileSync(persistPath, JSON.stringify(persistData, null, 2));
      logger.info(`Persisted ${tasks.length} queued tasks to ${persistPath}`);
    } catch (error) {
      logger.error('Failed to persist queued tasks', { error: (error as Error).message });
    }
  }

  /**
   * Load previously persisted queued tasks
   */
  async loadPersistedTasks(): Promise<PoolTask[]> {
    try {
      const { readdirSync, readFileSync, existsSync, unlinkSync } = await import('fs');
      const { join } = await import('path');

      const persistDir = join(this.options.workDir, 'queue-persist');
      if (!existsSync(persistDir)) {
        return [];
      }

      const files = readdirSync(persistDir)
        .filter(f => f.startsWith('queue-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) {
        return [];
      }

      // Load the most recent persisted queue
      const latestFile = join(persistDir, files[0]);
      const data = JSON.parse(readFileSync(latestFile, 'utf-8'));

      const tasks: PoolTask[] = data.map((item: any) => ({
        id: item.id,
        issue: item.issue,
        branchName: item.branchName,
        metadata: item.metadata,
        priorityScore: item.priorityScore,
        groupId: item.groupId,
        queuedAt: item.queuedAt ? new Date(item.queuedAt) : new Date(),
        retryCount: item.retryCount ?? 0,
      }));

      // Clean up the persisted file after loading
      unlinkSync(latestFile);

      logger.info(`Loaded ${tasks.length} persisted tasks from ${latestFile}`);
      return tasks;
    } catch (error) {
      logger.warn('Failed to load persisted tasks', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Get dead letter queue stats
   */
  getDeadLetterQueueStats() {
    const dlq = getDeadLetterQueue({}, this.options.workDir);
    return dlq.getStats();
  }

  /**
   * Get reprocessable tasks from dead letter queue
   */
  getReprocessableTasks(): DeadLetterEntry[] {
    const dlq = getDeadLetterQueue({}, this.options.workDir);
    return dlq.getReprocessableEntries();
  }

  /**
   * Get error aggregation summary for pattern analysis.
   * Provides insight into error patterns across the pool.
   */
  getErrorAggregationSummary() {
    const aggregator = getErrorAggregator();
    return aggregator.getSummary();
  }

  /**
   * Get recent errors within a time window for debugging.
   * @param windowMs Time window in milliseconds (default: 5 minutes)
   */
  getRecentErrors(windowMs: number = 5 * 60 * 1000) {
    const aggregator = getErrorAggregator();
    return aggregator.getErrorsInWindow(windowMs).map(error => ({
      code: error.code,
      message: error.message,
      severity: error.severity,
      isRetryable: error.isRetryable,
      recoveryStrategy: error instanceof ExecutorError
        ? error.recoveryStrategy.strategy
        : (error.isRetryable ? 'retry' : 'escalate'),
      timestamp: error.timestamp,
    }));
  }

  /**
   * Clear error aggregation data (useful after recovery or for testing)
   */
  clearErrorAggregation(): void {
    const aggregator = getErrorAggregator();
    aggregator.clear();
    logger.info('Error aggregation data cleared');
  }

  /**
   * Calculate priority score for a task
   */
  private calculatePriorityScore(task: PoolTask): number {
    const metadata = task.metadata;
    if (!metadata) {
      return PRIORITY_WEIGHTS.medium; // Default priority
    }

    let score = PRIORITY_WEIGHTS[metadata.priority ?? 'medium'];

    // Apply category boost
    if (metadata.category) {
      score += CATEGORY_PRIORITY_BOOST[metadata.category] ?? 0;
    }

    // Boost complexity-adjusted tasks (simple tasks get slight boost for quick wins)
    if (metadata.complexity === 'simple') {
      score += 5;
    } else if (metadata.complexity === 'complex') {
      score -= 5;
    }

    return score;
  }

  /**
   * Generate a group ID for a task based on affected paths
   */
  private generateGroupId(task: PoolTask): string | undefined {
    const paths = task.metadata?.affectedPaths;
    if (!paths || paths.length === 0) {
      return undefined;
    }

    // Find common directory prefix from affected paths
    const directories = paths.map(p => {
      // Extract directory from path (handle both file paths and directory paths)
      const parts = p.split('/');
      // Remove filename if present (has extension or is a known file pattern)
      if (parts.length > 1 && (parts[parts.length - 1].includes('.') || !parts[parts.length - 1])) {
        parts.pop();
      }
      return parts.slice(0, 2).join('/'); // Use first two path components
    });

    // Use the most common directory as group ID
    const dirCounts = new Map<string, number>();
    for (const dir of directories) {
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }

    // Return the most common directory, or undefined if no clear winner
    let maxCount = 0;
    let groupDir: string | undefined;
    for (const [dir, count] of dirCounts) {
      if (count > maxCount && dir.length > 0) {
        maxCount = count;
        groupDir = dir;
      }
    }

    return groupDir ? `group:${groupDir}` : undefined;
  }

  /**
   * Sort task queue by priority (highest first)
   */
  private sortTaskQueue(): void {
    this.taskQueue.sort((a, b) => {
      const scoreA = a.priorityScore ?? this.calculatePriorityScore(a);
      const scoreB = b.priorityScore ?? this.calculatePriorityScore(b);
      return scoreB - scoreA; // Higher score = higher priority
    });
  }

  /**
   * Select the next task, preferring tasks from the same group as a worker
   */
  private selectNextTask(preferredGroupId?: string): PoolTask | undefined {
    if (this.taskQueue.length === 0) {
      return undefined;
    }

    // If we have a preferred group, try to find a task from that group
    if (preferredGroupId) {
      const groupTaskIndex = this.taskQueue.findIndex(t => t.groupId === preferredGroupId);
      if (groupTaskIndex !== -1) {
        return this.taskQueue.splice(groupTaskIndex, 1)[0];
      }
    }

    // Otherwise, take the highest priority task
    return this.taskQueue.shift();
  }

  /**
   * Get task-specific timeout based on complexity
   */
  getTaskTimeout(task: PoolTask): number {
    const baseTimeout = this.options.timeoutMinutes * 60 * 1000;
    const complexity = task.metadata?.complexity ?? 'moderate';
    const multiplier = COMPLEXITY_TIMEOUT_MULTIPLIER[complexity];
    return Math.round(baseTimeout * multiplier);
  }

  async executeTasks(tasks: WorkerTask[]): Promise<PoolResult[]> {
    this.isRunning = true;
    this.isShuttingDown = false;
    this.results = [];
    this.workerTaskMap.clear();
    this.taskGroupWorkers.clear();

    // Reset progress tracking
    this.executionStartTime = Date.now();
    this.taskETACalculator.reset();

    // Load any persisted tasks from previous shutdown
    const persistedTasks = await this.loadPersistedTasks();

    // Convert tasks to PoolTasks with metadata enrichment
    const newTasks: PoolTask[] = tasks.map((task, index) => {
      const poolTask: PoolTask = {
        ...task,
        id: `task-${index + 1}`,
        metadata: this.extractTaskMetadata(task),
        queuedAt: new Date(),
        retryCount: 0,
        maxRetries: this.options.retryConfig?.maxRetries ?? 3,
      };

      // Calculate priority score and group ID
      poolTask.priorityScore = this.calculatePriorityScore(poolTask);
      poolTask.groupId = this.generateGroupId(poolTask);

      return poolTask;
    });

    // Combine persisted tasks (higher priority) with new tasks
    const allTasks = [...persistedTasks, ...newTasks];

    // Add tasks to queue with overflow handling
    this.taskQueue = [];
    const rejectedTasks: PoolTask[] = [];

    for (const task of allTasks) {
      if (this.handleQueueOverflow(task)) {
        this.taskQueue.push(task);
        this.recordExecutionHistory(task, 'queued');
      } else {
        rejectedTasks.push(task);
      }
    }

    if (rejectedTasks.length > 0) {
      logger.warn(`${rejectedTasks.length} tasks rejected due to queue overflow`, {
        rejectedCount: rejectedTasks.length,
        queueSize: this.taskQueue.length,
        maxQueueSize: this.queueConfig.maxQueueSize,
      });
    }

    // Sort by priority (highest first)
    this.sortTaskQueue();

    // Check queue capacity and emit warnings
    this.checkQueueCapacity();

    // Get effective worker limit based on current resources
    const effectiveWorkerLimit = Math.min(this.currentWorkerLimit, this.options.maxWorkers);

    logger.info(`Executing ${this.taskQueue.length} tasks with up to ${effectiveWorkerLimit} workers`, {
      taskCount: this.taskQueue.length,
      originalTaskCount: tasks.length,
      persistedTaskCount: persistedTasks.length,
      rejectedTaskCount: rejectedTasks.length,
      maxWorkers: this.options.maxWorkers,
      effectiveWorkerLimit,
      queueUtilization: `${this.getQueueUtilization().toFixed(1)}%`,
      maxQueueSize: this.queueConfig.maxQueueSize,
      enableDynamicScaling: this.options.enableDynamicScaling ?? false,
      enableExecutionHistory: this.options.enableExecutionHistory ?? false,
      systemResources: this.getSystemResources(),
    });

    // Update initial metrics
    this.updateMetrics();

    // Reset metrics tracking for this execution batch
    this.completedTaskCount = 0;
    this.failedTaskCount = 0;
    this.totalTaskDurationMs = 0;
    this.peakConcurrency = 0;
    this.peakMemoryUsageMB = getMemoryUsageMB();
    this.completionQueue = [];
    this.completionResolver = null;

    // Start dynamic scaling monitor if enabled
    this.startScalingMonitor();

    // Start graceful degradation monitor if enabled
    this.startDegradationMonitor();

    // Start memory monitor for automatic cleanup
    this.startMemoryMonitor();

    // Start initial workers
    while (this.activeWorkers.size < effectiveWorkerLimit && this.taskQueue.length > 0) {
      this.startNextTask();
      this.updatePeakConcurrency();
    }

    // Wait for all tasks to complete using event-based tracking (O(1) complexity)
    // This replaces the inefficient Promise.race() pattern which was O(n)
    while ((this.activeWorkers.size > 0 || this.taskQueue.length > 0) && !this.isShuttingDown) {
      if (this.activeWorkers.size > 0) {
        // Wait for next worker completion using event-based tracking (O(1))
        const completionEvent = await this.waitForWorkerCompletion();

        // Get the completed task's group for worker affinity
        const completedGroupId = completionEvent.groupId;

        // Clean up worker tracking
        this.activeWorkers.delete(completionEvent.taskId);
        this.workerTaskMap.delete(completionEvent.taskId);

        // Update metrics after worker completion
        this.updateMetrics();

        // Start next task if available and not shutting down
        if (this.taskQueue.length > 0 && this.isRunning && !this.isShuttingDown) {
          // Use worker affinity: try to assign same-group tasks to same worker
          this.startNextTask(completedGroupId);
          this.updatePeakConcurrency();
        }
      }
    }

    // Stop all monitors
    this.stopScalingMonitor();
    this.stopDegradationMonitor();
    this.stopMemoryMonitor();

    const succeeded = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;

    // Get final pool metrics
    const finalMetrics = this.getPoolMetrics();

    logger.info(`All tasks completed: ${succeeded}/${this.results.length} succeeded`, {
      succeeded,
      failed,
      total: this.results.length,
      successRate: `${finalMetrics.successRate}%`,
      avgDurationMs: finalMetrics.avgTaskDurationMs,
      peakConcurrency: finalMetrics.peakConcurrency,
      peakMemoryMB: finalMetrics.peakMemoryUsageMB,
      tasksPerMinute: finalMetrics.tasksPerMinute,
      degradationOccurred: this.degradationStatus.isDegraded || this.consecutiveFailures > 0,
      dlqStats: this.getDeadLetterQueueStats(),
    });

    // Reset pool metrics
    metrics.updateWorkerPoolStatus(0, 0);

    return this.results;
  }

  /**
   * Extract task metadata from issue labels and body
   */
  private extractTaskMetadata(task: WorkerTask): TaskMetadata {
    const metadata: TaskMetadata = {};
    const issue = task.issue;

    // Extract priority from labels (priority:high, priority:medium, etc.)
    const priorityLabel = issue.labels.find(l => l.startsWith('priority:'));
    if (priorityLabel) {
      const priority = priorityLabel.replace('priority:', '') as TaskPriority;
      if (['critical', 'high', 'medium', 'low'].includes(priority)) {
        metadata.priority = priority;
      }
    }

    // Extract category from labels (type:bugfix, type:feature, etc.)
    const typeLabel = issue.labels.find(l => l.startsWith('type:'));
    if (typeLabel) {
      const category = typeLabel.replace('type:', '') as TaskCategory;
      if (['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes(category)) {
        metadata.category = category;
      }
    }

    // Extract complexity from labels (complexity:simple, complexity:moderate, etc.)
    const complexityLabel = issue.labels.find(l => l.startsWith('complexity:'));
    if (complexityLabel) {
      const complexity = complexityLabel.replace('complexity:', '') as TaskComplexity;
      if (['simple', 'moderate', 'complex'].includes(complexity)) {
        metadata.complexity = complexity;
      }
    }

    // Extract affected paths from issue body
    if (issue.body) {
      const pathsMatch = issue.body.match(/## Affected Paths\s*([\s\S]*?)(?=\n##|---|\n\n\n|$)/);
      if (pathsMatch) {
        const pathsSection = pathsMatch[1];
        const paths = pathsSection.match(/`([^`]+)`/g);
        if (paths) {
          metadata.affectedPaths = paths.map(p => p.replace(/`/g, ''));
        }
      }
    }

    return metadata;
  }

  private startNextTask(preferredGroupId?: string): void {
    // Select task with group affinity preference
    const task = this.selectNextTask(preferredGroupId);
    if (!task) return;

    const workerId = `worker-${++this.workerIdCounter}`;

    // Track worker-task relationship for group affinity
    this.workerTaskMap.set(task.id, task);

    // Track group-worker relationship for future task assignment
    if (task.groupId) {
      this.taskGroupWorkers.set(task.groupId, workerId);
    }

    // Record task started in execution history
    this.recordExecutionHistory(task, 'started', workerId);

    // Calculate task-specific timeout
    const taskTimeoutMs = this.getTaskTimeout(task);
    const taskTimeoutMinutes = Math.round(taskTimeoutMs / 60000);

    logger.info(`Starting ${task.id} with ${workerId}: ${task.issue.title}`, {
      taskId: task.id,
      workerId,
      issueNumber: task.issue.number,
      priority: task.metadata?.priority ?? 'medium',
      category: task.metadata?.category ?? 'unknown',
      complexity: task.metadata?.complexity ?? 'moderate',
      priorityScore: task.priorityScore,
      groupId: task.groupId,
      timeoutMinutes: taskTimeoutMinutes,
      retryCount: task.retryCount ?? 0,
      queuedAt: task.queuedAt?.toISOString(),
    });

    // Log worker progress start
    logger.workerProgress(workerId, task.issue.number, 'starting');

    // Track with progress manager
    this.progressManager.startWorker(workerId, task.id, task.issue.number);

    // Update metrics after task is dequeued
    this.updateMetrics();

    const worker = new Worker(
      {
        workDir: this.options.workDir,
        repoUrl: this.options.repoUrl,
        baseBranch: this.options.baseBranch,
        githubToken: this.options.githubToken,
        claudeAuth: this.options.claudeAuth,
        timeoutMinutes: taskTimeoutMinutes, // Use task-specific timeout
        // Database logging options
        userId: this.options.userId,
        repoOwner: this.options.repoOwner,
        repoName: this.options.repoName,
        enableDatabaseLogging: this.options.enableDatabaseLogging,
        // Retry configuration
        retryConfig: this.options.retryConfig,
        // Merge configuration for auto-merge after PR creation
        mergeConfig: this.options.mergeConfig,
        // Token refresh callback for proactive token refresh
        onTokenRefresh: this.options.onTokenRefresh,
      },
      workerId
    );

    const promise = worker.execute(task).then((result) => {
      this.results.push({
        ...result,
        taskId: task.id,
      });

      // Track result for graceful degradation
      this.recordTaskResult(result.success);

      // Update metrics tracking
      if (result.success) {
        this.completedTaskCount++;
      } else {
        this.failedTaskCount++;
      }
      if (result.duration) {
        this.totalTaskDurationMs += result.duration;
      }

      // Record in execution history
      if (result.success) {
        this.recordExecutionHistory(task, 'completed', workerId);

        // Track completion for ETA calculation
        if (result.duration) {
          this.taskETACalculator.addSample(result.duration);
        }

        // Log worker progress completion
        logger.workerProgress(workerId, task.issue.number, 'completed', 100, `${formatDuration(result.duration || 0)}`);
        this.progressManager.completeWorker(workerId, true);

        logger.success(`${task.id} completed: ${task.issue.title}`);
        logger.debug(`Task completion details`, {
          taskId: task.id,
          priority: task.metadata?.priority,
          groupId: task.groupId,
          duration: result.duration,
          retryCount: task.retryCount ?? 0,
        });
      } else {
        // Extract error info for history
        const errorInfo = result.error ? {
          code: result.error.match(/\[([^\]]+)\]/)?.[1] ?? 'UNKNOWN',
          message: result.error,
          isRetryable: !result.error.includes('AUTH') && !result.error.includes('PERMISSION'),
        } : undefined;

        this.recordExecutionHistory(task, 'failed', workerId, errorInfo);
        this.progressManager.completeWorker(workerId, false);
        logger.failure(`${task.id} failed: ${result.error}`);
        logger.debug(`Task failure details`, {
          taskId: task.id,
          priority: task.metadata?.priority,
          groupId: task.groupId,
          duration: result.duration,
          retryCount: task.retryCount ?? 0,
          consecutiveFailures: this.consecutiveFailures,
          isDegraded: this.degradationStatus.isDegraded,
        });
      }

      // Signal completion using event-based tracking (O(1) complexity)
      // This replaces the old Promise.race() pattern
      this.signalWorkerCompletion({
        taskId: task.id,
        workerId,
        success: result.success,
        duration: result.duration,
        groupId: task.groupId,
        result,
      });

      return result;
    });

    this.activeWorkers.set(task.id, promise);
  }

  stop(): void {
    this.isRunning = false;
    this.stopScalingMonitor();
    this.stopDegradationMonitor();
    this.stopMemoryMonitor();
    logger.warn('Worker pool stop requested', {
      activeWorkers: this.activeWorkers.size,
      queuedTasks: this.taskQueue.length,
      poolMetrics: this.getPoolMetrics(),
    });
  }

  /**
   * Check if the pool is currently shutting down
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get the current queue configuration
   */
  getQueueConfig(): QueueConfig {
    return { ...this.queueConfig };
  }

  /**
   * Update queue configuration at runtime
   */
  updateQueueConfig(config: Partial<QueueConfig>): void {
    this.queueConfig = { ...this.queueConfig, ...config };
    logger.info('Queue configuration updated', {
      config: this.queueConfig,
    });
  }

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
  } {
    const groupIds = new Set(this.taskQueue.map(t => t.groupId).filter(Boolean));
    const utilization = this.getQueueUtilization();

    return {
      active: this.activeWorkers.size,
      queued: this.taskQueue.length,
      completed: this.results.length,
      succeeded: this.results.filter((r) => r.success).length,
      failed: this.results.filter((r) => !r.success).length,
      currentWorkerLimit: this.currentWorkerLimit,
      systemResources: this.getSystemResources(),
      taskGroups: groupIds.size,
      degradationStatus: this.getDegradationStatus(),
      dlqStats: this.getDeadLetterQueueStats(),
      errorAggregation: this.getErrorAggregationSummary(),
      queueStatus: {
        utilization,
        maxSize: this.queueConfig.maxQueueSize,
        isAtCapacity: utilization >= 100,
        overflowStrategy: this.queueConfig.overflowStrategy,
        recentOverflowCount: this.overflowEvents.filter(
          e => e.timestamp.getTime() > Date.now() - 60000 // Last minute
        ).length,
      },
      executionStats: this.getExecutionStats(),
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Get the current scaling configuration
   */
  getScalingConfig(): ScalingConfig {
    return { ...this.scalingConfig };
  }

  /**
   * Update scaling configuration at runtime
   */
  updateScalingConfig(config: Partial<ScalingConfig>): void {
    this.scalingConfig = { ...this.scalingConfig, ...config };
    // Recompute worker limit with new config
    this.currentWorkerLimit = this.computeOptimalWorkerCount();
    logger.info('Scaling configuration updated', {
      config: this.scalingConfig,
      newWorkerLimit: this.currentWorkerLimit,
    });
  }
}

export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  return new WorkerPool(options);
}
