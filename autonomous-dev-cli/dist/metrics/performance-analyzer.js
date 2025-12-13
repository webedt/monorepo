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
import { logger } from '../utils/logger.js';
/** Default configuration values */
const DEFAULT_CONFIG = {
    baselineSampleSize: 100,
    regressionThresholdPercent: 20,
    minSamplesForAnalysis: 10,
    autoUpdateBaseline: true,
    movingAverageWindow: 20,
    outlierStdDevMultiplier: 2.5,
};
/**
 * Performance regression analyzer
 * Tracks metrics over time and detects performance degradation
 */
export class PerformanceAnalyzer {
    config;
    baselines = new Map();
    samples = new Map();
    timestamps = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record a performance sample for a metric
     */
    recordSample(metricName, value) {
        if (!this.samples.has(metricName)) {
            this.samples.set(metricName, []);
            this.timestamps.set(metricName, []);
        }
        const samples = this.samples.get(metricName);
        const timestamps = this.timestamps.get(metricName);
        samples.push(value);
        timestamps.push(new Date());
        // Trim old samples to maintain window size
        const maxSamples = this.config.baselineSampleSize * 2;
        while (samples.length > maxSamples) {
            samples.shift();
            timestamps.shift();
        }
        // Auto-update baseline if enabled and we have enough samples
        if (this.config.autoUpdateBaseline && samples.length >= this.config.baselineSampleSize) {
            this.updateBaseline(metricName);
        }
    }
    /**
     * Record cycle duration for regression analysis
     */
    recordCycleDuration(durationMs) {
        this.recordSample('cycle_duration_ms', durationMs);
    }
    /**
     * Record task execution duration
     */
    recordTaskDuration(durationMs, taskType = 'default') {
        this.recordSample(`task_duration_${taskType}_ms`, durationMs);
        this.recordSample('task_duration_ms', durationMs);
    }
    /**
     * Record Claude API latency
     */
    recordClaudeLatency(durationMs) {
        this.recordSample('claude_api_latency_ms', durationMs);
    }
    /**
     * Record GitHub API latency
     */
    recordGitHubLatency(durationMs) {
        this.recordSample('github_api_latency_ms', durationMs);
    }
    /**
     * Update or create baseline for a metric
     */
    updateBaseline(metricName) {
        const samples = this.samples.get(metricName);
        if (!samples || samples.length < this.config.minSamplesForAnalysis) {
            return null;
        }
        // Use most recent samples for baseline
        const baselineSamples = samples.slice(-this.config.baselineSampleSize);
        const stats = this.calculateStatistics(baselineSamples);
        const baseline = {
            metricName,
            mean: stats.mean,
            stdDev: stats.stdDev,
            median: stats.median,
            p95: stats.p95,
            p99: stats.p99,
            sampleCount: baselineSamples.length,
            createdAt: this.baselines.get(metricName)?.createdAt ?? new Date(),
            updatedAt: new Date(),
        };
        this.baselines.set(metricName, baseline);
        logger.debug(`Updated baseline for ${metricName}`, {
            mean: baseline.mean.toFixed(2),
            stdDev: baseline.stdDev.toFixed(2),
            sampleCount: baseline.sampleCount,
        });
        return baseline;
    }
    /**
     * Get current performance snapshot for a metric
     */
    getSnapshot(metricName) {
        const samples = this.samples.get(metricName);
        const baseline = this.baselines.get(metricName);
        if (!samples || samples.length === 0) {
            return null;
        }
        const currentValue = samples[samples.length - 1];
        const movingAverage = this.calculateMovingAverage(samples);
        const baselineDiffPercent = baseline
            ? ((currentValue - baseline.mean) / baseline.mean) * 100
            : 0;
        const isOutlier = baseline
            ? Math.abs(currentValue - baseline.mean) > baseline.stdDev * this.config.outlierStdDevMultiplier
            : false;
        return {
            metricName,
            currentValue,
            movingAverage,
            timestamp: new Date(),
            baselineDiffPercent,
            isOutlier,
        };
    }
    /**
     * Detect regressions across all tracked metrics
     */
    detectRegressions() {
        const affectedMetrics = [];
        const recommendations = [];
        for (const [metricName, baseline] of this.baselines) {
            const snapshot = this.getSnapshot(metricName);
            if (!snapshot)
                continue;
            // Check for regression (value significantly higher than baseline)
            const regressionPercent = snapshot.baselineDiffPercent;
            const isRegression = regressionPercent > this.config.regressionThresholdPercent;
            if (isRegression) {
                affectedMetrics.push({
                    metricName,
                    currentValue: snapshot.currentValue,
                    baselineValue: baseline.mean,
                    regressionPercent,
                    message: `${metricName} is ${regressionPercent.toFixed(1)}% slower than baseline (${baseline.mean.toFixed(2)} → ${snapshot.currentValue.toFixed(2)})`,
                });
                // Generate recommendations based on metric type
                this.addRecommendations(metricName, regressionPercent, recommendations);
            }
        }
        // Determine overall severity
        let severity = 'none';
        if (affectedMetrics.length > 0) {
            const maxRegression = Math.max(...affectedMetrics.map(m => m.regressionPercent));
            severity = maxRegression > this.config.regressionThresholdPercent * 2 ? 'critical' : 'warning';
        }
        // Generate summary
        const summary = affectedMetrics.length === 0
            ? 'No performance regressions detected'
            : `Detected ${affectedMetrics.length} metric(s) with performance regression`;
        const result = {
            hasRegression: affectedMetrics.length > 0,
            severity,
            affectedMetrics,
            summary,
            analyzedAt: new Date(),
            recommendations: [...new Set(recommendations)], // Dedupe
        };
        // Log if regression detected
        if (result.hasRegression) {
            logger.warn('Performance regression detected', {
                severity,
                affectedCount: affectedMetrics.length,
                metrics: affectedMetrics.map(m => m.metricName),
            });
        }
        return result;
    }
    /**
     * Get all baselines
     */
    getBaselines() {
        return Array.from(this.baselines.values());
    }
    /**
     * Get baseline for a specific metric
     */
    getBaseline(metricName) {
        return this.baselines.get(metricName);
    }
    /**
     * Import baseline data (for persistence)
     */
    importBaselines(baselines) {
        for (const baseline of baselines) {
            this.baselines.set(baseline.metricName, {
                ...baseline,
                createdAt: new Date(baseline.createdAt),
                updatedAt: new Date(baseline.updatedAt),
            });
        }
        logger.info(`Imported ${baselines.length} performance baselines`);
    }
    /**
     * Export baselines for persistence
     */
    exportBaselines() {
        return this.getBaselines();
    }
    /**
     * Get performance report for dashboard
     */
    getPerformanceReport() {
        const snapshots = [];
        const trends = [];
        for (const metricName of this.samples.keys()) {
            const snapshot = this.getSnapshot(metricName);
            if (snapshot) {
                snapshots.push(snapshot);
            }
            const trend = this.analyzeTrend(metricName);
            if (trend) {
                trends.push({ metricName, trend });
            }
        }
        return {
            baselines: this.getBaselines(),
            snapshots,
            regressionAnalysis: this.detectRegressions(),
            trends,
        };
    }
    /**
     * Clear all collected data
     */
    reset() {
        this.baselines.clear();
        this.samples.clear();
        this.timestamps.clear();
        logger.info('Performance analyzer reset');
    }
    /**
     * Calculate statistics for a sample set
     */
    calculateStatistics(samples) {
        if (samples.length === 0) {
            return { mean: 0, stdDev: 0, median: 0, p95: 0, p99: 0 };
        }
        // Sort for percentile calculations
        const sorted = [...samples].sort((a, b) => a - b);
        // Mean
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        // Standard deviation
        const squaredDiffs = samples.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
        const stdDev = Math.sqrt(variance);
        // Percentiles
        const median = this.getPercentile(sorted, 50);
        const p95 = this.getPercentile(sorted, 95);
        const p99 = this.getPercentile(sorted, 99);
        return { mean, stdDev, median, p95, p99 };
    }
    /**
     * Get percentile value from sorted array
     */
    getPercentile(sorted, percentile) {
        const index = (percentile / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) {
            return sorted[lower];
        }
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    }
    /**
     * Calculate moving average for samples
     */
    calculateMovingAverage(samples) {
        const window = Math.min(this.config.movingAverageWindow, samples.length);
        const windowSamples = samples.slice(-window);
        return windowSamples.reduce((a, b) => a + b, 0) / windowSamples.length;
    }
    /**
     * Analyze trend for a metric
     */
    analyzeTrend(metricName) {
        const samples = this.samples.get(metricName);
        if (!samples || samples.length < this.config.minSamplesForAnalysis) {
            return null;
        }
        const halfPoint = Math.floor(samples.length / 2);
        const firstHalf = samples.slice(0, halfPoint);
        const secondHalf = samples.slice(halfPoint);
        const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        const changePercent = ((secondMean - firstMean) / firstMean) * 100;
        // For latency/duration metrics, lower is better
        if (changePercent < -10) {
            return 'improving';
        }
        else if (changePercent > 10) {
            return 'degrading';
        }
        return 'stable';
    }
    /**
     * Add metric-specific recommendations
     */
    addRecommendations(metricName, regressionPercent, recommendations) {
        if (metricName.includes('claude')) {
            recommendations.push('Check Claude API status and rate limits');
            recommendations.push('Consider increasing timeout values for Claude operations');
            if (regressionPercent > 50) {
                recommendations.push('Enable circuit breaker to prevent cascading failures');
            }
        }
        if (metricName.includes('github')) {
            recommendations.push('Check GitHub API rate limits');
            recommendations.push('Consider implementing request caching for GitHub API');
        }
        if (metricName.includes('cycle')) {
            recommendations.push('Review task complexity distribution for the cycle');
            recommendations.push('Check for resource contention between workers');
        }
        if (metricName.includes('task')) {
            recommendations.push('Review task selection criteria for complexity');
            recommendations.push('Consider reducing parallel worker count');
        }
        if (regressionPercent > 100) {
            recommendations.push('CRITICAL: Investigate recent code or configuration changes');
            recommendations.push('Consider pausing autonomous operations until investigated');
        }
    }
}
// Singleton instance for global usage
let performanceAnalyzerInstance = null;
/**
 * Get or create the global performance analyzer instance
 */
export function getPerformanceAnalyzer(config) {
    if (!performanceAnalyzerInstance) {
        performanceAnalyzerInstance = new PerformanceAnalyzer(config);
    }
    return performanceAnalyzerInstance;
}
/**
 * Reset the global performance analyzer instance
 */
export function resetPerformanceAnalyzer() {
    if (performanceAnalyzerInstance) {
        performanceAnalyzerInstance.reset();
    }
    performanceAnalyzerInstance = null;
}
//# sourceMappingURL=performance-analyzer.js.map