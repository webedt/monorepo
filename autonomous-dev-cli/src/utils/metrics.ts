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
      this.prsCreatedTotal,
      this.prsMergedTotal,
      this.errorsTotal,
      this.healthStatus,
      this.uptimeSeconds,
      this.claudeApiCallsTotal,
      this.claudeApiErrorsTotal,
      this.claudeToolUsageTotal,
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
      this.prsCreatedTotal,
      this.prsMergedTotal,
      this.errorsTotal,
      this.healthStatus,
      this.uptimeSeconds,
      this.claudeApiCallsTotal,
      this.claudeApiErrorsTotal,
      this.claudeToolUsageTotal,
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
