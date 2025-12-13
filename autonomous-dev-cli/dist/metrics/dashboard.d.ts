/**
 * Metrics Dashboard
 *
 * Provides dashboard-ready metrics aggregation and formatting.
 * Supports:
 * - Pipeline stage timing breakdowns
 * - Aggregated cycle and task metrics
 * - Worker utilization statistics
 * - Export in multiple formats (JSON, Prometheus)
 */
/** Pipeline stage metrics */
export interface PipelineStageMetrics {
    /** Stage name */
    stage: string;
    /** Average duration in milliseconds */
    avgDurationMs: number;
    /** Median duration */
    medianDurationMs: number;
    /** 95th percentile duration */
    p95DurationMs: number;
    /** Success rate percentage */
    successRate: number;
    /** Total executions */
    totalExecutions: number;
    /** Error count */
    errorCount: number;
}
/** Worker utilization metrics */
export interface WorkerUtilizationMetrics {
    /** Total workers configured */
    totalWorkers: number;
    /** Currently active workers */
    activeWorkers: number;
    /** Utilization percentage */
    utilizationPercent: number;
    /** Average tasks per worker */
    avgTasksPerWorker: number;
    /** Total tasks processed */
    totalTasksProcessed: number;
    /** Queued tasks */
    queuedTasks: number;
}
/** Cycle metrics summary */
export interface CycleMetricsSummary {
    /** Total cycles executed */
    totalCycles: number;
    /** Successful cycles */
    successfulCycles: number;
    /** Success rate percentage */
    successRate: number;
    /** Average cycle duration */
    avgDurationMs: number;
    /** Average tasks per cycle */
    avgTasksPerCycle: number;
    /** Cycles per hour rate */
    cyclesPerHour: number;
}
/** Dashboard configuration */
export interface DashboardConfig {
    /** Include detailed timing breakdowns */
    includeTimingDetails: boolean;
    /** Include performance regression analysis */
    includeRegressionAnalysis: boolean;
    /** Include complexity distribution */
    includeComplexityDistribution: boolean;
    /** Include active alerts */
    includeAlerts: boolean;
    /** Time window for metrics (ms) */
    timeWindowMs: number;
}
/** Complete dashboard metrics */
export interface DashboardMetrics {
    /** Dashboard generation timestamp */
    timestamp: string;
    /** System uptime in seconds */
    uptimeSeconds: number;
    /** Overall system health status */
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    /** Pipeline stage metrics */
    pipelineStages: PipelineStageMetrics[];
    /** Worker utilization */
    workerUtilization: WorkerUtilizationMetrics;
    /** Cycle metrics summary */
    cycles: CycleMetricsSummary;
    /** Task metrics summary */
    tasks: {
        total: number;
        succeeded: number;
        failed: number;
        successRate: number;
        avgDurationMs: number;
    };
    /** Error summary */
    errors: {
        total: number;
        byType: Record<string, number>;
        recentErrors: number;
    };
    /** API metrics */
    apiMetrics: {
        github: {
            calls: number;
            errors: number;
            avgLatencyMs: number;
        };
        claude: {
            calls: number;
            errors: number;
            avgLatencyMs: number;
        };
    };
    /** Performance regression analysis */
    performance?: {
        hasRegression: boolean;
        severity: 'none' | 'warning' | 'critical';
        affectedMetrics: string[];
    };
    /** Task complexity distribution */
    complexity?: {
        distribution: Record<string, number>;
        successRates: Record<string, number>;
    };
    /** Active alerts */
    alerts?: {
        activeCount: number;
        bySeverity: Record<string, number>;
        criticalAlerts: string[];
    };
}
/**
 * Metrics dashboard for monitoring
 */
export declare class MetricsDashboard {
    private config;
    private startTime;
    private pipelineMetrics;
    constructor(config?: Partial<DashboardConfig>);
    /**
     * Record pipeline stage execution
     */
    recordPipelineStage(stage: string, durationMs: number, success: boolean): void;
    /**
     * Get pipeline stage metrics
     */
    getPipelineStageMetrics(): PipelineStageMetrics[];
    /**
     * Get complete dashboard metrics
     */
    getDashboardMetrics(): DashboardMetrics;
    /**
     * Get dashboard metrics in Prometheus format
     */
    getPrometheusFormat(): string;
    /**
     * Get dashboard metrics as JSON string
     */
    getJsonFormat(): string;
    /**
     * Reset all dashboard metrics
     */
    reset(): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<DashboardConfig>): void;
    /**
     * Determine overall health status
     */
    private determineHealthStatus;
    /**
     * Get worker utilization metrics
     */
    private getWorkerUtilization;
    /**
     * Get cycle metrics summary
     */
    private getCycleMetrics;
    /**
     * Get task metrics summary
     */
    private getTaskMetrics;
    /**
     * Get error metrics summary
     */
    private getErrorMetrics;
    /**
     * Get API metrics summary
     */
    private getApiMetrics;
    /**
     * Get performance regression analysis
     */
    private getPerformanceAnalysis;
    /**
     * Get complexity distribution
     */
    private getComplexityDistribution;
    /**
     * Get alert summary
     */
    private getAlertSummary;
    /**
     * Extract metric value from JSON
     */
    private extractMetricValue;
    /**
     * Extract histogram mean from JSON
     */
    private extractHistogramMean;
    /**
     * Get percentile from sorted array
     */
    private getPercentile;
}
/**
 * Get or create the global dashboard instance
 */
export declare function getMetricsDashboard(config?: Partial<DashboardConfig>): MetricsDashboard;
/**
 * Reset the global dashboard instance
 */
export declare function resetMetricsDashboard(): void;
//# sourceMappingURL=dashboard.d.ts.map