/**
 * Interface for Health Monitoring Service
 *
 * Defines the contract for comprehensive health monitoring with
 * database health checks, external service status, circuit breaker states,
 * and metrics aggregation.
 *
 * @see HealthMonitor for the implementation
 * @module interfaces/IHealthMonitor
 */

import type { CircuitBreakerStats } from '../resilience/ICircuitBreaker.js';

/**
 * Result of a single health check.
 */
export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latencyMs?: number;
  lastCheck?: Date;
  details?: Record<string, unknown>;
}

/**
 * Aggregated health status for the service.
 */
export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  circuitBreakers: Record<string, CircuitBreakerStats>;
  metrics: {
    uptime: number;
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
  };
  timestamp: string;
}

/**
 * Detailed health status including system information.
 */
export interface DetailedHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  service: string;
  containerId: string;
  build: {
    commitSha: string;
    timestamp: string;
    imageTag: string;
  };
  checks: HealthCheckResult[];
  services: {
    database: HealthCheckResult;
    storage?: HealthCheckResult;
  };
  circuitBreakers: Record<string, CircuitBreakerStats>;
  metrics: {
    uptime: number;
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
    activeConnections: number;
    healthStatus: string;
  };
  cleanupStatus: {
    lastRun: Date | null;
    lastSuccess: boolean;
    totalCleaned: number;
    intervalMinutes: number;
  };
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;
  };
  timestamp: string;
}

/**
 * Health check function signature.
 */
export type HealthCheckFunction = () => Promise<HealthCheckResult>;

/**
 * Health monitor interface for comprehensive service health tracking.
 *
 * @example
 * ```typescript
 * const monitor: IHealthMonitor = getHealthMonitor();
 *
 * monitor.registerCheck('database', async () => ({
 *   name: 'database',
 *   status: 'healthy',
 *   latencyMs: 5,
 * }));
 *
 * const health = await monitor.getHealthStatus();
 * console.log(`Status: ${health.status}`);
 * ```
 */
export interface IHealthMonitor {
  /**
   * Register a health check function.
   *
   * @param name - Name of the health check
   * @param checkFn - Function that performs the check
   */
  registerCheck(name: string, checkFn: HealthCheckFunction): void;

  /**
   * Remove a health check.
   *
   * @param name - Name of the health check to remove
   */
  unregisterCheck(name: string): void;

  /**
   * Run a single health check.
   *
   * @param name - Name of the health check to run
   * @returns Health check result
   */
  runCheck(name: string): Promise<HealthCheckResult>;

  /**
   * Run all health checks.
   *
   * @returns Array of all health check results
   */
  runAllChecks(): Promise<HealthCheckResult[]>;

  /**
   * Get aggregated health status.
   *
   * @returns Service health with all checks and metrics
   */
  getHealthStatus(): Promise<ServiceHealth>;

  /**
   * Get detailed health status (for /health endpoint).
   *
   * @param config - Configuration with version and build info
   * @returns Detailed health status
   */
  getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
  }): Promise<DetailedHealthStatus>;

  /**
   * Start periodic health checks.
   *
   * @param intervalMs - Interval between checks (default: 30000)
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
   * @param name - Name of the health check
   * @returns Last known result or undefined
   */
  getLastResult(name: string): HealthCheckResult | undefined;

  /**
   * Get all last known results.
   *
   * @returns Array of all last known results
   */
  getAllLastResults(): HealthCheckResult[];

  /**
   * Check if the system is healthy (quick check).
   *
   * @returns `true` if all checks are healthy
   */
  isHealthy(): boolean;

  /**
   * Check if the system is ready to serve requests.
   *
   * @returns `true` if critical services are available
   */
  isReady(): Promise<boolean>;
}
