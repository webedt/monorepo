/**
 * Service Container Documentation Interface
 *
 * This file contains the fully-documented interface for the Service Container.
 * The Service Container provides explicit dependency injection for route handlers
 * and services, making all dependencies visible at construction time.
 *
 * @see ServiceContainer for the main container interface
 * @see createServiceContainer for the factory function
 * @see createMockServiceContainer for testing utilities
 */

import type { ALogger } from '../utils/logging/ALogger.js';
import type { ALogCapture } from '../utils/logging/ALogCapture.js';
import type { AMetricsRegistry } from '../utils/monitoring/AMetricsRegistry.js';
import type { AHealthMonitor } from '../utils/monitoring/AHealthMonitor.js';
import type { ACircuitBreakerRegistry } from '../utils/resilience/ACircuitBreaker.js';
import type { ASession } from '../sessions/ASession.js';
import type { ASessionEventBroadcaster } from '../sessions/ASessionEventBroadcaster.js';
import type { ASessionListBroadcaster } from '../sessions/ASessionListBroadcaster.js';
import type { ASessionCleanupService } from '../sessions/ASessionCleanupService.js';
import type { AEventStorageService } from '../sessions/AEventStorageService.js';
import type { ASessionQueryService } from '../sessions/ASessionQueryService.js';
import type { ASessionAuthorizationService } from '../sessions/ASessionAuthorizationService.js';
import type { AClaudeWebClient } from '../claudeWeb/AClaudeWebClient.js';
import type { AGitHubClient } from '../github/AGitHubClient.js';
import type { ALlm } from '../llm/ALlm.js';
import type { ATokenRefreshService } from '../auth/ATokenRefreshService.js';
import type { AEventFormatter } from '../utils/formatters/AEventFormatter.js';
import type { ASseHelper } from '../utils/http/ASseHelper.js';

/**
 * Interface for Service Container with full documentation.
 *
 * The Service Container provides explicit dependency injection for route handlers
 * and services. Unlike using `ServiceProvider.get()` which hides dependencies,
 * the container makes all dependencies explicit at construction time.
 *
 * ## Benefits
 *
 * - **Explicit dependencies**: All services needed are declared upfront
 * - **Easy testing**: Create mock containers for unit tests
 * - **Type safety**: Full TypeScript inference for service types
 * - **No global state**: Container can be scoped per request
 *
 * ## Usage Patterns
 *
 * ### Route Factory Pattern
 *
 * Pass the container to route factory functions:
 *
 * ```typescript
 * // In route factory
 * export function createSessionRoutes(container: SessionCrudServices) {
 *   const router = Router();
 *
 *   router.get('/', async (req, res) => {
 *     const sessions = await container.sessionQueryService.listActive(userId);
 *     res.json({ sessions });
 *   });
 *
 *   router.delete('/:id', async (req, res) => {
 *     container.logger.info('Deleting session', { id: req.params.id });
 *     await container.sessionQueryService.delete(req.params.id);
 *     res.sendStatus(204);
 *   });
 *
 *   return router;
 * }
 *
 * // In app setup
 * const container = createServiceContainer();
 * app.use('/api/sessions', createSessionRoutes(container));
 * ```
 *
 * ### Testing Pattern
 *
 * Create mock containers for unit testing:
 *
 * ```typescript
 * import { createMockServiceContainer } from '@webedt/shared';
 *
 * const mockContainer = createMockServiceContainer({
 *   sessionQueryService: {
 *     listActive: async () => [mockSession],
 *     getById: async () => mockSession,
 *   } as unknown as ASessionQueryService,
 *   logger: mockLogger,
 * });
 *
 * const router = createSessionRoutes(mockContainer);
 * // Test router with mock services
 * ```
 *
 * ### Subset Container Pattern
 *
 * Use subset interfaces to pass only required services:
 *
 * ```typescript
 * // Define what a route needs
 * interface MyRouteServices {
 *   readonly sessionQueryService: ASessionQueryService;
 *   readonly logger: ALogger;
 * }
 *
 * // Route only sees what it needs
 * function createMyRoute(services: MyRouteServices) {
 *   // Can only access sessionQueryService and logger
 * }
 *
 * // Extract subset from full container
 * const fullContainer = createServiceContainer();
 * const subset = extractSessionCrudServices(fullContainer);
 * ```
 *
 * ## Container Lifecycle
 *
 * 1. **Initialization**: Call `createServiceContainer()` after `ServiceProvider.initialize()`
 * 2. **Usage**: Pass container to route factories and middleware
 * 3. **Testing**: Use `createMockServiceContainer()` for isolated tests
 *
 * @example
 * ```typescript
 * // Complete setup example
 * import {
 *   ServiceProvider,
 *   createServiceContainer,
 *   ALogger,
 *   Logger,
 * } from '@webedt/shared';
 *
 * // 1. Register services
 * ServiceProvider.register(ALogger, new Logger());
 * // ... register other services
 *
 * // 2. Initialize
 * await ServiceProvider.initialize();
 *
 * // 3. Create container
 * const container = createServiceContainer();
 *
 * // 4. Use in routes
 * app.use('/api/sessions', createSessionRoutes(container));
 * ```
 */
export interface IServiceContainerDocumentation {
  /**
   * Logger service for application-wide logging.
   *
   * Provides structured logging with context enrichment.
   *
   * @example
   * ```typescript
   * container.logger.info('Processing request', { userId, sessionId });
   * container.logger.error('Operation failed', error, { operation: 'delete' });
   * ```
   */
  readonly logger: ALogger;

  /**
   * Log capture service for collecting and filtering logs.
   *
   * Useful for debugging and exposing logs via API.
   *
   * @example
   * ```typescript
   * const logs = container.logCapture.getLogs({ level: 'error', limit: 100 });
   * ```
   */
  readonly logCapture: ALogCapture;

  /**
   * Metrics registry for performance monitoring.
   *
   * Records counters, histograms, and gauges for observability.
   *
   * @example
   * ```typescript
   * container.metricsRegistry.incrementCounter('api_requests', { route: '/sessions' });
   * container.metricsRegistry.recordHistogram('response_time', 150, { route: '/sessions' });
   * ```
   */
  readonly metricsRegistry: AMetricsRegistry;

  /**
   * Health monitor for service health checks.
   *
   * Aggregates health from multiple sources for /health endpoints.
   *
   * @example
   * ```typescript
   * const health = await container.healthMonitor.getDetailedHealth();
   * if (!health.healthy) {
   *   console.log('Unhealthy services:', health.services);
   * }
   * ```
   */
  readonly healthMonitor: AHealthMonitor;

  /**
   * Circuit breaker registry for resilience patterns.
   *
   * Manages circuit breakers for external service calls.
   *
   * @example
   * ```typescript
   * const breaker = container.circuitBreakerRegistry.get('github-api');
   * const result = await breaker.execute(() => fetchFromGitHub());
   * ```
   */
  readonly circuitBreakerRegistry: ACircuitBreakerRegistry;

  /**
   * Session service for session management.
   *
   * Handles session creation, updates, and lifecycle.
   *
   * @example
   * ```typescript
   * const session = await container.sessionService.create(params);
   * await container.sessionService.updateStatus(sessionId, 'completed');
   * ```
   */
  readonly sessionService: ASession;

  /**
   * Session event broadcaster for real-time updates.
   *
   * Broadcasts session events to connected clients via SSE.
   *
   * @example
   * ```typescript
   * container.sessionEventBroadcaster.broadcast(sessionId, {
   *   type: 'progress',
   *   message: 'Analyzing code...',
   * });
   * ```
   */
  readonly sessionEventBroadcaster: ASessionEventBroadcaster;

  /**
   * Session list broadcaster for session list updates.
   *
   * Notifies clients when session lists change.
   *
   * @example
   * ```typescript
   * container.sessionListBroadcaster.broadcastUpdate(userId, 'created', sessionId);
   * ```
   */
  readonly sessionListBroadcaster: ASessionListBroadcaster;

  /**
   * Session cleanup service for maintenance.
   *
   * Handles orphan session cleanup and resource reclamation.
   *
   * @example
   * ```typescript
   * const result = await container.sessionCleanupService.cleanupOrphans();
   * console.log(`Cleaned up ${result.count} orphan sessions`);
   * ```
   */
  readonly sessionCleanupService: ASessionCleanupService;

  /**
   * Event storage service for event persistence.
   *
   * Stores and retrieves session events for replay.
   *
   * @example
   * ```typescript
   * await container.eventStorageService.storeEvent(sessionId, event);
   * const events = await container.eventStorageService.getEvents(sessionId);
   * ```
   */
  readonly eventStorageService: AEventStorageService;

  /**
   * Session query service for session lookups.
   *
   * Provides efficient session queries with filtering and pagination.
   *
   * @example
   * ```typescript
   * const sessions = await container.sessionQueryService.listActive(userId, {
   *   limit: 20,
   *   offset: 0,
   *   sortBy: 'updatedAt',
   * });
   * ```
   */
  readonly sessionQueryService: ASessionQueryService;

  /**
   * Session authorization service for access control.
   *
   * Validates user permissions for session operations.
   *
   * @example
   * ```typescript
   * const authResult = await container.sessionAuthorizationService.canAccess(
   *   userId,
   *   sessionId,
   *   'write'
   * );
   * if (!authResult.authorized) {
   *   throw new ForbiddenError(authResult.reason);
   * }
   * ```
   */
  readonly sessionAuthorizationService: ASessionAuthorizationService;

  /**
   * Claude Web Client for AI execution.
   *
   * Interfaces with Claude Remote Sessions API.
   *
   * @example
   * ```typescript
   * const result = await container.claudeWebClient.execute({
   *   prompt: 'Add unit tests',
   *   gitUrl: 'https://github.com/org/repo',
   * }, onEvent);
   * ```
   */
  readonly claudeWebClient: AClaudeWebClient;

  /**
   * GitHub client for repository operations.
   *
   * Handles GitHub API interactions.
   *
   * @example
   * ```typescript
   * const repos = await container.githubClient.listRepositories(accessToken);
   * const branches = await container.githubClient.listBranches(owner, repo, token);
   * ```
   */
  readonly githubClient: AGitHubClient;

  /**
   * LLM service for language model operations.
   *
   * Abstracts different LLM providers (OpenRouter, local, etc.).
   *
   * @example
   * ```typescript
   * const response = await container.llm.complete({
   *   prompt: 'Summarize this code',
   *   model: 'gpt-4',
   * });
   * ```
   */
  readonly llm: ALlm;

  /**
   * Token refresh service for OAuth management.
   *
   * Handles automatic token refresh for connected services.
   *
   * @example
   * ```typescript
   * const token = await container.tokenRefreshService.getValidToken(userId, 'github');
   * ```
   */
  readonly tokenRefreshService: ATokenRefreshService;

  /**
   * Event formatter for display formatting.
   *
   * Formats execution events for CLI or web display.
   *
   * @example
   * ```typescript
   * const formatted = container.eventFormatter.format(event, { colorize: true });
   * console.log(formatted.text);
   * ```
   */
  readonly eventFormatter: AEventFormatter;

  /**
   * SSE helper for Server-Sent Events.
   *
   * Utilities for SSE stream management.
   *
   * @example
   * ```typescript
   * const stream = container.sseHelper.createStream(res);
   * stream.send({ type: 'progress', data: 'Processing...' });
   * ```
   */
  readonly sseHelper: ASseHelper;
}

/**
 * Interface for creating service containers with documentation.
 *
 * Factory functions for creating containers in different contexts.
 */
export interface IServiceContainerFactoryDocumentation {
  /**
   * Create a service container from the global ServiceProvider.
   *
   * Call this after `ServiceProvider.initialize()` to get an explicit container.
   * The container can then be passed to route factories and middleware.
   *
   * @returns ServiceContainer with all services from ServiceProvider
   * @throws Error if ServiceProvider is not initialized
   *
   * @example
   * ```typescript
   * // At application startup
   * await ServiceProvider.initialize();
   *
   * // Create container
   * const container = createServiceContainer();
   *
   * // Pass to routes
   * app.use('/api/sessions', createSessionRoutes(container));
   * app.use('/api/github', createGitHubRoutes(container));
   * ```
   */
  createServiceContainer(): IServiceContainerDocumentation;

  /**
   * Create a lazy service container that defers service lookups.
   *
   * Useful when you need to create the container before services are initialized,
   * but won't access services until after initialization.
   *
   * @returns ServiceContainer with lazy service accessors
   *
   * @example
   * ```typescript
   * // Create container before initialization
   * const lazyContainer = createLazyServiceContainer();
   *
   * // Later, after initialization
   * await ServiceProvider.initialize();
   *
   * // Now services are accessible
   * const logger = lazyContainer.logger;
   * ```
   */
  createLazyServiceContainer(): IServiceContainerDocumentation;

  /**
   * Create a mock service container for testing.
   *
   * Accepts partial overrides - any services not provided will throw
   * an error when accessed, helping identify missing mocks.
   *
   * @param overrides - Partial container with mock services
   * @returns ServiceContainer that throws for unmocked services
   *
   * @example
   * ```typescript
   * import { mock } from 'node:test';
   *
   * // Create mock with only needed services
   * const mockContainer = createMockServiceContainer({
   *   sessionQueryService: {
   *     listActive: mock.fn(async () => [mockSession]),
   *     getById: mock.fn(async () => mockSession),
   *   } as unknown as ASessionQueryService,
   *   logger: {
   *     info: mock.fn(),
   *     error: mock.fn(),
   *   } as unknown as ALogger,
   * });
   *
   * // Use in tests
   * const router = createSessionRoutes(mockContainer);
   * await request(router).get('/').expect(200);
   *
   * // Accessing unmocked services throws
   * mockContainer.githubClient; // Error: Mock not provided for githubClient
   * ```
   */
  createMockServiceContainer(
    overrides: Partial<IServiceContainerDocumentation>
  ): IServiceContainerDocumentation;
}

/**
 * Interface for subset container extraction with documentation.
 *
 * Functions to extract specific service subsets from a full container.
 * Use these when routes or middleware only need specific services.
 */
export interface ISubsetContainerDocumentation {
  /**
   * Extract session CRUD services from container.
   *
   * @param container - Full service container
   * @returns Subset with sessionQueryService and logger
   *
   * @example
   * ```typescript
   * const crudServices = extractSessionCrudServices(container);
   * // crudServices has: sessionQueryService, logger
   * ```
   */
  extractSessionCrudServices(container: IServiceContainerDocumentation): {
    readonly sessionQueryService: ASessionQueryService;
    readonly logger: ALogger;
  };

  /**
   * Extract session middleware services from container.
   *
   * @param container - Full service container
   * @returns Subset with session query, authorization, and logger
   *
   * @example
   * ```typescript
   * const middlewareServices = extractSessionMiddlewareServices(container);
   * // middlewareServices has: sessionQueryService, sessionAuthorizationService, logger
   * ```
   */
  extractSessionMiddlewareServices(container: IServiceContainerDocumentation): {
    readonly sessionQueryService: ASessionQueryService;
    readonly sessionAuthorizationService: ASessionAuthorizationService;
    readonly logger: ALogger;
  };

  /**
   * Extract Claude CLI services from container.
   *
   * @param container - Full service container
   * @returns Subset with claudeWebClient, eventFormatter, and logger
   *
   * @example
   * ```typescript
   * const cliServices = extractClaudeCliServices(container);
   * // cliServices has: claudeWebClient, eventFormatter, logger
   * ```
   */
  extractClaudeCliServices(container: IServiceContainerDocumentation): {
    readonly claudeWebClient: AClaudeWebClient;
    readonly eventFormatter: AEventFormatter;
    readonly logger: ALogger;
  };
}
