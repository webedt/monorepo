/**
 * Interface for Metrics Collection Service
 *
 * Defines the contract for comprehensive metrics tracking for monitoring
 * daemon performance, API call success rates, task completion times, and error rates.
 *
 * @see MetricsRegistry for the implementation
 * @module interfaces/IMetricsRegistry
 */

/**
 * Metric labels for categorizing metrics.
 */
export interface MetricLabels {
  [key: string]: string;
}

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
 * Metrics registry interface for collecting and aggregating metrics.
 *
 * @example
 * ```typescript
 * const metrics: IMetricsRegistry = getMetrics();
 *
 * metrics.recordHttpRequest('GET', '/api/sessions', 200, 150);
 * metrics.recordDbQuery('select', true, 5);
 *
 * const summary = metrics.getSummary();
 * console.log(`Uptime: ${summary.uptime}s`);
 * ```
 */
export interface IMetricsRegistry {
  /**
   * Record an HTTP request.
   *
   * @param method - HTTP method (GET, POST, etc.)
   * @param path - Request path
   * @param statusCode - Response status code
   * @param durationMs - Request duration in milliseconds
   */
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number
  ): void;

  /**
   * Record a GitHub API call.
   *
   * @param endpoint - API endpoint called
   * @param success - Whether the call succeeded
   * @param durationMs - Call duration in milliseconds
   * @param statusCode - Optional HTTP status code
   */
  recordGitHubApiCall(
    endpoint: string,
    success: boolean,
    durationMs: number,
    statusCode?: number
  ): void;

  /**
   * Record a database query.
   *
   * @param operation - Query operation type
   * @param success - Whether the query succeeded
   * @param durationMs - Query duration in milliseconds
   */
  recordDbQuery(operation: string, success: boolean, durationMs: number): void;

  /**
   * Record a cleanup cycle.
   *
   * @param success - Whether cleanup succeeded
   * @param sessionsCleaned - Number of sessions cleaned
   * @param durationMs - Cleanup duration in milliseconds
   */
  recordCleanupCycle(success: boolean, sessionsCleaned: number, durationMs: number): void;

  /**
   * Record an error.
   *
   * @param errorType - Type of error
   * @param component - Component where error occurred
   */
  recordError(errorType: string, component: string): void;

  /**
   * Record a retry attempt.
   *
   * @param operation - Operation being retried
   * @param attempt - Attempt number
   * @param success - Whether the attempt succeeded
   */
  recordRetryAttempt(operation: string, attempt: number, success: boolean): void;

  /**
   * Update health status.
   *
   * @param healthy - Whether the service is healthy
   */
  updateHealthStatus(healthy: boolean): void;

  /**
   * Update system metrics (call periodically).
   */
  updateSystemMetrics(): void;

  /**
   * Update database connection metrics.
   *
   * @param active - Number of active connections
   * @param idle - Number of idle connections
   * @param waiting - Number of waiting connections
   */
  updateDbConnections(active: number, idle: number, waiting: number): void;

  /**
   * Update circuit breaker metrics.
   */
  updateCircuitBreakerMetrics(): void;

  /**
   * Get all metrics as JSON.
   *
   * @returns All metrics data
   */
  getMetricsJson(): Record<string, unknown>;

  /**
   * Get summary statistics.
   *
   * @returns Summary with uptime, error rate, etc.
   */
  getSummary(): MetricsSummary;

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void;
}
