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
    dataPoints: {
        timestamp: Date;
        value: number;
    }[];
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
export declare class ComplexityMetrics {
    private tasks;
    private maxRecords;
    private distributions;
    private maxDistributions;
    constructor(options?: {
        maxRecords?: number;
        maxDistributions?: number;
    });
    /**
     * Record a task completion with complexity info
     */
    recordTask(taskId: string, complexity: ComplexityLevel, success: boolean, durationMs: number, metadata?: {
        issueNumber?: number;
        category?: string;
    }): void;
    /**
     * Get current complexity distribution
     */
    getDistribution(): ComplexityDistribution;
    /**
     * Capture distribution snapshot for trend analysis
     */
    captureDistributionSnapshot(): ComplexityDistribution;
    /**
     * Get detailed statistics
     */
    getStats(options?: {
        since?: Date;
        until?: Date;
    }): TaskComplexityStats;
    /**
     * Analyze complexity trends
     */
    analyzeTrends(): ComplexityTrend[];
    /**
     * Get success rate by complexity level
     */
    getSuccessRateByComplexity(): Record<ComplexityLevel, number>;
    /**
     * Get duration statistics by complexity level
     */
    getDurationByComplexity(): Record<ComplexityLevel, {
        avg: number;
        median: number;
        p95: number;
    }>;
    /**
     * Get dashboard-ready metrics
     */
    getDashboardMetrics(): {
        distribution: ComplexityDistribution;
        stats: TaskComplexityStats;
        successRates: Record<ComplexityLevel, number>;
        durations: Record<ComplexityLevel, {
            avg: number;
            median: number;
            p95: number;
        }>;
        trends: ComplexityTrend[];
        insights: string[];
    };
    /**
     * Export data for persistence
     */
    exportData(): {
        tasks: TaskRecord[];
        distributions: ComplexityDistribution[];
    };
    /**
     * Import data from persistence
     */
    importData(data: {
        tasks?: TaskRecord[];
        distributions?: ComplexityDistribution[];
    }): void;
    /**
     * Clear all data
     */
    reset(): void;
    /**
     * Get percentile from sorted array
     */
    private getPercentile;
    /**
     * Generate trend message
     */
    private generateTrendMessage;
    /**
     * Generate insights from stats
     */
    private generateInsights;
}
/**
 * Get or create the global complexity metrics instance
 */
export declare function getComplexityMetrics(): ComplexityMetrics;
/**
 * Reset the global complexity metrics instance
 */
export declare function resetComplexityMetrics(): void;
export {};
//# sourceMappingURL=complexity-metrics.d.ts.map