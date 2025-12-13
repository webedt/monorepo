export { Worker, type WorkerOptions, type WorkerTask, type WorkerResult } from './worker.js';
export {
  WorkerPool,
  createWorkerPool,
  type WorkerPoolOptions,
  type PoolTask,
  type PoolResult,
  type TaskMetadata,
  type TaskPriority,
  type TaskCategory,
  type TaskComplexity,
  type SystemResources,
  type ScalingConfig,
} from './pool.js';
