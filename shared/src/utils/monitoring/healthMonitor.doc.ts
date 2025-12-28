/**
 * Health Monitor Documentation Interface
 *
 * This file contains the fully-documented interface for the Health Monitor service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AHealthMonitor for the abstract base class
 * @see HealthMonitor for the concrete implementation
 */

import type { CircuitBreakerStats } from '../resilience/circuitBreaker.doc.js';

/**
 * Result of a single health check.
 */
export interface HealthCheckResult {
  /** Name of the health check */
  name: string;
  /** Health status of the check */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Optional message describing the status */
  message?: string;
  /** Latency of the check in milliseconds */
  latencyMs?: number;
  /** When the check was last run */
  lastCheck?: Date;
  /** Additional details about the check */
  details?: Record<string, unknown>;
}

/**
 * Aggregated health status for the service.
 */
export interface ServiceHealth {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Individual check results */
  checks: HealthCheckResult[];
  /** Circuit breaker states */
  circuitBreakers: Record<string, CircuitBreakerStats>;
  /** Summary metrics */
  metrics: {
    uptime: number;
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
  };
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Detailed health status including system information.
 */
export interface DetailedHealthStatus {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Service version */
  version: string;
  /** Service name */
  service: string;
  /** Container ID */
  containerId: string;
  /** Build information */
  build: {
    commitSha: string;
    timestamp: string;
    imageTag: string;
  };
  /** Individual check results */
  checks: HealthCheckResult[];
  /** Service-specific checks */
  services: {
    database: HealthCheckResult;
    storage?: HealthCheckResult;
  };
  /** Circuit breaker states */
  circuitBreakers: Record<string, CircuitBreakerStats>;
  /** Summary metrics */
  metrics: {
    uptime: number;
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
    healthStatus: string;
  };
  /** Cleanup job status */
  cleanupStatus: {
    lastRun: Date | null;
    lastSuccess: boolean;
    totalCleaned: number;
    intervalMinutes: number;
  };
  /** Memory usage */
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;
  };
  /** Scale and capacity information */
  scale?: {
    currentCapacity: string;
    shortTermTarget: string;
    architecture: string;
  };
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Health check function signature.
 */
export type HealthCheckFunction = () => Promise<HealthCheckResult>;

/**
 * Interface for Health Monitor with full documentation.
 *
 * Provides comprehensive health monitoring with database health checks,
 * external service status, circuit breaker states, and metrics aggregation.
 *
 * ## Features
 *
 * - **Pluggable checks** - Register custom health check functions
 * - **Periodic monitoring** - Automatic background health checks
 * - **Aggregated status** - Combined health status from all checks
 * - **Detailed reporting** - Full system status for /health endpoint
 *
 * ## Usage
 *
 * ```typescript
 * import { healthMonitor, createDatabaseHealthCheck } from '@webedt/shared';
 *
 * // Register a database health check
 * healthMonitor.registerCheck('database', createDatabaseHealthCheck(async () => {
 *   const start = Date.now();
 *   await db.execute('SELECT 1');
 *   return { healthy: true, latencyMs: Date.now() - start };
 * }));
 *
 * // Start periodic checks
 * healthMonitor.startPeriodicChecks(30000);
 *
 * // Get health status
 * const status = await healthMonitor.getHealthStatus();
 * console.log(`System is ${status.status}`);
 * ```
 */
export interface IHealthMonitorDocumentation {
  /**
   * Register a health check function.
   *
   * @param name - Unique name for the health check
   * @param checkFn - Async function that returns check result
   *
   * @example
   * ```typescript
   * healthMonitor.registerCheck('redis', async () => ({
   *   name: 'redis',
   *   status: await redis.ping() ? 'healthy' : 'unhealthy',
   * }));
   * ```
   */
  registerCheck(name: string, checkFn: HealthCheckFunction): void;

  /**
   * Remove a health check.
   *
   * @param name - Name of the check to remove
   */
  unregisterCheck(name: string): void;

  /**
   * Run a single health check.
   *
   * @param name - Name of the check to run
   * @returns Health check result
   */
  runCheck(name: string): Promise<HealthCheckResult>;

  /**
   * Run all health checks.
   *
   * @returns Array of all check results
   */
  runAllChecks(): Promise<HealthCheckResult[]>;

  /**
   * Get aggregated health status.
   *
   * Runs all checks and returns combined status.
   *
   * @returns Aggregated health status
   *
   * @example
   * ```typescript
   * const health = await healthMonitor.getHealthStatus();
   * if (health.status !== 'healthy') {
   *   notifyOps('System degraded', health);
   * }
   * ```
   */
  getHealthStatus(): Promise<ServiceHealth>;

  /**
   * Get detailed health status (for /health endpoint).
   *
   * @param config - Build and service configuration
   * @returns Detailed health status including system info
   *
   * @example
   * ```typescript
   * app.get('/health', async (req, res) => {
   *   const status = await healthMonitor.getDetailedHealthStatus({
   *     version: '1.2.3',
   *     service: 'api-server',
   *     build: { commitSha, timestamp, imageTag },
   *   });
   *   res.json(status);
   * });
   * ```
   */
  getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
    scale?: { currentCapacity: string; shortTermTarget: string; architecture: string };
  }): Promise<DetailedHealthStatus>;

  /**
   * Start periodic health checks.
   *
   * @param intervalMs - Check interval in milliseconds (default: 30000)
   */
  startPeriodicChecks(intervalMs?: number): void;

  /**
   * Stop periodic health checks.
   */
  stopPeriodicChecks(): void;

  /**
   * Update cleanup status (called by cleanup job).
   *
   * @param success - Whether cleanup succeeded
   * @param cleanedCount - Number of items cleaned
   */
  updateCleanupStatus(success: boolean, cleanedCount: number): void;

  /**
   * Set cleanup interval (for status display).
   *
   * @param minutes - Cleanup interval in minutes
   */
  setCleanupInterval(minutes: number): void;

  /**
   * Get the last known result for a check.
   *
   * @param name - Name of the check
   * @returns Last result or undefined if never run
   */
  getLastResult(name: string): HealthCheckResult | undefined;

  /**
   * Get all last known results.
   *
   * @returns Array of all cached results
   */
  getAllLastResults(): HealthCheckResult[];

  /**
   * Check if the system is healthy (quick check).
   *
   * Uses cached results, doesn't run new checks.
   *
   * @returns True if all cached checks are healthy
   */
  isHealthy(): boolean;

  /**
   * Check if the system is ready to serve requests.
   *
   * Runs critical checks (e.g., database) to verify readiness.
   *
   * @returns True if system is ready
   */
  isReady(): Promise<boolean>;
}
