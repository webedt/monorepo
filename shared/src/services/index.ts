/**
 * Services module - Dependency injection and service registry
 *
 * Provides a type-safe service locator using abstract classes as tokens.
 *
 * @example
 * ```typescript
 * import { ServiceProvider, ALogger, AClaudeWebClient, bootstrapServices } from '@webedt/shared';
 *
 * // At startup
 * await bootstrapServices();
 *
 * // Get services (type-safe!)
 * const logger = ServiceProvider.get(ALogger);
 * const client = ServiceProvider.get(AClaudeWebClient);
 * ```
 *
 * @module services
 */

// Bootstrap function
export { bootstrapServices } from './bootstrap.js';

// ServiceProvider and ServiceScope
export {
  ServiceProvider,
  ServiceScope,
  type AbstractClass,
} from './registry.js';

// Abstract service classes (tokens)
export {
  AService,
  ALogger,
  ALogCapture,
  AMetricsRegistry,
  AHealthMonitor,
  ACircuitBreaker,
  ACircuitBreakerRegistry,
  ASessionEventBroadcaster,
  ASessionListBroadcaster,
  AClaudeWebClient,
  AGitHelper,
  AGitHubClient,
} from './abstracts/index.js';

// Types specific to abstract classes (not duplicated elsewhere)
export type { ClaudeWebClientConfig } from './abstracts/index.js';

// Service Container - Explicit dependency injection
export {
  createServiceContainer,
  createLazyServiceContainer,
  createMockServiceContainer,
  extractSessionCrudServices,
  extractSessionMiddlewareServices,
  extractSessionHelperServices,
  extractClaudeCliServices,
  extractSessionCliServices,
  extractLlmCliServices,
} from './ServiceContainer.js';

export type {
  ServiceContainer,
  SessionCrudServices,
  SessionMiddlewareServices,
  SessionSharingServices,
  SessionSyncServices,
  SessionHelperServices,
  LiveChatServices,
  InternalSessionsServices,
  GitHubServices,
  ClaudeCliServices,
  SessionCliServices,
  LlmCliServices,
} from './ServiceContainer.js';

// Sensitive data encryption service
// Note: ClaudeAuthData, CodexAuthData, GeminiAuthData, ImageAiKeysData are exported
// from db/index.ts (via authTypes.ts) to avoid conflicts
export {
  SensitiveDataService,
  createSensitiveDataService,
  encryptUserFields,
  decryptUserFields,
  decryptUser,
  hasEncryptedFields,
  hasUnencryptedSensitiveData,
} from './sensitiveDataService.js';

export type {
  SensitiveUserFields,
  EncryptedUserFields,
} from './sensitiveDataService.js';

// Test helpers for mocking services
export {
  createMockLogger,
  createMockSessionQueryService,
  createMockSessionAuthorizationService,
  createMockSseHelper,
  createMockSessionCleanupService,
  createMockClaudeWebClient,
  createMockEventFormatter,
  createMockLlm,
  createMockTokenRefreshService,
  createMockSessionService,
  createTestContainer,
  createMockSession,
  createMockEvent,
} from './testHelpers.js';
