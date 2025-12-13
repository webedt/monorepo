/**
 * Performance Regression Detection
 *
 * Analyzes metrics over time to detect performance regressions.
 * Supports:
 * - Baseline establishment from historical data
 * - Statistical analysis (mean, stddev, percentiles)
 * - Configurable regression thresholds
 * - Trend analysis over sliding windows
 */
/** Configuration for performance analysis */
export interface PerformanceAnalyzerConfig {
    /** Number of samples to use for baseline calculation (default: 100) */
    baselineSampleSize: number;
    /** Percentage threshold for regression detection (default: 20 = 20% slower) */
    regressionThresholdPercent: number;
    /** Minimum samples required before analysis is valid (default: 10) */
    minSamplesForAnalysis: number;
    /** Enable automatic baseline updates (default: true) */
    autoUpdateBaseline: boolean;
    /** Window size for moving average calculation (default: 20) */
    movingAverageWindow: number;
    /** Standard deviation multiplier for outlier detection (default: 2.5) */
    outlierStdDevMultiplier: number;
}
/** Performance baseline data */
export interface PerformanceBaseline {
    /** Metric name */
    metricName: string;
    /** Mean value */
    mean: number;
    /** Standard deviation */
    stdDev: number;
    /** Median value */
    median: number;
    /** 95th percentile */
    p95: number;
    /** 99th percentile */
    p99: number;
    /** Number of samples used */
    sampleCount: number;
    /** Timestamp of baseline creation */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
}
/** Current performance snapshot */
export interface PerformanceSnapshot {
    /** Metric name */
    metricName: string;
    /** Current value */
    currentValue: number;
    /** Moving average */
    movingAverage: number;
    /** Timestamp */
    timestamp: Date;
    /** Baseline comparison (percentage difference from baseline mean) */
    baselineDiffPercent: number;
    /** Whether current value is an outlier */
    isOutlier: boolean;
}
/** Result of regression detection analysis */
export interface RegressionDetectionResult {
    /** Whether a regression was detected */
    hasRegression: boolean;
    /** Severity: 'none' | 'warning' | 'critical' */
    severity: 'none' | 'warning' | 'critical';
    /** Affected metrics with regression */
    affectedMetrics: {
        metricName: string;
        currentValue: number;
        baselineValue: number;
        regressionPercent: number;
        message: string;
    }[];
    /** Summary message */
    summary: string;
    /** Analysis timestamp */
    analyzedAt: Date;
    /** Recommendations for addressing regressions */
    recommendations: string[];
}
/**
 * Performance regression analyzer
 * Tracks metrics over time and detects performance degradation
 */
export declare class PerformanceAnalyzer {
    private config;
    private baselines;
    private samples;
    private timestamps;
    constructor(config?: Partial<PerformanceAnalyzerConfig>);
    /**
     * Record a performance sample for a metric
     */
    recordSample(metricName: string, value: number): void;
    /**
     * Record cycle duration for regression analysis
     */
    recordCycleDuration(durationMs: number): void;
    /**
     * Record task execution duration
     */
    recordTaskDuration(durationMs: number, taskType?: string): void;
    /**
     * Record Claude API latency
     */
    recordClaudeLatency(durationMs: number): void;
    /**
     * Record GitHub API latency
     */
    recordGitHubLatency(durationMs: number): void;
    /**
     * Update or create baseline for a metric
     */
    updateBaseline(metricName: string): PerformanceBaseline | null;
    /**
     * Get current performance snapshot for a metric
     */
    getSnapshot(metricName: string): PerformanceSnapshot | null;
    /**
     * Detect regressions across all tracked metrics
     */
    detectRegressions(): RegressionDetectionResult;
    /**
     * Get all baselines
     */
    getBaselines(): PerformanceBaseline[];
    /**
     * Get baseline for a specific metric
     */
    getBaseline(metricName: string): PerformanceBaseline | undefined;
    /**
     * Import baseline data (for persistence)
     */
    importBaselines(baselines: PerformanceBaseline[]): void;
    /**
     * Export baselines for persistence
     */
    exportBaselines(): PerformanceBaseline[];
    /**
     * Get performance report for dashboard
     */
    getPerformanceReport(): {
        baselines: PerformanceBaseline[];
        snapshots: PerformanceSnapshot[];
        regressionAnalysis: RegressionDetectionResult;
        trends: {
            metricName: string;
            trend: 'improving' | 'stable' | 'degrading';
        }[];
    };
    /**
     * Clear all collected data
     */
    reset(): void;
    /**
     * Calculate statistics for a sample set
     */
    private calculateStatistics;
    /**
     * Get percentile value from sorted array
     */
    private getPercentile;
    /**
     * Calculate moving average for samples
     */
    private calculateMovingAverage;
    /**
     * Analyze trend for a metric
     */
    private analyzeTrend;
    /**
     * Add metric-specific recommendations
     */
    private addRecommendations;
}
/**
 * Get or create the global performance analyzer instance
 */
export declare function getPerformanceAnalyzer(config?: Partial<PerformanceAnalyzerConfig>): PerformanceAnalyzer;
/**
 * Reset the global performance analyzer instance
 */
export declare function resetPerformanceAnalyzer(): void;
//# sourceMappingURL=performance-analyzer.d.ts.map