/**
 * Monitoring and observability utilities
 * @module utils/monitoring
 */

// Abstract classes and types
export {
  AHealthMonitor,
  type HealthCheckResult,
  type ServiceHealth,
  type DetailedHealthStatus,
  type HealthCheckFunction,
} from './AHealthMonitor.js';

export {
  AMetricsRegistry,
  type MetricsSummary,
} from './AMetricsRegistry.js';

// Re-export MetricLabels from the implementation
export type { MetricLabels } from './metrics.js';

// Implementations
export { healthMonitor, createDatabaseHealthCheck } from './healthMonitor.js';
export { metrics } from './metrics.js';

// Health aggregator for unified external service monitoring
export {
  healthAggregator,
  type ServiceStatus,
  type AlertSeverity,
  type HealthThreshold,
  type ServiceHealthMetric,
  type ServiceHealthHistory,
  type ServiceHealthStatus,
  type AlertInfo,
  type AggregatedHealthStatus,
} from './healthAggregator.js';
