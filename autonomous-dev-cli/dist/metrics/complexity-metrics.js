/**
 * Task Complexity Distribution Metrics
 *
 * Tracks and analyzes task complexity across the system.
 * Supports:
 * - Complexity classification (simple, moderate, complex)
 * - Distribution analysis over time
 * - Success rate correlation with complexity
 * - Trend analysis for workload planning
 */
import { logger } from '../utils/logger.js';
/**
 * Task complexity metrics collector
 */
export class ComplexityMetrics {
    tasks = [];
    maxRecords;
    distributions = [];
    maxDistributions;
    constructor(options = {}) {
        this.maxRecords = options.maxRecords ?? 10000;
        this.maxDistributions = options.maxDistributions ?? 1000;
    }
    /**
     * Record a task completion with complexity info
     */
    recordTask(taskId, complexity, success, durationMs, metadata) {
        const record = {
            taskId,
            complexity,
            success,
            durationMs,
            timestamp: new Date(),
            ...metadata,
        };
        this.tasks.push(record);
        // Trim old records
        if (this.tasks.length > this.maxRecords) {
            this.tasks = this.tasks.slice(-this.maxRecords);
        }
        logger.debug('Recorded task complexity', {
            taskId,
            complexity,
            success,
            durationMs,
        });
    }
    /**
     * Get current complexity distribution
     */
    getDistribution() {
        const distribution = {
            simple: 0,
            moderate: 0,
            complex: 0,
            unknown: 0,
        };
        for (const task of this.tasks) {
            distribution[task.complexity]++;
        }
        const total = this.tasks.length || 1; // Avoid division by zero
        const percentages = {
            simple: (distribution.simple / total) * 100,
            moderate: (distribution.moderate / total) * 100,
            complex: (distribution.complex / total) * 100,
            unknown: (distribution.unknown / total) * 100,
        };
        return {
            distribution,
            percentages,
            timestamp: new Date(),
            totalTasks: this.tasks.length,
        };
    }
    /**
     * Capture distribution snapshot for trend analysis
     */
    captureDistributionSnapshot() {
        const snapshot = this.getDistribution();
        this.distributions.push(snapshot);
        // Trim old snapshots
        if (this.distributions.length > this.maxDistributions) {
            this.distributions = this.distributions.slice(-this.maxDistributions);
        }
        return snapshot;
    }
    /**
     * Get detailed statistics
     */
    getStats(options) {
        let filteredTasks = this.tasks;
        if (options?.since) {
            filteredTasks = filteredTasks.filter(t => t.timestamp >= options.since);
        }
        if (options?.until) {
            filteredTasks = filteredTasks.filter(t => t.timestamp <= options.until);
        }
        const byLevel = new Map();
        const levels = ['simple', 'moderate', 'complex', 'unknown'];
        for (const level of levels) {
            const levelTasks = filteredTasks.filter(t => t.complexity === level);
            const successTasks = levelTasks.filter(t => t.success);
            const durations = levelTasks.map(t => t.durationMs).sort((a, b) => a - b);
            byLevel.set(level, {
                level,
                count: levelTasks.length,
                percentage: (levelTasks.length / (filteredTasks.length || 1)) * 100,
                successCount: successTasks.length,
                successRate: (successTasks.length / (levelTasks.length || 1)) * 100,
                avgDurationMs: durations.length > 0
                    ? durations.reduce((a, b) => a + b, 0) / durations.length
                    : 0,
                medianDurationMs: this.getPercentile(durations, 50),
                p95DurationMs: this.getPercentile(durations, 95),
            });
        }
        // Find most common level
        let mostCommonLevel = 'unknown';
        let maxCount = 0;
        for (const [level, stats] of byLevel) {
            if (stats.count > maxCount) {
                maxCount = stats.count;
                mostCommonLevel = level;
            }
        }
        // Calculate overall stats
        const successfulTasks = filteredTasks.filter(t => t.success);
        const allDurations = filteredTasks.map(t => t.durationMs);
        return {
            totalTasks: filteredTasks.length,
            byLevel,
            overallSuccessRate: (successfulTasks.length / (filteredTasks.length || 1)) * 100,
            avgDurationMs: allDurations.length > 0
                ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
                : 0,
            mostCommonLevel,
            periodStart: filteredTasks[0]?.timestamp ?? new Date(),
            periodEnd: filteredTasks[filteredTasks.length - 1]?.timestamp ?? new Date(),
        };
    }
    /**
     * Analyze complexity trends
     */
    analyzeTrends() {
        if (this.distributions.length < 2) {
            return [];
        }
        const trends = [];
        const levels = ['simple', 'moderate', 'complex'];
        for (const level of levels) {
            const dataPoints = this.distributions.map(d => ({
                timestamp: d.timestamp,
                value: d.percentages[level],
            }));
            // Calculate trend
            const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
            const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
            const firstAvg = firstHalf.reduce((a, b) => a + b.value, 0) / (firstHalf.length || 1);
            const secondAvg = secondHalf.reduce((a, b) => a + b.value, 0) / (secondHalf.length || 1);
            const changePercent = firstAvg > 0
                ? ((secondAvg - firstAvg) / firstAvg) * 100
                : 0;
            let direction = 'stable';
            if (changePercent > 10)
                direction = 'increasing';
            else if (changePercent < -10)
                direction = 'decreasing';
            trends.push({
                metric: `${level}_percentage`,
                direction,
                changePercent,
                message: this.generateTrendMessage(level, direction, changePercent),
                dataPoints: dataPoints.slice(-20), // Last 20 data points
            });
        }
        return trends;
    }
    /**
     * Get success rate by complexity level
     */
    getSuccessRateByComplexity() {
        const stats = this.getStats();
        const rates = {
            simple: 0,
            moderate: 0,
            complex: 0,
            unknown: 0,
        };
        for (const [level, levelStats] of stats.byLevel) {
            rates[level] = levelStats.successRate;
        }
        return rates;
    }
    /**
     * Get duration statistics by complexity level
     */
    getDurationByComplexity() {
        const stats = this.getStats();
        const durations = {
            simple: { avg: 0, median: 0, p95: 0 },
            moderate: { avg: 0, median: 0, p95: 0 },
            complex: { avg: 0, median: 0, p95: 0 },
            unknown: { avg: 0, median: 0, p95: 0 },
        };
        for (const [level, levelStats] of stats.byLevel) {
            durations[level] = {
                avg: levelStats.avgDurationMs,
                median: levelStats.medianDurationMs,
                p95: levelStats.p95DurationMs,
            };
        }
        return durations;
    }
    /**
     * Get dashboard-ready metrics
     */
    getDashboardMetrics() {
        const distribution = this.getDistribution();
        const stats = this.getStats();
        const successRates = this.getSuccessRateByComplexity();
        const durations = this.getDurationByComplexity();
        const trends = this.analyzeTrends();
        const insights = this.generateInsights(stats, successRates);
        return {
            distribution,
            stats,
            successRates,
            durations,
            trends,
            insights,
        };
    }
    /**
     * Export data for persistence
     */
    exportData() {
        return {
            tasks: this.tasks,
            distributions: this.distributions,
        };
    }
    /**
     * Import data from persistence
     */
    importData(data) {
        if (data.tasks) {
            this.tasks = data.tasks.map(t => ({
                ...t,
                timestamp: new Date(t.timestamp),
            }));
        }
        if (data.distributions) {
            this.distributions = data.distributions.map(d => ({
                ...d,
                timestamp: new Date(d.timestamp),
            }));
        }
        logger.info('Imported complexity metrics data', {
            tasks: this.tasks.length,
            distributions: this.distributions.length,
        });
    }
    /**
     * Clear all data
     */
    reset() {
        this.tasks = [];
        this.distributions = [];
        logger.info('Complexity metrics reset');
    }
    /**
     * Get percentile from sorted array
     */
    getPercentile(sorted, percentile) {
        if (sorted.length === 0)
            return 0;
        const index = (percentile / 100) * (sorted.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) {
            return sorted[lower];
        }
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
    }
    /**
     * Generate trend message
     */
    generateTrendMessage(level, direction, changePercent) {
        const changeStr = Math.abs(changePercent).toFixed(1);
        if (direction === 'stable') {
            return `${level} task percentage is stable`;
        }
        if (level === 'complex') {
            if (direction === 'increasing') {
                return `Complex task percentage increased by ${changeStr}% - consider scaling resources`;
            }
            return `Complex task percentage decreased by ${changeStr}%`;
        }
        if (level === 'simple') {
            if (direction === 'increasing') {
                return `Simple task percentage increased by ${changeStr}% - efficient quick wins`;
            }
            return `Simple task percentage decreased by ${changeStr}%`;
        }
        return `${level} task percentage ${direction} by ${changeStr}%`;
    }
    /**
     * Generate insights from stats
     */
    generateInsights(stats, successRates) {
        const insights = [];
        // Overall success rate insight
        if (stats.overallSuccessRate < 70) {
            insights.push(`Low overall success rate (${stats.overallSuccessRate.toFixed(1)}%) - review task selection`);
        }
        else if (stats.overallSuccessRate > 90) {
            insights.push(`Excellent success rate (${stats.overallSuccessRate.toFixed(1)}%)`);
        }
        // Complexity-specific insights
        if (successRates.complex < 50) {
            insights.push('Complex tasks have low success rate - consider additional validation');
        }
        if (successRates.simple > 95 && stats.byLevel.get('simple')?.count || 0 > 10) {
            insights.push('Simple tasks performing well - good candidate for automation');
        }
        // Distribution insights
        const complexPercentage = stats.byLevel.get('complex')?.percentage || 0;
        if (complexPercentage > 40) {
            insights.push('High proportion of complex tasks - consider increasing timeout limits');
        }
        const simplePercentage = stats.byLevel.get('simple')?.percentage || 0;
        if (simplePercentage < 10) {
            insights.push('Few simple tasks discovered - may indicate well-maintained codebase');
        }
        return insights;
    }
}
// Singleton instance
let complexityMetricsInstance = null;
/**
 * Get or create the global complexity metrics instance
 */
export function getComplexityMetrics() {
    if (!complexityMetricsInstance) {
        complexityMetricsInstance = new ComplexityMetrics();
    }
    return complexityMetricsInstance;
}
/**
 * Reset the global complexity metrics instance
 */
export function resetComplexityMetrics() {
    if (complexityMetricsInstance) {
        complexityMetricsInstance.reset();
    }
    complexityMetricsInstance = null;
}
//# sourceMappingURL=complexity-metrics.js.map