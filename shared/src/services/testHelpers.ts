/**
 * Test Helpers for Service Container
 *
 * Provides utilities for creating mock service containers and services
 * for unit testing route handlers and middleware.
 *
 * ## Type Safety Approach
 *
 * Mocks implement a subset of abstract service methods needed for testing.
 * The `PartialMock<T>` type is a transparent alias that documents when a value
 * is a test-only implementation satisfying the service contract for the
 * methods that are implemented.
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

import type { Response } from 'express';

import type { ChatSession } from '../db/index.js';

import type { ALogger } from '../utils/logging/ALogger.js';
import type { LogContext } from '../utils/logging/ALogger.js';
import type { ALogCapture } from '../utils/logging/ALogCapture.js';
import type { AMetricsRegistry } from '../utils/monitoring/AMetricsRegistry.js';
import type { AHealthMonitor } from '../utils/monitoring/AHealthMonitor.js';
import type { ACircuitBreakerRegistry } from '../utils/resilience/ACircuitBreaker.js';
import type { ACircuitBreaker } from '../utils/resilience/ACircuitBreaker.js';
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
// Mock Type Definitions
// =============================================================================

/**
 * Type helper for creating mock services in tests.
 * This branded type indicates that a mock implements a partial subset
 * of an abstract service interface for testing purposes.
 *
 * NOTE: We use `as unknown as T` pattern because mocks intentionally
 * implement only the methods needed for tests, not the full interface.
 * The explicit mock interfaces document what methods are available.
 */
type PartialMock<T> = T;

/**
 * Base mock service properties required by all services.
 */
interface BaseMockService {
  order: number;
  initialize: () => Promise<void>;
  dispose: () => Promise<void>;
}

// =============================================================================
// Mock Service Factories
// =============================================================================

/**
 * Mock logger interface for testing.
 */
interface MockLogger extends BaseMockService {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, error?: Error | unknown, context?: LogContext) => void;
  debug: (message: string, context?: LogContext) => void;
}

/**
 * Create a mock logger for testing.
 *
 * All methods are stubs that record calls but do nothing.
 */
export function createMockLogger(): PartialMock<ALogger> {
  const noOp = () => {};
  const mock: MockLogger = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    info: noOp,
    warn: noOp,
    error: noOp,
    debug: noOp,
  };
  return mock as unknown as PartialMock<ALogger>;
}

/**
 * Mock session query service interface for testing.
 */
interface MockSessionQueryService extends BaseMockService {
  getById: (sessionId: string) => Promise<ChatSession | null>;
  getByIdForUser: (sessionId: string, userId: string) => Promise<ChatSession | null>;
  getByIdWithPreview: (sessionId: string, userId: string) => Promise<ChatSession | null>;
  listActive: (userId: string) => Promise<ChatSession[]>;
  listDeleted: (userId: string) => Promise<{ items: ChatSession[]; total: number; hasMore: boolean }>;
  listByIds: (sessionIds: string[], userId: string) => Promise<ChatSession[]>;
  existsForUser: (sessionId: string, userId: string) => Promise<boolean>;
  countActive: (userId: string) => Promise<number>;
  countDeleted: (userId: string) => Promise<number>;
  search: (userId: string, options: { query: string }) => Promise<{ items: ChatSession[]; total: number; hasMore: boolean }>;
}

/**
 * Create a mock session query service for testing.
 *
 * Returns empty results by default. Override methods to return test data.
 */
export function createMockSessionQueryService(): PartialMock<ASessionQueryService> {
  const mock: MockSessionQueryService = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    getById: async () => null,
    getByIdForUser: async () => null,
    getByIdWithPreview: async () => null,
    listActive: async () => [],
    listDeleted: async () => ({ items: [], total: 0, hasMore: false }),
    listByIds: async () => [],
    existsForUser: async () => false,
    countActive: async () => 0,
    countDeleted: async () => 0,
    search: async () => ({ items: [], total: 0, hasMore: false }),
  };
  return mock as unknown as PartialMock<ASessionQueryService>;
}

/**
 * Mock session authorization service interface for testing.
 */
interface MockSessionAuthorizationService extends BaseMockService {
  verifyOwnership: (sessionId: string, userId: string) => { authorized: boolean; reason?: string };
  verifyShareToken: (sessionId: string, token: string) => { authorized: boolean; reason?: string };
}

/**
 * Create a mock session authorization service for testing.
 *
 * Authorizes all requests by default.
 */
export function createMockSessionAuthorizationService(): PartialMock<ASessionAuthorizationService> {
  const mock: MockSessionAuthorizationService = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    verifyOwnership: () => ({ authorized: true }),
    verifyShareToken: () => ({ authorized: true }),
  };
  return mock as unknown as PartialMock<ASessionAuthorizationService>;
}

/**
 * Mock SSE helper interface for testing with recorded writes.
 */
interface MockSseHelper extends BaseMockService {
  write: (res: Response, data: string) => boolean;
  writes: string[];
}

/**
 * Create a mock SSE helper for testing.
 *
 * Records all write calls.
 */
export function createMockSseHelper(): PartialMock<ASseHelper> & { writes: string[] } {
  const writes: string[] = [];
  const mock: MockSseHelper = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    write: (_res: Response, data: string) => {
      writes.push(data);
      return true;
    },
    writes,
  };
  return mock as unknown as PartialMock<ASseHelper> & { writes: string[] };
}

/**
 * Mock session cleanup service interface for testing.
 */
interface MockSessionCleanupService extends BaseMockService {
  deleteGitHubBranch: (sessionId: string) => Promise<{ success: boolean; message: string }>;
  archiveClaudeRemoteSession: (sessionId: string) => Promise<{ success: boolean; message: string }>;
}

/**
 * Create a mock session cleanup service for testing.
 *
 * Returns success for all operations by default.
 */
export function createMockSessionCleanupService(): PartialMock<ASessionCleanupService> {
  const mock: MockSessionCleanupService = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    deleteGitHubBranch: async () => ({ success: true, message: 'Deleted' }),
    archiveClaudeRemoteSession: async () => ({ success: true, message: 'Archived' }),
  };
  return mock as unknown as PartialMock<ASessionCleanupService>;
}

/**
 * Mock Claude Web Client interface for testing.
 */
interface MockClaudeWebClient extends BaseMockService {
  configure: () => void;
  listSessions: () => Promise<{ data: unknown[]; has_more: boolean }>;
  getSession: (sessionId: string) => Promise<{ id: string; session_status: string }>;
  getEvents: (sessionId: string) => Promise<{ data: unknown[] }>;
  createSession: () => Promise<{ sessionId: string; webUrl: string }>;
  execute: () => Promise<{ sessionId: string; status: string; title: string }>;
  resume: () => Promise<{ status: string }>;
  pollSession: () => Promise<{ status: string }>;
  streamEvents: () => Promise<{ status: string }>;
  archiveSession: () => Promise<void>;
  renameSession: () => Promise<void>;
  interruptSession: () => Promise<void>;
  sendMessage: () => Promise<void>;
  canResume: (sessionId: string) => Promise<{ canResume: boolean; status: string }>;
  isComplete: (sessionId: string) => Promise<{ isComplete: boolean; status: string }>;
  setPermissionMode: () => Promise<void>;
}

/**
 * Create a mock Claude Web Client for testing.
 *
 * Returns success results for all operations by default.
 */
export function createMockClaudeWebClient(): PartialMock<AClaudeWebClient> {
  const mock: MockClaudeWebClient = {
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
  };
  return mock as unknown as PartialMock<AClaudeWebClient>;
}

/**
 * Mock event formatter interface for testing.
 */
interface MockEventFormatter extends BaseMockService {
  formatEvent: (event: Record<string, unknown>) => string;
}

/**
 * Create a mock event formatter for testing.
 *
 * Returns stringified event by default.
 */
export function createMockEventFormatter(): PartialMock<AEventFormatter> {
  const mock: MockEventFormatter = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    formatEvent: (event: Record<string, unknown>) => JSON.stringify(event),
  };
  return mock as unknown as PartialMock<AEventFormatter>;
}

/**
 * Mock LLM response type.
 */
interface MockLlmResponse {
  content: string;
  provider: string;
  model: string;
}

/**
 * Mock LLM interface for testing.
 */
interface MockLlm extends BaseMockService {
  execute: () => Promise<MockLlmResponse>;
}

/**
 * Create a mock LLM service for testing.
 */
export function createMockLlm(): PartialMock<ALlm> {
  const mock: MockLlm = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    execute: async () => ({
      content: 'Mock response',
      provider: 'mock',
      model: 'mock-model',
    }),
  };
  return mock as unknown as PartialMock<ALlm>;
}

/**
 * Mock token refresh service interface for testing.
 */
interface MockTokenRefreshService extends BaseMockService {
  ensureValidTokenForUser: <T>(userId: string, auth: T) => Promise<T>;
  refreshToken: <T>(auth: T) => Promise<T>;
}

/**
 * Create a mock token refresh service for testing.
 */
export function createMockTokenRefreshService(): PartialMock<ATokenRefreshService> {
  const mock: MockTokenRefreshService = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    ensureValidTokenForUser: async <T>(_userId: string, auth: T) => auth,
    refreshToken: async <T>(auth: T) => auth,
  };
  return mock as unknown as PartialMock<ATokenRefreshService>;
}

/**
 * Mock session execution result.
 */
interface MockSessionResult {
  sessionId: string;
  status: string;
}

/**
 * Mock session service interface for testing.
 */
interface MockSession extends BaseMockService {
  execute: () => Promise<MockSessionResult>;
  resume: () => Promise<{ status: string }>;
}

/**
 * Create a mock session service for testing.
 */
export function createMockSessionService(): PartialMock<ASession> {
  const mock: MockSession = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    execute: async () => ({ sessionId: 'mock', status: 'completed' }),
    resume: async () => ({ status: 'completed' }),
  };
  return mock as unknown as PartialMock<ASession>;
}

/**
 * Mock log entry type.
 */
interface MockLogEntry {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Mock log capture interface for testing.
 */
interface MockLogCapture extends BaseMockService {
  capture: (level: string, message: string, context?: Record<string, unknown>) => void;
  getLogs: () => { logs: MockLogEntry[]; total: number; filtered: number };
  clear: () => void;
  setMaxLogs: (max: number) => void;
  setEnabled: (enabled: boolean) => void;
  getStatus: () => { enabled: boolean; maxLogs: number; currentCount: number };
}

/**
 * Create a mock log capture service for testing.
 */
export function createMockLogCapture(): PartialMock<ALogCapture> {
  const logs: MockLogEntry[] = [];
  const mock: MockLogCapture = {
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
  };
  return mock as unknown as PartialMock<ALogCapture>;
}

/**
 * Mock metrics summary type.
 */
interface MockMetricsSummary {
  requests: { total: number; byStatus: Record<string, number> };
  errors: { total: number; byType: Record<string, number> };
}

/**
 * Mock metrics registry interface for testing.
 */
interface MockMetricsRegistry extends BaseMockService {
  recordHttpRequest: () => void;
  recordGitHubApiCall: () => void;
  recordDbQuery: () => void;
  recordCleanupCycle: () => void;
  recordError: () => void;
  recordRetryAttempt: () => void;
  updateHealthStatus: () => void;
  updateSystemMetrics: () => void;
  updateDbConnections: () => void;
  updateCircuitBreakerMetrics: () => void;
  getMetricsJson: () => Record<string, unknown>;
  getSummary: () => MockMetricsSummary;
  recordRateLimitHit: () => void;
  recordSseSubscription: () => void;
  recordSseUnsubscription: () => void;
  recordSseEviction: () => void;
  updateSseSessionCount: () => void;
  recordSseHeartbeat: () => void;
  reset: () => void;
}

/**
 * Create a mock metrics registry for testing.
 */
export function createMockMetricsRegistry(): PartialMock<AMetricsRegistry> {
  const noOp = () => {};
  const mock: MockMetricsRegistry = {
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
  };
  return mock as unknown as PartialMock<AMetricsRegistry>;
}

/**
 * Mock health check result type.
 */
interface MockHealthCheckResult {
  name: string;
  healthy: boolean;
  message: string;
}

/**
 * Mock health monitor interface for testing.
 */
interface MockHealthMonitor extends BaseMockService {
  registerCheck: () => void;
  unregisterCheck: () => void;
  runCheck: () => Promise<MockHealthCheckResult>;
  runAllChecks: () => Promise<MockHealthCheckResult[]>;
  getHealthStatus: () => Promise<{ healthy: boolean; checks: MockHealthCheckResult[] }>;
  getDetailedHealthStatus: () => Promise<{ status: string; checks: MockHealthCheckResult[]; uptime: number }>;
  startPeriodicChecks: () => void;
  stopPeriodicChecks: () => void;
  updateCleanupStatus: () => void;
  setCleanupInterval: () => void;
  getLastResult: () => MockHealthCheckResult | undefined;
  getAllLastResults: () => MockHealthCheckResult[];
  isHealthy: () => boolean;
  isReady: () => Promise<boolean>;
}

/**
 * Create a mock health monitor for testing.
 */
export function createMockHealthMonitor(): PartialMock<AHealthMonitor> {
  const mock: MockHealthMonitor = {
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
  };
  return mock as unknown as PartialMock<AHealthMonitor>;
}

/**
 * Mock circuit breaker stats type.
 */
interface MockCircuitBreakerStats {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
}

/**
 * Mock circuit breaker interface for testing.
 */
interface MockCircuitBreakerInstance extends BaseMockService {
  onStateChange: () => void;
  getStats: () => MockCircuitBreakerStats;
  canExecute: () => boolean;
  execute: <T>(op: () => Promise<T>) => Promise<{ success: boolean; value: T }>;
  executeWithFallback: <T>(op: () => Promise<T>) => Promise<{ value: T; degraded: boolean }>;
  reset: () => void;
  isOpen: () => boolean;
  isClosed: () => boolean;
  getState: () => 'closed' | 'open' | 'half-open';
  getName: () => string;
}

/**
 * Mock circuit breaker registry interface for testing.
 */
interface MockCircuitBreakerRegistry extends BaseMockService {
  get: (name: string) => PartialMock<ACircuitBreaker>;
  getAllStats: () => Record<string, MockCircuitBreakerStats>;
  resetAll: () => void;
  size: () => number;
}

/**
 * Create a mock circuit breaker registry for testing.
 */
export function createMockCircuitBreakerRegistry(): PartialMock<ACircuitBreakerRegistry> {
  const mockBreaker: MockCircuitBreakerInstance = {
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
  };

  const mock: MockCircuitBreakerRegistry = {
    order: -40,
    initialize: async () => {},
    dispose: async () => {},
    get: () => mockBreaker as unknown as PartialMock<ACircuitBreaker>,
    getAllStats: () => ({}),
    resetAll: () => {},
    size: () => 0,
  };
  return mock as unknown as PartialMock<ACircuitBreakerRegistry>;
}

/**
 * Mock session event broadcaster interface for testing.
 */
interface MockSessionEventBroadcaster extends BaseMockService {
  startSession: (sessionId: string) => void;
  endSession: (sessionId: string) => void;
  isSessionActive: (sessionId: string) => boolean;
  subscribe: (sessionId: string, callback: () => void) => () => void;
  broadcast: (sessionId: string, event: unknown) => void;
  getActiveSessionCount: () => number;
  getSubscriberCount: (sessionId: string) => number;
  getTotalSubscriberCount: () => number;
  shutdown: () => void;
}

/**
 * Create a mock session event broadcaster for testing.
 */
export function createMockSessionEventBroadcaster(): PartialMock<ASessionEventBroadcaster> {
  const mock: MockSessionEventBroadcaster = {
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
  };
  return mock as unknown as PartialMock<ASessionEventBroadcaster>;
}

/**
 * Mock session list broadcaster interface for testing.
 */
interface MockSessionListBroadcaster extends BaseMockService {
  subscribe: (userId: string, callback: () => void) => () => void;
  broadcast: (userId: string, event: unknown) => void;
  notifySessionCreated: (session: unknown) => void;
  notifySessionUpdated: (session: unknown) => void;
  notifyStatusChanged: (sessionId: string, status: string) => void;
  notifySessionDeleted: (sessionId: string) => void;
  getSubscriberCount: (userId: string) => number;
  getTotalSubscriberCount: () => number;
  shutdown: () => void;
}

/**
 * Create a mock session list broadcaster for testing.
 */
export function createMockSessionListBroadcaster(): PartialMock<ASessionListBroadcaster> {
  const mock: MockSessionListBroadcaster = {
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
  };
  return mock as unknown as PartialMock<ASessionListBroadcaster>;
}

/**
 * Mock event storage result type.
 */
interface MockEventStorageResult {
  stored: boolean;
  duplicate: boolean;
}

/**
 * Mock event storage service interface for testing.
 */
interface MockEventStorageService extends BaseMockService {
  storeEvent: () => Promise<MockEventStorageResult>;
  storeEventWithDedup: () => Promise<MockEventStorageResult>;
  batchStoreEvents: () => Promise<{ stored: number; duplicates: number }>;
  getExistingEventUuids: () => Promise<Set<string>>;
  createInputPreviewEvent: (content: string) => { type: string; content: string };
}

/**
 * Create a mock event storage service for testing.
 */
export function createMockEventStorageService(): PartialMock<AEventStorageService> {
  const mock: MockEventStorageService = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    storeEvent: async () => ({ stored: true, duplicate: false }),
    storeEventWithDedup: async () => ({ stored: true, duplicate: false }),
    batchStoreEvents: async () => ({ stored: 0, duplicates: 0 }),
    getExistingEventUuids: async () => new Set<string>(),
    createInputPreviewEvent: (content: string) => ({ type: 'input_preview', content }),
  };
  return mock as unknown as PartialMock<AEventStorageService>;
}

/**
 * Mock GitHub client interface for testing.
 */
interface MockGitHubClient extends BaseMockService {
  pullRepository: (url: string) => Promise<{ success: boolean; localPath: string }>;
  extractRepoName: (url: string) => string;
  extractOwner: (url: string) => string;
}

/**
 * Create a mock GitHub client for testing.
 */
export function createMockGitHubClient(): PartialMock<AGitHubClient> {
  const mock: MockGitHubClient = {
    order: 0,
    initialize: async () => {},
    dispose: async () => {},
    pullRepository: async () => ({ success: true, localPath: '/tmp/mock-repo' }),
    extractRepoName: (url: string) => url.split('/').pop() || 'mock-repo',
    extractOwner: (url: string) => url.split('/').slice(-2, -1)[0] || 'mock-owner',
  };
  return mock as unknown as PartialMock<AGitHubClient>;
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
