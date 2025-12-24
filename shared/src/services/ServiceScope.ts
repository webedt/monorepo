/**
 * Service Scope
 *
 * A scoped container for request/page-level services.
 * Falls back to global ServiceProvider for services not found in scope.
 *
 * @example
 * ```typescript
 * const scope = ServiceProvider.createScope();
 *
 * // Register request-scoped services
 * scope.register(AUserContext, new UserContext(req.user));
 *
 * // Initialize scope (waits for global init if needed)
 * await ServiceProvider.initialize(scope);
 *
 * // Use services - falls back to global
 * const logger = scope.get(ALogger);      // From global
 * const userCtx = scope.get(AUserContext); // From scope
 *
 * // Cleanup when done
 * await scope.dispose();
 * ```
 */
import type { AService } from './abstracts/AService.js';

/**
 * Abstract class constructor type for service tokens.
 */
export type AbstractClass<T> = abstract new (...args: unknown[]) => T;

/**
 * Service Scope - request/page-level service container.
 */
export class ServiceScope {
  private instances = new Map<AbstractClass<AService>, AService>();
  private initialized = false;
  private parent: { get<T extends AService>(token: AbstractClass<T>): T; has<T extends AService>(token: AbstractClass<T>): boolean } | null = null;

  /**
   * Set the parent provider (for fallback lookups).
   * @internal Called by ServiceProvider
   */
  _setParent(parent: { get<T extends AService>(token: AbstractClass<T>): T; has<T extends AService>(token: AbstractClass<T>): boolean }): void {
    this.parent = parent;
  }

  /**
   * Register a service to this scope.
   */
  register<T extends AService>(token: AbstractClass<T>, instance: T): void {
    if (this.initialized) {
      throw new Error('Cannot register after scope initialization');
    }
    this.instances.set(token as AbstractClass<AService>, instance);
  }

  /**
   * Get a service from this scope, falling back to global if not found.
   */
  get<T extends AService>(token: AbstractClass<T>): T {
    // Check scope first
    const instance = this.instances.get(token as AbstractClass<AService>);
    if (instance) {
      return instance as T;
    }

    // Fall back to parent (global)
    if (this.parent) {
      return this.parent.get(token);
    }

    throw new Error(`Service not registered: ${token.name}`);
  }

  /**
   * Check if a service exists in this scope or global.
   */
  has<T extends AService>(token: AbstractClass<T>): boolean {
    if (this.instances.has(token as AbstractClass<AService>)) {
      return true;
    }
    return this.parent?.has(token) ?? false;
  }

  /**
   * Check if this scope is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Initialize all services in this scope.
   * @internal Called by ServiceProvider.initialize(scope)
   */
  async _initialize(): Promise<void> {
    if (this.initialized) return;

    // Sort services by order (lowest first)
    const sorted = [...this.instances.values()].sort((a, b) => a.order - b.order);

    // Initialize in order
    for (const instance of sorted) {
      await instance.initialize();
    }
    this.initialized = true;
  }

  /**
   * Dispose all services in this scope.
   */
  async dispose(): Promise<void> {
    // Sort services by order descending (dispose in reverse order)
    const sorted = [...this.instances.values()].sort((a, b) => b.order - a.order);

    for (const instance of sorted) {
      await instance.dispose();
    }
    this.instances.clear();
    this.initialized = false;
  }
}
