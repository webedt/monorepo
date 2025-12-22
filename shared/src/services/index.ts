/**
 * Services module - Dependency injection and service registry
 * @module services
 */

export {
  services,
  setServiceFactory,
  resetServices,
  type IServiceRegistry,
  type ServiceConfigMap,
  type ServiceType,
  // Re-exported interfaces
  type ILogger,
  type ILogCapture,
  type IHealthMonitor,
  type IMetricsRegistry,
  type ICircuitBreaker,
  type ICircuitBreakerRegistry,
  type ISessionEventBroadcaster,
  type ISessionListBroadcaster,
  type IClaudeWebClient,
  type IGitHelper,
  type IGitHubClient,
} from './registry.js';
