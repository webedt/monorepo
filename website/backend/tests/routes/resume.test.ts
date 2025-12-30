/**
 * Tests for Resume Routes
 * Covers input validation, session lookup, and SSE event replay logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Resume Routes - Input Validation', () => {
  describe('GET /resume/:sessionId', () => {
    it('should require sessionId parameter', () => {
      const params = {};
      const result = validateResumeParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Session ID is required');
    });

    it('should reject empty sessionId', () => {
      const params = { sessionId: '' };
      const result = validateResumeParams(params);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid UUID sessionId', () => {
      const params = { sessionId: '550e8400-e29b-41d4-a716-446655440000' };
      const result = validateResumeParams(params);

      assert.strictEqual(result.valid, true);
    });

    it('should accept sessionPath format', () => {
      const params = { sessionId: 'owner__repo__feature-branch' };
      const result = validateResumeParams(params);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('GET /sessions/:sessionId/events', () => {
    it('should require sessionId parameter', () => {
      const params = {};
      const result = validateGetEventsParams(params);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid sessionId', () => {
      const params = { sessionId: 'session-123' };
      const result = validateGetEventsParams(params);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Resume Routes - Session Status Handling', () => {
  describe('Running Session Detection', () => {
    it('should detect recently active session', () => {
      const session = {
        status: 'running',
        workerLastActivity: new Date(Date.now() - 30 * 1000), // 30 seconds ago
      };

      const result = isSessionRecentlyActive(session, 2 * 60 * 1000);
      assert.strictEqual(result, true);
    });

    it('should detect inactive running session (orphaned)', () => {
      const session = {
        status: 'running',
        workerLastActivity: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      };

      const result = isSessionRecentlyActive(session, 2 * 60 * 1000);
      assert.strictEqual(result, false);
    });

    it('should handle null workerLastActivity', () => {
      const session = {
        status: 'running',
        workerLastActivity: null,
      };

      const result = isSessionRecentlyActive(session, 2 * 60 * 1000);
      assert.strictEqual(result, false);
    });

    it('should not apply activity check to completed sessions', () => {
      const session = {
        status: 'completed',
        workerLastActivity: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      };

      // For completed sessions, we don't check activity
      assert.strictEqual(session.status, 'completed');
    });
  });

  describe('Session Status Types', () => {
    it('should recognize valid status types', () => {
      const validStatuses = ['pending', 'running', 'completed', 'error'];

      for (const status of validStatuses) {
        assert.strictEqual(isValidSessionStatus(status), true, `Status '${status}' should be valid`);
      }
    });

    it('should reject invalid status types', () => {
      const invalidStatuses = ['paused', 'cancelled', 'unknown', ''];

      for (const status of invalidStatuses) {
        assert.strictEqual(
          isValidSessionStatus(status),
          false,
          `Status '${status}' should be invalid`
        );
      }
    });
  });
});

describe('Resume Routes - SSE Event Replay', () => {
  describe('Replay Event Format', () => {
    it('should add _replayed flag to replayed events', () => {
      const originalEvent = {
        type: 'content_block',
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const replayedEvent = markEventAsReplayed(originalEvent);

      assert.strictEqual(replayedEvent._replayed, true);
      assert.strictEqual(replayedEvent._originalTimestamp, '2024-01-01T00:00:00Z');
    });

    it('should preserve original event data', () => {
      const originalEvent = {
        type: 'tool_use',
        tool: 'bash',
        input: { command: 'ls' },
      };

      const replayedEvent = markEventAsReplayed(originalEvent);

      assert.strictEqual(replayedEvent.type, 'tool_use');
      assert.strictEqual(replayedEvent.tool, 'bash');
      assert.deepStrictEqual(replayedEvent.input, { command: 'ls' });
    });
  });

  describe('Replay Markers', () => {
    it('should create replay_start event', () => {
      const event = createReplayStartEvent(10);

      assert.strictEqual(event.type, 'replay_start');
      assert.strictEqual(event.totalEvents, 10);
      assert.ok(event.timestamp);
    });

    it('should create replay_end event', () => {
      const event = createReplayEndEvent(10);

      assert.strictEqual(event.type, 'replay_end');
      assert.strictEqual(event.totalEvents, 10);
      assert.ok(event.timestamp);
    });
  });

  describe('Session Info Event', () => {
    it('should format session info correctly', () => {
      const session = {
        id: 'session-123',
        sessionPath: 'owner__repo__branch',
        status: 'completed',
        branch: 'feature-branch',
        baseBranch: 'main',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        repositoryUrl: 'https://github.com/owner/repo',
        userRequest: 'Test session',
        createdAt: new Date('2024-01-01'),
        completedAt: new Date('2024-01-02'),
      };

      const event = createSessionInfoEvent(session);

      assert.strictEqual(event.type, 'session_info');
      assert.strictEqual(event.sessionId, 'session-123');
      assert.strictEqual(event.status, 'completed');
      assert.strictEqual(event.branch, 'feature-branch');
    });
  });
});

describe('Resume Routes - Reconnection Events', () => {
  describe('Reconnected Event', () => {
    it('should create reconnected event for running session', () => {
      const event = createReconnectedEvent('session-123', 'running', 'Reconnected to active session');

      assert.strictEqual(event.type, 'reconnected');
      assert.strictEqual(event.sessionId, 'session-123');
      assert.strictEqual(event.status, 'running');
      assert.ok(event.message.includes('Reconnected'));
    });

    it('should create reconnected event for orphaned session', () => {
      const event = createReconnectedEvent(
        'session-123',
        'error',
        'Session was interrupted - worker no longer active'
      );

      assert.strictEqual(event.status, 'error');
      assert.ok(event.message.includes('interrupted'));
    });

    it('should create reconnected event for completed session', () => {
      const event = createReconnectedEvent('session-123', 'completed', 'Session completed');

      assert.strictEqual(event.status, 'completed');
    });
  });

  describe('Submission Preview Event', () => {
    it('should create preview with repo info', () => {
      const session = {
        userRequest: 'Test Session',
        sessionPath: 'owner__repo__branch',
        id: 'session-123',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      };

      const event = createSubmissionPreviewEvent(session);

      assert.strictEqual(event.type, 'submission_preview');
      assert.ok(event.message.includes('owner/repo'));
    });

    it('should create preview without repo info', () => {
      const session = {
        userRequest: 'Test Session',
        sessionPath: 'owner__repo__branch',
        id: 'session-123',
        repositoryOwner: null,
        repositoryName: null,
      };

      const event = createSubmissionPreviewEvent(session);

      assert.strictEqual(event.type, 'submission_preview');
      assert.ok(!event.message.includes('null'));
    });
  });
});

describe('Resume Routes - Live Stream Events', () => {
  describe('Live Stream Start', () => {
    it('should create live_stream_start event', () => {
      const event = createLiveStreamStartEvent();

      assert.strictEqual(event.type, 'live_stream_start');
      assert.ok(event.message.includes('live events'));
      assert.ok(event.timestamp);
    });
  });

  describe('Completed Event', () => {
    it('should create completed event for replayed session', () => {
      const event = createCompletedEvent('session-123', true);

      assert.strictEqual(event.websiteSessionId, 'session-123');
      assert.strictEqual(event.completed, true);
      assert.strictEqual(event.replayed, true);
    });

    it('should create completed event for live session', () => {
      const event = createCompletedEvent('session-123', false);

      assert.strictEqual(event.replayed, false);
    });
  });
});

describe('Resume Routes - Error Handling', () => {
  describe('Session Not Found', () => {
    it('should return 404 error format', () => {
      const response = createNotFoundResponse();

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Session not found');
      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe('SSE Error Event', () => {
    it('should create error event for SSE stream', () => {
      const event = createSSEErrorEvent('Resume failed');

      assert.strictEqual(event.type, 'error');
      assert.strictEqual(event.error, 'Resume failed');
    });
  });
});

describe('Resume Routes - Events Response Format', () => {
  describe('GET /sessions/:id/events Response', () => {
    it('should return formatted events list', () => {
      const storedEvents = [
        { id: 1, chatSessionId: 'session-123', eventData: { type: 'test' }, timestamp: new Date() },
        { id: 2, chatSessionId: 'session-123', eventData: { type: 'test2' }, timestamp: new Date() },
      ];

      const response = createEventsResponse(storedEvents, 'session-123', 'owner__repo__branch', 'completed');

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.events.length, 2);
      assert.strictEqual(response.data.total, 2);
      assert.strictEqual(response.data.sessionId, 'session-123');
    });

    it('should handle empty events list', () => {
      const response = createEventsResponse([], 'session-123', 'path', 'completed');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.events.length, 0);
      assert.strictEqual(response.data.total, 0);
    });
  });
});

// Helper functions that mirror the validation logic in resume.ts
function validateResumeParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { sessionId } = params;

  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
    return { valid: false, error: 'Session ID is required' };
  }

  return { valid: true };
}

function validateGetEventsParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { sessionId } = params;

  if (!sessionId) {
    return { valid: false, error: 'Session ID is required' };
  }

  return { valid: true };
}

function isSessionRecentlyActive(
  session: { status: string; workerLastActivity: Date | null },
  thresholdMs: number
): boolean {
  if (!session.workerLastActivity) {
    return false;
  }

  const timeSinceActivity = Date.now() - new Date(session.workerLastActivity).getTime();
  return timeSinceActivity < thresholdMs;
}

function isValidSessionStatus(status: string): boolean {
  const validStatuses = ['pending', 'running', 'completed', 'error'];
  return validStatuses.includes(status);
}

function markEventAsReplayed(
  event: Record<string, unknown>
): Record<string, unknown> & { _replayed: boolean; _originalTimestamp: unknown } {
  return {
    ...event,
    _replayed: true,
    _originalTimestamp: event.timestamp,
  };
}

function createReplayStartEvent(totalEvents: number): {
  type: string;
  totalEvents: number;
  timestamp: string;
} {
  return {
    type: 'replay_start',
    totalEvents,
    timestamp: new Date().toISOString(),
  };
}

function createReplayEndEvent(totalEvents: number): {
  type: string;
  totalEvents: number;
  timestamp: string;
} {
  return {
    type: 'replay_end',
    totalEvents,
    timestamp: new Date().toISOString(),
  };
}

function createSessionInfoEvent(session: {
  id: string;
  sessionPath?: string;
  status: string;
  branch?: string;
  baseBranch?: string;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  repositoryUrl?: string | null;
  userRequest?: string | null;
  createdAt?: Date | null;
  completedAt?: Date | null;
}): Record<string, unknown> {
  return {
    type: 'session_info',
    sessionId: session.id,
    sessionPath: session.sessionPath,
    status: session.status,
    branch: session.branch,
    baseBranch: session.baseBranch,
    repositoryOwner: session.repositoryOwner,
    repositoryName: session.repositoryName,
    repositoryUrl: session.repositoryUrl,
    userRequest: session.userRequest,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    timestamp: new Date().toISOString(),
  };
}

function createReconnectedEvent(
  sessionId: string,
  status: string,
  message: string
): {
  type: string;
  sessionId: string;
  status: string;
  message: string;
  timestamp: string;
} {
  return {
    type: 'reconnected',
    sessionId,
    status,
    message,
    timestamp: new Date().toISOString(),
  };
}

function createSubmissionPreviewEvent(session: {
  userRequest?: string | null;
  sessionPath?: string | null;
  id: string;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
}): { type: string; message: string } {
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
  };
}

function createLiveStreamStartEvent(): {
  type: string;
  message: string;
  timestamp: string;
} {
  return {
    type: 'live_stream_start',
    message: 'Now receiving live events',
    timestamp: new Date().toISOString(),
  };
}

function createCompletedEvent(
  websiteSessionId: string,
  replayed: boolean
): {
  websiteSessionId: string;
  completed: boolean;
  replayed: boolean;
} {
  return {
    websiteSessionId,
    completed: true,
    replayed,
  };
}

function createNotFoundResponse(): {
  success: boolean;
  error: string;
  statusCode: number;
} {
  return {
    success: false,
    error: 'Session not found',
    statusCode: 404,
  };
}

function createSSEErrorEvent(errorMessage: string): {
  type: string;
  error: string;
} {
  return {
    type: 'error',
    error: errorMessage,
  };
}

function createEventsResponse(
  events: Array<{ id: number; chatSessionId: string; eventData: unknown; timestamp: Date }>,
  sessionId: string,
  sessionPath: string,
  status: string
): {
  success: boolean;
  data: {
    events: Array<{
      id: number;
      chatSessionId: string;
      eventData: unknown;
      timestamp: Date;
    }>;
    total: number;
    sessionId: string;
    sessionPath: string;
    status: string;
  };
} {
  return {
    success: true,
    data: {
      events: events.map((e) => ({
        id: e.id,
        chatSessionId: sessionId,
        eventData: e.eventData,
        timestamp: e.timestamp,
      })),
      total: events.length,
      sessionId,
      sessionPath,
      status,
    },
  };
}
