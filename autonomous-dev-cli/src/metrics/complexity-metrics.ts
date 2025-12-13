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

/** Task complexity levels */
export type ComplexityLevel = 'simple' | 'moderate' | 'complex' | 'unknown';

/** Statistics for a single complexity level */
export interface ComplexityLevelStats {
  /** Complexity level */
  level: ComplexityLevel;
  /** Total tasks at this complexity */
  count: number;
  /** Percentage of total tasks */
  percentage: number;
  /** Number of successful tasks */
  successCount: number;
  /** Success rate percentage */
  successRate: number;
  /** Average duration in milliseconds */
  avgDurationMs: number;
  /** Median duration in milliseconds */
  medianDurationMs: number;
  /** 95th percentile duration */
  p95DurationMs: number;
}

/** Task complexity statistics */
export interface TaskComplexityStats {
  /** Total tasks tracked */
  totalTasks: number;
  /** Stats by complexity level */
  byLevel: Map<ComplexityLevel, ComplexityLevelStats>;
  /** Overall success rate */
  overallSuccessRate: number;
  /** Average task duration */
  avgDurationMs: number;
  /** Most common complexity level */
  mostCommonLevel: ComplexityLevel;
  /** Time period start */
  periodStart: Date;
  /** Time period end */
  periodEnd: Date;
}

/** Complexity distribution snapshot */
export interface ComplexityDistribution {
  /** Distribution data by level */
  distribution: Record<ComplexityLevel, number>;
  /** Distribution as percentages */
  percentages: Record<ComplexityLevel, number>;
  /** Timestamp of snapshot */
  timestamp: Date;
  /** Total tasks in snapshot */
  totalTasks: number;
}

/** Complexity trend over time */
export interface ComplexityTrend {
  /** Metric being trended (e.g., 'complex_percentage') */
  metric: string;
  /** Trend direction */
  direction: 'increasing' | 'stable' | 'decreasing';
  /** Change percentage */
  changePercent: number;
  /** Analysis message */
  message: string;
  /** Recent data points */
  dataPoints: { timestamp: Date; value: number }[];
}

/** Individual task record */
interface TaskRecord {
  taskId: string;
  complexity: ComplexityLevel;
  success: boolean;
  durationMs: number;
  timestamp: Date;
  issueNumber?: number;
  category?: string;
}

/**
 * Task complexity metrics collector
 */
export class ComplexityMetrics {
  private tasks: TaskRecord[] = [];
  private maxRecords: number;
  private distributions: ComplexityDistribution[] = [];
  private maxDistributions: number;

  constructor(options: { maxRecords?: number; maxDistributions?: number } = {}) {
    this.maxRecords = options.maxRecords ?? 10000;
    this.maxDistributions = options.maxDistributions ?? 1000;
  }

  /**
   * Record a task completion with complexity info
   */
  recordTask(
    taskId: string,
    complexity: ComplexityLevel,
    success: boolean,
    durationMs: number,
    metadata?: { issueNumber?: number; category?: string }
  ): void {
    const record: TaskRecord = {
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
  getDistribution(): ComplexityDistribution {
    const distribution: Record<ComplexityLevel, number> = {
      simple: 0,
      moderate: 0,
      complex: 0,
      unknown: 0,
    };

    for (const task of this.tasks) {
      distribution[task.complexity]++;
    }

    const total = this.tasks.length || 1; // Avoid division by zero
    const percentages: Record<ComplexityLevel, number> = {
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
  captureDistributionSnapshot(): ComplexityDistribution {
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
  getStats(options?: { since?: Date; until?: Date }): TaskComplexityStats {
    let filteredTasks = this.tasks;

    if (options?.since) {
      filteredTasks = filteredTasks.filter(t => t.timestamp >= options.since!);
    }
    if (options?.until) {
      filteredTasks = filteredTasks.filter(t => t.timestamp <= options.until!);
    }

    const byLevel = new Map<ComplexityLevel, ComplexityLevelStats>();
    const levels: ComplexityLevel[] = ['simple', 'moderate', 'complex', 'unknown'];

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
    let mostCommonLevel: ComplexityLevel = 'unknown';
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
  analyzeTrends(): ComplexityTrend[] {
    if (this.distributions.length < 2) {
      return [];
    }

    const trends: ComplexityTrend[] = [];
    const levels: ComplexityLevel[] = ['simple', 'moderate', 'complex'];

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

      let direction: ComplexityTrend['direction'] = 'stable';
      if (changePercent > 10) direction = 'increasing';
      else if (changePercent < -10) direction = 'decreasing';

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
  getSuccessRateByComplexity(): Record<ComplexityLevel, number> {
    const stats = this.getStats();
    const rates: Record<ComplexityLevel, number> = {
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
  getDurationByComplexity(): Record<ComplexityLevel, { avg: number; median: number; p95: number }> {
    const stats = this.getStats();
    const durations: Record<ComplexityLevel, { avg: number; median: number; p95: number }> = {
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
  getDashboardMetrics(): {
    distribution: ComplexityDistribution;
    stats: TaskComplexityStats;
    successRates: Record<ComplexityLevel, number>;
    durations: Record<ComplexityLevel, { avg: number; median: number; p95: number }>;
    trends: ComplexityTrend[];
    insights: string[];
  } {
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
  exportData(): { tasks: TaskRecord[]; distributions: ComplexityDistribution[] } {
    return {
      tasks: this.tasks,
      distributions: this.distributions,
    };
  }

  /**
   * Import data from persistence
   */
  importData(data: { tasks?: TaskRecord[]; distributions?: ComplexityDistribution[] }): void {
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
  reset(): void {
    this.tasks = [];
    this.distributions = [];
    logger.info('Complexity metrics reset');
  }

  /**
   * Get percentile from sorted array
   */
  private getPercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;

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
  private generateTrendMessage(
    level: ComplexityLevel,
    direction: ComplexityTrend['direction'],
    changePercent: number
  ): string {
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
  private generateInsights(
    stats: TaskComplexityStats,
    successRates: Record<ComplexityLevel, number>
  ): string[] {
    const insights: string[] = [];

    // Overall success rate insight
    if (stats.overallSuccessRate < 70) {
      insights.push(`Low overall success rate (${stats.overallSuccessRate.toFixed(1)}%) - review task selection`);
    } else if (stats.overallSuccessRate > 90) {
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
let complexityMetricsInstance: ComplexityMetrics | null = null;

/**
 * Get or create the global complexity metrics instance
 */
export function getComplexityMetrics(): ComplexityMetrics {
  if (!complexityMetricsInstance) {
    complexityMetricsInstance = new ComplexityMetrics();
  }
  return complexityMetricsInstance;
}

/**
 * Reset the global complexity metrics instance
 */
export function resetComplexityMetrics(): void {
  if (complexityMetricsInstance) {
    complexityMetricsInstance.reset();
  }
  complexityMetricsInstance = null;
}
