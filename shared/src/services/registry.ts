/**
 * Service Registry
 *
 * A type-safe service locator for dependency injection.
 * Provides centralized access to singletons and factory methods.
 *
 * ## Usage
 *
 * ```typescript
 * import { services } from '@webedt/shared';
 *
 * // Get singletons
 * const logger = services.get<ILogger>();
 * const metrics = services.get<IMetricsRegistry>();
 *
 * // Create new instances (factories)
 * const client = services.get<IClaudeWebClient>({ accessToken, environmentId });
 * const git = services.get<IGitHelper>('/path/to/workspace');
 * ```
 *
 * ## Testing
 *
 * ```typescript
 * import { setServiceFactory, resetServices } from '@webedt/shared';
 *
 * beforeEach(() => {
 *   setServiceFactory<ILogger>(() => mockLogger);
 * });
 *
 * afterEach(() => {
 *   resetServices();
 * });
 * ```
 *
 * @module services
 */

// Interface imports
import type { ILogger } from '../utils/logging/ILogger.js';
import type { ILogCapture } from '../utils/logging/ILogCapture.js';
import type { IHealthMonitor } from '../utils/monitoring/IHealthMonitor.js';
import type { IMetricsRegistry } from '../utils/monitoring/IMetricsRegistry.js';
import type { ICircuitBreaker, ICircuitBreakerRegistry, CircuitBreakerConfig } from '../utils/resilience/ICircuitBreaker.js';
import type { ISessionEventBroadcaster } from '../sessions/ISessionEventBroadcaster.js';
import type { ISessionListBroadcaster } from '../sessions/ISessionListBroadcaster.js';
import type { IClaudeWebClient } from '../claudeWeb/IClaudeWebClient.js';
import type { ClaudeRemoteClientConfig } from '../claudeWeb/types.js';
import type { IGitHelper } from '../github/IGitHelper.js';
import type { IGitHubClient } from '../github/IGitHubClient.js';

// Implementation imports (lazy loaded)
import { logger } from '../utils/logging/logger.js';
import { logCapture } from '../utils/logging/logCapture.js';
import { healthMonitor } from '../utils/monitoring/healthMonitor.js';
import { metrics } from '../utils/monitoring/metrics.js';
import { circuitBreakerRegistry, createCircuitBreaker } from '../utils/resilience/circuitBreaker.js';
import { sessionEventBroadcaster } from '../sessions/sessionEventBroadcaster.js';
import { sessionListBroadcaster } from '../sessions/sessionListBroadcaster.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';
import { GitHelper } from '../github/gitHelper.js';
import { GitHubClient } from '../github/githubClient.js';

// =============================================================================
// Type-to-Config Mapping
// =============================================================================

/**
 * Maps interface types to their configuration types.
 * Singletons have `void` config, factories have their specific config type.
 */
export interface ServiceConfigMap {
  // Singletons (no config)
  ILogger: void;
  ILogCapture: void;
  IHealthMonitor: void;
  IMetricsRegistry: void;
  ICircuitBreakerRegistry: void;
  ISessionEventBroadcaster: void;
  ISessionListBroadcaster: void;
  IGitHubClient: void;

  // Factories (config required)
  IClaudeWebClient: ClaudeRemoteClientConfig;
  IGitHelper: string;
  ICircuitBreaker: Partial<CircuitBreakerConfig> | undefined;
}

/**
 * Helper type to get config type for a service interface
 */
type ConfigFor<T> =
  T extends ILogger ? void :
  T extends ILogCapture ? void :
  T extends IHealthMonitor ? void :
  T extends IMetricsRegistry ? void :
  T extends ICircuitBreakerRegistry ? void :
  T extends ISessionEventBroadcaster ? void :
  T extends ISessionListBroadcaster ? void :
  T extends IGitHubClient ? void :
  T extends IClaudeWebClient ? ClaudeRemoteClientConfig :
  T extends IGitHelper ? string :
  T extends ICircuitBreaker ? Partial<CircuitBreakerConfig> | undefined :
  never;

/**
 * Valid service types that can be requested
 */
export type ServiceType =
  | ILogger
  | ILogCapture
  | IHealthMonitor
  | IMetricsRegistry
  | ICircuitBreakerRegistry
  | ISessionEventBroadcaster
  | ISessionListBroadcaster
  | IGitHubClient
  | IClaudeWebClient
  | IGitHelper
  | ICircuitBreaker;

// =============================================================================
// Service Registry Interface
// =============================================================================

/**
 * Service registry interface for dependency injection.
 */
export interface IServiceRegistry {
  /**
   * Get a service by type.
   *
   * For singletons (ILogger, IMetricsRegistry, etc.), returns the same instance each time.
   * For factories (IClaudeWebClient, IGitHelper, etc.), creates a new instance.
   *
   * @typeParam T - Service interface type
   * @param config - Configuration (required for factories, omit for singletons)
   * @returns Service instance
   *
   * @example
   * ```typescript
   * // Singletons - no config needed
   * const logger = services.get<ILogger>();
   *
   * // Factories - config required
   * const client = services.get<IClaudeWebClient>({ accessToken, environmentId });
   * ```
   */
  get<T extends ServiceType>(
    ...args: ConfigFor<T> extends void ? [] : [config: ConfigFor<T>]
  ): T;
}

// =============================================================================
// Factory Registry
// =============================================================================

type FactoryFn = (config: unknown) => unknown;

// Factory functions keyed by a type identifier
const factories = new Map<string, FactoryFn>();
const defaultFactories = new Map<string, FactoryFn>();

// Register default factories
function registerDefaults(): void {
  // Singletons
  defaultFactories.set('ILogger', () => logger);
  defaultFactories.set('ILogCapture', () => logCapture);
  defaultFactories.set('IHealthMonitor', () => healthMonitor);
  defaultFactories.set('IMetricsRegistry', () => metrics);
  defaultFactories.set('ICircuitBreakerRegistry', () => circuitBreakerRegistry);
  defaultFactories.set('ISessionEventBroadcaster', () => sessionEventBroadcaster);
  defaultFactories.set('ISessionListBroadcaster', () => sessionListBroadcaster);
  defaultFactories.set('IGitHubClient', () => new GitHubClient());

  // Factories
  defaultFactories.set('IClaudeWebClient', (config) => new ClaudeWebClient(config as ClaudeRemoteClientConfig));
  defaultFactories.set('IGitHelper', (config) => new GitHelper(config as string));
  defaultFactories.set('ICircuitBreaker', (config) => createCircuitBreaker(config as Partial<CircuitBreakerConfig>));

  // Copy defaults to active factories
  for (const [key, factory] of defaultFactories) {
    factories.set(key, factory);
  }
}

registerDefaults();

// =============================================================================
// Type Key Resolution
// =============================================================================

/**
 * Maps a type parameter to its string key.
 * This is done via conditional type checking at runtime using config shape.
 */
function resolveTypeKey(config: unknown): string {
  // For factories, we can identify by config shape
  if (config !== undefined) {
    if (typeof config === 'string') {
      return 'IGitHelper';
    }
    if (typeof config === 'object' && config !== null) {
      if ('accessToken' in config) {
        return 'IClaudeWebClient';
      }
      // CircuitBreaker config or undefined
      return 'ICircuitBreaker';
    }
  }

  // For singletons called without config, we need the caller to specify
  // This will be handled by overloads
  throw new Error('Cannot resolve service type. For singletons, use the specific getter.');
}

// =============================================================================
// Service Registry Implementation
// =============================================================================

class ServiceRegistry implements IServiceRegistry {
  get<T extends ServiceType>(
    ...args: ConfigFor<T> extends void ? [] : [config: ConfigFor<T>]
  ): T {
    const config = args[0];

    // Try to resolve the type from config
    const typeKey = resolveTypeKey(config);
    const factory = factories.get(typeKey);

    if (!factory) {
      throw new Error(`No factory registered for service type: ${typeKey}`);
    }

    return factory(config) as T;
  }

  // Singleton getters (type-safe, no config needed)
  getLogger(): ILogger {
    return factories.get('ILogger')!(undefined) as ILogger;
  }

  getLogCapture(): ILogCapture {
    return factories.get('ILogCapture')!(undefined) as ILogCapture;
  }

  getHealthMonitor(): IHealthMonitor {
    return factories.get('IHealthMonitor')!(undefined) as IHealthMonitor;
  }

  getMetrics(): IMetricsRegistry {
    return factories.get('IMetricsRegistry')!(undefined) as IMetricsRegistry;
  }

  getCircuitBreakerRegistry(): ICircuitBreakerRegistry {
    return factories.get('ICircuitBreakerRegistry')!(undefined) as ICircuitBreakerRegistry;
  }

  getSessionEventBroadcaster(): ISessionEventBroadcaster {
    return factories.get('ISessionEventBroadcaster')!(undefined) as ISessionEventBroadcaster;
  }

  getSessionListBroadcaster(): ISessionListBroadcaster {
    return factories.get('ISessionListBroadcaster')!(undefined) as ISessionListBroadcaster;
  }

  getGitHubClient(): IGitHubClient {
    return factories.get('IGitHubClient')!(undefined) as IGitHubClient;
  }
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Global service registry instance.
 *
 * @example
 * ```typescript
 * import { services } from '@webedt/shared';
 *
 * // Factories - pass config, type is inferred
 * const client = services.get<IClaudeWebClient>({ accessToken, environmentId });
 * const git = services.get<IGitHelper>('/path/to/workspace');
 *
 * // Singletons - use specific getters
 * const logger = services.getLogger();
 * const metrics = services.getMetrics();
 * ```
 */
export const services = new ServiceRegistry();

/**
 * Set a custom factory for a service type (useful for testing).
 *
 * @typeParam T - Service interface type
 * @param typeKey - The type name (e.g., 'ILogger', 'IClaudeWebClient')
 * @param factory - Custom factory function
 *
 * @example
 * ```typescript
 * setServiceFactory('ILogger', () => mockLogger);
 * setServiceFactory('IClaudeWebClient', (config) => mockClient);
 * ```
 */
export function setServiceFactory<T extends ServiceType>(
  typeKey: string,
  factory: (config: ConfigFor<T>) => T
): void {
  factories.set(typeKey, factory as FactoryFn);
}

/**
 * Reset all factories to their defaults.
 */
export function resetServices(): void {
  factories.clear();
  for (const [key, factory] of defaultFactories) {
    factories.set(key, factory);
  }
}

// Re-export interfaces for convenience
export type {
  ILogger,
  ILogCapture,
  IHealthMonitor,
  IMetricsRegistry,
  ICircuitBreaker,
  ICircuitBreakerRegistry,
  ISessionEventBroadcaster,
  ISessionListBroadcaster,
  IClaudeWebClient,
  IGitHelper,
  IGitHubClient,
};
