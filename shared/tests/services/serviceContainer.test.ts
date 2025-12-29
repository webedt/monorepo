/**
 * Service Container Tests
 *
 * Tests the constructor injection pattern for route handlers and services.
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTestContainer,
  createMockLogger,
  createMockSessionQueryService,
  createMockSessionAuthorizationService,
  createMockSession,
} from '../../src/services/testHelpers.js';

import { createMockServiceContainer } from '../../src/services/ServiceContainer.js';

import type { ServiceContainer } from '../../src/services/ServiceContainer.js';

describe('ServiceContainer', () => {
  describe('createMockServiceContainer', () => {
    it('should throw for unmocked services', () => {
      const container = createMockServiceContainer({});

      assert.throws(
        () => container.logger,
        /Mock not provided for logger/
      );
    });

    it('should return provided mocks', () => {
      const mockLogger = createMockLogger();
      const container = createMockServiceContainer({ logger: mockLogger });

      assert.strictEqual(container.logger, mockLogger);
    });

    it('should throw for unrelated service access', () => {
      const mockLogger = createMockLogger();
      const container = createMockServiceContainer({ logger: mockLogger });

      // Logger should work
      assert.ok(container.logger);

      // Other services should throw
      assert.throws(
        () => container.sessionQueryService,
        /Mock not provided for sessionQueryService/
      );
    });
  });

  describe('createTestContainer', () => {
    it('should provide default mocks for all services', () => {
      const container = createTestContainer();

      // Should not throw for any service access
      assert.ok(container.logger);
      assert.ok(container.sessionQueryService);
      assert.ok(container.sessionAuthorizationService);
      assert.ok(container.claudeWebClient);
      assert.ok(container.sseHelper);
    });

    it('should allow overriding specific services', () => {
      const customQueryService = createMockSessionQueryService();
      const container = createTestContainer({
        sessionQueryService: customQueryService,
      });

      assert.strictEqual(container.sessionQueryService, customQueryService);
    });
  });

  describe('Mock Services', () => {
    describe('createMockSessionQueryService', () => {
      it('should return empty results by default', async () => {
        const queryService = createMockSessionQueryService();

        const sessions = await queryService.listActive('user-123');
        assert.deepStrictEqual(sessions, []);

        const session = await queryService.getById('session-123');
        assert.strictEqual(session, null);
      });
    });

    describe('createMockSessionAuthorizationService', () => {
      it('should authorize all requests by default', () => {
        const authService = createMockSessionAuthorizationService();

        const result = authService.verifyOwnership(createMockSession(), 'user-123');
        assert.strictEqual(result.authorized, true);
      });
    });

    describe('createMockSession', () => {
      it('should create a session with defaults', () => {
        const session = createMockSession();

        assert.ok(session.id);
        assert.ok(session.userId);
        assert.strictEqual(session.status, 'completed');
        assert.strictEqual(session.provider, 'claude');
      });

      it('should allow overriding properties', () => {
        const session = createMockSession({
          id: 'custom-id',
          status: 'running',
          favorite: true,
        });

        assert.strictEqual(session.id, 'custom-id');
        assert.strictEqual(session.status, 'running');
        assert.strictEqual(session.favorite, true);
      });
    });
  });

  describe('Dependency Injection Pattern', () => {
    it('should enable testing route handlers without ServiceProvider', async () => {
      // Create a mock container for testing
      const container = createTestContainer();

      // Example: Simulating a route handler that uses injected services
      async function handleListSessions(
        userId: string,
        services: Pick<ServiceContainer, 'sessionQueryService' | 'logger'>
      ) {
        const sessions = await services.sessionQueryService.listActive(userId);
        return { success: true, data: { sessions, total: sessions.length } };
      }

      // Test the handler with mock services
      const result = await handleListSessions('user-123', container);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data.sessions, []);
      assert.strictEqual(result.data.total, 0);
    });

    it('should allow customizing mock behavior for specific tests', async () => {
      const mockSession = createMockSession({ id: 'test-session' });

      // Create a custom query service that returns specific data
      const customQueryService = {
        ...createMockSessionQueryService(),
        listActive: async () => [mockSession],
        getById: async (id: string) => (id === 'test-session' ? mockSession : null),
      };

      const container = createTestContainer({
        sessionQueryService: customQueryService as any,
      });

      // Test with custom data
      const sessions = await container.sessionQueryService.listActive('user-123');
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].id, 'test-session');
    });
  });
});
