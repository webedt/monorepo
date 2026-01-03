/**
 * Service Scope Documentation Interface
 *
 * This file contains the fully-documented interface for the Service Scope.
 * A Service Scope is a scoped container for request/page-level services that
 * falls back to the global ServiceProvider for services not found in scope.
 *
 * @see ServiceScope for the implementation class
 * @see ServiceProvider for the global service registry
 * @see AService for the base service class
 */

import type { AService } from './abstracts/AService.js';

/**
 * Abstract class constructor type for service tokens.
 *
 * This type allows abstract classes to be used as runtime keys for service lookup.
 * Unlike interfaces which are erased at runtime, abstract classes exist as values.
 */
export type AbstractClass<T> = abstract new (...args: unknown[]) => T;

/**
 * Interface for Service Scope with full documentation.
 *
 * A Service Scope provides request-scoped or page-scoped service instances.
 * Services registered in a scope are isolated from the global registry and
 * can be disposed independently when the request completes.
 *
 * ## When to Use Scopes
 *
 * - **Per-request context**: User authentication, request tracing
 * - **Transaction boundaries**: Database transaction context
 * - **Temporary overrides**: Test-specific service implementations
 * - **Resource isolation**: Services that should be disposed per-request
 *
 * ## Scope Lifecycle
 *
 * 1. **Creation**: `ServiceProvider.createScope()`
 * 2. **Registration**: Register request-specific services
 * 3. **Initialization**: `ServiceProvider.initialize(scope)`
 * 4. **Usage**: Get services (falls back to global for unregistered)
 * 5. **Disposal**: `scope.dispose()` - cleans up scope services only
 *
 * ## Fallback Behavior
 *
 * When a service is not found in the scope, it automatically falls back
 * to the global ServiceProvider. This allows scopes to override only
 * specific services while using global instances for everything else.
 *
 * @example
 * ```typescript
 * // Request handler with scoped services
 * app.use(async (req, res, next) => {
 *   // 1. Create scope for this request
 *   const scope = ServiceProvider.createScope();
 *
 *   // 2. Register request-scoped services
 *   scope.register(AUserContext, new UserContext(req.user));
 *   scope.register(ARequestTracer, new RequestTracer(req.id));
 *
 *   // 3. Initialize (waits for global init if needed)
 *   await ServiceProvider.initialize(scope);
 *
 *   // 4. Attach to request for use in handlers
 *   req.scope = scope;
 *
 *   res.on('finish', async () => {
 *     // 5. Cleanup when request completes
 *     await scope.dispose();
 *   });
 *
 *   next();
 * });
 *
 * // Route handler
 * router.get('/', async (req, res) => {
 *   // Get scoped service
 *   const userCtx = req.scope.get(AUserContext);
 *
 *   // Falls back to global logger
 *   const logger = req.scope.get(ALogger);
 *
 *   logger.info('Processing request', { user: userCtx.userId });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Testing with scoped overrides
 * describe('SessionHandler', () => {
 *   let scope: ServiceScope;
 *
 *   beforeEach(async () => {
 *     scope = ServiceProvider.createScope();
 *
 *     // Override database service with mock
 *     scope.register(ADatabase, new MockDatabase());
 *
 *     await ServiceProvider.initialize(scope);
 *   });
 *
 *   afterEach(async () => {
 *     await scope.dispose();
 *   });
 *
 *   it('uses mock database', async () => {
 *     const db = scope.get(ADatabase); // Returns MockDatabase
 *     const logger = scope.get(ALogger); // Returns global Logger
 *   });
 * });
 * ```
 */
export interface IServiceScopeDocumentation {
  /**
   * Register a service to this scope.
   *
   * Services registered in a scope override global services when accessed
   * through this scope. Registration must happen before initialization.
   *
   * @param token - Abstract class to use as the service token
   * @param instance - Concrete service instance
   * @throws Error if called after scope initialization
   *
   * @example
   * ```typescript
   * const scope = ServiceProvider.createScope();
   *
   * // Register request-specific services
   * scope.register(AUserContext, new UserContext(req.user));
   * scope.register(ATransaction, new DatabaseTransaction());
   *
   * // Must register before initialize
   * await ServiceProvider.initialize(scope);
   *
   * // This would throw after initialization:
   * // scope.register(AOtherService, instance);
   * ```
   */
  register<T extends AService>(token: AbstractClass<T>, instance: T): void;

  /**
   * Get a service from this scope, falling back to global if not found.
   *
   * First checks if the service is registered in this scope. If not found,
   * falls back to the global ServiceProvider. Throws if not found in either.
   *
   * @param token - Abstract class token to look up
   * @returns Service instance (correctly typed)
   * @throws Error if service not found in scope or global
   *
   * @example
   * ```typescript
   * // Get scoped service (registered in this scope)
   * const userCtx = scope.get(AUserContext);
   *
   * // Get global service (not in scope, falls back to global)
   * const logger = scope.get(ALogger);
   *
   * // Throws if not registered anywhere
   * const unknown = scope.get(AUnregisteredService); // Error!
   * ```
   *
   * @example
   * ```typescript
   * // Scoped override takes precedence
   * scope.register(ALogger, new CustomLogger());
   * await ServiceProvider.initialize(scope);
   *
   * const logger = scope.get(ALogger); // Returns CustomLogger, not global
   * ```
   */
  get<T extends AService>(token: AbstractClass<T>): T;

  /**
   * Check if a service exists in this scope or global.
   *
   * Returns true if the service is registered in this scope OR in the
   * global ServiceProvider.
   *
   * @param token - Abstract class token to check
   * @returns true if service is available
   *
   * @example
   * ```typescript
   * if (scope.has(AOptionalService)) {
   *   const service = scope.get(AOptionalService);
   *   await service.doOptionalThing();
   * }
   * ```
   */
  has<T extends AService>(token: AbstractClass<T>): boolean;

  /**
   * Check if this scope is initialized.
   *
   * A scope is initialized after `ServiceProvider.initialize(scope)` completes.
   * Services can only be accessed after initialization.
   *
   * @returns true if initialize() has completed for this scope
   *
   * @example
   * ```typescript
   * const scope = ServiceProvider.createScope();
   * scope.register(AService, instance);
   *
   * console.log(scope.isInitialized()); // false
   *
   * await ServiceProvider.initialize(scope);
   *
   * console.log(scope.isInitialized()); // true
   * ```
   */
  isInitialized(): boolean;

  /**
   * Dispose all services in this scope.
   *
   * Calls `dispose()` on all services registered in this scope, in reverse
   * order of their initialization order. Global services are NOT affected.
   *
   * After disposal:
   * - Scope services are cleared
   * - Scope is marked as not initialized
   * - Services cannot be accessed (would need re-registration and init)
   *
   * @example
   * ```typescript
   * const scope = ServiceProvider.createScope();
   * scope.register(ATransaction, new DatabaseTransaction());
   * await ServiceProvider.initialize(scope);
   *
   * try {
   *   // Use scoped services
   *   const tx = scope.get(ATransaction);
   *   await tx.commit();
   * } finally {
   *   // Always dispose to clean up resources
   *   await scope.dispose();
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Express middleware pattern
   * app.use(async (req, res, next) => {
   *   const scope = ServiceProvider.createScope();
   *   scope.register(ARequestContext, new RequestContext(req));
   *   await ServiceProvider.initialize(scope);
   *
   *   req.scope = scope;
   *
   *   // Dispose on response finish
   *   res.on('finish', () => scope.dispose());
   *
   *   next();
   * });
   * ```
   */
  dispose(): Promise<void>;
}

/**
 * Internal methods for ServiceScope.
 *
 * These methods are called by ServiceProvider and should not be used directly.
 */
export interface IServiceScopeInternalDocumentation {
  /**
   * Set the parent provider for fallback lookups.
   *
   * @internal Called by ServiceProvider during initialization
   * @param parent - Parent provider with get/has methods
   *
   * @example
   * ```typescript
   * // ServiceProvider.initialize() does this internally:
   * scope._setParent({
   *   get: (token) => ServiceProvider.get(token),
   *   has: (token) => ServiceProvider.has(token),
   * });
   * ```
   */
  _setParent(parent: {
    get<T extends AService>(token: AbstractClass<T>): T;
    has<T extends AService>(token: AbstractClass<T>): boolean;
  }): void;

  /**
   * Initialize all services in this scope.
   *
   * @internal Called by ServiceProvider.initialize(scope)
   *
   * Initializes scoped services in order of their `order` property.
   * Must be called after global services are initialized.
   *
   * @example
   * ```typescript
   * // ServiceProvider.initialize(scope) does this internally:
   * await scope._initialize();
   * ```
   */
  _initialize(): Promise<void>;
}
