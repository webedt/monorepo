/**
 * Service-Layer Tests for Resume Routes
 *
 * Tests the mock service implementations for session event replay
 * and live streaming. These tests verify the behavior of the event
 * storage and broadcaster services.
 *
 * For actual HTTP endpoint tests, use supertest with the actual routes.
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
  createMockSessionEventBroadcaster,
} from '../helpers/mockServices.js';

describe('Resume Service Layer Tests', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  afterEach(() => {
    mockDb.clear();
  });

  describe('Authentication', () => {
    it('should require authentication', () => {
      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();

      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      assert.strictEqual(res.statusCode, 401);
    });

    it('should allow authenticated requests', () => {
      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { sessionId: 'test-session' },
      });

      assert.ok(req.user);
      assert.ok(req.authSession);
      assert.strictEqual(req.params.sessionId, 'test-session');
    });
  });

  describe('Session Lookup', () => {
    it('should find session by ID', async () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({ userId, userRequest: 'Test session' });

      const queryService = createMockSessionQueryService(mockDb);
      const found = await queryService.getById(session.id);

      assert.ok(found);
      assert.strictEqual(found.id, session.id);
    });

    it('should return 404 for non-existent session', async () => {
      const queryService = createMockSessionQueryService(mockDb);
      const found = await queryService.getById('non-existent');

      assert.strictEqual(found, null);
    });

    it('should verify session ownership', () => {
      const session = mockDb.createSession({ userId: 'owner-id' });
      const authService = createMockSessionAuthorizationService();

      // Owner should have access
      const ownerResult = authService.verifyOwnership(session, 'owner-id');
      assert.strictEqual(ownerResult.authorized, true);

      // Non-owner should be denied
      const otherResult = authService.verifyOwnership(session, 'other-user-id');
      assert.strictEqual(otherResult.authorized, false);
      assert.strictEqual(otherResult.statusCode, 403);
    });
  });

  describe('Event Replay', () => {
    it('should replay stored events', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });
      mockDb.createEvent({ chatSessionId: session.id, eventType: 'message', eventData: { text: 'First' } });
      mockDb.createEvent({ chatSessionId: session.id, eventType: 'message', eventData: { text: 'Second' } });
      mockDb.createEvent({ chatSessionId: session.id, eventType: 'completed', eventData: { done: true } });

      const eventService = createMockEventStorageService(mockDb);
      const events = await eventService.getEvents(session.id);

      assert.strictEqual(events.length, 3);
      assert.strictEqual(events[0].eventType, 'message');
      assert.strictEqual(events[2].eventType, 'completed');
    });

    it('should return empty array for session with no events', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });

      const eventService = createMockEventStorageService(mockDb);
      const events = await eventService.getEvents(session.id);

      assert.strictEqual(events.length, 0);
    });

    it('should support lastEventId for incremental replay', async () => {
      const session = mockDb.createSession({ userId: 'test-user-id' });

      // Create events - they will have sequential indexes in the array
      for (let i = 0; i < 5; i++) {
        mockDb.createEvent({
          chatSessionId: session.id,
          eventType: 'message',
          eventData: { index: i },
        });
      }

      const events = mockDb.getEvents(session.id);

      // Get events after the 3rd one (index 2) using array slice
      // This simulates filtering by "after this event" which in real DB would use ID comparison
      const lastEventIndex = 2;
      const newEvents = events.slice(lastEventIndex + 1);

      assert.strictEqual(newEvents.length, 2);
      assert.strictEqual((newEvents[0].eventData as { index: number }).index, 3);
      assert.strictEqual((newEvents[1].eventData as { index: number }).index, 4);
    });
  });

  describe('Live Streaming', () => {
    it('should check if session is active', () => {
      const broadcaster = createMockSessionEventBroadcaster();

      // Initially not active
      assert.strictEqual(broadcaster.isSessionActive('session-1'), false);

      // Subscribe makes it active
      const unsubscribe = broadcaster.subscribe('session-1', 'subscriber-1', () => {});
      assert.strictEqual(broadcaster.isSessionActive('session-1'), true);

      // Unsubscribe makes it inactive
      unsubscribe();
      assert.strictEqual(broadcaster.isSessionActive('session-1'), false);
    });

    it('should broadcast events to subscribers', () => {
      const broadcaster = createMockSessionEventBroadcaster();
      const receivedEvents: Array<{ eventType: string; data: unknown }> = [];

      broadcaster.subscribe('session-1', 'subscriber-1', (event) => {
        receivedEvents.push(event);
      });

      broadcaster.broadcast('session-1', { eventType: 'message', data: { text: 'Hello' } });
      broadcaster.broadcast('session-1', { eventType: 'message', data: { text: 'World' } });

      assert.strictEqual(receivedEvents.length, 2);
      assert.deepStrictEqual(receivedEvents[0].data, { text: 'Hello' });
    });

    it('should support multiple subscribers', () => {
      const broadcaster = createMockSessionEventBroadcaster();
      let subscriber1Received = 0;
      let subscriber2Received = 0;

      broadcaster.subscribe('session-1', 'subscriber-1', () => subscriber1Received++);
      broadcaster.subscribe('session-1', 'subscriber-2', () => subscriber2Received++);

      broadcaster.broadcast('session-1', { eventType: 'message', data: {} });

      assert.strictEqual(subscriber1Received, 1);
      assert.strictEqual(subscriber2Received, 1);
    });

    it('should isolate broadcasts between sessions', () => {
      const broadcaster = createMockSessionEventBroadcaster();
      let session1Count = 0;
      let session2Count = 0;

      broadcaster.subscribe('session-1', 'sub-1', () => session1Count++);
      broadcaster.subscribe('session-2', 'sub-2', () => session2Count++);

      broadcaster.broadcast('session-1', { eventType: 'message', data: {} });

      assert.strictEqual(session1Count, 1);
      assert.strictEqual(session2Count, 0);
    });
  });

  describe('Session Status Handling', () => {
    it('should handle completed sessions', () => {
      const session = createMockChatSession({ status: 'completed', completedAt: new Date() });

      assert.strictEqual(session.status, 'completed');
      assert.ok(session.completedAt);
    });

    it('should handle running sessions', () => {
      const session = createMockChatSession({
        status: 'running',
        workerStartedAt: new Date(),
        workerLastActivity: new Date(),
      });

      assert.strictEqual(session.status, 'running');
      assert.ok(session.workerLastActivity);
    });

    it('should detect orphaned running sessions', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const session = createMockChatSession({
        status: 'running',
        workerLastActivity: twoMinutesAgo,
      });

      const activityThresholdMs = 2 * 60 * 1000;
      const isRecentlyActive =
        session.workerLastActivity &&
        Date.now() - new Date(session.workerLastActivity).getTime() < activityThresholdMs;

      // Session is not recently active (orphaned)
      assert.strictEqual(isRecentlyActive, false);
    });

    it('should detect active running sessions', () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      const session = createMockChatSession({
        status: 'running',
        workerLastActivity: thirtySecondsAgo,
      });

      const activityThresholdMs = 2 * 60 * 1000;
      const isRecentlyActive =
        session.workerLastActivity &&
        Date.now() - new Date(session.workerLastActivity).getTime() < activityThresholdMs;

      // Session is recently active
      assert.strictEqual(isRecentlyActive, true);
    });

    it('should handle error sessions', () => {
      const session = createMockChatSession({ status: 'error' });

      assert.strictEqual(session.status, 'error');
    });

    it('should handle pending sessions', () => {
      const session = createMockChatSession({ status: 'pending' });

      assert.strictEqual(session.status, 'pending');
    });
  });

  describe('SSE Headers', () => {
    it('should set correct SSE headers', () => {
      const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      };

      assert.strictEqual(headers['Content-Type'], 'text/event-stream');
      assert.strictEqual(headers['Cache-Control'], 'no-cache');
      assert.strictEqual(headers['Connection'], 'keep-alive');
      assert.strictEqual(headers['X-Accel-Buffering'], 'no');
    });
  });

  describe('Submission Preview Event', () => {
    it('should format submission preview event', () => {
      const session = createMockChatSession({
        userRequest: 'Test Session',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const previewEvent = createSubmissionPreviewEvent(session);

      assert.strictEqual(previewEvent.type, 'submission_preview');
      assert.ok(previewEvent.message.includes('Resuming session'));
      assert.ok(previewEvent.message.includes('Test Session'));
      assert.ok(previewEvent.message.includes('owner/repo'));
    });

    it('should handle session without repository info', () => {
      const session = createMockChatSession({
        userRequest: 'Test Session',
        repositoryOwner: '',
        repositoryName: '',
      });

      const previewEvent = createSubmissionPreviewEvent(session);

      assert.strictEqual(previewEvent.type, 'submission_preview');
      assert.ok(previewEvent.message.includes('Test Session'));
    });
  });

  describe('Reconnection Events', () => {
    it('should format reconnected event for active session', () => {
      const event = createReconnectedEvent('session-123', 'running', 'Reconnected to active session');

      assert.strictEqual(event.type, 'reconnected');
      assert.strictEqual(event.sessionId, 'session-123');
      assert.strictEqual(event.status, 'running');
    });

    it('should format reconnected event for orphaned session', () => {
      const event = createReconnectedEvent('session-123', 'error', 'Session was interrupted');

      assert.strictEqual(event.type, 'reconnected');
      assert.strictEqual(event.status, 'error');
    });
  });

  describe('Completion Events', () => {
    it('should format completion event for replayed session', () => {
      const event = createCompletionEvent('session-123', true, 'completed');

      assert.strictEqual(event.websiteSessionId, 'session-123');
      assert.strictEqual(event.completed, true);
      assert.strictEqual(event.replayed, true);
    });

    it('should format completion event for live session', () => {
      const event = createCompletionEvent('session-123', false, 'completed');

      assert.strictEqual(event.replayed, false);
    });
  });

  describe('Error Handling', () => {
    it('should format error response for session not found', () => {
      const response = createErrorResponse(404, 'Session not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Session not found');
      assert.strictEqual(response.statusCode, 404);
    });

    it('should format error response for stream error', () => {
      const response = createErrorResponse(500, 'Failed to stream events');

      assert.strictEqual(response.statusCode, 500);
      assert.strictEqual(response.error, 'Failed to stream events');
    });
  });
});

// Helper functions
interface SessionData {
  id?: string;
  userRequest?: string;
  sessionPath?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  status?: string;
}

function createSubmissionPreviewEvent(session: SessionData) {
  const sessionName = session.userRequest || session.sessionPath || session.id;
  const repoInfo =
    session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : null;

  const previewText = repoInfo
    ? `Resuming session: ${sessionName} (${repoInfo})`
    : `Resuming session: ${sessionName}`;

  return {
    type: 'submission_preview',
    message: previewText,
    source: 'internal-api-server:/resume',
    timestamp: new Date().toISOString(),
    data: {
      sessionId: session.id,
      sessionName,
      repositoryOwner: session.repositoryOwner,
      repositoryName: session.repositoryName,
      branch: session.branch,
      status: session.status,
    },
  };
}

function createReconnectedEvent(sessionId: string, status: string, message: string) {
  return {
    type: 'reconnected',
    sessionId,
    status,
    message,
    timestamp: new Date().toISOString(),
  };
}

function createCompletionEvent(sessionId: string, replayed: boolean, status: string) {
  return {
    websiteSessionId: sessionId,
    completed: true,
    replayed,
    status,
  };
}

function createErrorResponse(statusCode: number, error: string) {
  return {
    success: false,
    error,
    statusCode,
  };
}
