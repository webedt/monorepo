import { AService } from '../../services/abstracts/AService.js';
import type { IHealthMonitorDocumentation } from './healthMonitor.doc.js';
import type { HealthCheckResult } from './healthMonitor.doc.js';
import type { ServiceHealth } from './healthMonitor.doc.js';
import type { DetailedHealthStatus } from './healthMonitor.doc.js';
import type { HealthCheckFunction } from './healthMonitor.doc.js';

export type { HealthCheckResult, ServiceHealth, DetailedHealthStatus, HealthCheckFunction } from './healthMonitor.doc.js';

export abstract class AHealthMonitor extends AService implements IHealthMonitorDocumentation {
  abstract registerCheck(name: string, checkFn: HealthCheckFunction): void;

  abstract unregisterCheck(name: string): void;

  abstract runCheck(name: string): Promise<HealthCheckResult>;

  abstract runAllChecks(): Promise<HealthCheckResult[]>;

  abstract getHealthStatus(): Promise<ServiceHealth>;

  abstract getDetailedHealthStatus(config: {
    version?: string;
    service?: string;
    containerId?: string;
    build?: { commitSha: string; timestamp: string; imageTag: string };
    scale?: { currentCapacity: string; shortTermTarget: string; architecture: string };
  }): Promise<DetailedHealthStatus>;

  abstract startPeriodicChecks(intervalMs?: number): void;

  abstract stopPeriodicChecks(): void;

  abstract updateCleanupStatus(success: boolean, cleanedCount: number): void;

  abstract setCleanupInterval(minutes: number): void;

  abstract getLastResult(name: string): HealthCheckResult | undefined;

  abstract getAllLastResults(): HealthCheckResult[];

  abstract isHealthy(): boolean;

  abstract isReady(): Promise<boolean>;
}
