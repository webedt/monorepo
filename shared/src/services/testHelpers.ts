/**
 * Test Helpers for Service Container
 *
 * Provides utilities for creating mock service containers and services
 * for unit testing route handlers and middleware.
 *
 * ## Usage
 *
 * ```typescript
 * import { createTestContainer, createMockLogger, createMockSessionQueryService } from '@webedt/shared';
 *
 * describe('Session CRUD Routes', () => {
 *   let container: SessionCrudServices;
 *   let mockQueryService: ASessionQueryService;
 *
 *   beforeEach(() => {
 *     mockQueryService = createMockSessionQueryService();
 *     container = createTestContainer({
 *       sessionQueryService: mockQueryService,
 *     });
 *   });
 *
 *   it('should list sessions', async () => {
 *     // Test with mock services
 *   });
 * });
 * ```
 */

import type { ChatSession } from '../db/index.js';

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
import type { ServiceContainer } from './ServiceContainer.js';

// =============================================================================
// Mock Service Factories
// =============================================================================

/**
 * Create a mock logger for testing.
 *
 * All methods are stubs that record calls but do nothing.
 */
export function createMockLogger(): ALogger {
  const noOp = () => {};
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    info: noOp,
    warn: noOp,
    error: noOp,
    debug: noOp,
  } as unknown as ALogger;
}

/**
 * Create a mock session query service for testing.
 *
 * Returns empty results by default. Override methods to return test data.
 */
export function createMockSessionQueryService(): ASessionQueryService {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    getById: async () => null,
    getByIdWithPreview: async () => null,
    listActive: async () => [],
    listDeleted: async () => ({ items: [], total: 0, hasMore: false }),
    search: async () => ({ items: [], total: 0, hasMore: false }),
  } as unknown as ASessionQueryService;
}

/**
 * Create a mock session authorization service for testing.
 *
 * Authorizes all requests by default.
 */
export function createMockSessionAuthorizationService(): ASessionAuthorizationService {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    verifyOwnership: () => ({ authorized: true }),
    verifyShareToken: () => ({ authorized: true }),
  } as unknown as ASessionAuthorizationService;
}

/**
 * Create a mock SSE helper for testing.
 *
 * Records all write calls.
 */
export function createMockSseHelper(): ASseHelper & { writes: string[] } {
  const writes: string[] = [];
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    write: (_res: unknown, data: string) => {
      writes.push(data);
      return true;
    },
    writes,
  } as unknown as ASseHelper & { writes: string[] };
}

/**
 * Create a mock session cleanup service for testing.
 *
 * Returns success for all operations by default.
 */
export function createMockSessionCleanupService(): ASessionCleanupService {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    deleteGitHubBranch: async () => ({ success: true, message: 'Deleted' }),
    archiveClaudeRemoteSession: async () => ({ success: true, message: 'Archived' }),
  } as unknown as ASessionCleanupService;
}

/**
 * Create a mock Claude Web Client for testing.
 *
 * Returns success results for all operations by default.
 */
export function createMockClaudeWebClient(): AClaudeWebClient {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    configure: () => {},
    listSessions: async () => ({ data: [], has_more: false }),
    getSession: async () => ({ id: 'mock', session_status: 'completed' }),
    getEvents: async () => ({ data: [] }),
    createSession: async () => ({ sessionId: 'mock', webUrl: 'https://claude.ai/code/mock' }),
    execute: async () => ({ sessionId: 'mock', status: 'completed', title: 'Mock Session' }),
    resume: async () => ({ status: 'completed' }),
    pollSession: async () => ({ status: 'completed' }),
    streamEvents: async () => ({ status: 'completed' }),
    archiveSession: async () => {},
    renameSession: async () => {},
    interruptSession: async () => {},
    sendMessage: async () => {},
    canResume: async () => ({ canResume: true, status: 'completed' }),
    isComplete: async () => ({ isComplete: true, status: 'completed' }),
    setPermissionMode: async () => {},
  } as unknown as AClaudeWebClient;
}

/**
 * Create a mock event formatter for testing.
 *
 * Returns stringified event by default.
 */
export function createMockEventFormatter(): AEventFormatter {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    formatEvent: (event: Record<string, unknown>) => JSON.stringify(event),
  } as unknown as AEventFormatter;
}

/**
 * Create a mock LLM service for testing.
 */
export function createMockLlm(): ALlm {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    execute: async () => ({
      content: 'Mock response',
      provider: 'mock',
      model: 'mock-model',
    }),
  } as unknown as ALlm;
}

/**
 * Create a mock token refresh service for testing.
 */
export function createMockTokenRefreshService(): ATokenRefreshService {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    ensureValidTokenForUser: async (_userId: string, auth: unknown) => auth,
    refreshToken: async (auth: unknown) => auth,
  } as unknown as ATokenRefreshService;
}

/**
 * Create a mock session service for testing.
 */
export function createMockSessionService(): ASession {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    execute: async () => ({ sessionId: 'mock', status: 'completed' }),
    resume: async () => ({ status: 'completed' }),
  } as unknown as ASession;
}

/**
 * Create a mock log capture service for testing.
 */
export function createMockLogCapture(): ALogCapture {
  const logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  return {
    order: -90,
    initialize: async () => {},
    dispose: async () => {},
    capture: (level: string, message: string, context?: Record<string, unknown>) => {
      logs.push({ level, message, context });
    },
    getLogs: () => ({ logs: [], total: 0, filtered: 0 }),
    clear: () => { logs.length = 0; },
    setMaxLogs: () => {},
    setEnabled: () => {},
    getStatus: () => ({ enabled: true, maxLogs: 1000, currentCount: logs.length }),
  } as unknown as ALogCapture;
}

/**
 * Create a mock metrics registry for testing.
 */
export function createMockMetricsRegistry(): AMetricsRegistry {
  const noOp = () => {};
  return {
    order: -50,
    initialize: async () => {},
    dispose: async () => {},
    recordHttpRequest: noOp,
    recordGitHubApiCall: noOp,
    recordDbQuery: noOp,
    recordCleanupCycle: noOp,
    recordError: noOp,
    recordRetryAttempt: noOp,
    updateHealthStatus: noOp,
    updateSystemMetrics: noOp,
    updateDbConnections: noOp,
    updateCircuitBreakerMetrics: noOp,
    getMetricsJson: () => ({}),
    getSummary: () => ({ requests: { total: 0, byStatus: {} }, errors: { total: 0, byType: {} } }),
    recordRateLimitHit: noOp,
    recordSseSubscription: noOp,
    recordSseUnsubscription: noOp,
    recordSseEviction: noOp,
    updateSseSessionCount: noOp,
    recordSseHeartbeat: noOp,
    reset: noOp,
  } as unknown as AMetricsRegistry;
}

/**
 * Create a mock health monitor for testing.
 */
export function createMockHealthMonitor(): AHealthMonitor {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    registerCheck: () => {},
    unregisterCheck: () => {},
    runCheck: async () => ({ name: 'mock', healthy: true, message: 'OK' }),
    runAllChecks: async () => [],
    getHealthStatus: async () => ({ healthy: true, checks: [] }),
    getDetailedHealthStatus: async () => ({ status: 'healthy', checks: [], uptime: 0 }),
    startPeriodicChecks: () => {},
    stopPeriodicChecks: () => {},
    updateCleanupStatus: () => {},
    setCleanupInterval: () => {},
    getLastResult: () => undefined,
    getAllLastResults: () => [],
    isHealthy: () => true,
    isReady: async () => true,
  } as unknown as AHealthMonitor;
}

/**
 * Create a mock circuit breaker registry for testing.
 */
export function createMockCircuitBreakerRegistry(): ACircuitBreakerRegistry {
  return {
    order: -40,
    initialize: async () => {},
    dispose: async () => {},
    get: () => ({
      order: 0,
      initialize: async () => {},
      dispose: async () => {},
      onStateChange: () => {},
      getStats: () => ({ state: 'closed', failures: 0, successes: 0 }),
      canExecute: () => true,
      execute: async <T>(op: () => Promise<T>) => ({ success: true, value: await op() }),
      executeWithFallback: async <T>(op: () => Promise<T>) => ({ value: await op(), degraded: false }),
      reset: () => {},
      isOpen: () => false,
      isClosed: () => true,
      getState: () => 'closed',
      getName: () => 'mock',
    }),
    getAllStats: () => ({}),
    resetAll: () => {},
    size: () => 0,
  } as unknown as ACircuitBreakerRegistry;
}

/**
 * Create a mock session event broadcaster for testing.
 */
export function createMockSessionEventBroadcaster(): ASessionEventBroadcaster {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    startSession: () => {},
    endSession: () => {},
    isSessionActive: () => false,
    subscribe: () => () => {},
    broadcast: () => {},
    getActiveSessionCount: () => 0,
    getSubscriberCount: () => 0,
    getTotalSubscriberCount: () => 0,
    shutdown: () => {},
  } as unknown as ASessionEventBroadcaster;
}

/**
 * Create a mock session list broadcaster for testing.
 */
export function createMockSessionListBroadcaster(): ASessionListBroadcaster {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    subscribe: () => () => {},
    broadcast: () => {},
    notifySessionCreated: () => {},
    notifySessionUpdated: () => {},
    notifyStatusChanged: () => {},
    notifySessionDeleted: () => {},
    getSubscriberCount: () => 0,
    getTotalSubscriberCount: () => 0,
    shutdown: () => {},
  } as unknown as ASessionListBroadcaster;
}

/**
 * Create a mock event storage service for testing.
 */
export function createMockEventStorageService(): AEventStorageService {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    storeEvent: async () => ({ stored: true, duplicate: false }),
    storeEventWithDedup: async () => ({ stored: true, duplicate: false }),
    batchStoreEvents: async () => ({ stored: 0, duplicates: 0 }),
    getExistingEventUuids: async () => new Set<string>(),
    createInputPreviewEvent: (content: string) => ({ type: 'input_preview', content }),
  } as unknown as AEventStorageService;
}

/**
 * Create a mock GitHub client for testing.
 */
export function createMockGitHubClient(): AGitHubClient {
  return {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    pullRepository: async () => ({ success: true, localPath: '/tmp/mock-repo' }),
    extractRepoName: (url: string) => url.split('/').pop() || 'mock-repo',
    extractOwner: (url: string) => url.split('/').slice(-2, -1)[0] || 'mock-owner',
  } as unknown as AGitHubClient;
}

// =============================================================================
// Test Container Factory
// =============================================================================

/**
 * Create a test service container with mock services.
 *
 * Provides sensible defaults for all services. Override specific services
 * by passing them in the overrides parameter.
 *
 * @param overrides - Partial container with custom mock services
 * @returns ServiceContainer with mock services
 *
 * @example
 * ```typescript
 * // Use defaults
 * const container = createTestContainer();
 *
 * // Override specific services
 * const container = createTestContainer({
 *   sessionQueryService: createMockSessionQueryService(),
 * });
 *
 * // Use with route factory
 * const router = createCrudRoutes(container);
 * ```
 */
export function createTestContainer(
  overrides: Partial<ServiceContainer> = {}
): ServiceContainer {
  const mockLogger = createMockLogger();

  return {
    logger: overrides.logger ?? mockLogger,
    logCapture: overrides.logCapture ?? createMockLogCapture(),
    metricsRegistry: overrides.metricsRegistry ?? createMockMetricsRegistry(),
    healthMonitor: overrides.healthMonitor ?? createMockHealthMonitor(),
    circuitBreakerRegistry: overrides.circuitBreakerRegistry ?? createMockCircuitBreakerRegistry(),
    sessionService: overrides.sessionService ?? createMockSessionService(),
    sessionEventBroadcaster: overrides.sessionEventBroadcaster ?? createMockSessionEventBroadcaster(),
    sessionListBroadcaster: overrides.sessionListBroadcaster ?? createMockSessionListBroadcaster(),
    sessionCleanupService: overrides.sessionCleanupService ?? createMockSessionCleanupService(),
    eventStorageService: overrides.eventStorageService ?? createMockEventStorageService(),
    sessionQueryService: overrides.sessionQueryService ?? createMockSessionQueryService(),
    sessionAuthorizationService: overrides.sessionAuthorizationService ?? createMockSessionAuthorizationService(),
    claudeWebClient: overrides.claudeWebClient ?? createMockClaudeWebClient(),
    githubClient: overrides.githubClient ?? createMockGitHubClient(),
    llm: overrides.llm ?? createMockLlm(),
    tokenRefreshService: overrides.tokenRefreshService ?? createMockTokenRefreshService(),
    eventFormatter: overrides.eventFormatter ?? createMockEventFormatter(),
    sseHelper: overrides.sseHelper ?? createMockSseHelper(),
  };
}

// =============================================================================
// Test Data Factories
// =============================================================================

/**
 * Create a mock chat session for testing.
 */
export function createMockSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'test-session-id',
    userId: 'test-user-id',
    sessionPath: 'owner__repo__branch',
    repositoryOwner: 'test-owner',
    repositoryName: 'test-repo',
    repositoryUrl: 'https://github.com/test-owner/test-repo',
    baseBranch: 'main',
    branch: 'feature/test',
    userRequest: 'Test request',
    status: 'completed',
    provider: 'claude',
    autoCommit: false,
    locked: false,
    favorite: false,
    createdAt: new Date(),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  } as ChatSession;
}

/**
 * Create a mock execution event for testing.
 */
export function createMockEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'text',
    content: 'Test content',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
