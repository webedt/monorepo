/**
 * Metrics Registry Documentation Interface
 *
 * This file contains the fully-documented interface for the Metrics Registry service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AMetricsRegistry for the abstract base class
 * @see MetricsRegistry for the concrete implementation
 */

/**
 * Summary statistics from the metrics registry.
 */
export interface MetricsSummary {
  /** Server uptime in seconds */
  uptime: number;
  /** Total HTTP requests received */
  totalRequests: number;
  /** Error rate as percentage */
  errorRate: number;
  /** Average response time in milliseconds */
  avgResponseTime: number;
  /** Number of active database connections */
  activeConnections: number;
  /** Current health status */
  healthStatus: string;
}

/**
 * Interface for Metrics Registry with full documentation.
 *
 * Provides comprehensive metrics tracking for monitoring service performance,
 * API call success rates, task completion times, and error rates.
 *
 * ## Features
 *
 * - **HTTP metrics** - Request counts, durations, and error rates
 * - **Database metrics** - Query counts and performance
 * - **External API metrics** - GitHub API call tracking
 * - **System metrics** - Memory usage, uptime, health status
 *
 * ## Usage
 *
 * ```typescript
 * import { metrics } from '@webedt/shared';
 *
 * // Record an HTTP request
 * metrics.recordHttpRequest('GET', '/api/users', 200, 45);
 *
 * // Record a database query
 * metrics.recordDbQuery('SELECT', true, 12);
 *
 * // Get summary statistics
 * const summary = metrics.getSummary();
 * console.log(`Uptime: ${summary.uptime}s, Requests: ${summary.totalRequests}`);
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
   *
   * @example
   * ```typescript
   * const start = Date.now();
   * // ... handle request ...
   * metrics.recordHttpRequest('POST', '/api/sessions', 201, Date.now() - start);
   * ```
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
   *
   * @example
   * ```typescript
   * const start = Date.now();
   * try {
   *   await octokit.repos.get({ owner, repo });
   *   metrics.recordGitHubApiCall('repos/get', true, Date.now() - start);
   * } catch (err) {
   *   metrics.recordGitHubApiCall('repos/get', false, Date.now() - start, err.status);
   * }
   * ```
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
   * @param operation - Query operation type (SELECT, INSERT, etc.)
   * @param success - Whether the query succeeded
   * @param durationMs - Query duration in milliseconds
   *
   * @example
   * ```typescript
   * const start = Date.now();
   * try {
   *   await db.query('SELECT * FROM users');
   *   metrics.recordDbQuery('SELECT', true, Date.now() - start);
   * } catch {
   *   metrics.recordDbQuery('SELECT', false, Date.now() - start);
   * }
   * ```
   */
  recordDbQuery(operation: string, success: boolean, durationMs: number): void;

  /**
   * Record a cleanup cycle.
   *
   * @param success - Whether cleanup succeeded
   * @param sessionsCleaned - Number of sessions cleaned up
   * @param durationMs - Cleanup duration in milliseconds
   */
  recordCleanupCycle(success: boolean, sessionsCleaned: number, durationMs: number): void;

  /**
   * Record an error.
   *
   * @param errorType - Type of error (e.g., 'validation', 'auth', 'network')
   * @param component - Component where error occurred
   *
   * @example
   * ```typescript
   * metrics.recordError('auth_failed', 'login');
   * metrics.recordError('rate_limit', 'github-api');
   * ```
   */
  recordError(errorType: string, component: string): void;

  /**
   * Record a retry attempt.
   *
   * @param operation - Name of the operation being retried
   * @param attempt - Attempt number (1 for first try)
   * @param success - Whether this attempt succeeded
   */
  recordRetryAttempt(operation: string, attempt: number, success: boolean): void;

  /**
   * Update health status.
   *
   * @param healthy - Whether the system is healthy
   */
  updateHealthStatus(healthy: boolean): void;

  /**
   * Update system metrics (call periodically).
   *
   * Updates memory usage and uptime metrics.
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
   *
   * Pulls latest stats from all circuit breakers.
   */
  updateCircuitBreakerMetrics(): void;

  /**
   * Get all metrics as JSON.
   *
   * @returns All metrics in JSON format
   *
   * @example
   * ```typescript
   * app.get('/metrics', (req, res) => {
   *   res.json(metrics.getMetricsJson());
   * });
   * ```
   */
  getMetricsJson(): Record<string, unknown>;

  /**
   * Get summary statistics.
   *
   * @returns Summary of key metrics
   *
   * @example
   * ```typescript
   * const summary = metrics.getSummary();
   * console.log(`Error rate: ${summary.errorRate}%`);
   * ```
   */
  getSummary(): MetricsSummary;

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void;
}
