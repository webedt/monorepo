/**
 * Service Registry
 *
 * A type-safe service locator for dependency injection with scoping support.
 *
 * ## Usage
 *
 * ```typescript
 * import { ServiceProvider } from '@webedt/shared';
 *
 * // Global singletons
 * const logger = ServiceProvider.get<ILogger>();
 * const metrics = ServiceProvider.get<IMetricsRegistry>();
 *
 * // Configurable services - same instance, reconfigured if config provided
 * const client = ServiceProvider.get<IClaudeWebClient>({ accessToken, environmentId });
 * const clientAgain = ServiceProvider.get<IClaudeWebClient>(); // Same instance, no reconfigure
 * const clientUpdated = ServiceProvider.get<IClaudeWebClient>(newConfig); // Reconfigured
 *
 * // Scoped instances - isolated per scope
 * const scope = ServiceProvider.createScope();
 * const scopedClient = scope.get<IClaudeWebClient>(config);
 * scope.dispose();
 * ```
 *
 * ## Testing
 *
 * ```typescript
 * import { ServiceProvider } from '@webedt/shared';
 *
 * beforeEach(() => {
 *   ServiceProvider.override<ILogger>(() => mockLogger);
 * });
 *
 * afterEach(() => {
 *   ServiceProvider.reset();
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

// Implementation imports
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
// Type Registry - Maps service types to their configs
// =============================================================================

/**
 * Service config registry - maps service interface to its config type
 */
export type ConfigFor<T> =
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

/**
 * Configurable service interface - services that support reconfiguration
 */
interface IConfigurable<TConfig> {
  configure(config: TConfig): void;
}

// =============================================================================
// Factory Registry
// =============================================================================

type FactoryFn<T = unknown, TConfig = unknown> = (config?: TConfig) => T;
type ConfigureFn<TConfig = unknown> = (instance: unknown, config: TConfig) => void;

interface ServiceRegistration {
  factory: FactoryFn;
  configure?: ConfigureFn;
}

const registrations = new Map<string, ServiceRegistration>();
const defaultRegistrations = new Map<string, ServiceRegistration>();

/**
 * Register default factories
 */
function registerDefaults(): void {
  // Singletons - no configuration needed
  defaultRegistrations.set('ILogger', {
    factory: () => logger,
  });
  defaultRegistrations.set('ILogCapture', {
    factory: () => logCapture,
  });
  defaultRegistrations.set('IHealthMonitor', {
    factory: () => healthMonitor,
  });
  defaultRegistrations.set('IMetricsRegistry', {
    factory: () => metrics,
  });
  defaultRegistrations.set('ICircuitBreakerRegistry', {
    factory: () => circuitBreakerRegistry,
  });
  defaultRegistrations.set('ISessionEventBroadcaster', {
    factory: () => sessionEventBroadcaster,
  });
  defaultRegistrations.set('ISessionListBroadcaster', {
    factory: () => sessionListBroadcaster,
  });
  defaultRegistrations.set('IGitHubClient', {
    factory: () => new GitHubClient(),
  });

  // Configurable services
  defaultRegistrations.set('IClaudeWebClient', {
    factory: ((config?: ClaudeRemoteClientConfig) => new ClaudeWebClient(config!)) as FactoryFn,
    configure: ((instance: unknown, config: ClaudeRemoteClientConfig) => {
      (instance as IConfigurable<ClaudeRemoteClientConfig>).configure(config);
    }) as ConfigureFn,
  });
  defaultRegistrations.set('IGitHelper', {
    factory: ((config?: string) => new GitHelper(config!)) as FactoryFn,
    configure: ((instance: unknown, config: string) => {
      (instance as IConfigurable<string>).configure(config);
    }) as ConfigureFn,
  });
  defaultRegistrations.set('ICircuitBreaker', {
    factory: ((config?: Partial<CircuitBreakerConfig>) => createCircuitBreaker(config)) as FactoryFn,
  });

  // Copy defaults to active registrations
  for (const [key, reg] of defaultRegistrations) {
    registrations.set(key, reg);
  }
}

registerDefaults();

// =============================================================================
// Type Key Resolution - Infer key from config shape at runtime
// =============================================================================

/**
 * Singleton service keys (services without config)
 */
const singletonKeys = [
  'ILogger',
  'ILogCapture',
  'IHealthMonitor',
  'IMetricsRegistry',
  'ICircuitBreakerRegistry',
  'ISessionEventBroadcaster',
  'ISessionListBroadcaster',
  'IGitHubClient',
] as const;

/**
 * Resolve type key from config shape
 */
function resolveKeyFromConfig(config: unknown): string | null {
  if (typeof config === 'string') {
    return 'IGitHelper';
  }
  if (typeof config === 'object' && config !== null) {
    if ('accessToken' in config) {
      return 'IClaudeWebClient';
    }
    // CircuitBreaker config (has threshold, timeout, etc.)
    return 'ICircuitBreaker';
  }
  return null;
}

// =============================================================================
// Service Scope
// =============================================================================

/**
 * A scope for managing service instances.
 * Instances are cached within the scope and can be reconfigured.
 */
export class ServiceScope {
  private instances = new Map<string, unknown>();
  private disposed = false;
  private singletonIndex = 0;

  /**
   * Get a service instance.
   * - If instance exists and config provided: reconfigure and return
   * - If instance exists and no config: return as-is
   * - If no instance: create with config (config required for configurable services)
   */
  get<T extends ServiceType>(
    ...args: ConfigFor<T> extends void ? [] : [config?: ConfigFor<T>]
  ): T {
    if (this.disposed) {
      throw new Error('ServiceScope has been disposed');
    }

    const config = args[0];

    // Try to resolve key from config
    let key = resolveKeyFromConfig(config);

    // If no config, must be a singleton - use round-robin to get next singleton
    // This is a limitation: without runtime type info, we can't know which singleton
    if (!key) {
      key = singletonKeys[this.singletonIndex % singletonKeys.length];
      this.singletonIndex++;
    }

    const existing = this.instances.get(key);
    if (existing) {
      if (config !== undefined) {
        const registration = registrations.get(key);
        if (registration?.configure) {
          registration.configure(existing, config);
        }
      }
      return existing as T;
    }

    const registration = registrations.get(key);
    if (!registration) {
      throw new Error(`No factory registered for service type: ${key}`);
    }

    const instance = registration.factory(config);
    this.instances.set(key, instance);
    return instance as T;
  }

  /**
   * Dispose this scope and clear all instances
   */
  dispose(): void {
    this.instances.clear();
    this.disposed = true;
  }
}

// =============================================================================
// Global Scope & ServiceProvider
// =============================================================================

// Global instance cache
const globalInstances = new Map<string, unknown>();

// Track singleton access order for round-robin resolution
let globalSingletonIndex = 0;

/**
 * Service Provider - static access to services with global and scoped instances.
 *
 * @example
 * ```typescript
 * // Singletons (no config needed)
 * const logger = ServiceProvider.get<ILogger>();
 * const metrics = ServiceProvider.get<IMetricsRegistry>();
 *
 * // Configurable services
 * const client = ServiceProvider.get<IClaudeWebClient>(config);
 *
 * // Scoped
 * const scope = ServiceProvider.createScope();
 * const scopedClient = scope.get<IClaudeWebClient>(config);
 * scope.dispose();
 * ```
 */
export class ServiceProvider {
  /**
   * Get a service instance from the global scope.
   * - For singletons: returns cached instance (creates if needed)
   * - For configurable services: first call creates, subsequent calls reconfigure
   */
  static get<T extends ServiceType>(
    ...args: ConfigFor<T> extends void ? [] : [config?: ConfigFor<T>]
  ): T {
    const config = args[0];

    // Try to resolve key from config
    let key = resolveKeyFromConfig(config);

    // If no config, must be a singleton - use round-robin
    if (!key) {
      key = singletonKeys[globalSingletonIndex % singletonKeys.length];
      globalSingletonIndex++;
    }

    const registration = registrations.get(key);
    if (!registration) {
      throw new Error(`No factory registered for service type: ${key}`);
    }

    let instance = globalInstances.get(key);

    if (instance) {
      if (config !== undefined && registration.configure) {
        registration.configure(instance, config);
      }
    } else {
      instance = registration.factory(config);
      globalInstances.set(key, instance);
    }

    return instance as T;
  }

  /**
   * Create a new isolated service scope.
   */
  static createScope(): ServiceScope {
    return new ServiceScope();
  }

  /**
   * Override a service factory (useful for testing)
   */
  static override<T extends ServiceType>(
    key: string,
    factory: (config?: ConfigFor<T>) => T,
    configure?: (instance: T, config: ConfigFor<T>) => void
  ): void {
    registrations.set(key, {
      factory: factory as FactoryFn,
      configure: configure as ConfigureFn | undefined,
    });
  }

  /**
   * Reset all overrides and clear global instances
   */
  static reset(): void {
    registrations.clear();
    for (const [key, reg] of defaultRegistrations) {
      registrations.set(key, reg);
    }
    globalInstances.clear();
    globalSingletonIndex = 0;
  }
}

// =============================================================================
// Re-exports
// =============================================================================

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
  ClaudeRemoteClientConfig,
  CircuitBreakerConfig,
};
