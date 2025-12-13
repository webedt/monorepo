import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { logger, generateCorrelationId, setCorrelationId, clearCorrelationId } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';

export interface WorkerPoolOptions extends Omit<WorkerOptions, 'workDir'> {
  maxWorkers: number;
  workDir: string;
}

export interface PoolTask extends WorkerTask {
  id: string;
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

  constructor(options: WorkerPoolOptions) {
    this.options = options;
    this.repository = this.extractRepoName(options.repoUrl);
    logger.info(`Worker pool initialized with ${options.maxWorkers} max workers`, {
      maxWorkers: options.maxWorkers,
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

  async executeTasks(tasks: WorkerTask[]): Promise<PoolResult[]> {
    this.isRunning = true;
    this.results = [];
    this.taskQueue = tasks.map((task, index) => ({
      ...task,
      id: `task-${index + 1}`,
    }));

    logger.info(`Executing ${tasks.length} tasks with up to ${this.options.maxWorkers} workers`, {
      taskCount: tasks.length,
      maxWorkers: this.options.maxWorkers,
    });

    // Update initial metrics
    this.updateMetrics();

    // Start initial workers
    while (this.activeWorkers.size < this.options.maxWorkers && this.taskQueue.length > 0) {
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

        // Remove completed worker
        this.activeWorkers.delete(completedId);

        // Update metrics after worker completion
        this.updateMetrics();

        // Start next task if available
        if (this.taskQueue.length > 0 && this.isRunning) {
          this.startNextTask();
        }
      }
    }

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

  private startNextTask(): void {
    const task = this.taskQueue.shift();
    if (!task) return;

    const workerId = `worker-${++this.workerIdCounter}`;
    logger.info(`Starting ${task.id} with ${workerId}: ${task.issue.title}`, {
      taskId: task.id,
      workerId,
      issueNumber: task.issue.number,
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
        timeoutMinutes: this.options.timeoutMinutes,
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
      } else {
        logger.failure(`${task.id} failed: ${result.error}`);
      }

      return result;
    });

    this.activeWorkers.set(task.id, promise);
  }

  stop(): void {
    this.isRunning = false;
    logger.warn('Worker pool stop requested');
  }

  getStatus(): {
    active: number;
    queued: number;
    completed: number;
    succeeded: number;
    failed: number;
  } {
    return {
      active: this.activeWorkers.size,
      queued: this.taskQueue.length,
      completed: this.results.length,
      succeeded: this.results.filter((r) => r.success).length,
      failed: this.results.filter((r) => !r.success).length,
    };
  }
}

export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  return new WorkerPool(options);
}
