/**
 * Analytics Module
 *
 * Provides cycle analytics collection and monthly report generation
 * for autonomous development metrics and observability.
 */

// Analytics Collector
export {
  AnalyticsCollector,
  createAnalyticsCollector,
  buildCycleAnalyticsData,
  type TaskExecutionData,
  type CycleAnalyticsData,
  type AnalyticsCollectorConfig,
} from './collector.js';

// Monthly Reports
export {
  MonthlyReportGenerator,
  createMonthlyReportGenerator,
  generateCurrentMonthReport,
  generatePreviousMonthReport,
  formatReportSummary,
  type MonthlyReport,
} from './reports.js';
