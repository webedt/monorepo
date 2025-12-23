/**
 * Services module - Dependency injection and service registry
 * @module services
 */

export {
  ServiceProvider,
  ServiceScope,
  // Type exports
  type ConfigFor,
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
  type ClaudeRemoteClientConfig,
  type CircuitBreakerConfig,
} from './registry.js';
