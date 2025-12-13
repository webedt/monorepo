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
declare class Counter {
    private name;
    private help;
    private values;
    constructor(name: string, help: string);
    inc(labels?: MetricLabels, value?: number): void;
    private labelsToKey;
    getMetrics(): CounterMetric[];
    getName(): string;
    getHelp(): string;
}
declare class Gauge {
    private name;
    private help;
    private values;
    constructor(name: string, help: string);
    set(labels: MetricLabels | undefined, value: number): void;
    inc(labels?: MetricLabels, value?: number): void;
    dec(labels?: MetricLabels, value?: number): void;
    private labelsToKey;
    getMetrics(): GaugeMetric[];
    getName(): string;
    getHelp(): string;
}
declare class Histogram {
    private name;
    private help;
    private bucketBoundaries;
    private data;
    constructor(name: string, help: string, buckets?: number[]);
    observe(labels: MetricLabels | undefined, value: number): void;
    private labelsToKey;
    getMetrics(): HistogramMetric[];
    getName(): string;
    getHelp(): string;
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
declare class MetricsRegistry {
    readonly tasksTotal: Counter;
    readonly tasksSuccessTotal: Counter;
    readonly tasksFailedTotal: Counter;
    readonly taskDurationMs: Histogram;
    readonly cyclesTotal: Counter;
    readonly cycleTasksDiscovered: Histogram;
    readonly cycleDurationMs: Histogram;
    readonly workersActive: Gauge;
    readonly workersQueued: Gauge;
    readonly buildsTotal: Counter;
    readonly buildsSuccessTotal: Counter;
    readonly buildDurationMs: Histogram;
    readonly testsTotal: Counter;
    readonly testsSuccessTotal: Counter;
    readonly testDurationMs: Histogram;
    readonly githubApiCallsTotal: Counter;
    readonly githubApiErrorsTotal: Counter;
    readonly prsCreatedTotal: Counter;
    readonly prsMergedTotal: Counter;
    readonly errorsTotal: Counter;
    readonly healthStatus: Gauge;
    readonly uptimeSeconds: Gauge;
    readonly claudeApiCallsTotal: Counter;
    readonly claudeApiErrorsTotal: Counter;
    readonly claudeToolUsageTotal: Counter;
    readonly cleanupOperationsTotal: Counter;
    readonly cleanupFailuresTotal: Counter;
    readonly cleanupDurationMs: Histogram;
    readonly cleanupBytesFreed: Counter;
    readonly orphanedWorkspacesFound: Counter;
    readonly orphanedWorkspacesCleaned: Counter;
    readonly deferredCleanupQueueSize: Gauge;
    private startTime;
    /**
     * Record a task completion
     */
    recordTaskCompletion(success: boolean, durationMs: number, labels: {
        repository: string;
        taskType?: string;
        workerId?: string;
    }): void;
    /**
     * Record a cycle completion
     */
    recordCycleCompletion(tasksDiscovered: number, tasksCompleted: number, tasksFailed: number, durationMs: number, labels: {
        repository: string;
    }): void;
    /**
     * Record a build result
     */
    recordBuild(success: boolean, durationMs: number, labels: {
        repository: string;
    }): void;
    /**
     * Record a test result
     */
    recordTests(success: boolean, durationMs: number, labels: {
        repository: string;
    }): void;
    /**
     * Record an error with full context
     */
    recordError(context: ErrorContext): void;
    /**
     * Record Claude tool usage
     */
    recordToolUsage(toolName: string, labels: {
        repository: string;
        workerId?: string;
    }): void;
    /**
     * Update worker pool status
     */
    updateWorkerPoolStatus(active: number, queued: number): void;
    /**
     * Update health status
     */
    updateHealthStatus(healthy: boolean): void;
    /**
     * Get all metrics in Prometheus format
     */
    getPrometheusMetrics(): string;
    /**
     * Get metrics as JSON for API response
     */
    getMetricsJson(): Record<string, any>;
    private formatLabels;
    private escapeLabel;
    /**
     * Reset all metrics (useful for testing)
     */
    reset(): void;
}
export declare const metrics: MetricsRegistry;
export { Counter, Gauge, Histogram };
//# sourceMappingURL=metrics.d.ts.map