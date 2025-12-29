/**
 * Service Container
 *
 * Provides explicit dependency injection for route handlers and services.
 * Unlike ServiceProvider.get() which hides dependencies, ServiceContainer
 * makes all dependencies explicit at construction time.
 *
 * ## Benefits
 * - Explicit dependencies: All services needed are declared upfront
 * - Easy testing: Create mock containers for unit tests
 * - Type safety: Full TypeScript inference for service types
 * - No global state: Container can be scoped per request
 *
 * ## Usage
 *
 * ```typescript
 * // In route factory
 * export function createSessionRoutes(container: SessionServiceContainer) {
 *   const router = Router();
 *
 *   router.get('/', async (req, res) => {
 *     const sessions = await container.sessionQueryService.listActive(userId);
 *     res.json({ sessions });
 *   });
 *
 *   return router;
 * }
 *
 * // In app setup
 * const container = createServiceContainer();
 * app.use('/api/sessions', createSessionRoutes(container));
 *
 * // In tests
 * const mockContainer = createMockServiceContainer({
 *   sessionQueryService: mockSessionQueryService,
 * });
 * const router = createSessionRoutes(mockContainer);
 * ```
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

// =============================================================================
// Service Container Interface
// =============================================================================

/**
 * Complete service container with all available services.
 *
 * Use this when you need access to all services, or create a more
 * specific subset interface for your use case.
 */
export interface ServiceContainer {
  // Logging
  readonly logger: ALogger;
  readonly logCapture: ALogCapture;

  // Monitoring
  readonly metricsRegistry: AMetricsRegistry;
  readonly healthMonitor: AHealthMonitor;
  readonly circuitBreakerRegistry: ACircuitBreakerRegistry;

  // Session management
  readonly sessionService: ASession;
  readonly sessionEventBroadcaster: ASessionEventBroadcaster;
  readonly sessionListBroadcaster: ASessionListBroadcaster;
  readonly sessionCleanupService: ASessionCleanupService;
  readonly eventStorageService: AEventStorageService;
  readonly sessionQueryService: ASessionQueryService;
  readonly sessionAuthorizationService: ASessionAuthorizationService;

  // External services
  readonly claudeWebClient: AClaudeWebClient;
  readonly githubClient: AGitHubClient;
  readonly llm: ALlm;

  // Auth
  readonly tokenRefreshService: ATokenRefreshService;

  // HTTP/Formatting
  readonly eventFormatter: AEventFormatter;
  readonly sseHelper: ASseHelper;
}

// =============================================================================
// Subset Interfaces for Specific Use Cases
// =============================================================================

/**
 * Services needed for session CRUD operations.
 */
export interface SessionCrudServices {
  readonly sessionQueryService: ASessionQueryService;
  readonly logger: ALogger;
}

/**
 * Services needed for session middleware.
 */
export interface SessionMiddlewareServices {
  readonly sessionQueryService: ASessionQueryService;
  readonly sessionAuthorizationService: ASessionAuthorizationService;
  readonly logger: ALogger;
}

/**
 * Services needed for session sharing operations.
 */
export interface SessionSharingServices {
  readonly sessionQueryService: ASessionQueryService;
  readonly sessionAuthorizationService: ASessionAuthorizationService;
  readonly logger: ALogger;
}

/**
 * Services needed for session sync operations.
 */
export interface SessionSyncServices {
  readonly sessionService: ASession;
  readonly logger: ALogger;
}

/**
 * Services needed for session helpers.
 */
export interface SessionHelperServices {
  readonly sseHelper: ASseHelper;
  readonly sessionCleanupService: ASessionCleanupService;
  readonly claudeWebClient: AClaudeWebClient;
}

/**
 * Services needed for live chat operations.
 */
export interface LiveChatServices {
  readonly claudeWebClient: AClaudeWebClient;
  readonly logger: ALogger;
}

/**
 * Services needed for internal sessions operations.
 */
export interface InternalSessionsServices {
  readonly claudeWebClient: AClaudeWebClient;
  readonly logger: ALogger;
}

/**
 * Services needed for GitHub operations.
 */
export interface GitHubServices {
  readonly claudeWebClient: AClaudeWebClient;
  readonly githubClient: AGitHubClient;
  readonly logger: ALogger;
}

/**
 * Services needed for CLI claude commands.
 */
export interface ClaudeCliServices {
  readonly claudeWebClient: AClaudeWebClient;
  readonly eventFormatter: AEventFormatter;
  readonly logger: ALogger;
}

/**
 * Services needed for CLI session commands.
 */
export interface SessionCliServices {
  readonly tokenRefreshService: ATokenRefreshService;
  readonly sessionService: ASession;
  readonly logger: ALogger;
}

/**
 * Services needed for CLI LLM commands.
 */
export interface LlmCliServices {
  readonly llm: ALlm;
  readonly logger: ALogger;
}

// =============================================================================
// Container Factory
// =============================================================================

import { ServiceProvider } from './registry.js';
import {
  ALogger as ALoggerToken,
  ALogCapture as ALogCaptureToken,
  AMetricsRegistry as AMetricsRegistryToken,
  AHealthMonitor as AHealthMonitorToken,
  ACircuitBreakerRegistry as ACircuitBreakerRegistryToken,
  ASession as ASessionToken,
  ASessionEventBroadcaster as ASessionEventBroadcasterToken,
  ASessionListBroadcaster as ASessionListBroadcasterToken,
  ASessionCleanupService as ASessionCleanupServiceToken,
  AEventStorageService as AEventStorageServiceToken,
  ASessionQueryService as ASessionQueryServiceToken,
  ASessionAuthorizationService as ASessionAuthorizationServiceToken,
  AClaudeWebClient as AClaudeWebClientToken,
  AGitHubClient as AGitHubClientToken,
  ALlm as ALlmToken,
  ATokenRefreshService as ATokenRefreshServiceToken,
  AEventFormatter as AEventFormatterToken,
  ASseHelper as ASseHelperToken,
} from './abstracts/index.js';

/**
 * Create a service container from the global ServiceProvider.
 *
 * Call this after ServiceProvider.initialize() to get an explicit container.
 * The container can then be passed to route factories and middleware.
 *
 * @returns ServiceContainer with all services from ServiceProvider
 * @throws Error if ServiceProvider is not initialized
 */
export function createServiceContainer(): ServiceContainer {
  return {
    logger: ServiceProvider.get(ALoggerToken),
    logCapture: ServiceProvider.get(ALogCaptureToken),
    metricsRegistry: ServiceProvider.get(AMetricsRegistryToken),
    healthMonitor: ServiceProvider.get(AHealthMonitorToken),
    circuitBreakerRegistry: ServiceProvider.get(ACircuitBreakerRegistryToken),
    sessionService: ServiceProvider.get(ASessionToken),
    sessionEventBroadcaster: ServiceProvider.get(ASessionEventBroadcasterToken),
    sessionListBroadcaster: ServiceProvider.get(ASessionListBroadcasterToken),
    sessionCleanupService: ServiceProvider.get(ASessionCleanupServiceToken),
    eventStorageService: ServiceProvider.get(AEventStorageServiceToken),
    sessionQueryService: ServiceProvider.get(ASessionQueryServiceToken),
    sessionAuthorizationService: ServiceProvider.get(ASessionAuthorizationServiceToken),
    claudeWebClient: ServiceProvider.get(AClaudeWebClientToken),
    githubClient: ServiceProvider.get(AGitHubClientToken),
    llm: ServiceProvider.get(ALlmToken),
    tokenRefreshService: ServiceProvider.get(ATokenRefreshServiceToken),
    eventFormatter: ServiceProvider.get(AEventFormatterToken),
    sseHelper: ServiceProvider.get(ASseHelperToken),
  };
}

/**
 * Create a lazy service container that defers service lookups.
 *
 * Useful when you need to create the container before services are initialized,
 * but won't access services until after initialization.
 *
 * @returns ServiceContainer with lazy service accessors
 */
export function createLazyServiceContainer(): ServiceContainer {
  return {
    get logger() { return ServiceProvider.get(ALoggerToken); },
    get logCapture() { return ServiceProvider.get(ALogCaptureToken); },
    get metricsRegistry() { return ServiceProvider.get(AMetricsRegistryToken); },
    get healthMonitor() { return ServiceProvider.get(AHealthMonitorToken); },
    get circuitBreakerRegistry() { return ServiceProvider.get(ACircuitBreakerRegistryToken); },
    get sessionService() { return ServiceProvider.get(ASessionToken); },
    get sessionEventBroadcaster() { return ServiceProvider.get(ASessionEventBroadcasterToken); },
    get sessionListBroadcaster() { return ServiceProvider.get(ASessionListBroadcasterToken); },
    get sessionCleanupService() { return ServiceProvider.get(ASessionCleanupServiceToken); },
    get eventStorageService() { return ServiceProvider.get(AEventStorageServiceToken); },
    get sessionQueryService() { return ServiceProvider.get(ASessionQueryServiceToken); },
    get sessionAuthorizationService() { return ServiceProvider.get(ASessionAuthorizationServiceToken); },
    get claudeWebClient() { return ServiceProvider.get(AClaudeWebClientToken); },
    get githubClient() { return ServiceProvider.get(AGitHubClientToken); },
    get llm() { return ServiceProvider.get(ALlmToken); },
    get tokenRefreshService() { return ServiceProvider.get(ATokenRefreshServiceToken); },
    get eventFormatter() { return ServiceProvider.get(AEventFormatterToken); },
    get sseHelper() { return ServiceProvider.get(ASseHelperToken); },
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

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
 * const mockContainer = createMockServiceContainer({
 *   sessionQueryService: {
 *     listActive: jest.fn().mockResolvedValue([mockSession]),
 *     getById: jest.fn().mockResolvedValue(mockSession),
 *   } as unknown as ASessionQueryService,
 * });
 *
 * const router = createSessionRoutes(mockContainer);
 * // Test router with mock services
 * ```
 */
export function createMockServiceContainer(
  overrides: Partial<ServiceContainer>
): ServiceContainer {
  const createThrowingGetter = (serviceName: string) => {
    return () => {
      throw new Error(
        `Mock not provided for ${serviceName}. ` +
        `Add it to createMockServiceContainer() overrides.`
      );
    };
  };

  return {
    get logger() { return overrides.logger ?? createThrowingGetter('logger')(); },
    get logCapture() { return overrides.logCapture ?? createThrowingGetter('logCapture')(); },
    get metricsRegistry() { return overrides.metricsRegistry ?? createThrowingGetter('metricsRegistry')(); },
    get healthMonitor() { return overrides.healthMonitor ?? createThrowingGetter('healthMonitor')(); },
    get circuitBreakerRegistry() { return overrides.circuitBreakerRegistry ?? createThrowingGetter('circuitBreakerRegistry')(); },
    get sessionService() { return overrides.sessionService ?? createThrowingGetter('sessionService')(); },
    get sessionEventBroadcaster() { return overrides.sessionEventBroadcaster ?? createThrowingGetter('sessionEventBroadcaster')(); },
    get sessionListBroadcaster() { return overrides.sessionListBroadcaster ?? createThrowingGetter('sessionListBroadcaster')(); },
    get sessionCleanupService() { return overrides.sessionCleanupService ?? createThrowingGetter('sessionCleanupService')(); },
    get eventStorageService() { return overrides.eventStorageService ?? createThrowingGetter('eventStorageService')(); },
    get sessionQueryService() { return overrides.sessionQueryService ?? createThrowingGetter('sessionQueryService')(); },
    get sessionAuthorizationService() { return overrides.sessionAuthorizationService ?? createThrowingGetter('sessionAuthorizationService')(); },
    get claudeWebClient() { return overrides.claudeWebClient ?? createThrowingGetter('claudeWebClient')(); },
    get githubClient() { return overrides.githubClient ?? createThrowingGetter('githubClient')(); },
    get llm() { return overrides.llm ?? createThrowingGetter('llm')(); },
    get tokenRefreshService() { return overrides.tokenRefreshService ?? createThrowingGetter('tokenRefreshService')(); },
    get eventFormatter() { return overrides.eventFormatter ?? createThrowingGetter('eventFormatter')(); },
    get sseHelper() { return overrides.sseHelper ?? createThrowingGetter('sseHelper')(); },
  };
}

/**
 * Create a subset container from a full container.
 *
 * Useful for passing only the services a route/middleware needs.
 *
 * @param container - Full service container
 * @returns Subset interface for session CRUD
 */
export function extractSessionCrudServices(container: ServiceContainer): SessionCrudServices {
  return {
    sessionQueryService: container.sessionQueryService,
    logger: container.logger,
  };
}

/**
 * Extract session middleware services from container.
 */
export function extractSessionMiddlewareServices(container: ServiceContainer): SessionMiddlewareServices {
  return {
    sessionQueryService: container.sessionQueryService,
    sessionAuthorizationService: container.sessionAuthorizationService,
    logger: container.logger,
  };
}

/**
 * Extract session helper services from container.
 */
export function extractSessionHelperServices(container: ServiceContainer): SessionHelperServices {
  return {
    sseHelper: container.sseHelper,
    sessionCleanupService: container.sessionCleanupService,
    claudeWebClient: container.claudeWebClient,
  };
}

/**
 * Extract CLI claude services from container.
 */
export function extractClaudeCliServices(container: ServiceContainer): ClaudeCliServices {
  return {
    claudeWebClient: container.claudeWebClient,
    eventFormatter: container.eventFormatter,
    logger: container.logger,
  };
}

/**
 * Extract CLI session services from container.
 */
export function extractSessionCliServices(container: ServiceContainer): SessionCliServices {
  return {
    tokenRefreshService: container.tokenRefreshService,
    sessionService: container.sessionService,
    logger: container.logger,
  };
}

/**
 * Extract CLI LLM services from container.
 */
export function extractLlmCliServices(container: ServiceContainer): LlmCliServices {
  return {
    llm: container.llm,
    logger: container.logger,
  };
}
