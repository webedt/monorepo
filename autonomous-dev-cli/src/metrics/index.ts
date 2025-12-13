/**
 * Metrics module - centralized metrics collection and export
 *
 * This module provides:
 * - Re-exported core metrics from utils/metrics
 * - Performance regression detection
 * - Task complexity distribution tracking
 * - Dashboard-ready metrics aggregation
 * - Alerting hooks for critical metrics thresholds
 */

// Re-export core metrics
export {
  metrics,
  Counter,
  Gauge,
  Histogram,
  type MetricLabels,
  type CounterMetric,
  type GaugeMetric,
  type HistogramMetric,
  type HistogramBucket,
  type Metric,
  type ErrorContext,
} from '../utils/metrics.js';

// Export new metrics features
export {
  PerformanceAnalyzer,
  type PerformanceBaseline,
  type PerformanceSnapshot,
  type RegressionDetectionResult,
  type PerformanceAnalyzerConfig,
} from './performance-analyzer.js';

export {
  ComplexityMetrics,
  type TaskComplexityStats,
  type ComplexityDistribution,
  type ComplexityTrend,
} from './complexity-metrics.js';

export {
  AlertingSystem,
  type Alert,
  type AlertConfig,
  type AlertHook,
  type AlertSeverity,
  type AlertThreshold,
} from './alerting.js';

export {
  MetricsDashboard,
  type DashboardMetrics,
  type PipelineStageMetrics,
  type DashboardConfig,
} from './dashboard.js';
