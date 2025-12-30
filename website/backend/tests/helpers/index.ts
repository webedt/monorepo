/**
 * Test Helpers Index
 *
 * Re-exports all test utilities for convenient importing.
 */

// Mock Express utilities
export {
  createMockRequest,
  createMockResponse,
  createMockUser,
  createMockSession,
  createMockNext,
} from './mockExpress.js';
export type { MockRequest, MockResponse } from './mockExpress.js';

// Test app factory
export {
  createTestApp,
  createMockChatSession,
  createMockEvent,
  createMockMessage,
} from './testApp.js';
export type {
  TestAppOptions,
  MockChatSession,
  MockEvent,
  MockMessage,
} from './testApp.js';

// Mock database
export {
  MockDb,
  createMockDb,
  createMockDbState,
} from './mockDb.js';
export type { MockDbState } from './mockDb.js';

// Mock services
export {
  createMockSessionQueryService,
  createMockSessionAuthorizationService,
  createMockEventStorageService,
  createMockSessionCleanupService,
  createMockSseHelper,
  createMockSessionEventBroadcaster,
  createMockServices,
} from './mockServices.js';
export type {
  MockSessionQueryService,
  MockSessionAuthorizationService,
  MockEventStorageService,
  MockSessionCleanupService,
  MockSseHelper,
  MockSessionEventBroadcaster,
  MockServices,
} from './mockServices.js';
