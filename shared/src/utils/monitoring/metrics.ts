import { AMetricsRegistry } from './AMetricsRegistry.js';
import type { MetricsSummary } from './AMetricsRegistry.js';
import { logger } from '../logging/logger.js';
import { circuitBreakerRegistry } from '../resilience/circuitBreaker.js';

export type { MetricsSummary } from './AMetricsRegistry.js';

export type MetricLabels = Record<string, string>;

interface CounterData {
  value: number;
  labels: MetricLabels;
}

interface GaugeData {
  value: number;
  labels: MetricLabels;
  timestamp: Date;
}

interface HistogramData {
  buckets: number[];
  sum: number;
  count: number;
  labels: MetricLabels;
}

class Counter {
  private name: string;
  private help: string;
  private values: Map<string, CounterData> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key) || { value: 0, labels };
    current.value += value;
    this.values.set(key, current);
  }

  get(labels: MetricLabels = {}): number {
    const key = this.labelsToKey(labels);
    return this.values.get(key)?.value || 0;
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getAll(): { name: string; help: string; type: string; values: CounterData[] } {
    return {
      name: this.name,
      help: this.help,
      type: 'counter',
      values: Array.from(this.values.values()),
    };
  }

  reset(): void {
    this.values.clear();
  }
}

class Gauge {
  private name: string;
  private help: string;
  private values: Map<string, GaugeData> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: MetricLabels = {}, value: number): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, { value, labels, timestamp: new Date() });
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key)?.value || 0;
    this.values.set(key, { value: current + value, labels, timestamp: new Date() });
  }

  dec(labels: MetricLabels = {}, value: number = 1): void {
    this.inc(labels, -value);
  }

  get(labels: MetricLabels = {}): number {
    const key = this.labelsToKey(labels);
    return this.values.get(key)?.value || 0;
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getAll(): { name: string; help: string; type: string; values: GaugeData[] } {
    return {
      name: this.name,
      help: this.help,
      type: 'gauge',
      values: Array.from(this.values.values()),
    };
  }

  reset(): void {
    this.values.clear();
  }
}

class Histogram {
  private name: string;
  private help: string;
  private bucketBoundaries: number[];
  private data: Map<string, HistogramData> = new Map();

  constructor(name: string, help: string, buckets: number[] = [100, 500, 1000, 5000, 10000, 30000]) {
    this.name = name;
    this.help = help;
    this.bucketBoundaries = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: MetricLabels = {}, value: number): void {
    const key = this.labelsToKey(labels);
    let data = this.data.get(key);

    if (!data) {
      data = {
        buckets: new Array(this.bucketBoundaries.length + 1).fill(0),
        sum: 0,
        count: 0,
        labels,
      };
      this.data.set(key, data);
    }

    for (let i = 0; i < this.bucketBoundaries.length; i++) {
      if (value <= this.bucketBoundaries[i]) {
        data.buckets[i]++;
      }
    }
    data.buckets[this.bucketBoundaries.length]++;

    data.sum += value;
    data.count++;
  }

  getAverage(labels: MetricLabels = {}): number {
    const key = this.labelsToKey(labels);
    const data = this.data.get(key);
    if (!data || data.count === 0) return 0;
    return data.sum / data.count;
  }

  getCount(labels: MetricLabels = {}): number {
    const key = this.labelsToKey(labels);
    return this.data.get(key)?.count || 0;
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getAll(): { name: string; help: string; type: string; buckets: number[]; data: HistogramData[] } {
    return {
      name: this.name,
      help: this.help,
      type: 'histogram',
      buckets: this.bucketBoundaries,
      data: Array.from(this.data.values()),
    };
  }

  reset(): void {
    this.data.clear();
  }
}

class MetricsRegistry extends AMetricsRegistry {
  private startTime: Date = new Date();

  readonly httpRequestsTotal = new Counter(
    'api_http_requests_total',
    'Total number of HTTP requests received'
  );

  readonly httpRequestDurationMs = new Histogram(
    'api_http_request_duration_ms',
    'HTTP request duration in milliseconds',
    [50, 100, 250, 500, 1000, 2500, 5000, 10000]
  );

  readonly httpErrorsTotal = new Counter(
    'api_http_errors_total',
    'Total number of HTTP errors'
  );

  readonly sessionsTotal = new Counter(
    'api_sessions_total',
    'Total number of sessions created'
  );

  readonly sessionsActive = new Gauge(
    'api_sessions_active',
    'Number of currently active sessions'
  );

  readonly sessionDurationMs = new Histogram(
    'api_session_duration_ms',
    'Session duration in milliseconds',
    [1000, 5000, 30000, 60000, 300000, 600000, 1800000]
  );

  readonly cyclesTotal = new Counter(
    'api_cycles_total',
    'Total number of cleanup cycles executed'
  );

  readonly cycleSuccessTotal = new Counter(
    'api_cycle_success_total',
    'Total number of successful cleanup cycles'
  );

  readonly cycleDurationMs = new Histogram(
    'api_cycle_duration_ms',
    'Cleanup cycle duration in milliseconds'
  );

  readonly orphanedSessionsCleaned = new Counter(
    'api_orphaned_sessions_cleaned_total',
    'Total number of orphaned sessions cleaned up'
  );

  readonly githubApiCallsTotal = new Counter(
    'api_github_api_calls_total',
    'Total number of GitHub API calls'
  );

  readonly githubApiErrorsTotal = new Counter(
    'api_github_api_errors_total',
    'Total number of GitHub API errors'
  );

  readonly githubApiDurationMs = new Histogram(
    'api_github_api_duration_ms',
    'GitHub API call duration in milliseconds'
  );

  readonly dbQueryTotal = new Counter(
    'api_db_queries_total',
    'Total number of database queries'
  );

  readonly dbQueryErrorsTotal = new Counter(
    'api_db_query_errors_total',
    'Total number of database query errors'
  );

  readonly dbQueryDurationMs = new Histogram(
    'api_db_query_duration_ms',
    'Database query duration in milliseconds',
    [10, 50, 100, 250, 500, 1000, 2500]
  );

  readonly dbConnectionsActive = new Gauge(
    'api_db_connections_active',
    'Number of active database connections'
  );

  readonly errorsTotal = new Counter(
    'api_errors_total',
    'Total number of errors by type'
  );

  readonly healthStatus = new Gauge(
    'api_health_status',
    'Health status (1 = healthy, 0 = unhealthy)'
  );

  readonly uptimeSeconds = new Gauge(
    'api_uptime_seconds',
    'Server uptime in seconds'
  );

  readonly memoryUsageMb = new Gauge(
    'api_memory_usage_mb',
    'Memory usage in megabytes'
  );

  readonly circuitBreakerState = new Gauge(
    'api_circuit_breaker_state',
    'Circuit breaker state (0=closed, 1=half_open, 2=open)'
  );

  readonly circuitBreakerFailures = new Counter(
    'api_circuit_breaker_failures_total',
    'Total circuit breaker failures'
  );

  readonly retryAttemptsTotal = new Counter(
    'api_retry_attempts_total',
    'Total number of retry attempts'
  );

  readonly retrySuccessAfterRetry = new Counter(
    'api_retry_success_after_retry_total',
    'Operations that succeeded after retry'
  );

  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    durationMs: number
  ): void {
    const labels = { method, path, status: statusCode.toString() };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationMs.observe(labels, durationMs);

    if (statusCode >= 400) {
      this.httpErrorsTotal.inc(labels);
    }
  }

  recordGitHubApiCall(
    endpoint: string,
    success: boolean,
    durationMs: number,
    statusCode?: number
  ): void {
    const labels = { endpoint, success: String(success) };
    this.githubApiCallsTotal.inc(labels);
    this.githubApiDurationMs.observe(labels, durationMs);

    if (!success) {
      this.githubApiErrorsTotal.inc({ endpoint, status: String(statusCode || 'unknown') });
    }
  }

  recordDbQuery(operation: string, success: boolean, durationMs: number): void {
    const labels = { operation };
    this.dbQueryTotal.inc(labels);
    this.dbQueryDurationMs.observe(labels, durationMs);

    if (!success) {
      this.dbQueryErrorsTotal.inc(labels);
    }
  }

  recordCleanupCycle(success: boolean, sessionsCleaned: number, durationMs: number): void {
    this.cyclesTotal.inc({});
    this.cycleDurationMs.observe({}, durationMs);

    if (success) {
      this.cycleSuccessTotal.inc({});
    }

    if (sessionsCleaned > 0) {
      this.orphanedSessionsCleaned.inc({}, sessionsCleaned);
    }
  }

  recordError(errorType: string, component: string): void {
    this.errorsTotal.inc({ error_type: errorType, component });
  }

  recordRetryAttempt(operation: string, attempt: number, success: boolean): void {
    this.retryAttemptsTotal.inc({ operation, attempt: String(attempt) });

    if (success && attempt > 1) {
      this.retrySuccessAfterRetry.inc({ operation });
    }
  }

  updateHealthStatus(healthy: boolean): void {
    this.healthStatus.set({}, healthy ? 1 : 0);
  }

  updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    this.memoryUsageMb.set({}, Math.round(memUsage.heapUsed / (1024 * 1024)));
    this.uptimeSeconds.set({}, Math.floor((Date.now() - this.startTime.getTime()) / 1000));
  }

  updateDbConnections(active: number, idle: number, waiting: number): void {
    this.dbConnectionsActive.set({ state: 'active' }, active);
    this.dbConnectionsActive.set({ state: 'idle' }, idle);
    this.dbConnectionsActive.set({ state: 'waiting' }, waiting);
  }

  updateCircuitBreakerMetrics(): void {
    const allStats = circuitBreakerRegistry.getAllStats();
    for (const [name, stats] of Object.entries(allStats)) {
      const stateValue = stats.state === 'closed' ? 0 : stats.state === 'half_open' ? 1 : 2;
      this.circuitBreakerState.set({ circuit: name }, stateValue);
      this.circuitBreakerFailures.inc({ circuit: name }, 0);
    }
  }

  getMetricsJson(): Record<string, any> {
    this.updateSystemMetrics();
    this.updateCircuitBreakerMetrics();

    return {
      http: {
        requests: this.httpRequestsTotal.getAll(),
        duration: this.httpRequestDurationMs.getAll(),
        errors: this.httpErrorsTotal.getAll(),
      },
      sessions: {
        total: this.sessionsTotal.getAll(),
        active: this.sessionsActive.getAll(),
        duration: this.sessionDurationMs.getAll(),
      },
      cycles: {
        total: this.cyclesTotal.getAll(),
        success: this.cycleSuccessTotal.getAll(),
        duration: this.cycleDurationMs.getAll(),
        orphansCleaned: this.orphanedSessionsCleaned.getAll(),
      },
      github: {
        calls: this.githubApiCallsTotal.getAll(),
        errors: this.githubApiErrorsTotal.getAll(),
        duration: this.githubApiDurationMs.getAll(),
      },
      database: {
        queries: this.dbQueryTotal.getAll(),
        errors: this.dbQueryErrorsTotal.getAll(),
        duration: this.dbQueryDurationMs.getAll(),
        connections: this.dbConnectionsActive.getAll(),
      },
      errors: this.errorsTotal.getAll(),
      system: {
        health: this.healthStatus.getAll(),
        uptime: this.uptimeSeconds.getAll(),
        memory: this.memoryUsageMb.getAll(),
      },
      circuitBreakers: circuitBreakerRegistry.getAllStats(),
      retry: {
        attempts: this.retryAttemptsTotal.getAll(),
        successAfterRetry: this.retrySuccessAfterRetry.getAll(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  getSummary(): MetricsSummary {
    this.updateSystemMetrics();

    const totalRequests = this.httpRequestsTotal.get({});
    const totalErrors = this.httpErrorsTotal.get({});
    const avgResponseTime = this.httpRequestDurationMs.getAverage({});

    return {
      uptime: this.uptimeSeconds.get({}),
      totalRequests,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      avgResponseTime: Math.round(avgResponseTime),
      activeConnections: this.dbConnectionsActive.get({ state: 'active' }),
      healthStatus: this.healthStatus.get({}) === 1 ? 'healthy' : 'unhealthy',
    };
  }

  reset(): void {
    this.httpRequestsTotal.reset();
    this.httpRequestDurationMs.reset();
    this.httpErrorsTotal.reset();
    this.sessionsTotal.reset();
    this.sessionsActive.reset();
    this.sessionDurationMs.reset();
    this.cyclesTotal.reset();
    this.cycleSuccessTotal.reset();
    this.cycleDurationMs.reset();
    this.orphanedSessionsCleaned.reset();
    this.githubApiCallsTotal.reset();
    this.githubApiErrorsTotal.reset();
    this.githubApiDurationMs.reset();
    this.dbQueryTotal.reset();
    this.dbQueryErrorsTotal.reset();
    this.dbQueryDurationMs.reset();
    this.dbConnectionsActive.reset();
    this.errorsTotal.reset();
    this.retryAttemptsTotal.reset();
    this.retrySuccessAfterRetry.reset();
    this.startTime = new Date();

    logger.info('Metrics reset', { component: 'Metrics' });
  }
}

export const metrics: AMetricsRegistry = new MetricsRegistry();
