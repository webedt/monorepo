/**
 * Service Provider Documentation Interface
 *
 * This file contains the fully-documented interface for the Service Provider.
 * The Service Provider is the central dependency injection registry using
 * abstract classes as tokens for type-safe service lookup.
 *
 * @see ServiceProvider for the static service registry
 * @see ServiceScope for request-scoped containers
 * @see AService for the base service class
 */

import type { AService } from './abstracts/AService.js';
import type { ServiceScope } from './ServiceScope.js';

/**
 * Abstract class constructor type for service tokens.
 *
 * This type enables abstract classes to be used as runtime keys for service lookup.
 * Unlike interfaces which are erased at runtime, abstract classes exist as values
 * and can be used as Map keys.
 *
 * @example
 * ```typescript
 * // Abstract class can be used as both type and runtime key
 * abstract class ALogger extends AService {
 *   abstract info(message: string): void;
 * }
 *
 * // Use as token for registration and lookup
 * ServiceProvider.register(ALogger, new ConsoleLogger());
 * const logger = ServiceProvider.get(ALogger); // Typed as ALogger
 * ```
 */
export type AbstractClass<T> = abstract new (...args: unknown[]) => T;

/**
 * Interface for Service Provider with full documentation.
 *
 * The Service Provider is a type-safe service locator using abstract classes
 * as tokens. It provides:
 *
 * - **Runtime keys**: Abstract classes exist at runtime (unlike interfaces)
 * - **Type safety**: TypeScript infers return type from token
 * - **No generics at call site**: `get(ALogger)` not `get<ALogger>('logger')`
 * - **Initialization order**: Services init by `order` property
 * - **Scoped services**: Request-level overrides via ServiceScope
 *
 * ## Design Philosophy
 *
 * The pattern uses abstract classes as tokens because:
 *
 * 1. **Abstract classes exist at runtime** - Unlike interfaces, they can be
 *    used as Map keys and for instanceof checks
 * 2. **Type inference works** - TypeScript knows `get(ALogger)` returns `ALogger`
 * 3. **Single source of truth** - The abstract class defines both the interface
 *    and the lookup key
 *
 * ## Service Lifecycle
 *
 * ```
 * register() → initialize() → get() → reset()
 *     ↓            ↓           ↓         ↓
 *   Store      Call init   Retrieve   Dispose
 *  instance    in order    instance   & clear
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { ServiceProvider, ALogger, ADatabase } from '@webedt/shared';
 *
 * // 1. Register services (before initialize)
 * ServiceProvider.register(ALogger, new ConsoleLogger());
 * ServiceProvider.register(ADatabase, new PostgresDatabase());
 *
 * // 2. Initialize all services (in order)
 * await ServiceProvider.initialize();
 *
 * // 3. Get services (type-safe!)
 * const logger = ServiceProvider.get(ALogger);
 * const db = ServiceProvider.get(ADatabase);
 *
 * // 4. Reset on shutdown
 * await ServiceProvider.reset();
 * ```
 *
 * @example
 * ```typescript
 * // Complete application bootstrap
 * async function bootstrap() {
 *   // Register core services first (negative order)
 *   ServiceProvider.register(ALogger, new Logger());         // order: -100
 *   ServiceProvider.register(AMetrics, new MetricsRegistry()); // order: -50
 *
 *   // Register business services (default order)
 *   ServiceProvider.register(AUserService, new UserService());
 *   ServiceProvider.register(ASessionService, new SessionService());
 *
 *   // Register services with dependencies (positive order)
 *   ServiceProvider.register(AApiClient, new ApiClient()); // order: 50
 *
 *   // Initialize all - calls each service's initialize() in order
 *   await ServiceProvider.initialize();
 *
 *   console.log('All services initialized');
 * }
 * ```
 */
export interface IServiceProviderDocumentation {
  /**
   * Register a global service.
   *
   * Services must be registered before `initialize()` is called.
   * The abstract class token is used for both lookup and type inference.
   *
   * @param token - Abstract class to use as the service token
   * @param instance - Concrete service instance
   * @throws Error if called after initialization
   *
   * @example
   * ```typescript
   * // Define abstract service
   * abstract class AEmailService extends AService {
   *   abstract send(to: string, subject: string, body: string): Promise<void>;
   * }
   *
   * // Create implementation
   * class SendGridEmailService extends AEmailService {
   *   async send(to: string, subject: string, body: string): Promise<void> {
   *     // Implementation
   *   }
   * }
   *
   * // Register
   * ServiceProvider.register(AEmailService, new SendGridEmailService());
   * ```
   *
   * @example
   * ```typescript
   * // Registration order doesn't matter - initialization order
   * // is determined by each service's `order` property
   * ServiceProvider.register(AHighPriorityService, instance1); // order: -50
   * ServiceProvider.register(ALowPriorityService, instance2);  // order: 50
   * ServiceProvider.register(ANormalService, instance3);       // order: 0
   *
   * // After initialize(), order was: instance1, instance3, instance2
   * ```
   */
  register<T extends AService>(token: AbstractClass<T>, instance: T): void;

  /**
   * Initialize services.
   *
   * Without scope: Initializes global services in order of their `order` property.
   * With scope: Waits for global init, then initializes scope services.
   *
   * Initialization calls each service's `initialize()` method, which can be
   * async for database connections, auth setup, etc.
   *
   * @param scope - Optional scope to initialize
   * @throws Error if scope is provided but global not yet initialized
   *
   * @example
   * ```typescript
   * // Initialize global services
   * ServiceProvider.register(ALogger, new Logger());     // order: -100
   * ServiceProvider.register(ADatabase, new Database()); // order: -50
   * ServiceProvider.register(AUserService, new UserService()); // order: 0
   *
   * await ServiceProvider.initialize();
   * // Initialization order: Logger → Database → UserService
   * ```
   *
   * @example
   * ```typescript
   * // Initialize with request scope
   * const scope = ServiceProvider.createScope();
   * scope.register(AUserContext, new UserContext(req.user));
   *
   * await ServiceProvider.initialize(scope);
   * // First waits for global init, then initializes scope services
   * ```
   *
   * @example
   * ```typescript
   * // Safe to call multiple times (no-op after first)
   * await ServiceProvider.initialize();
   * await ServiceProvider.initialize(); // No effect
   * ```
   */
  initialize(scope?: ServiceScope): Promise<void>;

  /**
   * Get a global service by its abstract class token.
   *
   * Returns the registered service instance, correctly typed based on the token.
   * Throws if the service is not registered or if called before initialization.
   *
   * @param token - Abstract class token
   * @returns Service instance (correctly typed)
   * @throws Error if not initialized or service not registered
   *
   * @example
   * ```typescript
   * // TypeScript knows the return type!
   * const logger = ServiceProvider.get(ALogger);
   * logger.info('Hello'); // Type-safe method call
   *
   * const db = ServiceProvider.get(ADatabase);
   * await db.query('SELECT * FROM users'); // Type-safe
   * ```
   *
   * @example
   * ```typescript
   * // Throws if not initialized
   * ServiceProvider.get(ALogger);
   * // Error: ServiceProvider not initialized. Call initialize() first.
   * ```
   *
   * @example
   * ```typescript
   * // Throws if not registered
   * await ServiceProvider.initialize();
   * ServiceProvider.get(AUnregisteredService);
   * // Error: Service not registered: AUnregisteredService
   * ```
   */
  get<T extends AService>(token: AbstractClass<T>): T;

  /**
   * Check if a global service is registered.
   *
   * Use this for optional services that may or may not be available.
   *
   * @param token - Abstract class token
   * @returns true if the service is registered
   *
   * @example
   * ```typescript
   * // Check before accessing optional service
   * if (ServiceProvider.has(AAnalyticsService)) {
   *   const analytics = ServiceProvider.get(AAnalyticsService);
   *   analytics.track('user_login', { userId });
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Works before and after initialization
   * ServiceProvider.register(ALogger, new Logger());
   * console.log(ServiceProvider.has(ALogger)); // true
   * console.log(ServiceProvider.has(ADatabase)); // false
   * ```
   */
  has<T extends AService>(token: AbstractClass<T>): boolean;

  /**
   * Create a new service scope for request/page-level services.
   *
   * Scopes allow request-specific service overrides while falling back
   * to global services for everything else.
   *
   * @returns New ServiceScope instance
   *
   * @example
   * ```typescript
   * // Express middleware for request scoping
   * app.use(async (req, res, next) => {
   *   const scope = ServiceProvider.createScope();
   *   scope.register(AUserContext, new UserContext(req.user));
   *   scope.register(ARequestTracer, new RequestTracer(req.id));
   *
   *   await ServiceProvider.initialize(scope);
   *   req.scope = scope;
   *
   *   res.on('finish', () => scope.dispose());
   *   next();
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Testing with mock scope
   * const scope = ServiceProvider.createScope();
   * scope.register(ADatabase, new MockDatabase());
   * await ServiceProvider.initialize(scope);
   *
   * const db = scope.get(ADatabase); // MockDatabase
   * const logger = scope.get(ALogger); // Falls back to global
   * ```
   */
  createScope(): ServiceScope;

  /**
   * Check if global services are initialized.
   *
   * Use this to verify initialization state before accessing services.
   *
   * @returns true if initialize() has completed
   *
   * @example
   * ```typescript
   * if (!ServiceProvider.isInitialized()) {
   *   throw new Error('Application not initialized');
   * }
   *
   * const logger = ServiceProvider.get(ALogger);
   * ```
   *
   * @example
   * ```typescript
   * // Wait for initialization in async context
   * while (!ServiceProvider.isInitialized()) {
   *   await sleep(100);
   * }
   * ```
   */
  isInitialized(): boolean;

  /**
   * Reset all services - dispose and clear registrations.
   *
   * Calls `dispose()` on all services in reverse initialization order,
   * then clears all registrations. After reset, services must be
   * re-registered and re-initialized.
   *
   * Use this for:
   * - Application shutdown
   * - Test cleanup between tests
   * - Hot reloading in development
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down...');
   *   await ServiceProvider.reset();
   *   process.exit(0);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Test cleanup
   * afterEach(async () => {
   *   await ServiceProvider.reset();
   * });
   *
   * beforeEach(async () => {
   *   ServiceProvider.register(ALogger, mockLogger);
   *   await ServiceProvider.initialize();
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Disposal order is reverse of initialization
   * // If init order was: Logger(-100) → Database(-50) → UserService(0)
   * // Dispose order is: UserService → Database → Logger
   * await ServiceProvider.reset();
   * ```
   */
  reset(): Promise<void>;
}

/**
 * Interface documenting the abstract class token pattern.
 *
 * This section explains the design pattern used throughout the service layer.
 *
 * ## Why Abstract Classes as Tokens?
 *
 * TypeScript interfaces are erased at compile time - they don't exist at runtime.
 * This makes them unusable as Map keys or for runtime type checking.
 *
 * Abstract classes solve this:
 * - They exist at runtime as constructor functions
 * - They can be used as Map keys
 * - TypeScript uses them for type inference
 * - They define the contract that implementations must follow
 *
 * ```typescript
 * // Interface - doesn't exist at runtime
 * interface ILogger {
 *   info(message: string): void;
 * }
 *
 * // Abstract class - exists at runtime!
 * abstract class ALogger extends AService {
 *   abstract info(message: string): void;
 * }
 *
 * // This works:
 * const map = new Map<AbstractClass<AService>, AService>();
 * map.set(ALogger, new ConsoleLogger());
 * map.get(ALogger); // Returns ConsoleLogger
 *
 * // This doesn't work:
 * // map.set(ILogger, new ConsoleLogger()); // ILogger doesn't exist at runtime
 * ```
 *
 * ## Creating New Services
 *
 * Follow this pattern for new services:
 *
 * 1. Create abstract class extending AService:
 *    ```typescript
 *    // AEmailService.ts
 *    export abstract class AEmailService extends AService {
 *      readonly order = 50; // After auth services
 *      abstract send(to: string, subject: string, body: string): Promise<void>;
 *    }
 *    ```
 *
 * 2. Create documentation file (optional but recommended):
 *    ```typescript
 *    // emailService.doc.ts
 *    export interface IEmailServiceDocumentation {
 *      /** Send an email *\/
 *      send(to: string, subject: string, body: string): Promise<void>;
 *    }
 *    ```
 *
 * 3. Create implementation:
 *    ```typescript
 *    // EmailService.ts
 *    export class SendGridEmailService extends AEmailService {
 *      async initialize(): Promise<void> {
 *        this.client = new SendGridClient(config.apiKey);
 *      }
 *
 *      async send(to: string, subject: string, body: string): Promise<void> {
 *        await this.client.send({ to, subject, html: body });
 *      }
 *
 *      async dispose(): Promise<void> {
 *        await this.client.close();
 *      }
 *    }
 *    ```
 *
 * 4. Register in bootstrap:
 *    ```typescript
 *    ServiceProvider.register(AEmailService, new SendGridEmailService());
 *    ```
 *
 * 5. Use anywhere:
 *    ```typescript
 *    const email = ServiceProvider.get(AEmailService);
 *    await email.send('user@example.com', 'Welcome!', '<h1>Hello</h1>');
 *    ```
 */
export interface IAbstractClassTokenPatternDocumentation {
  /**
   * Example of defining an abstract service token.
   *
   * @example
   * ```typescript
   * // Abstract class defines the contract
   * export abstract class ACacheService extends AService {
   *   // Initialization order (before services that use cache)
   *   readonly order = -30;
   *
   *   // Abstract methods define the interface
   *   abstract get<T>(key: string): Promise<T | null>;
   *   abstract set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
   *   abstract delete(key: string): Promise<void>;
   *   abstract clear(): Promise<void>;
   * }
   * ```
   */
  abstractServiceExample: never;

  /**
   * Example of implementing an abstract service.
   *
   * @example
   * ```typescript
   * // Implementation extends the abstract class
   * export class RedisCacheService extends ACacheService {
   *   private client: RedisClient | null = null;
   *
   *   async initialize(): Promise<void> {
   *     this.client = await createRedisClient(config.redisUrl);
   *   }
   *
   *   async get<T>(key: string): Promise<T | null> {
   *     const value = await this.client!.get(key);
   *     return value ? JSON.parse(value) : null;
   *   }
   *
   *   async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
   *     const serialized = JSON.stringify(value);
   *     if (ttlMs) {
   *       await this.client!.set(key, serialized, 'PX', ttlMs);
   *     } else {
   *       await this.client!.set(key, serialized);
   *     }
   *   }
   *
   *   async delete(key: string): Promise<void> {
   *     await this.client!.del(key);
   *   }
   *
   *   async clear(): Promise<void> {
   *     await this.client!.flushdb();
   *   }
   *
   *   async dispose(): Promise<void> {
   *     await this.client?.quit();
   *     this.client = null;
   *   }
   * }
   * ```
   */
  implementationExample: never;
}
