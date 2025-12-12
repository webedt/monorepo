import { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
import { logger } from '../utils/logger.js';

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

  constructor(options: WorkerPoolOptions) {
    this.options = options;
    logger.info(`Worker pool initialized with ${options.maxWorkers} max workers`);
  }

  async executeTasks(tasks: WorkerTask[]): Promise<PoolResult[]> {
    this.isRunning = true;
    this.results = [];
    this.taskQueue = tasks.map((task, index) => ({
      ...task,
      id: `task-${index + 1}`,
    }));

    logger.info(`Executing ${tasks.length} tasks with up to ${this.options.maxWorkers} workers`);

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

        // Start next task if available
        if (this.taskQueue.length > 0 && this.isRunning) {
          this.startNextTask();
        }
      }
    }

    logger.info(`All tasks completed: ${this.results.filter(r => r.success).length}/${this.results.length} succeeded`);

    return this.results;
  }

  private startNextTask(): void {
    const task = this.taskQueue.shift();
    if (!task) return;

    const workerId = `worker-${++this.workerIdCounter}`;
    logger.info(`Starting ${task.id} with ${workerId}: ${task.issue.title}`);

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
