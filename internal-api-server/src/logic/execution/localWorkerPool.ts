/**
 * Local Worker Pool
 *
 * Manages a pool of local AI coding workers for single-image deployment.
 * Provides the same interface as the Docker Swarm workerCoordinator.
 *
 * In local mode, workers run on localhost with sequential ports (5001, 5002, etc.)
 * The main process (services/src/index.ts) is responsible for spawning workers.
 */

import { logger } from '@webedt/shared';
import {
  WORKER_BASE_PORT,
  WORKER_POOL_SIZE,
  WORKER_STALE_BUSY_TIMEOUT_MS,
  WORKER_NO_CAPACITY_RETRY_MS,
  WORKER_NO_CAPACITY_MAX_RETRIES
} from '../config/env.js';

// ============================================================================
// Types (same as workerCoordinator.ts)
// ============================================================================

export type WorkerStatus = 'free' | 'busy' | 'unknown';

export interface WorkerTask {
  id: string;
  containerId: string;
  address: string;
  port: number;
  status: WorkerStatus;
  lastAssigned: number | null;
  lastSeen: number;
}

export interface WorkerAssignment {
  worker: WorkerTask;
  url: string;
  release: () => void;
}

export interface AcquireWorkerOptions {
  onProgress?: (attempt: number, maxRetries: number, message: string) => void;
}

// ============================================================================
// Local Worker Pool Implementation
// ============================================================================

class LocalWorkerPool {
  private workers: Map<string, WorkerTask> = new Map();
  private roundRobinIndex: number = 0;
  private initialized: boolean = false;

  constructor() {
    logger.info('LocalWorkerPool initialized', {
      component: 'LocalWorkerPool',
      poolSize: WORKER_POOL_SIZE,
      basePort: WORKER_BASE_PORT,
      staleBusyTimeoutMs: WORKER_STALE_BUSY_TIMEOUT_MS
    });
  }

  /**
   * Initialize the worker pool with local workers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Discovering local workers...', {
      component: 'LocalWorkerPool',
      poolSize: WORKER_POOL_SIZE
    });

    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      const port = WORKER_BASE_PORT + i;
      const workerId = `local-worker-${i}`;

      this.workers.set(workerId, {
        id: workerId,
        containerId: `worker-${i}`,
        address: 'localhost',
        port,
        status: 'unknown',
        lastAssigned: null,
        lastSeen: Date.now()
      });

      // Check if worker is actually running
      await this.checkWorkerHealth(workerId);
    }

    this.initialized = true;

    logger.info('Local worker pool ready', {
      component: 'LocalWorkerPool',
      totalWorkers: this.workers.size,
      freeWorkers: this.getFreeWorkerCount()
    });
  }

  /**
   * Get an available worker for a job
   */
  async acquireWorker(jobId: string, options?: AcquireWorkerOptions): Promise<WorkerAssignment | null> {
    const startTime = Date.now();
    const { onProgress } = options || {};

    // Ensure workers are initialized
    if (!this.initialized) {
      await this.initialize();
    }

    for (let attempt = 0; attempt <= WORKER_NO_CAPACITY_MAX_RETRIES; attempt++) {
      // Refresh worker status
      await this.refreshWorkerStatus();

      // Handle stale busy workers
      this.handleStaleBusyWorkers();

      // Try to find an available worker
      const worker = this.selectAvailableWorker();

      if (worker) {
        // Mark as busy
        worker.status = 'busy';
        worker.lastAssigned = Date.now();

        const url = `http://${worker.address}:${worker.port}`;

        logger.info('Worker assigned to job', {
          component: 'LocalWorkerPool',
          jobId,
          workerId: worker.id,
          workerPort: worker.port,
          workerUrl: url,
          attempt: attempt + 1,
          totalWorkers: this.workers.size,
          freeWorkers: this.getFreeWorkerCount()
        });

        // Create release function
        const release = () => this.releaseWorker(worker.id, jobId);

        return { worker, url, release };
      }

      // No worker available
      if (attempt < WORKER_NO_CAPACITY_MAX_RETRIES) {
        const message = this.workers.size === 0
          ? 'No local workers discovered'
          : `All ${this.workers.size} workers busy`;

        logger.warn('No workers available, retrying', {
          component: 'LocalWorkerPool',
          jobId,
          attempt: attempt + 1,
          maxRetries: WORKER_NO_CAPACITY_MAX_RETRIES,
          retryDelayMs: WORKER_NO_CAPACITY_RETRY_MS,
          totalWorkers: this.workers.size,
          busyWorkers: this.getBusyWorkerCount()
        });

        if (onProgress) {
          onProgress(
            attempt + 1,
            WORKER_NO_CAPACITY_MAX_RETRIES,
            `${message}, retrying (${attempt + 1}/${WORKER_NO_CAPACITY_MAX_RETRIES})...`
          );
        }

        await this.sleep(WORKER_NO_CAPACITY_RETRY_MS);
      }
    }

    const duration = Date.now() - startTime;
    logger.error('No workers available after retries', new Error('No capacity'), {
      component: 'LocalWorkerPool',
      jobId,
      totalAttempts: WORKER_NO_CAPACITY_MAX_RETRIES + 1,
      durationMs: duration,
      totalWorkers: this.workers.size,
      busyWorkers: this.getBusyWorkerCount()
    });

    return null;
  }

  /**
   * Release a worker back to the free pool
   */
  releaseWorker(workerId: string, jobId: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      const wasStatus = worker.status;
      worker.status = 'free';
      worker.lastAssigned = null;

      logger.info('Worker released', {
        component: 'LocalWorkerPool',
        jobId,
        workerId,
        previousStatus: wasStatus,
        freeWorkers: this.getFreeWorkerCount()
      });
    } else {
      logger.warn('Attempted to release unknown worker', {
        component: 'LocalWorkerPool',
        jobId,
        workerId
      });
    }
  }

  /**
   * Mark a worker as failed
   */
  markWorkerFailed(workerId: string, jobId: string, error: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      logger.warn('Worker marked as failed', {
        component: 'LocalWorkerPool',
        jobId,
        workerId,
        error
      });

      // Mark as unknown - will be checked on next request
      worker.status = 'unknown';
      worker.lastAssigned = null;
    }
  }

  /**
   * Get current pool status
   */
  getStatus(): {
    totalWorkers: number;
    freeWorkers: number;
    busyWorkers: number;
    workers: Array<{
      id: string;
      containerId: string;
      status: WorkerStatus;
      lastAssigned: number | null;
    }>;
  } {
    const workerList = Array.from(this.workers.values()).map(w => ({
      id: w.id,
      containerId: w.containerId,
      status: w.status,
      lastAssigned: w.lastAssigned
    }));

    return {
      totalWorkers: this.workers.size,
      freeWorkers: this.getFreeWorkerCount(),
      busyWorkers: this.getBusyWorkerCount(),
      workers: workerList
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check health of a specific worker
   */
  private async checkWorkerHealth(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://${worker.address}:${worker.port}/status`, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const status = await response.json() as { status: string; workerStatus?: string };
        worker.lastSeen = Date.now();

        // Handle both 'status' and 'workerStatus' field names
        const workerStatus = status.workerStatus || status.status;

        if (workerStatus === 'idle') {
          worker.status = 'free';
        } else if (workerStatus === 'busy') {
          worker.status = 'busy';
        } else {
          worker.status = 'free'; // Assume free if running
        }
      } else {
        worker.status = 'unknown';
      }
    } catch {
      // Worker unreachable
      worker.status = 'unknown';
    }
  }

  /**
   * Refresh status of all workers
   */
  private async refreshWorkerStatus(): Promise<void> {
    const checks = Array.from(this.workers.keys()).map(id => this.checkWorkerHealth(id));
    await Promise.all(checks);
  }

  /**
   * Select an available worker using round-robin
   */
  private selectAvailableWorker(): WorkerTask | null {
    const freeWorkers = Array.from(this.workers.values()).filter(w => w.status === 'free');

    if (freeWorkers.length === 0) {
      return null;
    }

    this.roundRobinIndex = (this.roundRobinIndex + 1) % freeWorkers.length;
    return freeWorkers[this.roundRobinIndex];
  }

  /**
   * Handle workers that have been busy for too long
   */
  private handleStaleBusyWorkers(): void {
    const now = Date.now();

    for (const worker of this.workers.values()) {
      if (worker.status === 'busy' && worker.lastAssigned) {
        const busyDuration = now - worker.lastAssigned;

        if (busyDuration > WORKER_STALE_BUSY_TIMEOUT_MS) {
          logger.warn('Worker busy timeout exceeded, checking health', {
            component: 'LocalWorkerPool',
            workerId: worker.id,
            busyDurationMs: busyDuration
          });

          // Check actual status
          this.checkWorkerHealth(worker.id);
        }
      }
    }
  }

  private getFreeWorkerCount(): number {
    return Array.from(this.workers.values()).filter(w => w.status === 'free').length;
  }

  private getBusyWorkerCount(): number {
    return Array.from(this.workers.values()).filter(w => w.status === 'busy').length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton
export const localWorkerPool = new LocalWorkerPool();
