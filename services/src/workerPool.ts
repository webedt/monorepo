/**
 * Worker Pool Manager
 *
 * Manages a pool of AI coding worker processes within the same container.
 * Replaces Docker Swarm worker coordination for single-image deployment.
 *
 * Features:
 * - Spawns N worker processes (configurable)
 * - Round-robin assignment to available workers
 * - Automatic worker restart on crash
 * - Health monitoring and stale job detection
 */

import { fork, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@webedt/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

// Worker pool configuration (from environment or defaults)
const WORKER_POOL_SIZE = parseInt(process.env.WORKER_POOL_SIZE || '2', 10);
const WORKER_BASE_PORT = parseInt(process.env.WORKER_BASE_PORT || '5001', 10);
const WORKER_STALE_TIMEOUT_MS = parseInt(process.env.WORKER_STALE_TIMEOUT_MS || '600000', 10); // 10 min
const WORKER_RESTART_DELAY_MS = parseInt(process.env.WORKER_RESTART_DELAY_MS || '1000', 10);
const WORKER_NO_CAPACITY_RETRY_MS = parseInt(process.env.WORKER_NO_CAPACITY_RETRY_MS || '1000', 10);
const WORKER_NO_CAPACITY_MAX_RETRIES = parseInt(process.env.WORKER_NO_CAPACITY_MAX_RETRIES || '10', 10);

// ============================================================================
// Types
// ============================================================================

export type WorkerStatus = 'starting' | 'idle' | 'busy' | 'stopping' | 'crashed';

export interface WorkerInfo {
  id: number;
  port: number;
  process: ChildProcess | null;
  status: WorkerStatus;
  lastAssigned: number | null;
  lastHealthCheck: number;
  restartCount: number;
  currentJobId: string | null;
}

export interface WorkerAssignment {
  worker: WorkerInfo;
  url: string;
  release: () => void;
}

export interface AcquireWorkerOptions {
  onProgress?: (attempt: number, maxRetries: number, message: string) => void;
}

// ============================================================================
// Worker Pool Implementation
// ============================================================================

class WorkerPool extends EventEmitter {
  private workers: Map<number, WorkerInfo> = new Map();
  private roundRobinIndex: number = 0;
  private isShuttingDown: boolean = false;
  private workerScriptPath: string;

  constructor() {
    super();

    // Path to the compiled worker entry point
    // In production, this will be in the same dist folder
    this.workerScriptPath = path.join(__dirname, 'worker', 'server.js');

    logger.info('WorkerPool initialized', {
      component: 'WorkerPool',
      poolSize: WORKER_POOL_SIZE,
      basePort: WORKER_BASE_PORT,
      staleTimeoutMs: WORKER_STALE_TIMEOUT_MS
    });
  }

  /**
   * Start the worker pool
   */
  async start(): Promise<void> {
    logger.info('Starting worker pool...', {
      component: 'WorkerPool',
      poolSize: WORKER_POOL_SIZE
    });

    for (let i = 0; i < WORKER_POOL_SIZE; i++) {
      await this.spawnWorker(i);
    }

    // Start health monitoring
    this.startHealthMonitoring();

    logger.info('Worker pool started', {
      component: 'WorkerPool',
      activeWorkers: this.getIdleWorkerCount()
    });
  }

  /**
   * Stop all workers gracefully
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('Stopping worker pool...', { component: 'WorkerPool' });

    const stopPromises = Array.from(this.workers.values()).map(worker => {
      return this.stopWorker(worker.id);
    });

    await Promise.all(stopPromises);
    this.workers.clear();

    logger.info('Worker pool stopped', { component: 'WorkerPool' });
  }

  /**
   * Spawn a worker process
   */
  private async spawnWorker(id: number): Promise<void> {
    const port = WORKER_BASE_PORT + id;

    const workerInfo: WorkerInfo = {
      id,
      port,
      process: null,
      status: 'starting',
      lastAssigned: null,
      lastHealthCheck: Date.now(),
      restartCount: 0,
      currentJobId: null
    };

    this.workers.set(id, workerInfo);

    try {
      // Spawn the worker process
      const childProcess = fork(this.workerScriptPath, [], {
        env: {
          ...process.env,
          PORT: String(port),
          WORKER_ID: String(id),
          // Internal API URL points to localhost since we're in the same container
          INTERNAL_API_URL: `http://localhost:${process.env.API_PORT || '3001'}`,
          WORKSPACE_DIR: process.env.WORKSPACE_DIR || '/workspace',
          NODE_ENV: process.env.NODE_ENV || 'production'
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      });

      workerInfo.process = childProcess;

      // Handle worker stdout
      childProcess.stdout?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
          if (line) {
            console.log(`[Worker ${id}] ${line}`);
          }
        });
      });

      // Handle worker stderr
      childProcess.stderr?.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
          if (line) {
            console.error(`[Worker ${id}] ${line}`);
          }
        });
      });

      // Handle worker exit
      childProcess.on('exit', (code, signal) => {
        logger.info('Worker process exited', {
          component: 'WorkerPool',
          workerId: id,
          exitCode: code,
          signal
        });

        workerInfo.process = null;
        workerInfo.status = 'crashed';
        workerInfo.currentJobId = null;

        // Auto-restart if not shutting down
        if (!this.isShuttingDown) {
          setTimeout(() => {
            workerInfo.restartCount++;
            logger.info('Restarting worker...', {
              component: 'WorkerPool',
              workerId: id,
              restartCount: workerInfo.restartCount
            });
            this.spawnWorker(id);
          }, WORKER_RESTART_DELAY_MS);
        }
      });

      // Handle IPC messages from worker
      childProcess.on('message', (message: any) => {
        if (message.type === 'ready') {
          workerInfo.status = 'idle';
          workerInfo.lastHealthCheck = Date.now();
          logger.info('Worker ready', {
            component: 'WorkerPool',
            workerId: id,
            port
          });
        } else if (message.type === 'busy') {
          workerInfo.status = 'busy';
          workerInfo.lastAssigned = Date.now();
        } else if (message.type === 'idle') {
          workerInfo.status = 'idle';
          workerInfo.currentJobId = null;
        }
      });

      // Wait for worker to be ready
      await this.waitForWorkerReady(workerInfo);

    } catch (error) {
      logger.error('Failed to spawn worker', error, {
        component: 'WorkerPool',
        workerId: id
      });
      workerInfo.status = 'crashed';
    }
  }

  /**
   * Wait for a worker to report ready status
   */
  private async waitForWorkerReady(worker: WorkerInfo, timeout: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (worker.status === 'starting' && Date.now() - startTime < timeout) {
      await this.sleep(100);

      // Also try HTTP health check
      try {
        const response = await fetch(`http://localhost:${worker.port}/health`, {
          signal: AbortSignal.timeout(2000)
        });
        if (response.ok) {
          worker.status = 'idle';
          worker.lastHealthCheck = Date.now();
          return;
        }
      } catch {
        // Worker not ready yet
      }
    }

    if (worker.status === 'starting') {
      throw new Error(`Worker ${worker.id} failed to start within timeout`);
    }
  }

  /**
   * Stop a specific worker
   */
  private async stopWorker(id: number): Promise<void> {
    const worker = this.workers.get(id);
    if (!worker || !worker.process) return;

    worker.status = 'stopping';

    return new Promise((resolve) => {
      if (!worker.process) {
        resolve();
        return;
      }

      const proc = worker.process;
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        proc.kill('SIGKILL');
        resolve();
      }, 5000);

      proc.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Send graceful shutdown signal
      proc.kill('SIGTERM');
    });
  }

  /**
   * Acquire an available worker for a job
   */
  async acquireWorker(jobId: string, options?: AcquireWorkerOptions): Promise<WorkerAssignment | null> {
    const startTime = Date.now();
    const { onProgress } = options || {};

    for (let attempt = 0; attempt <= WORKER_NO_CAPACITY_MAX_RETRIES; attempt++) {
      // Handle stale busy workers
      this.handleStaleBusyWorkers();

      // Try to find an available worker
      const worker = this.selectAvailableWorker();

      if (worker) {
        // Mark as busy
        worker.status = 'busy';
        worker.lastAssigned = Date.now();
        worker.currentJobId = jobId;

        const url = `http://localhost:${worker.port}`;

        logger.info('Worker assigned to job', {
          component: 'WorkerPool',
          jobId,
          workerId: worker.id,
          workerPort: worker.port,
          attempt: attempt + 1,
          totalWorkers: this.workers.size,
          idleWorkers: this.getIdleWorkerCount()
        });

        // Create release function
        const release = () => this.releaseWorker(worker.id, jobId);

        return { worker, url, release };
      }

      // No worker available
      if (attempt < WORKER_NO_CAPACITY_MAX_RETRIES) {
        const message = this.workers.size === 0
          ? 'No workers in pool'
          : `All ${this.workers.size} workers busy`;

        logger.warn('No workers available, retrying', {
          component: 'WorkerPool',
          jobId,
          attempt: attempt + 1,
          maxRetries: WORKER_NO_CAPACITY_MAX_RETRIES
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
      component: 'WorkerPool',
      jobId,
      totalAttempts: WORKER_NO_CAPACITY_MAX_RETRIES + 1,
      durationMs: duration
    });

    return null;
  }

  /**
   * Release a worker back to idle state
   */
  releaseWorker(workerId: number, jobId: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      const wasStatus = worker.status;
      worker.status = 'idle';
      worker.lastAssigned = null;
      worker.currentJobId = null;

      logger.info('Worker released', {
        component: 'WorkerPool',
        jobId,
        workerId,
        previousStatus: wasStatus,
        idleWorkers: this.getIdleWorkerCount()
      });
    }
  }

  /**
   * Mark a worker as failed (will trigger restart)
   */
  markWorkerFailed(workerId: number, jobId: string, error: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      logger.warn('Worker marked as failed', {
        component: 'WorkerPool',
        jobId,
        workerId,
        error
      });

      // Kill the process (will auto-restart)
      if (worker.process) {
        worker.process.kill('SIGTERM');
      }
    }
  }

  /**
   * Get pool status for monitoring
   */
  getStatus(): {
    totalWorkers: number;
    idleWorkers: number;
    busyWorkers: number;
    workers: Array<{
      id: number;
      port: number;
      status: WorkerStatus;
      currentJobId: string | null;
      restartCount: number;
    }>;
  } {
    const workerList = Array.from(this.workers.values()).map(w => ({
      id: w.id,
      port: w.port,
      status: w.status,
      currentJobId: w.currentJobId,
      restartCount: w.restartCount
    }));

    return {
      totalWorkers: this.workers.size,
      idleWorkers: this.getIdleWorkerCount(),
      busyWorkers: this.getBusyWorkerCount(),
      workers: workerList
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private selectAvailableWorker(): WorkerInfo | null {
    const idleWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'idle');

    if (idleWorkers.length === 0) {
      return null;
    }

    // Round-robin selection
    this.roundRobinIndex = (this.roundRobinIndex + 1) % idleWorkers.length;
    return idleWorkers[this.roundRobinIndex];
  }

  private handleStaleBusyWorkers(): void {
    const now = Date.now();

    for (const worker of this.workers.values()) {
      if (worker.status === 'busy' && worker.lastAssigned) {
        const busyDuration = now - worker.lastAssigned;

        if (busyDuration > WORKER_STALE_TIMEOUT_MS) {
          logger.warn('Worker busy timeout exceeded', {
            component: 'WorkerPool',
            workerId: worker.id,
            busyDurationMs: busyDuration,
            jobId: worker.currentJobId
          });

          // Check worker health via HTTP
          this.checkWorkerHealth(worker);
        }
      }
    }
  }

  private async checkWorkerHealth(worker: WorkerInfo): Promise<void> {
    try {
      const response = await fetch(`http://localhost:${worker.port}/status`, {
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const status = await response.json() as { workerStatus: string };

        if (status.workerStatus === 'idle') {
          logger.info('Stale busy worker is actually idle, resetting', {
            component: 'WorkerPool',
            workerId: worker.id
          });
          worker.status = 'idle';
          worker.lastAssigned = null;
          worker.currentJobId = null;
        } else {
          // Still busy, extend timeout
          worker.lastAssigned = Date.now();
        }
      } else {
        // Unhealthy, restart
        this.markWorkerFailed(worker.id, worker.currentJobId || 'unknown', 'Health check failed');
      }
    } catch {
      // Unreachable, restart
      this.markWorkerFailed(worker.id, worker.currentJobId || 'unknown', 'Worker unreachable');
    }
  }

  private startHealthMonitoring(): void {
    setInterval(() => {
      for (const worker of this.workers.values()) {
        if (worker.status === 'idle' || worker.status === 'busy') {
          this.checkWorkerHealth(worker).catch(() => {});
        }
      }
    }, 60000); // Check every minute
  }

  private getIdleWorkerCount(): number {
    return Array.from(this.workers.values()).filter(w => w.status === 'idle').length;
  }

  private getBusyWorkerCount(): number {
    return Array.from(this.workers.values()).filter(w => w.status === 'busy').length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const workerPool = new WorkerPool();
