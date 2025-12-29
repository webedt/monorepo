/**
 * Service-Layer Tests for Sessions
 *
 * Tests the business logic and mock service implementations for session operations.
 * These tests verify the behavior of mock services (query, authorization, events)
 * that simulate the session route handlers' data layer.
 *
 * For actual HTTP endpoint tests, see sessions.http.test.ts which uses supertest.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createMockRequest, createMockResponse, createMockUser, createMockSession } from '../helpers/mockExpress.js';
import { createMockChatSession, createMockEvent } from '../helpers/testApp.js';
import { MockDb, createMockDb } from '../helpers/mockDb.js';
import {
  createMockSessionQueryService,
  createMockSessionAuthorizationService,
  createMockEventStorageService,
} from '../helpers/mockServices.js';

describe('Sessions Service Layer Tests', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  afterEach(() => {
    mockDb.clear();
  });

  describe('Authentication Middleware', () => {
    it('should reject requests without authentication', () => {
      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      // Simulate requireAuth middleware
      if (!req.user || !req.authSession) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      } else {
        next();
      }

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
    });

    it('should allow authenticated requests to proceed', () => {
      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      // Simulate requireAuth middleware
      if (!req.user || !req.authSession) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      } else {
        next();
      }

      assert.strictEqual(nextCalled, true);
    });
  });

  describe('Session Ownership Verification', () => {
    it('should allow owner to access their session', async () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({ userId });
      const authService = createMockSessionAuthorizationService();

      const result = authService.verifyOwnership(session, userId);

      assert.strictEqual(result.authorized, true);
    });

    it('should deny non-owner access to session', () => {
      const session = mockDb.createSession({ userId: 'owner-user-id' });
      const authService = createMockSessionAuthorizationService();

      const result = authService.verifyOwnership(session, 'different-user-id');

      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 403);
      assert.strictEqual(result.error, 'Access denied');
    });

    it('should return 404 for non-existent session', () => {
      const authService = createMockSessionAuthorizationService();

      const result = authService.verifyOwnership(null, 'any-user-id');

      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 404);
      assert.strictEqual(result.error, 'Session not found');
    });
  });

  describe('GET / - List Sessions', () => {
    it('should return empty array when user has no sessions', async () => {
      const userId = 'test-user-id';
      const queryService = createMockSessionQueryService(mockDb);

      const sessions = await queryService.listActive(userId);

      assert.strictEqual(sessions.length, 0);
    });

    it('should return all active sessions for user', async () => {
      const userId = 'test-user-id';
      mockDb.createSession({ userId, userRequest: 'Session 1' });
      mockDb.createSession({ userId, userRequest: 'Session 2' });
      mockDb.createSession({ userId: 'other-user', userRequest: 'Other user session' });

      const queryService = createMockSessionQueryService(mockDb);
      const sessions = await queryService.listActive(userId);

      assert.strictEqual(sessions.length, 2);
      assert.ok(sessions.some((s) => s.userRequest === 'Session 1'));
      assert.ok(sessions.some((s) => s.userRequest === 'Session 2'));
    });

    it('should exclude deleted sessions', async () => {
      const userId = 'test-user-id';
      mockDb.createSession({ userId, userRequest: 'Active session' });
      mockDb.createSession({ userId, userRequest: 'Deleted session', deletedAt: new Date() });

      const queryService = createMockSessionQueryService(mockDb);
      const sessions = await queryService.listActive(userId);

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].userRequest, 'Active session');
    });
  });

  describe('GET /search - Search Sessions', () => {
    it('should search sessions by query', async () => {
      const userId = 'test-user-id';
      mockDb.createSession({ userId, userRequest: 'Fix authentication bug' });
      mockDb.createSession({ userId, userRequest: 'Add new feature' });
      mockDb.createSession({ userId, userRequest: 'Auth refactoring' });

      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.search(userId, 'auth');

      assert.strictEqual(result.sessions.length, 2);
      assert.ok(result.sessions.some((s) => s.userRequest === 'Fix authentication bug'));
      assert.ok(result.sessions.some((s) => s.userRequest === 'Auth refactoring'));
    });

    it('should filter by status', async () => {
      const userId = 'test-user-id';
      mockDb.createSession({ userId, userRequest: 'Completed task', status: 'completed' });
      mockDb.createSession({ userId, userRequest: 'Running task', status: 'running' });
      mockDb.createSession({ userId, userRequest: 'Pending task', status: 'pending' });

      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.search(userId, 'task', { status: 'completed' });

      assert.strictEqual(result.sessions.length, 1);
      assert.strictEqual(result.sessions[0].status, 'completed');
    });

    it('should filter by favorite', async () => {
      const userId = 'test-user-id';
      mockDb.createSession({ userId, userRequest: 'Favorite session', isFavorite: true });
      mockDb.createSession({ userId, userRequest: 'Regular session', isFavorite: false });

      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.search(userId, 'session', { favorite: true });

      assert.strictEqual(result.sessions.length, 1);
      assert.strictEqual(result.sessions[0].userRequest, 'Favorite session');
    });

    it('should respect limit and offset', async () => {
      const userId = 'test-user-id';
      for (let i = 0; i < 10; i++) {
        mockDb.createSession({ userId, userRequest: `Session ${i}` });
      }

      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.search(userId, 'Session', { limit: 3, offset: 2 });

      assert.strictEqual(result.sessions.length, 3);
      assert.strictEqual(result.total, 10);
    });
  });

  describe('GET /:id - Get Session by ID', () => {
    it('should return session by ID', async () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({ userId, userRequest: 'Test session' });

      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.getById(session.id);

      assert.ok(result);
      assert.strictEqual(result.id, session.id);
      assert.strictEqual(result.userRequest, 'Test session');
    });

    it('should return null for non-existent session', async () => {
      const queryService = createMockSessionQueryService(mockDb);
      const result = await queryService.getById('non-existent-id');

      assert.strictEqual(result, null);
    });
  });

  describe('POST /create-code-session - Create Session', () => {
    it('should validate required fields', () => {
      // Test missing repositoryOwner
      let result = validateCreateCodeSession({ repositoryName: 'repo', baseBranch: 'main', branch: 'feature' });
      assert.strictEqual(result.valid, false);

      // Test missing repositoryName
      result = validateCreateCodeSession({ repositoryOwner: 'owner', baseBranch: 'main', branch: 'feature' });
      assert.strictEqual(result.valid, false);

      // Test missing baseBranch
      result = validateCreateCodeSession({ repositoryOwner: 'owner', repositoryName: 'repo', branch: 'feature' });
      assert.strictEqual(result.valid, false);

      // Test missing branch
      result = validateCreateCodeSession({ repositoryOwner: 'owner', repositoryName: 'repo', baseBranch: 'main' });
      assert.strictEqual(result.valid, false);
    });

    it('should accept valid input', () => {
      const result = validateCreateCodeSession({
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        baseBranch: 'main',
        branch: 'feature-branch',
      });

      assert.strictEqual(result.valid, true);
    });

    it('should generate session path correctly', () => {
      const path = generateSessionPath('owner', 'repo', 'feature-branch');
      assert.strictEqual(path, 'owner__repo__feature-branch');
    });

    it('should generate repository URL correctly', () => {
      const url = generateRepositoryUrl('owner', 'repo');
      assert.strictEqual(url, 'https://github.com/owner/repo');
    });
  });

  describe('PATCH /:id - Update Session', () => {
    it('should require at least one field to update', () => {
      const result = validateUpdateSession({});
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'At least one field must be provided');
    });

    it('should accept userRequest update', () => {
      const result = validateUpdateSession({ userRequest: 'New title' });
      assert.strictEqual(result.valid, true);
    });

    it('should accept branch update', () => {
      const result = validateUpdateSession({ branch: 'new-branch' });
      assert.strictEqual(result.valid, true);
    });

    it('should reject empty userRequest', () => {
      const result = validateUpdateSession({ userRequest: '' });
      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only userRequest', () => {
      const result = validateUpdateSession({ userRequest: '   ' });
      assert.strictEqual(result.valid, false);
    });

    it('should update session in database', () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({ userId, userRequest: 'Original' });

      const updated = mockDb.updateSession(session.id, { userRequest: 'Updated' });

      assert.ok(updated);
      assert.strictEqual(updated.userRequest, 'Updated');
    });
  });

  describe('DELETE /:id - Delete Session', () => {
    it('should soft delete session', () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({ userId });

      const success = mockDb.deleteSession(session.id);

      assert.strictEqual(success, true);
      const deletedSession = mockDb.getSession(session.id);
      assert.ok(deletedSession?.deletedAt);
    });

    it('should return false for non-existent session', () => {
      const success = mockDb.deleteSession('non-existent-id');
      assert.strictEqual(success, false);
    });
  });

  describe('POST /bulk-delete - Bulk Delete Sessions', () => {
    it('should validate ids array', () => {
      assert.strictEqual(validateBulkDelete({}).valid, false);
      assert.strictEqual(validateBulkDelete({ ids: [] }).valid, false);
      assert.strictEqual(validateBulkDelete({ ids: 'not-array' }).valid, false);
      assert.strictEqual(validateBulkDelete({ ids: ['id1', 'id2'] }).valid, true);
    });

    it('should delete multiple sessions', () => {
      const userId = 'test-user-id';
      const session1 = mockDb.createSession({ userId });
      const session2 = mockDb.createSession({ userId });
      const session3 = mockDb.createSession({ userId });

      mockDb.deleteSession(session1.id);
      mockDb.deleteSession(session2.id);

      const remaining = mockDb.getSessionsByUserId(userId);
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].id, session3.id);
    });
  });

  describe('POST /:id/share - Share Session', () => {
    it('should validate expiresInDays', () => {
      assert.strictEqual(validateShareInput({}).valid, true); // Optional
      assert.strictEqual(validateShareInput({ expiresInDays: 30 }).valid, true);
      assert.strictEqual(validateShareInput({ expiresInDays: 0 }).valid, false);
      assert.strictEqual(validateShareInput({ expiresInDays: 400 }).valid, false);
    });

    it('should generate share token', () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });
      const shareToken = generateShareToken();

      assert.ok(shareToken);
      assert.ok(shareToken.length > 10);

      const updated = mockDb.updateSession(session.id, { shareToken });
      assert.strictEqual(updated?.shareToken, shareToken);
    });
  });

  describe('GET /shared/:token - Get Shared Session', () => {
    it('should validate share token', () => {
      const authService = createMockSessionAuthorizationService();

      const sessionWithToken = createMockChatSession({ shareToken: 'valid-token' });
      const result = authService.verifyShareTokenAccess(sessionWithToken, 'valid-token');
      assert.strictEqual(result.authorized, true);
    });

    it('should reject invalid share token', () => {
      const authService = createMockSessionAuthorizationService();

      const sessionWithToken = createMockChatSession({ shareToken: 'valid-token' });
      const result = authService.verifyShareTokenAccess(sessionWithToken, 'wrong-token');
      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 403);
    });

    it('should reject expired share token', () => {
      const authService = createMockSessionAuthorizationService();

      const expiredSession = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: new Date(Date.now() - 86400000), // 1 day ago
      });
      const result = authService.verifyShareTokenAccess(expiredSession, 'valid-token');
      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.error, 'Share link has expired');
    });

    it('should accept non-expired share token', () => {
      const authService = createMockSessionAuthorizationService();

      const validSession = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: new Date(Date.now() + 86400000), // 1 day from now
      });
      const result = authService.verifyShareTokenAccess(validSession, 'valid-token');
      assert.strictEqual(result.authorized, true);
    });
  });

  describe('DELETE /:id/share - Revoke Share', () => {
    it('should remove share token', () => {
      const session = mockDb.createSession({
        userId: 'test-user-id',
        shareToken: 'token-to-remove',
        shareExpiresAt: new Date(Date.now() + 86400000),
      });

      const updated = mockDb.updateSession(session.id, { shareToken: null, shareExpiresAt: null });

      assert.strictEqual(updated?.shareToken, null);
      assert.strictEqual(updated?.shareExpiresAt, null);
    });
  });

  describe('POST /:id/favorite - Toggle Favorite', () => {
    it('should toggle favorite status', () => {
      const session = mockDb.createSession({ userId: 'test-user-id', isFavorite: false });

      // Toggle to true
      let updated = mockDb.updateSession(session.id, { isFavorite: true });
      assert.strictEqual(updated?.isFavorite, true);

      // Toggle to false
      updated = mockDb.updateSession(session.id, { isFavorite: false });
      assert.strictEqual(updated?.isFavorite, false);
    });
  });

  describe('GET /:id/events - Get Session Events', () => {
    it('should return events for session', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });
      mockDb.createEvent({ chatSessionId: session.id, eventType: 'message' });
      mockDb.createEvent({ chatSessionId: session.id, eventType: 'tool_use' });

      const eventService = createMockEventStorageService(mockDb);
      const events = await eventService.getEvents(session.id);

      assert.strictEqual(events.length, 2);
    });

    it('should return empty array for session with no events', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });

      const eventService = createMockEventStorageService(mockDb);
      const events = await eventService.getEvents(session.id);

      assert.strictEqual(events.length, 0);
    });
  });

  describe('POST /:id/events - Create Event', () => {
    it('should validate event data', () => {
      assert.strictEqual(validateCreateEvent(null, {}).valid, false); // No session ID
      assert.strictEqual(validateCreateEvent('session-id', {}).valid, false); // No event data
      assert.strictEqual(validateCreateEvent('session-id', { eventData: { type: 'test' } }).valid, true);
    });

    it('should store event', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });

      const eventService = createMockEventStorageService(mockDb);
      const event = await eventService.storeEvent(session.id, {
        eventType: 'message',
        eventData: { content: 'Test message' },
      });

      assert.ok(event);
      assert.strictEqual(event.chatSessionId, session.id);
    });
  });

  describe('POST /:id/messages - Create Message', () => {
    it('should validate message type', () => {
      assert.strictEqual(validateCreateMessage({ content: 'Hello' }).valid, false); // No type
      assert.strictEqual(validateCreateMessage({ type: 'user' }).valid, false); // No content
      assert.strictEqual(validateCreateMessage({ type: 'invalid', content: 'Hello' }).valid, false);
      assert.strictEqual(validateCreateMessage({ type: 'user', content: 'Hello' }).valid, true);
      assert.strictEqual(validateCreateMessage({ type: 'assistant', content: 'Hi' }).valid, true);
      assert.strictEqual(validateCreateMessage({ type: 'system', content: 'Info' }).valid, true);
      assert.strictEqual(validateCreateMessage({ type: 'error', content: 'Error' }).valid, true);
    });
  });

  describe('POST /:id/send - Send Message to Session', () => {
    it('should validate content', () => {
      assert.strictEqual(validateSendMessage({}).valid, false);
      assert.strictEqual(validateSendMessage({ content: 123 }).valid, false);
      assert.strictEqual(validateSendMessage({ content: '' }).valid, false);
      assert.strictEqual(validateSendMessage({ content: 'Hello!' }).valid, true);
    });
  });

  describe('POST /:id/worker-status - Worker Status Update', () => {
    it('should validate worker secret', () => {
      const expectedSecret = 'correct-secret';

      assert.strictEqual(
        validateWorkerStatus({ status: 'completed' }, expectedSecret).valid,
        false
      );
      assert.strictEqual(
        validateWorkerStatus({ status: 'completed', workerSecret: 'wrong' }, expectedSecret).valid,
        false
      );
      assert.strictEqual(
        validateWorkerStatus({ status: 'completed', workerSecret: expectedSecret }, expectedSecret).valid,
        true
      );
    });

    it('should validate status values', () => {
      const secret = 'test-secret';

      assert.strictEqual(
        validateWorkerStatus({ status: 'invalid', workerSecret: secret }, secret).valid,
        false
      );
      assert.strictEqual(
        validateWorkerStatus({ status: 'completed', workerSecret: secret }, secret).valid,
        true
      );
      assert.strictEqual(
        validateWorkerStatus({ status: 'error', workerSecret: secret }, secret).valid,
        true
      );
    });

    it('should update session status', () => {
      const session = mockDb.createSession({
        userId: 'test-user-id',
        status: 'running',
        workerSecret: 'test-secret',
      });

      const updated = mockDb.updateSession(session.id, {
        status: 'completed',
        completedAt: new Date(),
        workerLastActivity: null,
      });

      assert.strictEqual(updated?.status, 'completed');
      assert.ok(updated?.completedAt);
    });
  });

  describe('Response Format', () => {
    it('should format success response correctly', () => {
      const session = createMockChatSession();
      const response = createSuccessResponse(session);

      assert.strictEqual(response.success, true);
      assert.ok(response.session);
      assert.strictEqual(response.session.id, session.id);
    });

    it('should format list response correctly', () => {
      const sessions = [createMockChatSession(), createMockChatSession()];
      const response = createListResponse(sessions);

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.sessions.length, 2);
      assert.strictEqual(response.data.total, 2);
    });

    it('should format error response correctly', () => {
      const response = createErrorResponse('Something went wrong');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Something went wrong');
    });
  });
});

// Helper validation functions
function validateCreateCodeSession(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const { repositoryOwner, repositoryName, baseBranch, branch } = body;
  if (!repositoryOwner || !repositoryName || !baseBranch || !branch) {
    return { valid: false, error: 'Missing required fields' };
  }
  return { valid: true };
}

function validateUpdateSession(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const { userRequest, branch } = body;
  const hasUserRequest = userRequest && typeof userRequest === 'string' && userRequest.trim().length > 0;
  const hasBranch = branch && typeof branch === 'string' && branch.trim().length > 0;

  if (!hasUserRequest && !hasBranch) {
    return { valid: false, error: 'At least one field must be provided' };
  }
  return { valid: true };
}

function validateBulkDelete(body: Record<string, unknown>): { valid: boolean } {
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return { valid: false };
  }
  return { valid: true };
}

function validateShareInput(body: Record<string, unknown>): { valid: boolean } {
  const { expiresInDays } = body as { expiresInDays?: number };
  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
      return { valid: false };
    }
  }
  return { valid: true };
}

function validateCreateEvent(sessionId: string | null, body: Record<string, unknown>): { valid: boolean } {
  if (!sessionId) return { valid: false };
  if (!body.eventData) return { valid: false };
  return { valid: true };
}

function validateCreateMessage(body: Record<string, unknown>): { valid: boolean } {
  const { type, content } = body;
  if (!type || !content) return { valid: false };
  const validTypes = ['user', 'assistant', 'system', 'error'];
  if (!validTypes.includes(type as string)) return { valid: false };
  return { valid: true };
}

function validateSendMessage(body: Record<string, unknown>): { valid: boolean } {
  const { content } = body;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    return { valid: false };
  }
  return { valid: true };
}

function validateWorkerStatus(body: Record<string, unknown>, expectedSecret: string): { valid: boolean } {
  const { status, workerSecret } = body;
  if (!workerSecret || workerSecret !== expectedSecret) return { valid: false };
  if (!status || !['completed', 'error'].includes(status as string)) return { valid: false };
  return { valid: true };
}

function generateSessionPath(owner: string, repo: string, branch: string): string {
  return `${owner}__${repo}__${branch}`;
}

function generateRepositoryUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

function generateShareToken(): string {
  return `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSuccessResponse(session: Record<string, unknown>): { success: boolean; session: Record<string, unknown> } {
  return { success: true, session };
}

function createListResponse(sessions: Array<Record<string, unknown>>): {
  success: boolean;
  data: { sessions: Array<Record<string, unknown>>; total: number };
} {
  return { success: true, data: { sessions, total: sessions.length } };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
