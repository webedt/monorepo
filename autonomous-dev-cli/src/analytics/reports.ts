/**
 * Monthly Report Generator
 *
 * Generates aggregated monthly analytics reports for trend analysis
 * and pattern effectiveness tracking.
 */

import { logger } from '../utils/logger.js';
import {
  getCycleMetrics,
  getTaskMetricsByCycle,
  upsertMonthlySummary,
  upsertPatternEffectiveness,
  getMonthlySummary,
  getTopPatterns,
  type CycleMetric,
  type TaskMetric,
  type MonthlySummaryType,
  type PatternEffectivenessType,
} from '../db/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Monthly report data structure
 */
export interface MonthlyReport {
  repository: string;
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;

  // Cycle metrics
  cycleMetrics: {
    totalCycles: number;
    avgDurationMs: number;
    maxDurationMs: number;
    minDurationMs: number;
    degradedCycleCount: number;
    avgErrorsPerCycle: number;
  };

  // Discovery metrics
  discoveryMetrics: {
    totalTasksDiscovered: number;
    discoverySuccessRate: number;
  };

  // Execution metrics
  executionMetrics: {
    totalTasksAttempted: number;
    totalTasksCompleted: number;
    totalTasksFailed: number;
    overallSuccessRate: number;
    successRateByCategory: Record<string, { attempted: number; completed: number; successRate: number }>;
    successRateByComplexity: Record<string, { attempted: number; completed: number; successRate: number }>;
  };

  // PR metrics
  prMetrics: {
    totalPrsCreated: number;
    totalPrsMerged: number;
    prMergeRate: number;
  };

  // Cost efficiency metrics
  costMetrics: {
    totalApiCalls: number;
    successfulImplementationsPerApiCall: number;
    avgApiCallsPerTask: number;
  };

  // Top performing patterns
  topPatterns: Array<{
    pattern: string;
    patternType: string;
    successRate: number;
    taskCount: number;
  }>;

  // Failure analysis
  failureAnalysis: {
    failureCategories: Record<string, { count: number; percentage: number; examples: string[] }>;
    commonErrors: Array<{ code: string; count: number; percentage: number }>;
  };

  // Trend indicators
  trends: {
    successRateTrend: number | null; // Positive = improvement
    efficiencyTrend: number | null;
    previousMonthSuccessRate: number | null;
    previousMonthEfficiency: number | null;
  };

  // Generated timestamp
  generatedAt: Date;
}

// ============================================================================
// Report Generator
// ============================================================================

/**
 * Generates monthly analytics reports
 */
export class MonthlyReportGenerator {
  private repository: string;

  constructor(repository: string) {
    this.repository = repository;
  }

  /**
   * Generate a monthly report for a specific month
   */
  async generateReport(year: number, month: number): Promise<MonthlyReport> {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

    logger.info('Generating monthly analytics report', {
      repository: this.repository,
      year,
      month,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });

    // Fetch cycle metrics for the month
    const cycles = await getCycleMetrics(this.repository, periodStart, periodEnd);

    // Fetch all task metrics for these cycles
    const allTasks: TaskMetric[] = [];
    for (const cycle of cycles) {
      const tasks = await getTaskMetricsByCycle(cycle.correlationId);
      allTasks.push(...tasks);
    }

    // Build the report
    const report = await this.buildReport(
      year,
      month,
      periodStart,
      periodEnd,
      cycles,
      allTasks
    );

    // Persist the summary for future queries
    await this.persistSummary(report);

    // Update pattern effectiveness
    await this.updatePatternEffectiveness(periodStart, periodEnd, allTasks);

    logger.info('Monthly report generated successfully', {
      repository: this.repository,
      year,
      month,
      totalCycles: report.cycleMetrics.totalCycles,
      overallSuccessRate: report.executionMetrics.overallSuccessRate.toFixed(1),
    });

    return report;
  }

  /**
   * Build the report from raw data
   */
  private async buildReport(
    year: number,
    month: number,
    periodStart: Date,
    periodEnd: Date,
    cycles: CycleMetric[],
    tasks: TaskMetric[]
  ): Promise<MonthlyReport> {
    // Cycle metrics
    const totalCycles = cycles.length;
    const durations = cycles.map((c) => c.durationMs);
    const avgDurationMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
    const minDurationMs = durations.length > 0 ? Math.min(...durations) : 0;
    const degradedCycleCount = cycles.filter((c) => c.degraded).length;
    const totalErrors = cycles.reduce((sum, c) => sum + c.errorCount, 0);
    const avgErrorsPerCycle = totalCycles > 0 ? totalErrors / totalCycles : 0;

    // Discovery metrics
    const totalTasksDiscovered = cycles.reduce((sum, c) => sum + c.tasksDiscovered, 0);
    const totalTasksFromDiscovery = cycles.reduce((sum, c) => sum + c.tasksFromDiscovery, 0);
    const discoverySuccessRate = totalTasksDiscovered > 0
      ? (totalTasksFromDiscovery / totalTasksDiscovered) * 100
      : 0;

    // Execution metrics
    const totalTasksAttempted = tasks.length;
    const totalTasksCompleted = tasks.filter((t) => t.outcome === 'success').length;
    const totalTasksFailed = tasks.filter((t) => t.outcome === 'failure').length;
    const overallSuccessRate = totalTasksAttempted > 0
      ? (totalTasksCompleted / totalTasksAttempted) * 100
      : 0;

    // Success rates by category
    const successRateByCategory = this.calculateSuccessRatesByGroup(
      tasks,
      (t) => t.category || 'other'
    );

    // Success rates by complexity
    const successRateByComplexity = this.calculateSuccessRatesByGroup(
      tasks,
      (t) => t.complexity || 'medium'
    );

    // PR metrics
    const totalPrsCreated = cycles.reduce((sum, c) => sum + c.prsCreated, 0);
    const totalPrsMerged = cycles.reduce((sum, c) => sum + c.prsMerged, 0);
    const prMergeRate = totalPrsCreated > 0 ? (totalPrsMerged / totalPrsCreated) * 100 : 0;

    // Cost efficiency metrics
    const totalApiCalls = cycles.reduce((sum, c) => sum + c.totalApiCalls, 0);
    const successfulImplementationsPerApiCall = totalApiCalls > 0
      ? totalTasksCompleted / totalApiCalls
      : 0;
    const avgApiCallsPerTask = totalTasksAttempted > 0
      ? totalApiCalls / totalTasksAttempted
      : 0;

    // Top patterns (will be populated after pattern analysis)
    const topPatterns = await this.getTopPatternsForReport();

    // Failure analysis
    const failureAnalysis = this.analyzeFailures(tasks);

    // Get previous month's summary for trend analysis
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const previousSummary = await getMonthlySummary(this.repository, prevYear, prevMonth);

    // Calculate trends
    const trends = this.calculateTrends(
      overallSuccessRate,
      successfulImplementationsPerApiCall,
      previousSummary
    );

    return {
      repository: this.repository,
      year,
      month,
      periodStart,
      periodEnd,
      cycleMetrics: {
        totalCycles,
        avgDurationMs,
        maxDurationMs,
        minDurationMs,
        degradedCycleCount,
        avgErrorsPerCycle,
      },
      discoveryMetrics: {
        totalTasksDiscovered,
        discoverySuccessRate,
      },
      executionMetrics: {
        totalTasksAttempted,
        totalTasksCompleted,
        totalTasksFailed,
        overallSuccessRate,
        successRateByCategory,
        successRateByComplexity,
      },
      prMetrics: {
        totalPrsCreated,
        totalPrsMerged,
        prMergeRate,
      },
      costMetrics: {
        totalApiCalls,
        successfulImplementationsPerApiCall,
        avgApiCallsPerTask,
      },
      topPatterns,
      failureAnalysis,
      trends,
      generatedAt: new Date(),
    };
  }

  /**
   * Calculate success rates grouped by a property
   */
  private calculateSuccessRatesByGroup(
    tasks: TaskMetric[],
    groupFn: (task: TaskMetric) => string
  ): Record<string, { attempted: number; completed: number; successRate: number }> {
    const groups: Record<string, { attempted: number; completed: number; successRate: number }> = {};

    for (const task of tasks) {
      const group = groupFn(task);
      if (!groups[group]) {
        groups[group] = { attempted: 0, completed: 0, successRate: 0 };
      }
      groups[group].attempted++;
      if (task.outcome === 'success') {
        groups[group].completed++;
      }
    }

    // Calculate success rates
    for (const group of Object.keys(groups)) {
      const { attempted, completed } = groups[group];
      groups[group].successRate = attempted > 0 ? (completed / attempted) * 100 : 0;
    }

    return groups;
  }

  /**
   * Analyze failure patterns
   */
  private analyzeFailures(tasks: TaskMetric[]): {
    failureCategories: Record<string, { count: number; percentage: number; examples: string[] }>;
    commonErrors: Array<{ code: string; count: number; percentage: number }>;
  } {
    const failedTasks = tasks.filter((t) => t.outcome === 'failure');
    const totalFailed = failedTasks.length;

    // Categorize failures by error code
    const errorCounts: Record<string, { count: number; examples: string[] }> = {};

    for (const task of failedTasks) {
      const errorCode = task.errorCode || 'UNKNOWN';
      if (!errorCounts[errorCode]) {
        errorCounts[errorCode] = { count: 0, examples: [] };
      }
      errorCounts[errorCode].count++;
      if (errorCounts[errorCode].examples.length < 3) {
        errorCounts[errorCode].examples.push(task.taskTitle);
      }
    }

    // Build failure categories
    const failureCategories: Record<string, { count: number; percentage: number; examples: string[] }> = {};
    for (const [code, data] of Object.entries(errorCounts)) {
      failureCategories[code] = {
        count: data.count,
        percentage: totalFailed > 0 ? (data.count / totalFailed) * 100 : 0,
        examples: data.examples,
      };
    }

    // Sort common errors by count
    const commonErrors = Object.entries(errorCounts)
      .map(([code, data]) => ({
        code,
        count: data.count,
        percentage: totalFailed > 0 ? (data.count / totalFailed) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { failureCategories, commonErrors };
  }

  /**
   * Calculate trend indicators compared to previous month
   */
  private calculateTrends(
    currentSuccessRate: number,
    currentEfficiency: number,
    previousSummary: MonthlySummaryType | null
  ): {
    successRateTrend: number | null;
    efficiencyTrend: number | null;
    previousMonthSuccessRate: number | null;
    previousMonthEfficiency: number | null;
  } {
    if (!previousSummary) {
      return {
        successRateTrend: null,
        efficiencyTrend: null,
        previousMonthSuccessRate: null,
        previousMonthEfficiency: null,
      };
    }

    const previousSuccessRate = previousSummary.overallSuccessRate ?? 0;
    const previousEfficiency = previousSummary.successfulImplementationsPerApiCall ?? 0;

    return {
      successRateTrend: currentSuccessRate - previousSuccessRate,
      efficiencyTrend: currentEfficiency - previousEfficiency,
      previousMonthSuccessRate: previousSuccessRate,
      previousMonthEfficiency: previousEfficiency,
    };
  }

  /**
   * Get top performing patterns for the report
   */
  private async getTopPatternsForReport(): Promise<
    Array<{ pattern: string; patternType: string; successRate: number; taskCount: number }>
  > {
    const patterns = await getTopPatterns(this.repository, 10);
    return patterns.map((p) => ({
      pattern: p.pattern,
      patternType: p.patternType,
      successRate: p.successRate,
      taskCount: p.totalTasks,
    }));
  }

  /**
   * Persist the monthly summary to database
   */
  private async persistSummary(report: MonthlyReport): Promise<void> {
    await upsertMonthlySummary({
      repository: report.repository,
      year: report.year,
      month: report.month,
      totalCycles: report.cycleMetrics.totalCycles,
      avgCycleDurationMs: report.cycleMetrics.avgDurationMs,
      maxCycleDurationMs: report.cycleMetrics.maxDurationMs,
      minCycleDurationMs: report.cycleMetrics.minDurationMs,
      totalTasksDiscovered: report.discoveryMetrics.totalTasksDiscovered,
      discoverySuccessRate: report.discoveryMetrics.discoverySuccessRate,
      totalTasksAttempted: report.executionMetrics.totalTasksAttempted,
      totalTasksCompleted: report.executionMetrics.totalTasksCompleted,
      totalTasksFailed: report.executionMetrics.totalTasksFailed,
      overallSuccessRate: report.executionMetrics.overallSuccessRate,
      totalPrsCreated: report.prMetrics.totalPrsCreated,
      totalPrsMerged: report.prMetrics.totalPrsMerged,
      prMergeRate: report.prMetrics.prMergeRate,
      totalApiCalls: report.costMetrics.totalApiCalls,
      successfulImplementationsPerApiCall: report.costMetrics.successfulImplementationsPerApiCall,
      avgApiCallsPerTask: report.costMetrics.avgApiCallsPerTask,
      successRateByCategory: report.executionMetrics.successRateByCategory,
      successRateByComplexity: report.executionMetrics.successRateByComplexity,
      topPatterns: report.topPatterns,
      failureCategories: report.failureAnalysis.failureCategories,
      successRateTrend: report.trends.successRateTrend,
      efficiencyTrend: report.trends.efficiencyTrend,
      degradedCycleCount: report.cycleMetrics.degradedCycleCount,
      avgErrorsPerCycle: report.cycleMetrics.avgErrorsPerCycle,
    });
  }

  /**
   * Update pattern effectiveness based on task results
   */
  private async updatePatternEffectiveness(
    periodStart: Date,
    periodEnd: Date,
    tasks: TaskMetric[]
  ): Promise<void> {
    // Extract patterns from affected paths
    const patternStats: Map<string, {
      patternType: string;
      total: number;
      successful: number;
      totalDuration: number;
      totalApiCalls: number;
      categoryBreakdown: Record<string, { total: number; successful: number }>;
      complexityBreakdown: Record<string, { total: number; successful: number }>;
      failureReasons: Record<string, number>;
    }> = new Map();

    for (const task of tasks) {
      const paths = task.affectedPaths || [];
      const patterns = this.extractPatterns(paths);

      for (const { pattern, patternType } of patterns) {
        if (!patternStats.has(pattern)) {
          patternStats.set(pattern, {
            patternType,
            total: 0,
            successful: 0,
            totalDuration: 0,
            totalApiCalls: 0,
            categoryBreakdown: {},
            complexityBreakdown: {},
            failureReasons: {},
          });
        }

        const stats = patternStats.get(pattern)!;
        stats.total++;

        if (task.outcome === 'success') {
          stats.successful++;
        } else if (task.errorCode) {
          stats.failureReasons[task.errorCode] = (stats.failureReasons[task.errorCode] || 0) + 1;
        }

        if (task.durationMs) {
          stats.totalDuration += task.durationMs;
        }

        stats.totalApiCalls += task.claudeApiCalls;

        // Category breakdown
        const category = task.category || 'other';
        if (!stats.categoryBreakdown[category]) {
          stats.categoryBreakdown[category] = { total: 0, successful: 0 };
        }
        stats.categoryBreakdown[category].total++;
        if (task.outcome === 'success') {
          stats.categoryBreakdown[category].successful++;
        }

        // Complexity breakdown
        const complexity = task.complexity || 'medium';
        if (!stats.complexityBreakdown[complexity]) {
          stats.complexityBreakdown[complexity] = { total: 0, successful: 0 };
        }
        stats.complexityBreakdown[complexity].total++;
        if (task.outcome === 'success') {
          stats.complexityBreakdown[complexity].successful++;
        }
      }
    }

    // Persist pattern effectiveness
    for (const [pattern, stats] of patternStats.entries()) {
      if (stats.total >= 2) { // Minimum sample size
        const categoryBreakdown: Record<string, { total: number; successful: number; successRate: number }> = {};
        for (const [cat, data] of Object.entries(stats.categoryBreakdown)) {
          categoryBreakdown[cat] = {
            ...data,
            successRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
          };
        }

        const complexityBreakdown: Record<string, { total: number; successful: number; successRate: number }> = {};
        for (const [comp, data] of Object.entries(stats.complexityBreakdown)) {
          complexityBreakdown[comp] = {
            ...data,
            successRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
          };
        }

        await upsertPatternEffectiveness({
          repository: this.repository,
          pattern,
          patternType: stats.patternType,
          periodStart,
          periodEnd,
          totalTasks: stats.total,
          successfulTasks: stats.successful,
          failedTasks: stats.total - stats.successful,
          successRate: (stats.successful / stats.total) * 100,
          avgDurationMs: stats.total > 0 ? stats.totalDuration / stats.total : null,
          avgApiCalls: stats.total > 0 ? stats.totalApiCalls / stats.total : null,
          categoryBreakdown,
          complexityBreakdown,
          failureReasons: stats.failureReasons,
        });
      }
    }
  }

  /**
   * Extract patterns from file paths
   */
  private extractPatterns(paths: string[]): Array<{ pattern: string; patternType: string }> {
    const patterns: Array<{ pattern: string; patternType: string }> = [];
    const seen = new Set<string>();

    for (const path of paths) {
      // Directory pattern (e.g., "src/utils")
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        patterns.push({ pattern: dir, patternType: 'directory' });
      }

      // File extension pattern (e.g., ".ts")
      const ext = path.match(/\.[a-z]+$/)?.[0];
      if (ext && !seen.has(ext)) {
        seen.add(ext);
        patterns.push({ pattern: ext, patternType: 'file_extension' });
      }

      // File pattern (e.g., "index.ts", "*.test.ts")
      const filename = path.split('/').pop();
      if (filename) {
        // Check for test files
        if (filename.includes('.test.') || filename.includes('.spec.')) {
          const testPattern = '*.test.*';
          if (!seen.has(testPattern)) {
            seen.add(testPattern);
            patterns.push({ pattern: testPattern, patternType: 'file_pattern' });
          }
        }
        // Check for index files
        if (filename.startsWith('index.')) {
          const indexPattern = 'index.*';
          if (!seen.has(indexPattern)) {
            seen.add(indexPattern);
            patterns.push({ pattern: indexPattern, patternType: 'file_pattern' });
          }
        }
      }
    }

    return patterns;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a monthly report generator instance
 */
export function createMonthlyReportGenerator(repository: string): MonthlyReportGenerator {
  return new MonthlyReportGenerator(repository);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate report for current month
 */
export async function generateCurrentMonthReport(repository: string): Promise<MonthlyReport> {
  const now = new Date();
  const generator = createMonthlyReportGenerator(repository);
  return generator.generateReport(now.getFullYear(), now.getMonth() + 1);
}

/**
 * Generate report for previous month
 */
export async function generatePreviousMonthReport(repository: string): Promise<MonthlyReport> {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth(); // Previous month (0-indexed)

  if (month === 0) {
    month = 12;
    year--;
  }

  const generator = createMonthlyReportGenerator(repository);
  return generator.generateReport(year, month);
}

/**
 * Format a monthly report as a text summary
 */
export function formatReportSummary(report: MonthlyReport): string {
  const lines: string[] = [
    `=== Monthly Analytics Report ===`,
    `Repository: ${report.repository}`,
    `Period: ${report.year}-${String(report.month).padStart(2, '0')}`,
    `Generated: ${report.generatedAt.toISOString()}`,
    ``,
    `--- Cycle Metrics ---`,
    `Total Cycles: ${report.cycleMetrics.totalCycles}`,
    `Avg Duration: ${(report.cycleMetrics.avgDurationMs / 1000).toFixed(1)}s`,
    `Degraded Cycles: ${report.cycleMetrics.degradedCycleCount}`,
    ``,
    `--- Task Execution ---`,
    `Tasks Attempted: ${report.executionMetrics.totalTasksAttempted}`,
    `Tasks Completed: ${report.executionMetrics.totalTasksCompleted}`,
    `Tasks Failed: ${report.executionMetrics.totalTasksFailed}`,
    `Success Rate: ${report.executionMetrics.overallSuccessRate.toFixed(1)}%`,
    ``,
    `--- PR Metrics ---`,
    `PRs Created: ${report.prMetrics.totalPrsCreated}`,
    `PRs Merged: ${report.prMetrics.totalPrsMerged}`,
    `Merge Rate: ${report.prMetrics.prMergeRate.toFixed(1)}%`,
    ``,
    `--- Cost Efficiency ---`,
    `Total API Calls: ${report.costMetrics.totalApiCalls}`,
    `Implementations per API Call: ${report.costMetrics.successfulImplementationsPerApiCall.toFixed(3)}`,
    ``,
    `--- Success by Category ---`,
  ];

  for (const [category, data] of Object.entries(report.executionMetrics.successRateByCategory)) {
    lines.push(`  ${category}: ${data.successRate.toFixed(1)}% (${data.completed}/${data.attempted})`);
  }

  lines.push(``);
  lines.push(`--- Success by Complexity ---`);
  for (const [complexity, data] of Object.entries(report.executionMetrics.successRateByComplexity)) {
    lines.push(`  ${complexity}: ${data.successRate.toFixed(1)}% (${data.completed}/${data.attempted})`);
  }

  if (report.trends.successRateTrend !== null) {
    lines.push(``);
    lines.push(`--- Trends (vs Previous Month) ---`);
    const trendSign = report.trends.successRateTrend >= 0 ? '+' : '';
    lines.push(`  Success Rate: ${trendSign}${report.trends.successRateTrend.toFixed(1)}%`);
    if (report.trends.efficiencyTrend !== null) {
      const effSign = report.trends.efficiencyTrend >= 0 ? '+' : '';
      lines.push(`  Efficiency: ${effSign}${report.trends.efficiencyTrend.toFixed(4)}`);
    }
  }

  if (report.topPatterns.length > 0) {
    lines.push(``);
    lines.push(`--- Top Performing Patterns ---`);
    for (const pattern of report.topPatterns.slice(0, 5)) {
      lines.push(`  ${pattern.pattern} (${pattern.patternType}): ${pattern.successRate.toFixed(1)}% (${pattern.taskCount} tasks)`);
    }
  }

  return lines.join('\n');
}
