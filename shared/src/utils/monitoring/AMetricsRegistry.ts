import { AService } from '../../services/abstracts/AService.js';
import type { IMetricsRegistryDocumentation } from './metrics.doc.js';
import type { MetricsSummary } from './metrics.doc.js';

export type { MetricsSummary } from './metrics.doc.js';

export abstract class AMetricsRegistry extends AService implements IMetricsRegistryDocumentation {
  override readonly order: number = -50;

  abstract recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number
  ): void;

  abstract recordGitHubApiCall(
    endpoint: string,
    success: boolean,
    durationMs: number,
    statusCode?: number
  ): void;

  abstract recordDbQuery(operation: string, success: boolean, durationMs: number): void;

  abstract recordCleanupCycle(success: boolean, sessionsCleaned: number, durationMs: number): void;

  abstract recordError(errorType: string, component: string): void;

  abstract recordRetryAttempt(operation: string, attempt: number, success: boolean): void;

  abstract updateHealthStatus(healthy: boolean): void;

  abstract updateSystemMetrics(): void;

  abstract updateDbConnections(active: number, idle: number, waiting: number): void;

  abstract updateCircuitBreakerMetrics(): void;

  abstract getMetricsJson(): Record<string, unknown>;

  abstract getSummary(): MetricsSummary;

  abstract recordRateLimitHit(tier: string, path: string): void;

  abstract recordSseSubscription(broadcasterType: string): void;

  abstract recordSseUnsubscription(broadcasterType: string): void;

  abstract recordSseEviction(broadcasterType: string, reason: string): void;

  abstract updateSseSessionCount(broadcasterType: string, count: number): void;

  abstract recordSseHeartbeat(broadcasterType: string, success: boolean): void;

  abstract reset(): void;
}
