import { Worker } from './worker.js';
import { logger } from '../utils/logger.js';
export class WorkerPool {
    options;
    activeWorkers = new Map();
    taskQueue = [];
    results = [];
    isRunning = false;
    workerIdCounter = 0;
    constructor(options) {
        this.options = options;
        logger.info(`Worker pool initialized with ${options.maxWorkers} max workers`);
    }
    async executeTasks(tasks) {
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
                const [completedId] = await Promise.race(completedPromises.map(async ([id, promise]) => {
                    await promise;
                    return [id];
                }));
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
    startNextTask() {
        const task = this.taskQueue.shift();
        if (!task)
            return;
        const workerId = `worker-${++this.workerIdCounter}`;
        logger.info(`Starting ${task.id} with ${workerId}: ${task.issue.title}`);
        const worker = new Worker({
            workDir: this.options.workDir,
            repoUrl: this.options.repoUrl,
            baseBranch: this.options.baseBranch,
            githubToken: this.options.githubToken,
            claudeAuth: this.options.claudeAuth,
            timeoutMinutes: this.options.timeoutMinutes,
        }, workerId);
        const promise = worker.execute(task).then((result) => {
            this.results.push({
                ...result,
                taskId: task.id,
            });
            if (result.success) {
                logger.success(`${task.id} completed: ${task.issue.title}`);
            }
            else {
                logger.failure(`${task.id} failed: ${result.error}`);
            }
            return result;
        });
        this.activeWorkers.set(task.id, promise);
    }
    stop() {
        this.isRunning = false;
        logger.warn('Worker pool stop requested');
    }
    getStatus() {
        return {
            active: this.activeWorkers.size,
            queued: this.taskQueue.length,
            completed: this.results.length,
            succeeded: this.results.filter((r) => r.success).length,
            failed: this.results.filter((r) => !r.success).length,
        };
    }
}
export function createWorkerPool(options) {
    return new WorkerPool(options);
}
//# sourceMappingURL=pool.js.map