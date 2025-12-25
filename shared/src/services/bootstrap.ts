/**
 * Service Bootstrap
 *
 * Initializes all global services at application startup.
 * Services are registered and then initialized in order of their `order` property.
 *
 * @example
 * ```typescript
 * // In backend/src/index.ts
 * import { bootstrapServices } from '@webedt/shared';
 *
 * async function main() {
 *   await bootstrapServices();
 *
 *   // Services are ready - start server
 *   const app = express();
 *   app.listen(PORT);
 * }
 * ```
 */
import { ServiceProvider } from './registry.js';
import type { AService } from './abstracts/AService.js';
import {
  ALogger,
  ALogCapture,
  AMetricsRegistry,
  AHealthMonitor,
  ACircuitBreakerRegistry,
  ASessionEventBroadcaster,
  ASessionListBroadcaster,
  AClaudeWebClient,
  AGitHubClient,
  ALlm,
} from './abstracts/index.js';

// Import concrete implementations
import { logger } from '../utils/logging/logger.js';
import { logCapture } from '../utils/logging/logCapture.js';
import { metrics } from '../utils/monitoring/metrics.js';
import { healthMonitor } from '../utils/monitoring/healthMonitor.js';
import { circuitBreakerRegistry } from '../utils/resilience/circuitBreaker.js';
import { sessionEventBroadcaster } from '../sessions/sessionEventBroadcaster.js';
import { sessionListBroadcaster } from '../sessions/sessionListBroadcaster.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';
import { GitHubClient } from '../github/githubClient.js';
import { Llm } from '../llm/Llm.js';
import type { ClaudeRemoteClientConfig } from '../claudeWeb/types.js';

/**
 * Wrap an existing service implementation with AService lifecycle methods.
 * This allows existing singletons to be used with the new ServiceProvider.
 */
function wrapService<T extends object>(instance: T, order: number = 0): T & AService {
  return Object.assign(instance, {
    order,
    initialize: async () => {},
    dispose: async () => {},
  });
}

/**
 * Bootstrap all global services.
 *
 * Registers all services and initializes them in order:
 * 1. Logger (order: -100) - Ready first for other services to log
 * 2. LogCapture (order: -90) - Ready for capturing logs
 * 3. MetricsRegistry (order: -50) - Ready for recording metrics
 * 4. CircuitBreakerRegistry (order: -40) - Ready for resilience
 * 5. HealthMonitor (order: 0) - Default order
 * 6. SessionEventBroadcaster (order: 0) - Default order
 * 7. SessionListBroadcaster (order: 0) - Default order
 * 8. GitHubClient (order: 0) - Default order
 * 9. ClaudeWebClient (order: 50) - Initializes after core services, resolves credentials
 */
export async function bootstrapServices(): Promise<void> {
  // Register all services (order doesn't matter - sorted by service.order during init)
  // Wrap existing singletons with AService lifecycle methods
  ServiceProvider.register(ALogger, wrapService(logger, -100));
  ServiceProvider.register(ALogCapture, wrapService(logCapture, -90));
  ServiceProvider.register(AMetricsRegistry, wrapService(metrics, -50));
  ServiceProvider.register(AHealthMonitor, wrapService(healthMonitor, 0));
  ServiceProvider.register(ACircuitBreakerRegistry, wrapService(circuitBreakerRegistry, -40));
  ServiceProvider.register(ASessionEventBroadcaster, wrapService(sessionEventBroadcaster, 0));
  ServiceProvider.register(ASessionListBroadcaster, wrapService(sessionListBroadcaster, 0));
  ServiceProvider.register(AGitHubClient, wrapService(new GitHubClient(), 0));

  // ClaudeWebClient - needs special handling for initialization
  const claudeClient = new ClaudeWebClient({} as ClaudeRemoteClientConfig);
  ServiceProvider.register(AClaudeWebClient, wrapService(claudeClient, 50));

  // LLM - one-off requests
  ServiceProvider.register(ALlm, wrapService(new Llm(), 0));

  // Initialize all services in order (sorted by service.order)
  await ServiceProvider.initialize();
}
