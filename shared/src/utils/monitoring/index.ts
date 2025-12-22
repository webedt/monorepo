/**
 * Monitoring and observability utilities
 * @module utils/monitoring
 */

// Interfaces
export type {
  IHealthMonitor,
  HealthCheckResult,
  ServiceHealth,
  DetailedHealthStatus,
  HealthCheckFunction,
} from './IHealthMonitor.js';

export type {
  IMetricsRegistry,
  MetricLabels,
  MetricsSummary,
} from './IMetricsRegistry.js';

// Implementations
export { healthMonitor, createDatabaseHealthCheck } from './healthMonitor.js';
export { metrics } from './metrics.js';
