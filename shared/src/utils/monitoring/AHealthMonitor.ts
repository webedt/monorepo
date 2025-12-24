/**
 * Abstract Health Monitor Service
 *
 * Base class for comprehensive health monitoring with database health checks,
 * external service status, circuit breaker states, and metrics aggregation.
 *
 * @see HealthMonitor for the concrete implementation
 */
import { AService } from '../../services/abstracts/AService.js';
import type { CircuitBreakerStats } from '../resilience/ACircuitBreaker.js';

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
 * Abstract health monitor service.
 *
 * Initialize order is 0 (default).
 */
export abstract class AHealthMonitor extends AService {
  /**
   * Register a health check function.
   */
  abstract registerCheck(name: string, checkFn: HealthCheckFunction): void;

  /**
   * Remove a health check.
   */
  abstract unregisterCheck(name: string): void;

  /**
   * Run a single health check.
   */
  abstract runCheck(name: string): Promise<HealthCheckResult>;

  /**
   * Run all health checks.
   */
  abstract runAllChecks(): Promise<HealthCheckResult[]>;

  /**
   * Get aggregated health status.
   */
  abstract getHealthStatus(): Promise<ServiceHealth>;

  /**
   * Get detailed health status (for /health endpoint).
   */
  abstract getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
  }): Promise<DetailedHealthStatus>;

  /**
   * Start periodic health checks.
   */
  abstract startPeriodicChecks(intervalMs?: number): void;

  /**
   * Stop periodic health checks.
   */
  abstract stopPeriodicChecks(): void;

  /**
   * Update cleanup status (called by cleanup job).
   */
  abstract updateCleanupStatus(success: boolean, cleanedCount: number): void;

  /**
   * Set cleanup interval (for status display).
   */
  abstract setCleanupInterval(minutes: number): void;

  /**
   * Get the last known result for a check.
   */
  abstract getLastResult(name: string): HealthCheckResult | undefined;

  /**
   * Get all last known results.
   */
  abstract getAllLastResults(): HealthCheckResult[];

  /**
   * Check if the system is healthy (quick check).
   */
  abstract isHealthy(): boolean;

  /**
   * Check if the system is ready to serve requests.
   */
  abstract isReady(): Promise<boolean>;
}
