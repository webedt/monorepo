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
    readonly githubApiDurationMs: Histogram;
    readonly claudeApiDurationMs: Histogram;
    readonly workerUtilization: Gauge;
    readonly workerTasksTotal: Counter;
    readonly memoryUsageMb: Gauge;
    readonly discoveryDurationMs: Histogram;
    readonly analysisCacheHits: Counter;
    readonly analysisCacheMisses: Counter;
    readonly circuitBreakerState: Gauge;
    readonly circuitBreakerSuccesses: Counter;
    readonly circuitBreakerFailures: Counter;
    readonly circuitBreakerStateChanges: Counter;
    readonly circuitBreakerRejections: Counter;
    readonly retryAttemptsTotal: Counter;
    readonly retryDelayMs: Histogram;
    readonly retryExhaustedTotal: Counter;
    readonly retrySuccessAfterRetryTotal: Counter;
    readonly retryTimeoutProgressionMs: Histogram;
    readonly dlqEntriesTotal: Counter;
    readonly dlqReprocessTotal: Counter;
    readonly dlqEntriesCurrent: Gauge;
    readonly rateLimitHitsTotal: Counter;
    readonly rateLimitWaitMs: Histogram;
    readonly rateLimitRemaining: Gauge;
    readonly degradationState: Gauge;
    readonly degradationDurationMs: Histogram;
    private correlationMetrics;
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
     * Record a GitHub API call with timing
     */
    recordGitHubApiCall(endpoint: string, method: string, success: boolean, durationMs: number, labels: {
        repository: string;
        statusCode?: number;
    }): void;
    /**
     * Record a Claude SDK call with timing
     */
    recordClaudeApiCall(operation: string, success: boolean, durationMs: number, labels: {
        repository: string;
        workerId?: string;
    }): void;
    /**
     * Update worker utilization
     */
    updateWorkerUtilization(activeWorkers: number, maxWorkers: number, queuedTasks: number): void;
    /**
     * Record a worker task execution
     */
    recordWorkerTask(workerId: string, success: boolean, durationMs: number, labels: {
        repository: string;
        issueNumber?: number;
    }): void;
    /**
     * Update memory usage metrics
     */
    updateMemoryUsage(heapUsedMB: number): void;
    /**
     * Record discovery operation
     */
    recordDiscovery(tasksFound: number, durationMs: number, cacheHit: boolean, labels: {
        repository: string;
    }): void;
    /**
     * Record circuit breaker success
     */
    recordCircuitBreakerSuccess(name: string): void;
    /**
     * Record circuit breaker failure
     */
    recordCircuitBreakerFailure(name: string, errorMessage: string): void;
    /**
     * Record circuit breaker state change
     */
    recordCircuitBreakerStateChange(name: string, fromState: string, toState: string): void;
    /**
     * Record circuit breaker rejection (request blocked by open circuit)
     */
    recordCircuitBreakerRejection(name: string): void;
    /**
     * Record a retry attempt
     */
    recordRetryAttempt(operation: string, attempt: number, delayMs: number, success: boolean, labels: {
        repository?: string;
        errorType?: string;
    }): void;
    /**
     * Record when all retries are exhausted
     */
    recordRetryExhausted(operation: string, totalAttempts: number, totalDurationMs: number, labels: {
        repository?: string;
        errorType?: string;
    }): void;
    /**
     * Record successful operation after retry
     */
    recordRetrySuccess(operation: string, attemptsTaken: number, totalDurationMs: number, labels: {
        repository?: string;
    }): void;
    /**
     * Record progressive timeout value
     */
    recordProgressiveTimeout(operation: string, timeoutMs: number, attempt: number, labels: {
        repository?: string;
    }): void;
    /**
     * Record dead letter queue entry
     */
    recordDLQEntry(taskType: string, errorCode: string, labels: {
        repository: string;
    }): void;
    /**
     * Update current DLQ entry count
     */
    updateDLQCount(count: number): void;
    /**
     * Record DLQ reprocess attempt
     */
    recordDLQReprocess(success: boolean, labels: {
        repository: string;
    }): void;
    /**
     * Record rate limit hit
     */
    recordRateLimitHit(service: string, waitMs: number, labels: {
        repository?: string;
    }): void;
    /**
     * Update rate limit remaining count
     */
    updateRateLimitRemaining(service: string, remaining: number): void;
    /**
     * Record degradation state change
     */
    recordDegradationState(isDegraded: boolean, durationMs?: number): void;
    /**
     * Categorize error message for circuit breaker metrics
     */
    private categorizeCircuitBreakerError;
    /**
     * Start tracking a correlation ID
     */
    startCorrelation(correlationId: string): void;
    /**
     * Record an operation for a correlation ID
     */
    recordCorrelationOperation(correlationId: string, operation: string): void;
    /**
     * Record an error for a correlation ID
     */
    recordCorrelationError(correlationId: string): void;
    /**
     * End tracking a correlation ID and return summary
     */
    endCorrelation(correlationId: string): CorrelationSummary | null;
    /**
     * Get correlation metrics summary (for debugging)
     */
    getCorrelationSummary(correlationId: string): DetailedCorrelationSummary | null;
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