/**
 * Metrics collection module for observability and monitoring.
 * Provides Prometheus-compatible metrics for task success rates, timing, and errors.
 */
// Default histogram buckets for duration metrics (in milliseconds)
const DEFAULT_DURATION_BUCKETS = [100, 500, 1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
class Counter {
    name;
    help;
    values = new Map();
    constructor(name, help) {
        this.name = name;
        this.help = help;
    }
    inc(labels = {}, value = 1) {
        const key = this.labelsToKey(labels);
        const current = this.values.get(key) || { value: 0, labels };
        current.value += value;
        this.values.set(key, current);
    }
    labelsToKey(labels) {
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
    getMetrics() {
        return Array.from(this.values.entries()).map(([_, data]) => ({
            name: this.name,
            help: this.help,
            type: 'counter',
            value: data.value,
            labels: data.labels,
        }));
    }
    getName() {
        return this.name;
    }
    getHelp() {
        return this.help;
    }
}
class Gauge {
    name;
    help;
    values = new Map();
    constructor(name, help) {
        this.name = name;
        this.help = help;
    }
    set(labels = {}, value) {
        const key = this.labelsToKey(labels);
        this.values.set(key, { value, labels });
    }
    inc(labels = {}, value = 1) {
        const key = this.labelsToKey(labels);
        const current = this.values.get(key) || { value: 0, labels };
        current.value += value;
        this.values.set(key, current);
    }
    dec(labels = {}, value = 1) {
        this.inc(labels, -value);
    }
    labelsToKey(labels) {
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
    getMetrics() {
        return Array.from(this.values.entries()).map(([_, data]) => ({
            name: this.name,
            help: this.help,
            type: 'gauge',
            value: data.value,
            labels: data.labels,
        }));
    }
    getName() {
        return this.name;
    }
    getHelp() {
        return this.help;
    }
}
class Histogram {
    name;
    help;
    bucketBoundaries;
    data = new Map();
    constructor(name, help, buckets = DEFAULT_DURATION_BUCKETS) {
        this.name = name;
        this.help = help;
        this.bucketBoundaries = [...buckets].sort((a, b) => a - b);
    }
    observe(labels = {}, value) {
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
    labelsToKey(labels) {
        return Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
    }
    getMetrics() {
        return Array.from(this.data.entries()).map(([_, data]) => {
            const buckets = this.bucketBoundaries.map((le, i) => ({
                le,
                count: data.buckets.slice(0, i + 1).reduce((a, b) => a + b, 0),
            }));
            buckets.push({
                le: '+Inf',
                count: data.count,
            });
            return {
                name: this.name,
                help: this.help,
                type: 'histogram',
                buckets,
                sum: data.sum,
                count: data.count,
                labels: data.labels,
            };
        });
    }
    getName() {
        return this.name;
    }
    getHelp() {
        return this.help;
    }
}
/**
 * MetricsRegistry collects and exports all metrics
 */
class MetricsRegistry {
    // Task metrics
    tasksTotal = new Counter('autonomous_dev_tasks_total', 'Total number of tasks processed');
    tasksSuccessTotal = new Counter('autonomous_dev_tasks_success_total', 'Total number of successfully completed tasks');
    tasksFailedTotal = new Counter('autonomous_dev_tasks_failed_total', 'Total number of failed tasks');
    taskDurationMs = new Histogram('autonomous_dev_task_duration_ms', 'Task execution duration in milliseconds');
    // Cycle metrics
    cyclesTotal = new Counter('autonomous_dev_cycles_total', 'Total number of daemon cycles executed');
    cycleTasksDiscovered = new Histogram('autonomous_dev_cycle_tasks_discovered', 'Number of tasks discovered per cycle', [0, 1, 2, 3, 5, 10, 20]);
    cycleDurationMs = new Histogram('autonomous_dev_cycle_duration_ms', 'Cycle duration in milliseconds');
    // Worker pool metrics
    workersActive = new Gauge('autonomous_dev_workers_active', 'Number of currently active workers');
    workersQueued = new Gauge('autonomous_dev_workers_queued', 'Number of tasks currently queued');
    // Build/evaluation metrics
    buildsTotal = new Counter('autonomous_dev_builds_total', 'Total number of builds executed');
    buildsSuccessTotal = new Counter('autonomous_dev_builds_success_total', 'Total number of successful builds');
    buildDurationMs = new Histogram('autonomous_dev_build_duration_ms', 'Build duration in milliseconds');
    testsTotal = new Counter('autonomous_dev_tests_total', 'Total number of test runs');
    testsSuccessTotal = new Counter('autonomous_dev_tests_success_total', 'Total number of successful test runs');
    testDurationMs = new Histogram('autonomous_dev_test_duration_ms', 'Test execution duration in milliseconds');
    // GitHub API metrics
    githubApiCallsTotal = new Counter('autonomous_dev_github_api_calls_total', 'Total number of GitHub API calls');
    githubApiErrorsTotal = new Counter('autonomous_dev_github_api_errors_total', 'Total number of GitHub API errors');
    prsCreatedTotal = new Counter('autonomous_dev_prs_created_total', 'Total number of PRs created');
    prsMergedTotal = new Counter('autonomous_dev_prs_merged_total', 'Total number of PRs merged');
    // Error tracking
    errorsTotal = new Counter('autonomous_dev_errors_total', 'Total number of errors by code and severity');
    // Health status
    healthStatus = new Gauge('autonomous_dev_health_status', 'Health status of the daemon (1 = healthy, 0 = unhealthy)');
    uptimeSeconds = new Gauge('autonomous_dev_uptime_seconds', 'Time since daemon started in seconds');
    // Claude API metrics
    claudeApiCallsTotal = new Counter('autonomous_dev_claude_api_calls_total', 'Total number of Claude API calls');
    claudeApiErrorsTotal = new Counter('autonomous_dev_claude_api_errors_total', 'Total number of Claude API errors');
    claudeToolUsageTotal = new Counter('autonomous_dev_claude_tool_usage_total', 'Total number of tool uses by Claude');
    // GitHub API timing metrics
    githubApiDurationMs = new Histogram('autonomous_dev_github_api_duration_ms', 'GitHub API call duration in milliseconds', [50, 100, 250, 500, 1000, 2500, 5000, 10000]);
    // Claude SDK timing metrics
    claudeApiDurationMs = new Histogram('autonomous_dev_claude_api_duration_ms', 'Claude API call duration in milliseconds', [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]);
    // Worker utilization metrics
    workerUtilization = new Gauge('autonomous_dev_worker_utilization', 'Worker utilization percentage (0-100)');
    workerTasksTotal = new Counter('autonomous_dev_worker_tasks_total', 'Total tasks processed by worker');
    // Memory metrics
    memoryUsageMb = new Gauge('autonomous_dev_memory_usage_mb', 'Current memory usage in megabytes');
    // Discovery metrics
    discoveryDurationMs = new Histogram('autonomous_dev_discovery_duration_ms', 'Task discovery duration in milliseconds');
    analysisCacheHits = new Counter('autonomous_dev_analysis_cache_hits_total', 'Number of analysis cache hits');
    analysisCacheMisses = new Counter('autonomous_dev_analysis_cache_misses_total', 'Number of analysis cache misses');
    // Circuit breaker metrics
    circuitBreakerState = new Gauge('autonomous_dev_circuit_breaker_state', 'Circuit breaker state (0=closed, 1=half_open, 2=open)');
    circuitBreakerSuccesses = new Counter('autonomous_dev_circuit_breaker_successes_total', 'Total successful requests through circuit breaker');
    circuitBreakerFailures = new Counter('autonomous_dev_circuit_breaker_failures_total', 'Total failed requests through circuit breaker');
    circuitBreakerStateChanges = new Counter('autonomous_dev_circuit_breaker_state_changes_total', 'Total circuit breaker state transitions');
    circuitBreakerRejections = new Counter('autonomous_dev_circuit_breaker_rejections_total', 'Total requests rejected by open circuit breaker');
    // Retry metrics
    retryAttemptsTotal = new Counter('autonomous_dev_retry_attempts_total', 'Total number of retry attempts by operation and status');
    retryDelayMs = new Histogram('autonomous_dev_retry_delay_ms', 'Retry delay distribution in milliseconds', [100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000]);
    retryExhaustedTotal = new Counter('autonomous_dev_retry_exhausted_total', 'Total number of operations that exhausted all retries');
    retrySuccessAfterRetryTotal = new Counter('autonomous_dev_retry_success_after_retry_total', 'Total number of operations that succeeded after at least one retry');
    retryTimeoutProgressionMs = new Histogram('autonomous_dev_retry_timeout_progression_ms', 'Progressive timeout values used in retries', [30000, 45000, 60000, 90000, 120000, 180000, 300000, 600000]);
    // Dead letter queue metrics
    dlqEntriesTotal = new Counter('autonomous_dev_dlq_entries_total', 'Total number of entries added to dead letter queue');
    dlqReprocessTotal = new Counter('autonomous_dev_dlq_reprocess_total', 'Total number of DLQ reprocess attempts');
    dlqEntriesCurrent = new Gauge('autonomous_dev_dlq_entries_current', 'Current number of entries in dead letter queue');
    // Rate limit metrics
    rateLimitHitsTotal = new Counter('autonomous_dev_rate_limit_hits_total', 'Total number of rate limit hits by service');
    rateLimitWaitMs = new Histogram('autonomous_dev_rate_limit_wait_ms', 'Time spent waiting for rate limits to reset', [1000, 5000, 10000, 30000, 60000, 120000, 300000]);
    rateLimitRemaining = new Gauge('autonomous_dev_rate_limit_remaining', 'Current remaining requests before rate limit');
    // Degradation metrics
    degradationState = new Gauge('autonomous_dev_degradation_state', 'Current degradation state (0=normal, 1=degraded)');
    degradationDurationMs = new Histogram('autonomous_dev_degradation_duration_ms', 'Duration of degradation periods in milliseconds', [5000, 10000, 30000, 60000, 120000, 300000, 600000]);
    // Correlation tracking for debugging
    correlationMetrics = new Map();
    startTime = Date.now();
    /**
     * Record a task completion
     */
    recordTaskCompletion(success, durationMs, labels) {
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
        }
        else {
            this.tasksFailedTotal.inc(baseLabels);
        }
    }
    /**
     * Record a cycle completion
     */
    recordCycleCompletion(tasksDiscovered, tasksCompleted, tasksFailed, durationMs, labels) {
        this.cyclesTotal.inc(labels);
        this.cycleTasksDiscovered.observe(labels, tasksDiscovered);
        this.cycleDurationMs.observe(labels, durationMs);
    }
    /**
     * Record a build result
     */
    recordBuild(success, durationMs, labels) {
        this.buildsTotal.inc(labels);
        this.buildDurationMs.observe(labels, durationMs);
        if (success) {
            this.buildsSuccessTotal.inc(labels);
        }
    }
    /**
     * Record a test result
     */
    recordTests(success, durationMs, labels) {
        this.testsTotal.inc(labels);
        this.testDurationMs.observe(labels, durationMs);
        if (success) {
            this.testsSuccessTotal.inc(labels);
        }
    }
    /**
     * Record an error with full context
     */
    recordError(context) {
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
    recordToolUsage(toolName, labels) {
        this.claudeToolUsageTotal.inc({
            tool: toolName,
            repository: labels.repository,
            worker_id: labels.workerId || 'unknown',
        });
    }
    /**
     * Update worker pool status
     */
    updateWorkerPoolStatus(active, queued) {
        this.workersActive.set({}, active);
        this.workersQueued.set({}, queued);
    }
    /**
     * Update health status
     */
    updateHealthStatus(healthy) {
        this.healthStatus.set({}, healthy ? 1 : 0);
        this.uptimeSeconds.set({}, Math.floor((Date.now() - this.startTime) / 1000));
    }
    /**
     * Record a GitHub API call with timing
     */
    recordGitHubApiCall(endpoint, method, success, durationMs, labels) {
        this.githubApiCallsTotal.inc({
            repository: labels.repository,
            endpoint,
            method,
        });
        this.githubApiDurationMs.observe({
            repository: labels.repository,
            endpoint,
            method,
            status: labels.statusCode?.toString() ?? 'unknown',
        }, durationMs);
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
    recordClaudeApiCall(operation, success, durationMs, labels) {
        this.claudeApiCallsTotal.inc({
            repository: labels.repository,
            operation,
        });
        this.claudeApiDurationMs.observe({
            repository: labels.repository,
            operation,
            worker_id: labels.workerId ?? 'unknown',
            success: String(success),
        }, durationMs);
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
    updateWorkerUtilization(activeWorkers, maxWorkers, queuedTasks) {
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
    recordWorkerTask(workerId, success, durationMs, labels) {
        this.workerTasksTotal.inc({
            worker_id: workerId,
            repository: labels.repository,
            success: String(success),
        });
        this.taskDurationMs.observe({
            worker_id: workerId,
            repository: labels.repository,
        }, durationMs);
    }
    /**
     * Update memory usage metrics
     */
    updateMemoryUsage(heapUsedMB) {
        this.memoryUsageMb.set({}, heapUsedMB);
    }
    /**
     * Record discovery operation
     */
    recordDiscovery(tasksFound, durationMs, cacheHit, labels) {
        this.discoveryDurationMs.observe(labels, durationMs);
        this.cycleTasksDiscovered.observe(labels, tasksFound);
        if (cacheHit) {
            this.analysisCacheHits.inc(labels);
        }
        else {
            this.analysisCacheMisses.inc(labels);
        }
    }
    /**
     * Record circuit breaker success
     */
    recordCircuitBreakerSuccess(name) {
        this.circuitBreakerSuccesses.inc({ circuit_name: name });
    }
    /**
     * Record circuit breaker failure
     */
    recordCircuitBreakerFailure(name, errorMessage) {
        this.circuitBreakerFailures.inc({
            circuit_name: name,
            error_type: this.categorizeCircuitBreakerError(errorMessage),
        });
    }
    /**
     * Record circuit breaker state change
     */
    recordCircuitBreakerStateChange(name, fromState, toState) {
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
    recordCircuitBreakerRejection(name) {
        this.circuitBreakerRejections.inc({ circuit_name: name });
    }
    /**
     * Record a retry attempt
     */
    recordRetryAttempt(operation, attempt, delayMs, success, labels) {
        this.retryAttemptsTotal.inc({
            operation,
            attempt: String(attempt),
            success: String(success),
            repository: labels.repository || 'unknown',
            error_type: labels.errorType || 'unknown',
        });
        this.retryDelayMs.observe({
            operation,
            repository: labels.repository || 'unknown',
        }, delayMs);
    }
    /**
     * Record when all retries are exhausted
     */
    recordRetryExhausted(operation, totalAttempts, totalDurationMs, labels) {
        this.retryExhaustedTotal.inc({
            operation,
            total_attempts: String(totalAttempts),
            repository: labels.repository || 'unknown',
            error_type: labels.errorType || 'unknown',
        });
    }
    /**
     * Record successful operation after retry
     */
    recordRetrySuccess(operation, attemptsTaken, totalDurationMs, labels) {
        this.retrySuccessAfterRetryTotal.inc({
            operation,
            attempts_taken: String(attemptsTaken),
            repository: labels.repository || 'unknown',
        });
    }
    /**
     * Record progressive timeout value
     */
    recordProgressiveTimeout(operation, timeoutMs, attempt, labels) {
        this.retryTimeoutProgressionMs.observe({
            operation,
            attempt: String(attempt),
            repository: labels.repository || 'unknown',
        }, timeoutMs);
    }
    /**
     * Record dead letter queue entry
     */
    recordDLQEntry(taskType, errorCode, labels) {
        this.dlqEntriesTotal.inc({
            task_type: taskType,
            error_code: errorCode,
            repository: labels.repository,
        });
    }
    /**
     * Update current DLQ entry count
     */
    updateDLQCount(count) {
        this.dlqEntriesCurrent.set({}, count);
    }
    /**
     * Record DLQ reprocess attempt
     */
    recordDLQReprocess(success, labels) {
        this.dlqReprocessTotal.inc({
            success: String(success),
            repository: labels.repository,
        });
    }
    /**
     * Record rate limit hit
     */
    recordRateLimitHit(service, waitMs, labels) {
        this.rateLimitHitsTotal.inc({
            service,
            repository: labels.repository || 'unknown',
        });
        this.rateLimitWaitMs.observe({
            service,
            repository: labels.repository || 'unknown',
        }, waitMs);
    }
    /**
     * Update rate limit remaining count
     */
    updateRateLimitRemaining(service, remaining) {
        this.rateLimitRemaining.set({ service }, remaining);
    }
    /**
     * Record degradation state change
     */
    recordDegradationState(isDegraded, durationMs) {
        this.degradationState.set({}, isDegraded ? 1 : 0);
        if (durationMs !== undefined && durationMs > 0) {
            this.degradationDurationMs.observe({}, durationMs);
        }
    }
    /**
     * Categorize error message for circuit breaker metrics
     */
    categorizeCircuitBreakerError(errorMessage) {
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
    startCorrelation(correlationId) {
        this.correlationMetrics.set(correlationId, {
            startTime: Date.now(),
            operations: [],
            errors: 0,
        });
    }
    /**
     * Record an operation for a correlation ID
     */
    recordCorrelationOperation(correlationId, operation) {
        const metrics = this.correlationMetrics.get(correlationId);
        if (metrics) {
            metrics.operations.push(operation);
        }
    }
    /**
     * Record an error for a correlation ID
     */
    recordCorrelationError(correlationId) {
        const metrics = this.correlationMetrics.get(correlationId);
        if (metrics) {
            metrics.errors++;
        }
    }
    /**
     * End tracking a correlation ID and return summary
     */
    endCorrelation(correlationId) {
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
    getCorrelationSummary(correlationId) {
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
    getPrometheusMetrics() {
        const lines = [];
        const processedMetrics = new Set();
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
            if (metrics.length === 0)
                continue;
            const name = collector.getName();
            if (!processedMetrics.has(name)) {
                lines.push(`# HELP ${name} ${collector.getHelp()}`);
                // Determine type
                const firstMetric = metrics[0];
                if ('buckets' in firstMetric) {
                    lines.push(`# TYPE ${name} histogram`);
                }
                else if (firstMetric.type === 'gauge') {
                    lines.push(`# TYPE ${name} gauge`);
                }
                else {
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
                }
                else {
                    // Counter or Gauge
                    if (labelsStr) {
                        lines.push(`${name}{${labelsStr}} ${metric.value}`);
                    }
                    else {
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
    getMetricsJson() {
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
        const result = {};
        for (const collector of allCollectors) {
            const metrics = collector.getMetrics();
            if (metrics.length > 0) {
                result[collector.getName()] = metrics;
            }
        }
        return result;
    }
    formatLabels(labels) {
        const entries = Object.entries(labels);
        if (entries.length === 0)
            return '';
        return entries
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
            .join(',');
    }
    escapeLabel(value) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    }
    /**
     * Reset all metrics (useful for testing)
     */
    reset() {
        this.startTime = Date.now();
        // Note: Individual metric values would need to be cleared
        // This is intentionally not implemented to preserve accumulated metrics
    }
}
// Global metrics instance
export const metrics = new MetricsRegistry();
// Re-export classes for custom metrics
export { Counter, Gauge, Histogram };
//# sourceMappingURL=metrics.js.map