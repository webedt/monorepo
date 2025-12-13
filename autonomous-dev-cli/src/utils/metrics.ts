/**
 * Metrics collection module for observability and monitoring.
 * Provides Prometheus-compatible metrics for task success rates, timing, and errors.
 */

export interface MetricLabels {
  [key: string]: string;
}

export interface CounterMetric {
  name: string;
  help: string;
  type: 'counter';
  value: number;
  labels: MetricLabels;
}

export interface GaugeMetric {
  name: string;
  help: string;
  type: 'gauge';
  value: number;
  labels: MetricLabels;
}

export interface HistogramBucket {
  le: number | '+Inf';
  count: number;
}

export interface HistogramMetric {
  name: string;
  help: string;
  type: 'histogram';
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: MetricLabels;
}

export type Metric = CounterMetric | GaugeMetric | HistogramMetric;

/**
 * Summary returned when ending correlation tracking
 */
export interface CorrelationSummary {
  duration: number;
  operationCount: number;
  errorCount: number;
}

/**
 * Detailed correlation summary with additional context (for debugging)
 */
export interface DetailedCorrelationSummary extends CorrelationSummary {
  correlationId: string;
  operations: string[];
}

// Default histogram buckets for duration metrics (in milliseconds)
const DEFAULT_DURATION_BUCKETS = [100, 500, 1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];

interface MetricKey {
  name: string;
  labelsKey: string;
}

class Counter {
  private name: string;
  private help: string;
  private values: Map<string, { value: number; labels: MetricLabels }> = new Map();

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

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getMetrics(): CounterMetric[] {
    return Array.from(this.values.entries()).map(([_, data]) => ({
      name: this.name,
      help: this.help,
      type: 'counter' as const,
      value: data.value,
      labels: data.labels,
    }));
  }

  getName(): string {
    return this.name;
  }

  getHelp(): string {
    return this.help;
  }
}

class Gauge {
  private name: string;
  private help: string;
  private values: Map<string, { value: number; labels: MetricLabels }> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: MetricLabels = {}, value: number): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, { value, labels });
  }

  inc(labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const current = this.values.get(key) || { value: 0, labels };
    current.value += value;
    this.values.set(key, current);
  }

  dec(labels: MetricLabels = {}, value: number = 1): void {
    this.inc(labels, -value);
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getMetrics(): GaugeMetric[] {
    return Array.from(this.values.entries()).map(([_, data]) => ({
      name: this.name,
      help: this.help,
      type: 'gauge' as const,
      value: data.value,
      labels: data.labels,
    }));
  }

  getName(): string {
    return this.name;
  }

  getHelp(): string {
    return this.help;
  }
}

class Histogram {
  private name: string;
  private help: string;
  private bucketBoundaries: number[];
  private data: Map<string, { buckets: number[]; sum: number; count: number; labels: MetricLabels }> = new Map();

  constructor(name: string, help: string, buckets: number[] = DEFAULT_DURATION_BUCKETS) {
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

    // Increment buckets
    for (let i = 0; i < this.bucketBoundaries.length; i++) {
      if (value <= this.bucketBoundaries[i]) {
        data.buckets[i]++;
      }
    }
    // +Inf bucket
    data.buckets[this.bucketBoundaries.length]++;

    data.sum += value;
    data.count++;
  }

  private labelsToKey(labels: MetricLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  getMetrics(): HistogramMetric[] {
    return Array.from(this.data.entries()).map(([_, data]) => {
      const buckets: HistogramBucket[] = this.bucketBoundaries.map((le, i) => ({
        le,
        count: data.buckets.slice(0, i + 1).reduce((a, b) => a + b, 0),
      }));
      buckets.push({
        le: '+Inf' as const,
        count: data.count,
      });

      return {
        name: this.name,
        help: this.help,
        type: 'histogram' as const,
        buckets,
        sum: data.sum,
        count: data.count,
        labels: data.labels,
      };
    });
  }

  getName(): string {
    return this.name;
  }

  getHelp(): string {
    return this.help;
  }
}

/**
 * Error tracking context for comprehensive error monitoring
 */
export interface ErrorContext {
  repository?: string;
  taskType?: string;
  workerId?: string;
  issueNumber?: number;
  branchName?: string;
  errorCode?: string;
  severity?: string;
  isRetryable?: boolean;
  component?: string;
  operation?: string;
}

/**
 * MetricsRegistry collects and exports all metrics
 */
class MetricsRegistry {
  // Task metrics
  readonly tasksTotal = new Counter(
    'autonomous_dev_tasks_total',
    'Total number of tasks processed'
  );

  readonly tasksSuccessTotal = new Counter(
    'autonomous_dev_tasks_success_total',
    'Total number of successfully completed tasks'
  );

  readonly tasksFailedTotal = new Counter(
    'autonomous_dev_tasks_failed_total',
    'Total number of failed tasks'
  );

  readonly taskDurationMs = new Histogram(
    'autonomous_dev_task_duration_ms',
    'Task execution duration in milliseconds'
  );

  // Cycle metrics
  readonly cyclesTotal = new Counter(
    'autonomous_dev_cycles_total',
    'Total number of daemon cycles executed'
  );

  readonly cycleTasksDiscovered = new Histogram(
    'autonomous_dev_cycle_tasks_discovered',
    'Number of tasks discovered per cycle',
    [0, 1, 2, 3, 5, 10, 20]
  );

  readonly cycleDurationMs = new Histogram(
    'autonomous_dev_cycle_duration_ms',
    'Cycle duration in milliseconds'
  );

  // Worker pool metrics
  readonly workersActive = new Gauge(
    'autonomous_dev_workers_active',
    'Number of currently active workers'
  );

  readonly workersQueued = new Gauge(
    'autonomous_dev_workers_queued',
    'Number of tasks currently queued'
  );

  // Build/evaluation metrics
  readonly buildsTotal = new Counter(
    'autonomous_dev_builds_total',
    'Total number of builds executed'
  );

  readonly buildsSuccessTotal = new Counter(
    'autonomous_dev_builds_success_total',
    'Total number of successful builds'
  );

  readonly buildDurationMs = new Histogram(
    'autonomous_dev_build_duration_ms',
    'Build duration in milliseconds'
  );

  readonly testsTotal = new Counter(
    'autonomous_dev_tests_total',
    'Total number of test runs'
  );

  readonly testsSuccessTotal = new Counter(
    'autonomous_dev_tests_success_total',
    'Total number of successful test runs'
  );

  readonly testDurationMs = new Histogram(
    'autonomous_dev_test_duration_ms',
    'Test execution duration in milliseconds'
  );

  // GitHub API metrics
  readonly githubApiCallsTotal = new Counter(
    'autonomous_dev_github_api_calls_total',
    'Total number of GitHub API calls'
  );

  readonly githubApiErrorsTotal = new Counter(
    'autonomous_dev_github_api_errors_total',
    'Total number of GitHub API errors'
  );

  readonly prsCreatedTotal = new Counter(
    'autonomous_dev_prs_created_total',
    'Total number of PRs created'
  );

  readonly prsMergedTotal = new Counter(
    'autonomous_dev_prs_merged_total',
    'Total number of PRs merged'
  );

  // Error tracking
  readonly errorsTotal = new Counter(
    'autonomous_dev_errors_total',
    'Total number of errors by code and severity'
  );

  // Health status
  readonly healthStatus = new Gauge(
    'autonomous_dev_health_status',
    'Health status of the daemon (1 = healthy, 0 = unhealthy)'
  );

  readonly uptimeSeconds = new Gauge(
    'autonomous_dev_uptime_seconds',
    'Time since daemon started in seconds'
  );

  // Claude API metrics
  readonly claudeApiCallsTotal = new Counter(
    'autonomous_dev_claude_api_calls_total',
    'Total number of Claude API calls'
  );

  readonly claudeApiErrorsTotal = new Counter(
    'autonomous_dev_claude_api_errors_total',
    'Total number of Claude API errors'
  );

  readonly claudeToolUsageTotal = new Counter(
    'autonomous_dev_claude_tool_usage_total',
    'Total number of tool uses by Claude'
  );

  // GitHub API timing metrics
  readonly githubApiDurationMs = new Histogram(
    'autonomous_dev_github_api_duration_ms',
    'GitHub API call duration in milliseconds',
    [50, 100, 250, 500, 1000, 2500, 5000, 10000]
  );

  // Claude SDK timing metrics
  readonly claudeApiDurationMs = new Histogram(
    'autonomous_dev_claude_api_duration_ms',
    'Claude API call duration in milliseconds',
    [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]
  );

  // Worker utilization metrics
  readonly workerUtilization = new Gauge(
    'autonomous_dev_worker_utilization',
    'Worker utilization percentage (0-100)'
  );

  readonly workerTasksTotal = new Counter(
    'autonomous_dev_worker_tasks_total',
    'Total tasks processed by worker'
  );

  // Memory metrics
  readonly memoryUsageMb = new Gauge(
    'autonomous_dev_memory_usage_mb',
    'Current memory usage in megabytes'
  );

  // Discovery metrics
  readonly discoveryDurationMs = new Histogram(
    'autonomous_dev_discovery_duration_ms',
    'Task discovery duration in milliseconds'
  );

  readonly analysisCacheHits = new Counter(
    'autonomous_dev_analysis_cache_hits_total',
    'Number of analysis cache hits'
  );

  readonly analysisCacheMisses = new Counter(
    'autonomous_dev_analysis_cache_misses_total',
    'Number of analysis cache misses'
  );

  // Circuit breaker metrics
  readonly circuitBreakerState = new Gauge(
    'autonomous_dev_circuit_breaker_state',
    'Circuit breaker state (0=closed, 1=half_open, 2=open)'
  );

  readonly circuitBreakerSuccesses = new Counter(
    'autonomous_dev_circuit_breaker_successes_total',
    'Total successful requests through circuit breaker'
  );

  readonly circuitBreakerFailures = new Counter(
    'autonomous_dev_circuit_breaker_failures_total',
    'Total failed requests through circuit breaker'
  );

  readonly circuitBreakerStateChanges = new Counter(
    'autonomous_dev_circuit_breaker_state_changes_total',
    'Total circuit breaker state transitions'
  );

  readonly circuitBreakerRejections = new Counter(
    'autonomous_dev_circuit_breaker_rejections_total',
    'Total requests rejected by open circuit breaker'
  );

  // Correlation tracking for debugging
  private correlationMetrics: Map<string, {
    startTime: number;
    operations: string[];
    errors: number;
  }> = new Map();

  private startTime: number = Date.now();

  /**
   * Record a task completion
   */
  recordTaskCompletion(
    success: boolean,
    durationMs: number,
    labels: { repository: string; taskType?: string; workerId?: string }
  ): void {
    const baseLabels = { repository: labels.repository };
    const fullLabels = {
      ...baseLabels,
      task_type: labels.taskType || 'unknown',
      worker_id: labels.workerId || 'unknown',
    };

    this.tasksTotal.inc(baseLabels);
    this.taskDurationMs.observe(fullLabels, durationMs);

    if (success) {
      this.tasksSuccessTotal.inc(baseLabels);
    } else {
      this.tasksFailedTotal.inc(baseLabels);
    }
  }

  /**
   * Record a cycle completion
   */
  recordCycleCompletion(
    tasksDiscovered: number,
    tasksCompleted: number,
    tasksFailed: number,
    durationMs: number,
    labels: { repository: string }
  ): void {
    this.cyclesTotal.inc(labels);
    this.cycleTasksDiscovered.observe(labels, tasksDiscovered);
    this.cycleDurationMs.observe(labels, durationMs);
  }

  /**
   * Record a build result
   */
  recordBuild(success: boolean, durationMs: number, labels: { repository: string }): void {
    this.buildsTotal.inc(labels);
    this.buildDurationMs.observe(labels, durationMs);
    if (success) {
      this.buildsSuccessTotal.inc(labels);
    }
  }

  /**
   * Record a test result
   */
  recordTests(success: boolean, durationMs: number, labels: { repository: string }): void {
    this.testsTotal.inc(labels);
    this.testDurationMs.observe(labels, durationMs);
    if (success) {
      this.testsSuccessTotal.inc(labels);
    }
  }

  /**
   * Record an error with full context
   */
  recordError(context: ErrorContext): void {
    this.errorsTotal.inc({
      repository: context.repository || 'unknown',
      error_code: context.errorCode || 'unknown',
      severity: context.severity || 'error',
      component: context.component || 'unknown',
      is_retryable: String(context.isRetryable ?? false),
    });
  }

  /**
   * Record Claude tool usage
   */
  recordToolUsage(toolName: string, labels: { repository: string; workerId?: string }): void {
    this.claudeToolUsageTotal.inc({
      tool: toolName,
      repository: labels.repository,
      worker_id: labels.workerId || 'unknown',
    });
  }

  /**
   * Update worker pool status
   */
  updateWorkerPoolStatus(active: number, queued: number): void {
    this.workersActive.set({}, active);
    this.workersQueued.set({}, queued);
  }

  /**
   * Update health status
   */
  updateHealthStatus(healthy: boolean): void {
    this.healthStatus.set({}, healthy ? 1 : 0);
    this.uptimeSeconds.set({}, Math.floor((Date.now() - this.startTime) / 1000));
  }

  /**
   * Record a GitHub API call with timing
   */
  recordGitHubApiCall(
    endpoint: string,
    method: string,
    success: boolean,
    durationMs: number,
    labels: { repository: string; statusCode?: number }
  ): void {
    this.githubApiCallsTotal.inc({
      repository: labels.repository,
      endpoint,
      method,
    });

    this.githubApiDurationMs.observe(
      {
        repository: labels.repository,
        endpoint,
        method,
        status: labels.statusCode?.toString() ?? 'unknown',
      },
      durationMs
    );

    if (!success) {
      this.githubApiErrorsTotal.inc({
        repository: labels.repository,
        endpoint,
        status_code: labels.statusCode?.toString() ?? 'unknown',
      });
    }
  }

  /**
   * Record a Claude SDK call with timing
   */
  recordClaudeApiCall(
    operation: string,
    success: boolean,
    durationMs: number,
    labels: { repository: string; workerId?: string }
  ): void {
    this.claudeApiCallsTotal.inc({
      repository: labels.repository,
      operation,
    });

    this.claudeApiDurationMs.observe(
      {
        repository: labels.repository,
        operation,
        worker_id: labels.workerId ?? 'unknown',
        success: String(success),
      },
      durationMs
    );

    if (!success) {
      this.claudeApiErrorsTotal.inc({
        repository: labels.repository,
        operation,
      });
    }
  }

  /**
   * Update worker utilization
   */
  updateWorkerUtilization(
    activeWorkers: number,
    maxWorkers: number,
    queuedTasks: number
  ): void {
    const utilization = maxWorkers > 0
      ? Math.round((activeWorkers / maxWorkers) * 100)
      : 0;

    this.workerUtilization.set({}, utilization);
    this.workersActive.set({}, activeWorkers);
    this.workersQueued.set({}, queuedTasks);
  }

  /**
   * Record a worker task execution
   */
  recordWorkerTask(
    workerId: string,
    success: boolean,
    durationMs: number,
    labels: { repository: string; issueNumber?: number }
  ): void {
    this.workerTasksTotal.inc({
      worker_id: workerId,
      repository: labels.repository,
      success: String(success),
    });

    this.taskDurationMs.observe(
      {
        worker_id: workerId,
        repository: labels.repository,
      },
      durationMs
    );
  }

  /**
   * Update memory usage metrics
   */
  updateMemoryUsage(heapUsedMB: number): void {
    this.memoryUsageMb.set({}, heapUsedMB);
  }

  /**
   * Record discovery operation
   */
  recordDiscovery(
    tasksFound: number,
    durationMs: number,
    cacheHit: boolean,
    labels: { repository: string }
  ): void {
    this.discoveryDurationMs.observe(labels, durationMs);
    this.cycleTasksDiscovered.observe(labels, tasksFound);

    if (cacheHit) {
      this.analysisCacheHits.inc(labels);
    } else {
      this.analysisCacheMisses.inc(labels);
    }
  }

  /**
   * Record circuit breaker success
   */
  recordCircuitBreakerSuccess(name: string): void {
    this.circuitBreakerSuccesses.inc({ circuit_name: name });
  }

  /**
   * Record circuit breaker failure
   */
  recordCircuitBreakerFailure(name: string, errorMessage: string): void {
    this.circuitBreakerFailures.inc({
      circuit_name: name,
      error_type: this.categorizeCircuitBreakerError(errorMessage),
    });
  }

  /**
   * Record circuit breaker state change
   */
  recordCircuitBreakerStateChange(
    name: string,
    fromState: string,
    toState: string
  ): void {
    this.circuitBreakerStateChanges.inc({
      circuit_name: name,
      from_state: fromState,
      to_state: toState,
    });

    // Update current state gauge
    const stateValue = toState === 'closed' ? 0 : toState === 'half_open' ? 1 : 2;
    this.circuitBreakerState.set({ circuit_name: name }, stateValue);
  }

  /**
   * Record circuit breaker rejection (request blocked by open circuit)
   */
  recordCircuitBreakerRejection(name: string): void {
    this.circuitBreakerRejections.inc({ circuit_name: name });
  }

  /**
   * Categorize error message for circuit breaker metrics
   */
  private categorizeCircuitBreakerError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();
    if (message.includes('rate limit') || message.includes('429')) {
      return 'rate_limit';
    }
    if (message.includes('timeout') || message.includes('408') || message.includes('504')) {
      return 'timeout';
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('auth') || message.includes('401') || message.includes('403')) {
      return 'auth';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503')) {
      return 'server_error';
    }
    return 'other';
  }

  /**
   * Start tracking a correlation ID
   */
  startCorrelation(correlationId: string): void {
    this.correlationMetrics.set(correlationId, {
      startTime: Date.now(),
      operations: [],
      errors: 0,
    });
  }

  /**
   * Record an operation for a correlation ID
   */
  recordCorrelationOperation(correlationId: string, operation: string): void {
    const metrics = this.correlationMetrics.get(correlationId);
    if (metrics) {
      metrics.operations.push(operation);
    }
  }

  /**
   * Record an error for a correlation ID
   */
  recordCorrelationError(correlationId: string): void {
    const metrics = this.correlationMetrics.get(correlationId);
    if (metrics) {
      metrics.errors++;
    }
  }

  /**
   * End tracking a correlation ID and return summary
   */
  endCorrelation(correlationId: string): CorrelationSummary | null {
    const metrics = this.correlationMetrics.get(correlationId);
    if (!metrics) {
      return null;
    }

    this.correlationMetrics.delete(correlationId);
    return {
      duration: Date.now() - metrics.startTime,
      operationCount: metrics.operations.length,
      errorCount: metrics.errors,
    };
  }

  /**
   * Get correlation metrics summary (for debugging)
   */
  getCorrelationSummary(correlationId: string): DetailedCorrelationSummary | null {
    const metrics = this.correlationMetrics.get(correlationId);
    if (!metrics) {
      return null;
    }

    return {
      correlationId,
      duration: Date.now() - metrics.startTime,
      operations: [...metrics.operations],
      operationCount: metrics.operations.length,
      errorCount: metrics.errors,
    };
  }

  /**
   * Get all metrics in Prometheus format
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const processedMetrics = new Set<string>();

    // Update uptime before exporting
    this.uptimeSeconds.set({}, Math.floor((Date.now() - this.startTime) / 1000));

    const allCollectors = [
      this.tasksTotal,
      this.tasksSuccessTotal,
      this.tasksFailedTotal,
      this.taskDurationMs,
      this.cyclesTotal,
      this.cycleTasksDiscovered,
      this.cycleDurationMs,
      this.workersActive,
      this.workersQueued,
      this.buildsTotal,
      this.buildsSuccessTotal,
      this.buildDurationMs,
      this.testsTotal,
      this.testsSuccessTotal,
      this.testDurationMs,
      this.githubApiCallsTotal,
      this.githubApiErrorsTotal,
      this.githubApiDurationMs,
      this.prsCreatedTotal,
      this.prsMergedTotal,
      this.errorsTotal,
      this.healthStatus,
      this.uptimeSeconds,
      this.claudeApiCallsTotal,
      this.claudeApiErrorsTotal,
      this.claudeApiDurationMs,
      this.claudeToolUsageTotal,
      this.workerUtilization,
      this.workerTasksTotal,
      this.memoryUsageMb,
      this.discoveryDurationMs,
      this.analysisCacheHits,
      this.analysisCacheMisses,
      this.circuitBreakerState,
      this.circuitBreakerSuccesses,
      this.circuitBreakerFailures,
      this.circuitBreakerStateChanges,
      this.circuitBreakerRejections,
    ];

    for (const collector of allCollectors) {
      const metrics = collector.getMetrics();
      if (metrics.length === 0) continue;

      const name = collector.getName();
      if (!processedMetrics.has(name)) {
        lines.push(`# HELP ${name} ${collector.getHelp()}`);

        // Determine type
        const firstMetric = metrics[0];
        if ('buckets' in firstMetric) {
          lines.push(`# TYPE ${name} histogram`);
        } else if (firstMetric.type === 'gauge') {
          lines.push(`# TYPE ${name} gauge`);
        } else {
          lines.push(`# TYPE ${name} counter`);
        }

        processedMetrics.add(name);
      }

      for (const metric of metrics) {
        const labelsStr = this.formatLabels(metric.labels);

        if ('buckets' in metric) {
          // Histogram
          for (const bucket of metric.buckets) {
            const bucketLabels = labelsStr
              ? `${labelsStr},le="${bucket.le}"`
              : `le="${bucket.le}"`;
            lines.push(`${name}_bucket{${bucketLabels}} ${bucket.count}`);
          }
          lines.push(`${name}_sum{${labelsStr}} ${metric.sum}`);
          lines.push(`${name}_count{${labelsStr}} ${metric.count}`);
        } else {
          // Counter or Gauge
          if (labelsStr) {
            lines.push(`${name}{${labelsStr}} ${metric.value}`);
          } else {
            lines.push(`${name} ${metric.value}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON for API response
   */
  getMetricsJson(): Record<string, any> {
    this.uptimeSeconds.set({}, Math.floor((Date.now() - this.startTime) / 1000));

    const allCollectors = [
      this.tasksTotal,
      this.tasksSuccessTotal,
      this.tasksFailedTotal,
      this.taskDurationMs,
      this.cyclesTotal,
      this.cycleTasksDiscovered,
      this.cycleDurationMs,
      this.workersActive,
      this.workersQueued,
      this.buildsTotal,
      this.buildsSuccessTotal,
      this.buildDurationMs,
      this.testsTotal,
      this.testsSuccessTotal,
      this.testDurationMs,
      this.githubApiCallsTotal,
      this.githubApiErrorsTotal,
      this.githubApiDurationMs,
      this.prsCreatedTotal,
      this.prsMergedTotal,
      this.errorsTotal,
      this.healthStatus,
      this.uptimeSeconds,
      this.claudeApiCallsTotal,
      this.claudeApiErrorsTotal,
      this.claudeApiDurationMs,
      this.claudeToolUsageTotal,
      this.workerUtilization,
      this.workerTasksTotal,
      this.memoryUsageMb,
      this.discoveryDurationMs,
      this.analysisCacheHits,
      this.analysisCacheMisses,
      this.circuitBreakerState,
      this.circuitBreakerSuccesses,
      this.circuitBreakerFailures,
      this.circuitBreakerStateChanges,
      this.circuitBreakerRejections,
    ];

    const result: Record<string, any> = {};

    for (const collector of allCollectors) {
      const metrics = collector.getMetrics();
      if (metrics.length > 0) {
        result[collector.getName()] = metrics;
      }
    }

    return result;
  }

  private formatLabels(labels: MetricLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';

    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
      .join(',');
  }

  private escapeLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.startTime = Date.now();
    // Note: Individual metric values would need to be cleared
    // This is intentionally not implemented to preserve accumulated metrics
  }
}

// Global metrics instance
export const metrics = new MetricsRegistry();

// Re-export classes for custom metrics
export { Counter, Gauge, Histogram };
