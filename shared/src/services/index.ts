/**
 * Services module - Dependency injection and service registry
 *
 * Provides a type-safe service locator using abstract classes as tokens.
 *
 * @example
 * ```typescript
 * import { ServiceProvider, ALogger, AClaudeWebClient, bootstrapServices } from '@webedt/shared';
 *
 * // At startup
 * await bootstrapServices();
 *
 * // Get services (type-safe!)
 * const logger = ServiceProvider.get(ALogger);
 * const client = ServiceProvider.get(AClaudeWebClient);
 * ```
 *
 * @module services
 */

// Bootstrap function
export { bootstrapServices } from './bootstrap.js';

// ServiceProvider and ServiceScope
export {
  ServiceProvider,
  ServiceScope,
  type AbstractClass,
} from './registry.js';

// Abstract service classes (tokens)
export {
  AService,
  ALogger,
  ALogCapture,
  AMetricsRegistry,
  AHealthMonitor,
  ACircuitBreaker,
  ACircuitBreakerRegistry,
  ASessionEventBroadcaster,
  ASessionListBroadcaster,
  AClaudeWebClient,
  AGitHelper,
  AGitHubClient,
} from './abstracts/index.js';

// Types specific to abstract classes (not duplicated elsewhere)
export type { ClaudeWebClientConfig } from './abstracts/index.js';
