import { type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
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
export declare class WorkerPool {
    private options;
    private activeWorkers;
    private taskQueue;
    private results;
    private isRunning;
    private workerIdCounter;
    constructor(options: WorkerPoolOptions);
    executeTasks(tasks: WorkerTask[]): Promise<PoolResult[]>;
    private startNextTask;
    stop(): void;
    getStatus(): {
        active: number;
        queued: number;
        completed: number;
        succeeded: number;
        failed: number;
    };
}
export declare function createWorkerPool(options: WorkerPoolOptions): WorkerPool;
//# sourceMappingURL=pool.d.ts.map