import { AHealthMonitor } from './AHealthMonitor.js';
import { logger } from '../logging/logger.js';
import { metrics } from './metrics.js';
import { circuitBreakerRegistry } from '../resilience/circuitBreaker.js';
import { TIMEOUTS, INTERVALS } from '../../config/constants.js';

import type { HealthCheckResult } from './AHealthMonitor.js';
import type { ServiceHealth } from './AHealthMonitor.js';
import type { DetailedHealthStatus } from './AHealthMonitor.js';
import type { HealthCheckFunction } from './AHealthMonitor.js';

export type { HealthCheckResult, ServiceHealth, DetailedHealthStatus, HealthCheckFunction } from './AHealthMonitor.js';

class HealthMonitor extends AHealthMonitor {
  private healthChecks: Map<string, HealthCheckFunction> = new Map();
  private lastCheckResults: Map<string, HealthCheckResult> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private cleanupStatus = {
    lastRun: null as Date | null,
    lastSuccess: true,
    totalCleaned: 0,
    intervalMinutes: 5,
  };

  registerCheck(name: string, checkFn: HealthCheckFunction): void {
    this.healthChecks.set(name, checkFn);
    logger.debug(`Registered health check: ${name}`, { component: 'HealthMonitor' });
  }

  unregisterCheck(name: string): void {
    this.healthChecks.delete(name);
    this.lastCheckResults.delete(name);
  }

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
          setTimeout(() => reject(new Error('Health check timeout')), TIMEOUTS.HTTP.HEALTH_CHECK)
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

  async runAllChecks(): Promise<HealthCheckResult[]> {
    const checkPromises = Array.from(this.healthChecks.keys()).map(name =>
      this.runCheck(name)
    );

    return Promise.all(checkPromises);
  }

  async getHealthStatus(): Promise<ServiceHealth> {
    const checks = await this.runAllChecks();

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasDegraded = checks.some(c => c.status === 'degraded');

    if (hasUnhealthy) {
      const hasHealthy = checks.some(c => c.status === 'healthy');
      status = hasHealthy ? 'degraded' : 'unhealthy';
    } else if (hasDegraded) {
      status = 'degraded';
    }

    metrics.updateHealthStatus(status === 'healthy');

    return {
      status,
      checks,
      circuitBreakers: circuitBreakerRegistry.getAllStats(),
      metrics: metrics.getSummary(),
      timestamp: new Date().toISOString(),
    };
  }

  async getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
    scale?: { currentCapacity: string; shortTermTarget: string; architecture: string };
  }): Promise<DetailedHealthStatus> {
    const checks = await this.runAllChecks();

    const dbCheck = checks.find(c => c.name === 'database') || {
      name: 'database',
      status: 'unhealthy' as const,
      message: 'Database check not configured',
    };

    const storageCheck = checks.find(c => c.name === 'storage');

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
    const hasDegraded = checks.some(c => c.status === 'degraded');

    if (hasUnhealthy) {
      const hasHealthy = checks.some(c => c.status === 'healthy');
      status = hasHealthy ? 'degraded' : 'unhealthy';
    } else if (hasDegraded) {
      status = 'degraded';
    }

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
      scale: config.scale,
      timestamp: new Date().toISOString(),
    };
  }

  startPeriodicChecks(intervalMs: number = INTERVALS.HEALTH.CHECK): void {
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

  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped periodic health checks', { component: 'HealthMonitor' });
    }
  }

  updateCleanupStatus(success: boolean, cleanedCount: number): void {
    this.cleanupStatus.lastRun = new Date();
    this.cleanupStatus.lastSuccess = success;
    this.cleanupStatus.totalCleaned += cleanedCount;
  }

  setCleanupInterval(minutes: number): void {
    this.cleanupStatus.intervalMinutes = minutes;
  }

  getLastResult(name: string): HealthCheckResult | undefined {
    return this.lastCheckResults.get(name);
  }

  getAllLastResults(): HealthCheckResult[] {
    return Array.from(this.lastCheckResults.values());
  }

  isHealthy(): boolean {
    for (const result of this.lastCheckResults.values()) {
      if (result.status === 'unhealthy') {
        return false;
      }
    }
    return true;
  }

  async isReady(): Promise<boolean> {
    const dbCheck = this.healthChecks.get('database');
    if (dbCheck) {
      const result = await this.runCheck('database');
      return result.status !== 'unhealthy';
    }
    return true;
  }
}

export const healthMonitor: AHealthMonitor = new HealthMonitor();

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
