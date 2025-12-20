/**
 * Health Monitoring Service
 *
 * Provides comprehensive health monitoring with:
 * - Database health checks
 * - External service status
 * - Circuit breaker states
 * - Metrics aggregation
 * - Automatic recovery mechanisms
 */

import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { circuitBreakerRegistry, type CircuitBreakerStats } from './circuitBreaker.js';

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latencyMs?: number;
  lastCheck?: Date;
  details?: Record<string, any>;
}

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
  metrics: ReturnType<typeof metrics.getSummary>;
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

type HealthCheckFunction = () => Promise<HealthCheckResult>;

/**
 * Health Monitor Class
 */
class HealthMonitor {
  private healthChecks: Map<string, HealthCheckFunction> = new Map();
  private lastCheckResults: Map<string, HealthCheckResult> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private cleanupStatus = {
    lastRun: null as Date | null,
    lastSuccess: true,
    totalCleaned: 0,
    intervalMinutes: 5,
  };

  /**
   * Register a health check function
   */
  registerCheck(name: string, checkFn: HealthCheckFunction): void {
    this.healthChecks.set(name, checkFn);
    logger.debug(`Registered health check: ${name}`, { component: 'HealthMonitor' });
  }

  /**
   * Remove a health check
   */
  unregisterCheck(name: string): void {
    this.healthChecks.delete(name);
    this.lastCheckResults.delete(name);
  }

  /**
   * Run a single health check
   */
  async runCheck(name: string): Promise<HealthCheckResult> {
    const checkFn = this.healthChecks.get(name);
    if (!checkFn) {
      return {
        name,
        status: 'unhealthy',
        message: `Health check '${name}' not found`,
      };
    }

    const startTime = Date.now();
    try {
      const result = await Promise.race([
        checkFn(),
        new Promise<HealthCheckResult>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        ),
      ]);

      const finalResult = {
        ...result,
        latencyMs: Date.now() - startTime,
        lastCheck: new Date(),
      };

      this.lastCheckResults.set(name, finalResult);
      return finalResult;
    } catch (error) {
      const errorResult: HealthCheckResult = {
        name,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
        lastCheck: new Date(),
      };

      this.lastCheckResults.set(name, errorResult);
      return errorResult;
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthCheckResult[]> {
    const checkPromises = Array.from(this.healthChecks.keys()).map(name =>
      this.runCheck(name)
    );

    return Promise.all(checkPromises);
  }

  /**
   * Get aggregated health status
   */
  async getHealthStatus(): Promise<ServiceHealth> {
    const checks = await this.runAllChecks();

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasDegraded = checks.some(c => c.status === 'degraded');

    if (hasUnhealthy) {
      // If some checks are healthy and some unhealthy, it's degraded
      const hasHealthy = checks.some(c => c.status === 'healthy');
      status = hasHealthy ? 'degraded' : 'unhealthy';
    } else if (hasDegraded) {
      status = 'degraded';
    }

    // Update health metrics
    metrics.updateHealthStatus(status === 'healthy');

    return {
      status,
      checks,
      circuitBreakers: circuitBreakerRegistry.getAllStats(),
      metrics: metrics.getSummary(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get detailed health status (for /health endpoint)
   */
  async getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
  }): Promise<DetailedHealthStatus> {
    const checks = await this.runAllChecks();

    // Find specific service checks
    const dbCheck = checks.find(c => c.name === 'database') || {
      name: 'database',
      status: 'unhealthy' as const,
      message: 'Database check not configured',
    };

    const storageCheck = checks.find(c => c.name === 'storage');

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasDegraded = checks.some(c => c.status === 'degraded');

    if (hasUnhealthy) {
      const hasHealthy = checks.some(c => c.status === 'healthy');
      status = hasHealthy ? 'degraded' : 'unhealthy';
    } else if (hasDegraded) {
      status = 'degraded';
    }

    // Get memory info
    const memUsage = process.memoryUsage();

    return {
      status,
      version: config.version || 'unknown',
      service: config.service || 'internal-api-server',
      containerId: config.containerId || 'unknown',
      build: config.build || {
        commitSha: 'unknown',
        timestamp: 'unknown',
        imageTag: 'unknown',
      },
      checks,
      services: {
        database: dbCheck,
        storage: storageCheck,
      },
      circuitBreakers: circuitBreakerRegistry.getAllStats(),
      metrics: metrics.getSummary(),
      cleanupStatus: { ...this.cleanupStatus },
      memory: {
        heapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memUsage.heapTotal / (1024 * 1024)),
        rssMb: Math.round(memUsage.rss / (1024 * 1024)),
        externalMb: Math.round(memUsage.external / (1024 * 1024)),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs: number = 30000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.runAllChecks();
      } catch (error) {
        logger.error('Error running periodic health checks', error, {
          component: 'HealthMonitor',
        });
      }
    }, intervalMs);

    logger.info(`Started periodic health checks every ${intervalMs}ms`, {
      component: 'HealthMonitor',
    });
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped periodic health checks', { component: 'HealthMonitor' });
    }
  }

  /**
   * Update cleanup status (called by cleanup job)
   */
  updateCleanupStatus(success: boolean, cleanedCount: number): void {
    this.cleanupStatus.lastRun = new Date();
    this.cleanupStatus.lastSuccess = success;
    this.cleanupStatus.totalCleaned += cleanedCount;
  }

  /**
   * Set cleanup interval (for status display)
   */
  setCleanupInterval(minutes: number): void {
    this.cleanupStatus.intervalMinutes = minutes;
  }

  /**
   * Get the last known result for a check
   */
  getLastResult(name: string): HealthCheckResult | undefined {
    return this.lastCheckResults.get(name);
  }

  /**
   * Get all last known results
   */
  getAllLastResults(): HealthCheckResult[] {
    return Array.from(this.lastCheckResults.values());
  }

  /**
   * Check if the system is healthy (quick check)
   */
  isHealthy(): boolean {
    for (const result of this.lastCheckResults.values()) {
      if (result.status === 'unhealthy') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if the system is ready to serve requests
   */
  async isReady(): Promise<boolean> {
    // Run critical checks
    const dbCheck = this.healthChecks.get('database');
    if (dbCheck) {
      const result = await this.runCheck('database');
      return result.status !== 'unhealthy';
    }
    return true;
  }
}

// Global health monitor instance
export const healthMonitor = new HealthMonitor();

/**
 * Create a database health check function
 */
export function createDatabaseHealthCheck(
  checkFn: () => Promise<{ healthy: boolean; latencyMs: number; error?: string }>
): HealthCheckFunction {
  return async (): Promise<HealthCheckResult> => {
    try {
      const result = await checkFn();
      return {
        name: 'database',
        status: result.healthy ? 'healthy' : 'unhealthy',
        message: result.error || (result.healthy ? 'Database is responding' : 'Database check failed'),
        latencyMs: result.latencyMs,
        details: {
          latencyMs: result.latencyMs,
        },
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Create a storage health check function
 */
export function createStorageHealthCheck(
  checkFn: () => Promise<{ healthy: boolean; latencyMs?: number; error?: string }>
): HealthCheckFunction {
  return async (): Promise<HealthCheckResult> => {
    try {
      const result = await checkFn();
      return {
        name: 'storage',
        status: result.healthy ? 'healthy' : 'degraded',
        message: result.error || (result.healthy ? 'Storage is responding' : 'Storage check failed'),
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      return {
        name: 'storage',
        status: 'degraded',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

/**
 * Create a generic service health check
 */
export function createServiceHealthCheck(
  serviceName: string,
  checkFn: () => Promise<boolean>
): HealthCheckFunction {
  return async (): Promise<HealthCheckResult> => {
    const startTime = Date.now();
    try {
      const healthy = await checkFn();
      return {
        name: serviceName,
        status: healthy ? 'healthy' : 'degraded',
        message: healthy ? `${serviceName} is healthy` : `${serviceName} check failed`,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name: serviceName,
        status: 'unhealthy',
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      };
    }
  };
}
