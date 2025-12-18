/**
 * Worker Coordinator Service
 *
 * Manages routing of jobs to AI coding workers in a Docker Swarm environment.
 * Replaces DNS Round Robin (DNSRR) with direct routing to specific container tasks.
 *
 * Key features:
 * - Discovers running tasks via Docker API
 * - Maintains in-memory availability map (free/busy/unknown)
 * - Round-robin assignment to available workers
 * - Singleflight pattern for task list refreshes
 * - Stale busy timeout handling
 * - Auto-recovery when Swarm reschedules tasks
 */

import { logger } from '@webedt/shared';
import {
  WORKER_SWARM_SERVICE_NAME,
  WORKER_COORDINATOR_REFRESH_INTERVAL_MS,
  WORKER_STALE_BUSY_TIMEOUT_MS,
  WORKER_NO_CAPACITY_RETRY_MS,
  WORKER_NO_CAPACITY_MAX_RETRIES,
  DOCKER_SOCKET_PATH,
  AI_WORKER_PORT
} from '../config/env.js';

// ============================================================================
// Types
// ============================================================================

export type WorkerStatus = 'free' | 'busy' | 'unknown';

export interface WorkerTask {
  id: string;           // Docker task ID
  containerId: string;  // Container ID (short form)
  address: string;      // IP address on overlay network
  port: number;         // Service port
  status: WorkerStatus;
  lastAssigned: number | null;  // Timestamp when last assigned a job
  lastSeen: number;     // Timestamp when last seen in Docker API
}

export interface WorkerAssignment {
  worker: WorkerTask;
  url: string;          // Full URL to the worker (http://address:port)
  release: () => void;  // Call when job completes to mark worker free
}

export interface AcquireWorkerOptions {
  onProgress?: (attempt: number, maxRetries: number, message: string) => void;
}

interface DockerTask {
  ID: string;
  Status: {
    State: string;
    ContainerStatus?: {
      ContainerID: string;
    };
  };
  NetworksAttachments?: Array<{
    Network: {
      Spec: {
        Name: string;
      };
    };
    Addresses: string[];
  }>;
  DesiredState: string;
  Slot?: number;
}

// ============================================================================
// Worker Coordinator Implementation
// ============================================================================

class WorkerCoordinator {
  private workers: Map<string, WorkerTask> = new Map();
  private roundRobinIndex: number = 0;
  private lastRefresh: number = 0;
  private refreshPromise: Promise<void> | null = null;
  private refreshLock: boolean = false;

  constructor() {
    logger.info('WorkerCoordinator initialized', {
      component: 'WorkerCoordinator',
      serviceName: WORKER_SWARM_SERVICE_NAME,
      refreshIntervalMs: WORKER_COORDINATOR_REFRESH_INTERVAL_MS,
      staleBusyTimeoutMs: WORKER_STALE_BUSY_TIMEOUT_MS
    });
  }

  /**
   * Get an available worker for a job
   * Returns null if no workers are available after retries
   */
  async acquireWorker(jobId: string, options?: AcquireWorkerOptions): Promise<WorkerAssignment | null> {
    const startTime = Date.now();
    const { onProgress } = options || {};

    for (let attempt = 0; attempt <= WORKER_NO_CAPACITY_MAX_RETRIES; attempt++) {
      // Ensure worker list is fresh
      try {
        await this.ensureFreshWorkerList();
      } catch (refreshError) {
        logger.error('Failed to refresh worker list', refreshError, {
          component: 'WorkerCoordinator',
          jobId,
          attempt: attempt + 1
        });

        // Notify about the error
        if (onProgress) {
          onProgress(attempt + 1, WORKER_NO_CAPACITY_MAX_RETRIES,
            `Failed to query Docker for workers: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }

        // Continue to retry logic below
      }

      // Check for stale busy workers
      this.handleStaleBusyWorkers();

      // Try to find an available worker
      const worker = this.selectAvailableWorker();

      if (worker) {
        // Mark as busy atomically
        worker.status = 'busy';
        worker.lastAssigned = Date.now();

        const url = `http://${worker.address}:${worker.port}`;

        logger.info('Worker assigned to job', {
          component: 'WorkerCoordinator',
          jobId,
          workerId: worker.id,
          containerId: worker.containerId,
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
          ? 'No workers discovered in Docker Swarm'
          : `All ${this.workers.size} workers busy`;

        logger.warn('No workers available, retrying', {
          component: 'WorkerCoordinator',
          jobId,
          attempt: attempt + 1,
          maxRetries: WORKER_NO_CAPACITY_MAX_RETRIES,
          retryDelayMs: WORKER_NO_CAPACITY_RETRY_MS,
          totalWorkers: this.workers.size,
          busyWorkers: this.getBusyWorkerCount()
        });

        // Notify progress
        if (onProgress) {
          onProgress(
            attempt + 1,
            WORKER_NO_CAPACITY_MAX_RETRIES,
            `${message}, retrying (${attempt + 1}/${WORKER_NO_CAPACITY_MAX_RETRIES})...`
          );
        }

        await this.sleep(WORKER_NO_CAPACITY_RETRY_MS);

        // Force refresh on retry
        this.lastRefresh = 0;
      }
    }

    const duration = Date.now() - startTime;
    logger.error('No workers available after retries', new Error('No capacity'), {
      component: 'WorkerCoordinator',
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
        component: 'WorkerCoordinator',
        jobId,
        workerId,
        containerId: worker.containerId,
        previousStatus: wasStatus,
        freeWorkers: this.getFreeWorkerCount()
      });
    } else {
      // Worker may have been removed during task reschedule
      logger.warn('Attempted to release unknown worker', {
        component: 'WorkerCoordinator',
        jobId,
        workerId
      });
    }
  }

  /**
   * Mark a worker as failed/unavailable
   * Used when a request to a worker fails
   */
  markWorkerFailed(workerId: string, jobId: string, error: string): void {
    const worker = this.workers.get(workerId);

    if (worker) {
      logger.warn('Worker marked as failed, removing from pool', {
        component: 'WorkerCoordinator',
        jobId,
        workerId,
        containerId: worker.containerId,
        error
      });

      // Remove failed worker - it will be re-added on next refresh if healthy
      this.workers.delete(workerId);

      // Force refresh to discover new tasks
      this.lastRefresh = 0;
    }
  }

  /**
   * Get current worker pool status (for debugging/monitoring)
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
   * Ensure worker list is fresh using singleflight pattern
   */
  private async ensureFreshWorkerList(): Promise<void> {
    const now = Date.now();
    const needsRefresh = now - this.lastRefresh > WORKER_COORDINATOR_REFRESH_INTERVAL_MS;

    if (!needsRefresh) {
      return;
    }

    // Singleflight: only one refresh at a time
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    if (this.refreshLock) {
      // Another refresh is starting, wait briefly
      await this.sleep(100);
      return this.ensureFreshWorkerList();
    }

    this.refreshLock = true;
    this.refreshPromise = this.refreshWorkerList();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
      this.refreshLock = false;
    }
  }

  /**
   * Refresh worker list from Docker API
   */
  private async refreshWorkerList(): Promise<void> {
    const startTime = Date.now();

    try {
      const tasks = await this.fetchDockerTasks();
      const previousWorkerIds = new Set(this.workers.keys());
      const currentWorkerIds = new Set<string>();

      for (const task of tasks) {
        // Only consider running tasks
        if (task.Status.State !== 'running' || task.DesiredState !== 'running') {
          continue;
        }

        const containerId = task.Status.ContainerStatus?.ContainerID?.substring(0, 12) || task.ID.substring(0, 12);

        // Get IP address from network attachments
        const address = this.extractTaskAddress(task);
        if (!address) {
          logger.debug('Task has no network address, skipping', {
            component: 'WorkerCoordinator',
            taskId: task.ID
          });
          continue;
        }

        currentWorkerIds.add(task.ID);

        // Update or add worker
        const existingWorker = this.workers.get(task.ID);
        if (existingWorker) {
          // Update last seen, keep status
          existingWorker.lastSeen = Date.now();
          existingWorker.address = address;
        } else {
          // New worker discovered
          this.workers.set(task.ID, {
            id: task.ID,
            containerId,
            address,
            port: AI_WORKER_PORT,
            status: 'free',
            lastAssigned: null,
            lastSeen: Date.now()
          });

          logger.info('New worker discovered', {
            component: 'WorkerCoordinator',
            taskId: task.ID,
            containerId,
            address,
            slot: task.Slot
          });
        }
      }

      // Remove workers that are no longer running
      for (const workerId of previousWorkerIds) {
        if (!currentWorkerIds.has(workerId)) {
          const worker = this.workers.get(workerId);
          logger.info('Worker removed (no longer running)', {
            component: 'WorkerCoordinator',
            workerId,
            containerId: worker?.containerId,
            wasStatus: worker?.status
          });
          this.workers.delete(workerId);
        }
      }

      this.lastRefresh = Date.now();
      const duration = Date.now() - startTime;

      logger.debug('Worker list refreshed', {
        component: 'WorkerCoordinator',
        durationMs: duration,
        totalWorkers: this.workers.size,
        freeWorkers: this.getFreeWorkerCount(),
        busyWorkers: this.getBusyWorkerCount()
      });

    } catch (error) {
      logger.error('Failed to refresh worker list', error, {
        component: 'WorkerCoordinator'
      });
      // Don't update lastRefresh on error - will retry next call
    }
  }

  /**
   * Fetch tasks from Docker API via Unix socket
   */
  private async fetchDockerTasks(): Promise<DockerTask[]> {
    // Use dynamic import for http to work with Unix sockets
    const http = await import('http');

    return new Promise((resolve, reject) => {
      const options = {
        socketPath: DOCKER_SOCKET_PATH,
        path: `/tasks?filters=${encodeURIComponent(JSON.stringify({
          service: [WORKER_SWARM_SERVICE_NAME],
          'desired-state': ['running']
        }))}`,
        method: 'GET'
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`Docker API error: ${res.statusCode} - ${data}`));
              return;
            }
            const tasks = JSON.parse(data) as DockerTask[];
            resolve(tasks);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Docker API request timeout'));
      });
      req.end();
    });
  }

  /**
   * Extract IP address from task network attachments
   */
  private extractTaskAddress(task: DockerTask): string | null {
    if (!task.NetworksAttachments) {
      return null;
    }

    // Look for the overlay network (dokploy-network or similar)
    for (const attachment of task.NetworksAttachments) {
      const networkName = attachment.Network?.Spec?.Name || '';

      // Skip ingress network
      if (networkName === 'ingress') {
        continue;
      }

      // Get first address (format: "10.0.1.23/24")
      if (attachment.Addresses && attachment.Addresses.length > 0) {
        const address = attachment.Addresses[0].split('/')[0];
        return address;
      }
    }

    return null;
  }

  /**
   * Select an available worker using round-robin
   */
  private selectAvailableWorker(): WorkerTask | null {
    const freeWorkers = Array.from(this.workers.values()).filter(w => w.status === 'free');

    if (freeWorkers.length === 0) {
      return null;
    }

    // Round-robin selection
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
            component: 'WorkerCoordinator',
            workerId: worker.id,
            containerId: worker.containerId,
            busyDurationMs: busyDuration,
            timeoutMs: WORKER_STALE_BUSY_TIMEOUT_MS
          });

          // Check if worker is still in Docker tasks
          // If not, remove it; if yes, reset to free (job may have completed without release)
          this.verifyWorkerHealth(worker);
        }
      }
    }
  }

  /**
   * Verify worker health via Docker API or health endpoint
   */
  private async verifyWorkerHealth(worker: WorkerTask): Promise<void> {
    try {
      // Try to hit the worker's status endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://${worker.address}:${worker.port}/status`, {
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const status = await response.json() as { workerStatus: string };

        if (status.workerStatus === 'idle') {
          // Worker is actually free, update our state
          logger.info('Stale busy worker is actually idle, resetting', {
            component: 'WorkerCoordinator',
            workerId: worker.id,
            containerId: worker.containerId
          });
          worker.status = 'free';
          worker.lastAssigned = null;
        } else {
          // Worker is still busy, extend timeout
          logger.info('Stale busy worker still processing, extending timeout', {
            component: 'WorkerCoordinator',
            workerId: worker.id,
            containerId: worker.containerId,
            reportedStatus: status.workerStatus
          });
          worker.lastAssigned = Date.now();
        }
      } else {
        // Worker unhealthy, remove from pool
        logger.warn('Stale worker health check failed, removing', {
          component: 'WorkerCoordinator',
          workerId: worker.id,
          containerId: worker.containerId,
          statusCode: response.status
        });
        this.workers.delete(worker.id);
      }
    } catch (error) {
      // Worker unreachable, remove from pool
      logger.warn('Stale worker unreachable, removing', {
        component: 'WorkerCoordinator',
        workerId: worker.id,
        containerId: worker.containerId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.workers.delete(worker.id);
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

// Import local worker pool for single-image mode
import { localWorkerPool } from './localWorkerPool.js';
import { WORKER_POOL_MODE } from '../config/env.js';

// Docker Swarm coordinator singleton
const dockerSwarmCoordinator = new WorkerCoordinator();

/**
 * Unified worker coordinator interface
 * Routes to either Docker Swarm or Local worker pool based on WORKER_POOL_MODE
 */
interface UnifiedWorkerCoordinator {
  acquireWorker(jobId: string, options?: AcquireWorkerOptions): Promise<WorkerAssignment | null>;
  releaseWorker(workerId: string, jobId: string): void;
  markWorkerFailed(workerId: string, jobId: string, error: string): void;
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
  };
}

// Create unified coordinator that delegates based on mode
const createUnifiedCoordinator = (): UnifiedWorkerCoordinator => {
  const isLocalMode = WORKER_POOL_MODE === 'local';

  logger.info('Worker coordinator mode', {
    component: 'WorkerCoordinator',
    mode: WORKER_POOL_MODE,
    isLocalMode
  });

  if (isLocalMode) {
    return {
      acquireWorker: (jobId, options) => localWorkerPool.acquireWorker(jobId, options),
      releaseWorker: (workerId, jobId) => localWorkerPool.releaseWorker(workerId, jobId),
      markWorkerFailed: (workerId, jobId, error) => localWorkerPool.markWorkerFailed(workerId, jobId, error),
      getStatus: () => localWorkerPool.getStatus()
    };
  }

  return {
    acquireWorker: (jobId, options) => dockerSwarmCoordinator.acquireWorker(jobId, options),
    releaseWorker: (workerId, jobId) => dockerSwarmCoordinator.releaseWorker(workerId, jobId),
    markWorkerFailed: (workerId, jobId, error) => dockerSwarmCoordinator.markWorkerFailed(workerId, jobId, error),
    getStatus: () => dockerSwarmCoordinator.getStatus()
  };
};

// Export singleton instance
export const workerCoordinator = createUnifiedCoordinator();
