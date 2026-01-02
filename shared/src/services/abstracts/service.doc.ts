/**
 * Base Service Documentation Interface
 *
 * This file contains the fully-documented interface for the base Service class.
 * All services in the application extend AService to integrate with the
 * ServiceProvider lifecycle management system.
 *
 * @see AService for the abstract base class
 * @see ServiceProvider for the service container and lifecycle management
 */

/**
 * Interface for Base Service with full documentation.
 *
 * The base service class provides a consistent lifecycle for all services
 * in the application. Services are managed by the ServiceProvider which
 * handles initialization order, dependency injection, and cleanup.
 *
 * ## Service Lifecycle
 *
 * 1. **Registration**: Service is registered with ServiceProvider
 * 2. **Initialization**: `initialize()` called in order (by `order` property)
 * 3. **Operation**: Service is active and accessible via ServiceProvider
 * 4. **Disposal**: `dispose()` called during shutdown or reset
 *
 * ## Initialization Order
 *
 * Services are initialized in order based on their `order` property:
 * - Negative values: Core services (logging, metrics) - initialize first
 * - Zero: Default for most services
 * - Positive values: Services with dependencies - initialize later
 *
 * Common order values:
 * - `-100`: Logger (needs to be ready for all other services)
 * - `-50`: Metrics registry
 * - `0`: Most services (default)
 * - `50`: Claude Web Client (depends on auth services)
 * - `100`: Services with multiple dependencies
 *
 * ## Creating a New Service
 *
 * 1. Create abstract class extending AService with method signatures
 * 2. Create .doc.ts file with documentation interface
 * 3. Create implementation class extending the abstract class
 * 4. Register with ServiceProvider
 *
 * ```typescript
 * // Abstract class (AMyService.ts)
 * export abstract class AMyService extends AService {
 *   readonly order = 10;
 *   abstract doSomething(): Promise<void>;
 * }
 *
 * // Implementation (MyService.ts)
 * class MyService extends AMyService {
 *   async initialize(): Promise<void> {
 *     // Setup connections, load config, etc.
 *   }
 *
 *   async doSomething(): Promise<void> {
 *     // Implementation
 *   }
 *
 *   async dispose(): Promise<void> {
 *     // Cleanup resources
 *   }
 * }
 *
 * // Registration
 * serviceProvider.register(AMyService, new MyService());
 *
 * // Usage
 * const myService = serviceProvider.get(AMyService);
 * await myService.doSomething();
 * ```
 */
export interface IServiceDocumentation {
  /**
   * Initialization order for the service.
   *
   * Determines when this service is initialized relative to other services.
   * Lower numbers initialize first. Use negative values for core services
   * that other services depend on.
   *
   * @default 0
   *
   * @example
   * ```typescript
   * // Logger initializes first
   * class Logger extends AService {
   *   readonly order = -100;
   * }
   *
   * // Database connects early
   * class Database extends AService {
   *   readonly order = -50;
   * }
   *
   * // Default order for most services
   * class UserService extends AService {
   *   readonly order = 0;
   * }
   *
   * // Depends on UserService, init later
   * class NotificationService extends AService {
   *   readonly order = 50;
   * }
   * ```
   */
  readonly order: number;

  /**
   * Initialize the service.
   *
   * Called by ServiceProvider after all services are registered, in order
   * of the `order` property. Override this method to perform async setup
   * such as:
   * - Establishing database connections
   * - Loading configuration from external sources
   * - Setting up authentication
   * - Starting background tasks
   *
   * If initialization fails, throw an error to prevent dependent services
   * from starting.
   *
   * @throws Error if initialization fails
   *
   * @example
   * ```typescript
   * class DatabaseService extends AService {
   *   private pool: Pool | null = null;
   *
   *   async initialize(): Promise<void> {
   *     this.pool = await createPool({
   *       connectionString: process.env.DATABASE_URL,
   *     });
   *
   *     // Verify connection
   *     await this.pool.query('SELECT 1');
   *     console.log('Database connected');
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * class CacheService extends AService {
   *   readonly order = -30; // Initialize after logger but before business services
   *
   *   async initialize(): Promise<void> {
   *     const redis = await createRedisClient();
   *     await redis.ping();
   *     this.client = redis;
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * class ConfigService extends AService {
   *   readonly order = -80; // Early initialization
   *
   *   async initialize(): Promise<void> {
   *     // Load config from remote source
   *     const response = await fetch(CONFIG_URL);
   *     this.config = await response.json();
   *
   *     // Validate required fields
   *     if (!this.config.apiKey) {
   *       throw new Error('Missing required config: apiKey');
   *     }
   *   }
   * }
   * ```
   */
  initialize(): Promise<void>;

  /**
   * Dispose of service resources.
   *
   * Called by ServiceProvider during shutdown or reset. Override this
   * method to perform cleanup such as:
   * - Closing database connections
   * - Stopping background tasks
   * - Flushing buffers
   * - Releasing external resources
   *
   * Services are disposed in reverse order of initialization, ensuring
   * dependent services are cleaned up before their dependencies.
   *
   * @example
   * ```typescript
   * class DatabaseService extends AService {
   *   private pool: Pool | null = null;
   *
   *   async dispose(): Promise<void> {
   *     if (this.pool) {
   *       await this.pool.end();
   *       this.pool = null;
   *       console.log('Database connection closed');
   *     }
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * class BackgroundJobService extends AService {
   *   private intervalId: NodeJS.Timeout | null = null;
   *
   *   async initialize(): Promise<void> {
   *     this.intervalId = setInterval(() => this.runJob(), 60000);
   *   }
   *
   *   async dispose(): Promise<void> {
   *     if (this.intervalId) {
   *       clearInterval(this.intervalId);
   *       this.intervalId = null;
   *     }
   *     // Wait for any running job to complete
   *     await this.waitForJobCompletion();
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * class MetricsService extends AService {
   *   readonly order = -50;
   *
   *   async dispose(): Promise<void> {
   *     // Flush any pending metrics before shutdown
   *     await this.flush();
   *     console.log('Metrics flushed');
   *   }
   * }
   * ```
   */
  dispose(): Promise<void>;
}
