import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { logger, generateCorrelationId, setCorrelationId, clearCorrelationId } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import * as os from 'os';

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

export interface WorkerPoolOptions extends Omit<WorkerOptions, 'workDir'> {
  maxWorkers: number;
  workDir: string;
  /** Optional scaling configuration for dynamic worker management */
  scalingConfig?: Partial<ScalingConfig>;
  /** Enable dynamic scaling based on system resources */
  enableDynamicScaling?: boolean;
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

export class WorkerPool {
  private options: WorkerPoolOptions;
  private activeWorkers: Map<string, Promise<WorkerResult>> = new Map();
  private taskQueue: PoolTask[] = [];
  private results: PoolResult[] = [];
  private isRunning: boolean = false;
  private workerIdCounter: number = 0;
  private repository: string;
  private scalingConfig: ScalingConfig;
  private currentWorkerLimit: number;
  private scaleCheckInterval: NodeJS.Timeout | null = null;
  private workerTaskMap: Map<string, PoolTask> = new Map(); // Maps worker ID to assigned task
  private taskGroupWorkers: Map<string, string> = new Map(); // Maps group ID to preferred worker ID

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

  constructor(options: WorkerPoolOptions) {
    this.options = options;
    this.repository = this.extractRepoName(options.repoUrl);

    // Initialize scaling configuration
    this.scalingConfig = {
      ...WorkerPool.DEFAULT_SCALING_CONFIG,
      maxWorkers: options.maxWorkers,
      ...options.scalingConfig,
    };

    // Compute initial worker limit based on system resources
    this.currentWorkerLimit = this.computeOptimalWorkerCount();

    logger.info(`Worker pool initialized`, {
      maxWorkers: options.maxWorkers,
      initialWorkerLimit: this.currentWorkerLimit,
      enableDynamicScaling: options.enableDynamicScaling ?? false,
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
    this.results = [];
    this.workerTaskMap.clear();
    this.taskGroupWorkers.clear();

    // Convert tasks to PoolTasks with metadata enrichment
    this.taskQueue = tasks.map((task, index) => {
      const poolTask: PoolTask = {
        ...task,
        id: `task-${index + 1}`,
        metadata: this.extractTaskMetadata(task),
      };

      // Calculate priority score and group ID
      poolTask.priorityScore = this.calculatePriorityScore(poolTask);
      poolTask.groupId = this.generateGroupId(poolTask);

      return poolTask;
    });

    // Sort by priority (highest first)
    this.sortTaskQueue();

    // Get effective worker limit based on current resources
    const effectiveWorkerLimit = Math.min(this.currentWorkerLimit, this.options.maxWorkers);

    logger.info(`Executing ${tasks.length} tasks with up to ${effectiveWorkerLimit} workers`, {
      taskCount: tasks.length,
      maxWorkers: this.options.maxWorkers,
      effectiveWorkerLimit,
      enableDynamicScaling: this.options.enableDynamicScaling ?? false,
      systemResources: this.getSystemResources(),
    });

    // Update initial metrics
    this.updateMetrics();

    // Start dynamic scaling monitor if enabled
    this.startScalingMonitor();

    // Start initial workers
    while (this.activeWorkers.size < effectiveWorkerLimit && this.taskQueue.length > 0) {
      this.startNextTask();
    }

    // Wait for all tasks to complete
    while (this.activeWorkers.size > 0 || this.taskQueue.length > 0) {
      if (this.activeWorkers.size > 0) {
        // Wait for any worker to complete
        const completedPromises = Array.from(this.activeWorkers.entries());
        const [completedId] = await Promise.race(
          completedPromises.map(async ([id, promise]) => {
            await promise;
            return [id] as [string];
          })
        );

        // Get the completed task's group for worker affinity
        const completedTask = this.workerTaskMap.get(completedId);
        const completedGroupId = completedTask?.groupId;

        // Clean up worker tracking
        this.activeWorkers.delete(completedId);
        this.workerTaskMap.delete(completedId);

        // Update metrics after worker completion
        this.updateMetrics();

        // Start next task if available
        if (this.taskQueue.length > 0 && this.isRunning) {
          // Use worker affinity: try to assign same-group tasks to same worker
          this.startNextTask(completedGroupId);
        }
      }
    }

    // Stop dynamic scaling monitor
    this.stopScalingMonitor();

    const succeeded = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;

    logger.info(`All tasks completed: ${succeeded}/${this.results.length} succeeded`, {
      succeeded,
      failed,
      total: this.results.length,
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
    });

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
      },
      workerId
    );

    const promise = worker.execute(task).then((result) => {
      this.results.push({
        ...result,
        taskId: task.id,
      });

      if (result.success) {
        logger.success(`${task.id} completed: ${task.issue.title}`);
        logger.debug(`Task completion details`, {
          taskId: task.id,
          priority: task.metadata?.priority,
          groupId: task.groupId,
          duration: result.duration,
        });
      } else {
        logger.failure(`${task.id} failed: ${result.error}`);
        logger.debug(`Task failure details`, {
          taskId: task.id,
          priority: task.metadata?.priority,
          groupId: task.groupId,
          duration: result.duration,
        });
      }

      return result;
    });

    this.activeWorkers.set(task.id, promise);
  }

  stop(): void {
    this.isRunning = false;
    this.stopScalingMonitor();
    logger.warn('Worker pool stop requested');
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
  } {
    const groupIds = new Set(this.taskQueue.map(t => t.groupId).filter(Boolean));
    return {
      active: this.activeWorkers.size,
      queued: this.taskQueue.length,
      completed: this.results.length,
      succeeded: this.results.filter((r) => r.success).length,
      failed: this.results.filter((r) => !r.success).length,
      currentWorkerLimit: this.currentWorkerLimit,
      systemResources: this.getSystemResources(),
      taskGroups: groupIds.size,
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
