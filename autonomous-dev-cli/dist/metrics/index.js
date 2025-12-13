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
export { metrics, Counter, Gauge, Histogram, } from '../utils/metrics.js';
// Export new metrics features
export { PerformanceAnalyzer, } from './performance-analyzer.js';
export { ComplexityMetrics, } from './complexity-metrics.js';
export { AlertingSystem, } from './alerting.js';
export { MetricsDashboard, } from './dashboard.js';
//# sourceMappingURL=index.js.map