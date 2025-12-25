/**
 * Base abstract class for all services.
 *
 * All services extend AService which provides lifecycle methods and initialization order.
 * Services are initialized by ServiceProvider in order of their `order` property.
 *
 * @example
 * ```typescript
 * export abstract class ALogger extends AService {
 *   readonly order = -100;  // Initialize first
 *
 *   abstract info(message: string): void;
 * }
 *
 * class Logger extends ALogger {
 *   async initialize(): Promise<void> {
 *     // Setup logging transport
 *   }
 *
 *   info(message: string): void {
 *     console.log(message);
 *   }
 * }
 * ```
 */
export abstract class AService {
  /**
   * Initialization order. Lower numbers initialize first.
   * - Negative: core services (logging, metrics) - initialize first
   * - 0: default
   * - Positive: services with dependencies - initialize later
   *
   * Example values:
   * - -100: ALogger
   * - -50: AMetricsRegistry
   * - 0: Most services (default)
   * - 50: AClaudeWebClient
   * - 100: Services that depend on multiple other services
   */
  readonly order: number = 0;

  /**
   * Called by ServiceProvider.initialize() after all services are registered.
   * Services are initialized in order (lowest to highest).
   * Override this to perform async initialization (DB connections, auth, etc.)
   */
  async initialize(): Promise<void> {
    // Default: no-op, override in subclasses that need async init
  }

  /**
   * Called by ServiceProvider.reset() for cleanup.
   * Override this for cleanup (close connections, clear caches, etc.)
   */
  async dispose(): Promise<void> {
    // Default: no-op, override in subclasses that need cleanup
  }
}
