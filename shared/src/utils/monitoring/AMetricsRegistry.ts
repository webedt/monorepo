/**
 * Abstract Metrics Registry Service
 *
 * Base class for metrics collection and aggregation.
 *
 * @see MetricsRegistry for the concrete implementation
 */
import { AService } from '../../services/abstracts/AService.js';

/**
 * Summary statistics from the metrics registry.
 */
export interface MetricsSummary {
  uptime: number;
  totalRequests: number;
  errorRate: number;
  avgResponseTime: number;
  activeConnections: number;
  healthStatus: string;
}

/**
 * Abstract metrics registry service.
 *
 * Initialize order is -50 to ensure metrics are available early.
 */
export abstract class AMetricsRegistry extends AService {
  override readonly order: number = -50;

  /**
   * Record an HTTP request.
   */
  abstract recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number
  ): void;

  /**
   * Record a GitHub API call.
   */
  abstract recordGitHubApiCall(
    endpoint: string,
    success: boolean,
    durationMs: number,
    statusCode?: number
  ): void;

  /**
   * Record a database query.
   */
  abstract recordDbQuery(operation: string, success: boolean, durationMs: number): void;

  /**
   * Record a cleanup cycle.
   */
  abstract recordCleanupCycle(success: boolean, sessionsCleaned: number, durationMs: number): void;

  /**
   * Record an error.
   */
  abstract recordError(errorType: string, component: string): void;

  /**
   * Record a retry attempt.
   */
  abstract recordRetryAttempt(operation: string, attempt: number, success: boolean): void;

  /**
   * Update health status.
   */
  abstract updateHealthStatus(healthy: boolean): void;

  /**
   * Update system metrics (call periodically).
   */
  abstract updateSystemMetrics(): void;

  /**
   * Update database connection metrics.
   */
  abstract updateDbConnections(active: number, idle: number, waiting: number): void;

  /**
   * Update circuit breaker metrics.
   */
  abstract updateCircuitBreakerMetrics(): void;

  /**
   * Get all metrics as JSON.
   */
  abstract getMetricsJson(): Record<string, unknown>;

  /**
   * Get summary statistics.
   */
  abstract getSummary(): MetricsSummary;

  /**
   * Reset all metrics (useful for testing).
   */
  abstract reset(): void;
}
