/**
 * Abstract Service Classes
 *
 * Export all abstract service classes used as tokens for dependency injection.
 * These classes serve as both TypeScript types AND runtime keys for ServiceProvider.
 *
 * @example
 * ```typescript
 * import { ALogger, AClaudeWebClient, ServiceProvider } from '@webedt/shared';
 *
 * // Registration
 * ServiceProvider.register(ALogger, new Logger());
 * ServiceProvider.register(AClaudeWebClient, new ClaudeWebClient());
 *
 * // Usage - TypeScript knows the return type!
 * const logger = ServiceProvider.get(ALogger);
 * const client = ServiceProvider.get(AClaudeWebClient);
 * ```
 */

// Base service class
export { AService } from './AService.js';

// Logging services (from utils/logging/)
export { ALogger, type LogContext } from '../../utils/logging/ALogger.js';
export {
  ALogCapture,
  type CapturedLog,
  type LogFilter,
  type LogCaptureStatus,
} from '../../utils/logging/ALogCapture.js';

// Monitoring services (from utils/monitoring/)
export { AMetricsRegistry, type MetricsSummary } from '../../utils/monitoring/AMetricsRegistry.js';
export {
  AHealthMonitor,
  type HealthCheckResult,
  type ServiceHealth,
  type DetailedHealthStatus,
  type HealthCheckFunction,
} from '../../utils/monitoring/AHealthMonitor.js';

// Resilience services (from utils/resilience/)
export {
  ACircuitBreaker,
  ACircuitBreakerRegistry,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerResult,
} from '../../utils/resilience/ACircuitBreaker.js';

// Session broadcasting services (from sessions/)
export {
  ASessionEventBroadcaster,
  type BroadcastEvent,
  type SessionEvent,
} from '../../sessions/ASessionEventBroadcaster.js';
export {
  ASessionListBroadcaster,
  type SessionUpdateType,
  type SessionListEvent,
} from '../../sessions/ASessionListBroadcaster.js';

// Claude Web Client (from claudeWeb/)
export { AClaudeWebClient } from '../../claudeWeb/AClaudeWebClient.js';
export type { ClaudeWebClientConfig } from '../../claudeWeb/types.js';

// Git services (from github/)
export { AGitHelper } from '../../github/AGitHelper.js';
export {
  AGitHubClient,
  type GitHubPullOptions,
  type GitHubPullResult,
} from '../../github/AGitHubClient.js';
