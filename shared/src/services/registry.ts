/**
 * Service Registry
 *
 * A type-safe service locator using abstract classes as tokens.
 * Abstract classes exist at runtime, serving as both TypeScript types AND lookup keys.
 *
 * ## Usage
 *
 * ```typescript
 * import { ServiceProvider, ALogger, AClaudeWebClient } from '@webedt/shared';
 *
 * // At startup - register and initialize
 * ServiceProvider.register(ALogger, new Logger());
 * ServiceProvider.register(AClaudeWebClient, new ClaudeWebClient());
 * await ServiceProvider.initialize();
 *
 * // Get services (sync, type-safe!)
 * const logger = ServiceProvider.get(ALogger);        // TypeScript knows it's ALogger
 * const client = ServiceProvider.get(AClaudeWebClient);
 *
 * // Request-scoped services
 * const scope = ServiceProvider.createScope();
 * scope.register(AUserContext, new UserContext(req.user));
 * await ServiceProvider.initialize(scope);
 * const userCtx = scope.get(AUserContext);
 * await scope.dispose();
 * ```
 *
 * ## Testing
 *
 * ```typescript
 * beforeEach(() => {
 *   ServiceProvider.register(ALogger, mockLogger);
 * });
 *
 * afterEach(async () => {
 *   await ServiceProvider.reset();
 * });
 * ```
 *
 * @module services
 */

import type { AService } from './abstracts/AService.js';
import { ServiceScope, type AbstractClass } from './ServiceScope.js';

// =============================================================================
// ServiceProvider
// =============================================================================

/**
 * Service Provider - static access to services with abstract class tokens.
 *
 * Uses abstract classes as tokens which provide:
 * - Runtime key (abstract classes exist at runtime)
 * - Type safety (TypeScript infers return type from token)
 * - No generics needed at call site
 *
 * @example
 * ```typescript
 * // Registration
 * ServiceProvider.register(ALogger, new Logger());
 * ServiceProvider.register(AClaudeWebClient, new ClaudeWebClient());
 *
 * // Initialize all services (in order by service.order)
 * await ServiceProvider.initialize();
 *
 * // Usage - type-safe without generics!
 * const logger = ServiceProvider.get(ALogger);
 * const client = ServiceProvider.get(AClaudeWebClient);
 *
 * // Scoped services
 * const scope = ServiceProvider.createScope();
 * scope.register(AUserContext, new UserContext(req.user));
 * await ServiceProvider.initialize(scope);
 * const userCtx = scope.get(AUserContext);
 * ```
 */
export class ServiceProvider {
  private static globalInstances = new Map<AbstractClass<AService>, AService>();
  private static globalInitialized = false;
  private static globalInitPromise: Promise<void> | null = null;

  /**
   * Register a global service.
   *
   * Services must be registered before initialization.
   *
   * @param token - Abstract class to use as the service token
   * @param instance - Concrete service instance
   * @throws Error if called after initialization
   */
  static register<T extends AService>(token: AbstractClass<T>, instance: T): void {
    if (this.globalInitialized) {
      throw new Error('Cannot register after global initialization');
    }
    this.globalInstances.set(token as AbstractClass<AService>, instance);
  }

  /**
   * Initialize services.
   *
   * - Without scope: initializes global services in order (by service.order)
   * - With scope: waits for global init, then initializes scope services
   *
   * @param scope - Optional scope to initialize
   */
  static async initialize(scope?: ServiceScope): Promise<void> {
    if (scope) {
      // Wait for global init to complete first
      if (this.globalInitPromise) {
        await this.globalInitPromise;
      }
      if (!this.globalInitialized) {
        throw new Error('Global services must be initialized before scopes');
      }
      // Set parent for fallback lookups
      scope._setParent({
        get: <T extends AService>(token: AbstractClass<T>) => this.get(token),
        has: <T extends AService>(token: AbstractClass<T>) => this.has(token),
      });
      // Then initialize scope
      await scope._initialize();
    } else {
      // Initialize global services
      if (this.globalInitialized) return;

      this.globalInitPromise = (async () => {
        // Sort services by order (lowest first)
        const sorted = [...this.globalInstances.values()].sort((a, b) => a.order - b.order);

        // Initialize in order
        for (const instance of sorted) {
          await instance.initialize();
        }
        this.globalInitialized = true;
      })();

      await this.globalInitPromise;
    }
  }

  /**
   * Get a global service by its abstract class token.
   *
   * @param token - Abstract class token
   * @returns Service instance (correctly typed)
   * @throws Error if not initialized or service not registered
   */
  static get<T extends AService>(token: AbstractClass<T>): T {
    if (!this.globalInitialized) {
      throw new Error('ServiceProvider not initialized. Call initialize() first.');
    }
    const instance = this.globalInstances.get(token as AbstractClass<AService>);
    if (!instance) {
      throw new Error(`Service not registered: ${token.name}`);
    }
    return instance as T;
  }

  /**
   * Check if a global service is registered.
   *
   * @param token - Abstract class token
   * @returns true if the service is registered
   */
  static has<T extends AService>(token: AbstractClass<T>): boolean {
    return this.globalInstances.has(token as AbstractClass<AService>);
  }

  /**
   * Create a new service scope for request/page-level services.
   *
   * @returns New ServiceScope instance
   */
  static createScope(): ServiceScope {
    return new ServiceScope();
  }

  /**
   * Check if global services are initialized.
   *
   * @returns true if initialize() has completed
   */
  static isInitialized(): boolean {
    return this.globalInitialized;
  }

  /**
   * Reset all services - dispose and clear registrations.
   *
   * Useful for testing and cleanup.
   */
  static async reset(): Promise<void> {
    // Sort services by order descending (dispose in reverse order)
    const sorted = [...this.globalInstances.values()].sort((a, b) => b.order - a.order);

    for (const instance of sorted) {
      await instance.dispose();
    }
    this.globalInstances.clear();
    this.globalInitialized = false;
    this.globalInitPromise = null;
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export { ServiceScope, type AbstractClass } from './ServiceScope.js';

// Re-export all abstract classes for convenient imports
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
  ASessionCleanupService,
  AEventStorageService,
  AClaudeWebClient,
  ACodexClient,
  AGitHelper,
  AGitHubClient,
  ATokenRefreshService,
  AEventFormatter,
  ASseHelper,
  ACodeAnalyzer,
  ACacheService,
  // Types
  type LogContext,
  type CapturedLog,
  type LogFilter,
  type LogCaptureStatus,
  type MetricsSummary,
  type HealthCheckResult,
  type ServiceHealth,
  type DetailedHealthStatus,
  type HealthCheckFunction,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreakerResult,
  type BroadcastEvent,
  type SessionEvent,
  type SessionUpdateType,
  type SessionListEvent,
  type ClaudeWebClientConfig,
  type CodexClientConfig,
  type GitHubPullOptions,
  type GitHubPullResult,
  type AnalysisType,
  type FindingSeverity,
  type AnalysisFinding,
  type AnalysisSummary,
  type CodeAnalysisParams,
  type CodeAnalysisResult,
  type CodeAnalyzerConfig,
  type CacheConfig,
  type CacheStats,
  type CacheResult,
  type CacheSetOptions,
  type InvalidationPattern,
  type CacheHealth,
} from './abstracts/index.js';

// =============================================================================
// Re-export types from Claude Web (for convenience)
// =============================================================================

export type { ClaudeRemoteClientConfig } from '../claudeWeb/types.js';

// =============================================================================
// Re-export types from Codex (for convenience)
// =============================================================================

export type { CodexClientConfig as CodexRemoteClientConfig } from '../codex/types.js';
