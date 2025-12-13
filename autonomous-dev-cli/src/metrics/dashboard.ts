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

import { metrics } from '../utils/metrics.js';
import { logger } from '../utils/logger.js';
import { getPerformanceAnalyzer } from './performance-analyzer.js';
import { getComplexityMetrics } from './complexity-metrics.js';
import { getAlertingSystem } from './alerting.js';

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
    github: { calls: number; errors: number; avgLatencyMs: number };
    claude: { calls: number; errors: number; avgLatencyMs: number };
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

/** Default dashboard configuration */
const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  includeTimingDetails: true,
  includeRegressionAnalysis: true,
  includeComplexityDistribution: true,
  includeAlerts: true,
  timeWindowMs: 3600000, // 1 hour
};

/**
 * Metrics dashboard for monitoring
 */
export class MetricsDashboard {
  private config: DashboardConfig;
  private startTime: Date;
  private pipelineMetrics: Map<string, { durations: number[]; successes: number; failures: number }> = new Map();

  constructor(config: Partial<DashboardConfig> = {}) {
    this.config = { ...DEFAULT_DASHBOARD_CONFIG, ...config };
    this.startTime = new Date();
  }

  /**
   * Record pipeline stage execution
   */
  recordPipelineStage(stage: string, durationMs: number, success: boolean): void {
    if (!this.pipelineMetrics.has(stage)) {
      this.pipelineMetrics.set(stage, { durations: [], successes: 0, failures: 0 });
    }

    const stageMetrics = this.pipelineMetrics.get(stage)!;
    stageMetrics.durations.push(durationMs);

    // Trim old data (keep last 1000 entries)
    if (stageMetrics.durations.length > 1000) {
      stageMetrics.durations = stageMetrics.durations.slice(-1000);
    }

    if (success) {
      stageMetrics.successes++;
    } else {
      stageMetrics.failures++;
    }

    // Record to performance analyzer
    const analyzer = getPerformanceAnalyzer();
    analyzer.recordSample(`pipeline_${stage}_duration_ms`, durationMs);
  }

  /**
   * Get pipeline stage metrics
   */
  getPipelineStageMetrics(): PipelineStageMetrics[] {
    const stages: PipelineStageMetrics[] = [];

    for (const [stage, data] of this.pipelineMetrics) {
      const durations = [...data.durations].sort((a, b) => a - b);
      const total = data.successes + data.failures;

      stages.push({
        stage,
        avgDurationMs: durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0,
        medianDurationMs: this.getPercentile(durations, 50),
        p95DurationMs: this.getPercentile(durations, 95),
        successRate: total > 0 ? (data.successes / total) * 100 : 0,
        totalExecutions: total,
        errorCount: data.failures,
      });
    }

    // Sort by stage name for consistent ordering
    return stages.sort((a, b) => a.stage.localeCompare(b.stage));
  }

  /**
   * Get complete dashboard metrics
   */
  getDashboardMetrics(): DashboardMetrics {
    const metricsJson = metrics.getMetricsJson();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime.getTime()) / 1000);

    // Determine health status
    const healthStatus = this.determineHealthStatus(metricsJson);

    // Build dashboard metrics
    const dashboard: DashboardMetrics = {
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      healthStatus,
      pipelineStages: this.getPipelineStageMetrics(),
      workerUtilization: this.getWorkerUtilization(metricsJson),
      cycles: this.getCycleMetrics(metricsJson),
      tasks: this.getTaskMetrics(metricsJson),
      errors: this.getErrorMetrics(metricsJson),
      apiMetrics: this.getApiMetrics(metricsJson),
    };

    // Add optional sections
    if (this.config.includeRegressionAnalysis) {
      dashboard.performance = this.getPerformanceAnalysis();
    }

    if (this.config.includeComplexityDistribution) {
      dashboard.complexity = this.getComplexityDistribution();
    }

    if (this.config.includeAlerts) {
      dashboard.alerts = this.getAlertSummary();
    }

    return dashboard;
  }

  /**
   * Get dashboard metrics in Prometheus format
   */
  getPrometheusFormat(): string {
    const dashboard = this.getDashboardMetrics();
    const lines: string[] = [];

    // Add custom dashboard metrics
    lines.push('# HELP autonomous_dev_dashboard_uptime_seconds System uptime in seconds');
    lines.push('# TYPE autonomous_dev_dashboard_uptime_seconds gauge');
    lines.push(`autonomous_dev_dashboard_uptime_seconds ${dashboard.uptimeSeconds}`);

    lines.push('# HELP autonomous_dev_dashboard_health_status System health status (1=healthy, 0.5=degraded, 0=unhealthy)');
    lines.push('# TYPE autonomous_dev_dashboard_health_status gauge');
    const healthValue = dashboard.healthStatus === 'healthy' ? 1 : dashboard.healthStatus === 'degraded' ? 0.5 : 0;
    lines.push(`autonomous_dev_dashboard_health_status ${healthValue}`);

    // Pipeline stage metrics
    lines.push('# HELP autonomous_dev_pipeline_stage_duration_avg_ms Average pipeline stage duration');
    lines.push('# TYPE autonomous_dev_pipeline_stage_duration_avg_ms gauge');
    for (const stage of dashboard.pipelineStages) {
      lines.push(`autonomous_dev_pipeline_stage_duration_avg_ms{stage="${stage.stage}"} ${stage.avgDurationMs.toFixed(2)}`);
    }

    lines.push('# HELP autonomous_dev_pipeline_stage_success_rate Stage success rate percentage');
    lines.push('# TYPE autonomous_dev_pipeline_stage_success_rate gauge');
    for (const stage of dashboard.pipelineStages) {
      lines.push(`autonomous_dev_pipeline_stage_success_rate{stage="${stage.stage}"} ${stage.successRate.toFixed(2)}`);
    }

    // Worker utilization
    lines.push('# HELP autonomous_dev_worker_utilization_percent Worker utilization percentage');
    lines.push('# TYPE autonomous_dev_worker_utilization_percent gauge');
    lines.push(`autonomous_dev_worker_utilization_percent ${dashboard.workerUtilization.utilizationPercent.toFixed(2)}`);

    // Cycle metrics
    lines.push('# HELP autonomous_dev_cycles_per_hour Cycles completed per hour');
    lines.push('# TYPE autonomous_dev_cycles_per_hour gauge');
    lines.push(`autonomous_dev_cycles_per_hour ${dashboard.cycles.cyclesPerHour.toFixed(2)}`);

    // Task success rate
    lines.push('# HELP autonomous_dev_task_success_rate Overall task success rate');
    lines.push('# TYPE autonomous_dev_task_success_rate gauge');
    lines.push(`autonomous_dev_task_success_rate ${dashboard.tasks.successRate.toFixed(2)}`);

    // Performance regression indicator
    if (dashboard.performance) {
      lines.push('# HELP autonomous_dev_performance_regression Performance regression indicator (0=none, 1=warning, 2=critical)');
      lines.push('# TYPE autonomous_dev_performance_regression gauge');
      const regressionValue = dashboard.performance.severity === 'none' ? 0 : dashboard.performance.severity === 'warning' ? 1 : 2;
      lines.push(`autonomous_dev_performance_regression ${regressionValue}`);
    }

    // Active alerts
    if (dashboard.alerts) {
      lines.push('# HELP autonomous_dev_active_alerts_total Active alert count');
      lines.push('# TYPE autonomous_dev_active_alerts_total gauge');
      lines.push(`autonomous_dev_active_alerts_total ${dashboard.alerts.activeCount}`);
    }

    // Append the standard metrics
    lines.push('');
    lines.push('# Standard metrics from metrics collector');
    lines.push(metrics.getPrometheusMetrics());

    return lines.join('\n');
  }

  /**
   * Get dashboard metrics as JSON string
   */
  getJsonFormat(): string {
    return JSON.stringify(this.getDashboardMetrics(), null, 2);
  }

  /**
   * Reset all dashboard metrics
   */
  reset(): void {
    this.pipelineMetrics.clear();
    this.startTime = new Date();
    logger.info('Dashboard metrics reset');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Determine overall health status
   */
  private determineHealthStatus(metricsJson: Record<string, unknown>): 'healthy' | 'degraded' | 'unhealthy' {
    const alertSystem = getAlertingSystem();
    const activeAlerts = alertSystem.getActiveAlerts();

    // Check for critical alerts
    if (activeAlerts.some(a => a.severity === 'critical')) {
      return 'unhealthy';
    }

    // Check for error alerts or high failure rate
    if (activeAlerts.some(a => a.severity === 'error')) {
      return 'degraded';
    }

    // Check performance regression
    const analyzer = getPerformanceAnalyzer();
    const regression = analyzer.detectRegressions();
    if (regression.severity === 'critical') {
      return 'unhealthy';
    }
    if (regression.severity === 'warning') {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get worker utilization metrics
   */
  private getWorkerUtilization(metricsJson: Record<string, unknown>): WorkerUtilizationMetrics {
    // Extract from metrics or use defaults
    const activeWorkers = this.extractMetricValue(metricsJson, 'workers_active', 0);
    const queuedTasks = this.extractMetricValue(metricsJson, 'workers_queued', 0);
    const totalTasks = this.extractMetricValue(metricsJson, 'tasks_total', 0);
    const utilizationPercent = this.extractMetricValue(metricsJson, 'worker_utilization', 0);

    // Estimate total workers (could be from config)
    const totalWorkers = Math.max(activeWorkers, 4); // Default to at least 4

    return {
      totalWorkers,
      activeWorkers,
      utilizationPercent,
      avgTasksPerWorker: totalWorkers > 0 ? totalTasks / totalWorkers : 0,
      totalTasksProcessed: totalTasks,
      queuedTasks,
    };
  }

  /**
   * Get cycle metrics summary
   */
  private getCycleMetrics(metricsJson: Record<string, unknown>): CycleMetricsSummary {
    const totalCycles = this.extractMetricValue(metricsJson, 'cycles_total', 0);
    const successfulCycles = totalCycles; // Assuming all completed cycles are successful
    const avgDuration = this.extractHistogramMean(metricsJson, 'cycle_duration_ms');
    const avgTasks = this.extractMetricValue(metricsJson, 'cycle_tasks_discovered', 0) / Math.max(totalCycles, 1);

    // Calculate cycles per hour
    const uptimeHours = (Date.now() - this.startTime.getTime()) / 3600000;
    const cyclesPerHour = uptimeHours > 0 ? totalCycles / uptimeHours : 0;

    return {
      totalCycles,
      successfulCycles,
      successRate: totalCycles > 0 ? (successfulCycles / totalCycles) * 100 : 0,
      avgDurationMs: avgDuration,
      avgTasksPerCycle: avgTasks,
      cyclesPerHour,
    };
  }

  /**
   * Get task metrics summary
   */
  private getTaskMetrics(metricsJson: Record<string, unknown>): DashboardMetrics['tasks'] {
    const total = this.extractMetricValue(metricsJson, 'tasks_total', 0);
    const succeeded = this.extractMetricValue(metricsJson, 'tasks_success_total', 0);
    const failed = this.extractMetricValue(metricsJson, 'tasks_failed_total', 0);
    const avgDuration = this.extractHistogramMean(metricsJson, 'task_duration_ms');

    return {
      total,
      succeeded,
      failed,
      successRate: total > 0 ? (succeeded / total) * 100 : 0,
      avgDurationMs: avgDuration,
    };
  }

  /**
   * Get error metrics summary
   */
  private getErrorMetrics(metricsJson: Record<string, unknown>): DashboardMetrics['errors'] {
    const total = this.extractMetricValue(metricsJson, 'errors_total', 0);

    // Extract error breakdown by type (simplified)
    const byType: Record<string, number> = {
      github: this.extractMetricValue(metricsJson, 'github_api_errors_total', 0),
      claude: this.extractMetricValue(metricsJson, 'claude_api_errors_total', 0),
      execution: this.extractMetricValue(metricsJson, 'execution_errors_total', 0),
    };

    // Recent errors (last hour estimate)
    const recentErrors = Math.min(total, 10); // Simplified

    return {
      total,
      byType,
      recentErrors,
    };
  }

  /**
   * Get API metrics summary
   */
  private getApiMetrics(metricsJson: Record<string, unknown>): DashboardMetrics['apiMetrics'] {
    return {
      github: {
        calls: this.extractMetricValue(metricsJson, 'github_api_calls_total', 0),
        errors: this.extractMetricValue(metricsJson, 'github_api_errors_total', 0),
        avgLatencyMs: this.extractHistogramMean(metricsJson, 'github_api_duration_ms'),
      },
      claude: {
        calls: this.extractMetricValue(metricsJson, 'claude_api_calls_total', 0),
        errors: this.extractMetricValue(metricsJson, 'claude_api_errors_total', 0),
        avgLatencyMs: this.extractHistogramMean(metricsJson, 'claude_api_duration_ms'),
      },
    };
  }

  /**
   * Get performance regression analysis
   */
  private getPerformanceAnalysis(): DashboardMetrics['performance'] {
    const analyzer = getPerformanceAnalyzer();
    const result = analyzer.detectRegressions();

    return {
      hasRegression: result.hasRegression,
      severity: result.severity,
      affectedMetrics: result.affectedMetrics.map(m => m.metricName),
    };
  }

  /**
   * Get complexity distribution
   */
  private getComplexityDistribution(): DashboardMetrics['complexity'] {
    const complexityMetrics = getComplexityMetrics();
    const distribution = complexityMetrics.getDistribution();
    const successRates = complexityMetrics.getSuccessRateByComplexity();

    return {
      distribution: distribution.distribution as unknown as Record<string, number>,
      successRates: successRates as unknown as Record<string, number>,
    };
  }

  /**
   * Get alert summary
   */
  private getAlertSummary(): DashboardMetrics['alerts'] {
    const alertSystem = getAlertingSystem();
    const stats = alertSystem.getStats();
    const criticalAlerts = alertSystem.getAlertsBySeverity('critical').map(a => a.title);

    return {
      activeCount: stats.activeCount,
      bySeverity: stats.activeBySeverity as unknown as Record<string, number>,
      criticalAlerts,
    };
  }

  /**
   * Extract metric value from JSON
   */
  private extractMetricValue(metricsJson: Record<string, unknown>, name: string, defaultValue: number): number {
    const metric = metricsJson[name];
    if (typeof metric === 'number') {
      return metric;
    }
    if (typeof metric === 'object' && metric !== null && 'value' in metric) {
      return (metric as { value: number }).value;
    }
    return defaultValue;
  }

  /**
   * Extract histogram mean from JSON
   */
  private extractHistogramMean(metricsJson: Record<string, unknown>, name: string): number {
    const metric = metricsJson[name];
    if (typeof metric === 'object' && metric !== null) {
      const histMetric = metric as { sum?: number; count?: number };
      if (histMetric.sum !== undefined && histMetric.count !== undefined && histMetric.count > 0) {
        return histMetric.sum / histMetric.count;
      }
    }
    return 0;
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
}

// Singleton instance
let dashboardInstance: MetricsDashboard | null = null;

/**
 * Get or create the global dashboard instance
 */
export function getMetricsDashboard(config?: Partial<DashboardConfig>): MetricsDashboard {
  if (!dashboardInstance) {
    dashboardInstance = new MetricsDashboard(config);
  }
  return dashboardInstance;
}

/**
 * Reset the global dashboard instance
 */
export function resetMetricsDashboard(): void {
  if (dashboardInstance) {
    dashboardInstance.reset();
  }
  dashboardInstance = null;
}
