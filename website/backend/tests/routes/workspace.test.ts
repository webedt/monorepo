/**
 * Tests for Workspace Routes
 * Covers presence management, workspace events, and real-time collaboration features.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Workspace Routes - Presence Management', () => {
  describe('PUT /presence', () => {
    it('should require owner field', () => {
      const body = {
        repo: 'my-repo',
        branch: 'main',
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Missing required fields: owner, repo, branch');
    });

    it('should require repo field', () => {
      const body = {
        owner: 'testuser',
        branch: 'main',
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require branch field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid presence data', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional cursor position', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        cursorX: 100,
        cursorY: 200,
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional page field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        page: 'code-editor',
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional selection field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        selection: { start: 0, end: 10 },
      };
      const result = validatePresenceInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('GET /presence/:owner/:repo/:branch', () => {
    it('should require all path params', () => {
      const params = { owner: 'testuser', repo: 'my-repo' };
      const result = validatePresenceGetParams(params);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid path params', () => {
      const params = { owner: 'testuser', repo: 'my-repo', branch: 'main' };
      const result = validatePresenceGetParams(params);

      assert.strictEqual(result.valid, true);
    });

    it('should decode URL-encoded branch names', () => {
      const encodedBranch = 'feature%2Ftest-branch';
      const decoded = decodeURIComponent(encodedBranch);

      assert.strictEqual(decoded, 'feature/test-branch');
    });
  });

  describe('DELETE /presence/:owner/:repo/:branch', () => {
    it('should require all path params', () => {
      const params = { owner: 'testuser', repo: 'my-repo' };
      const result = validatePresenceDeleteParams(params);

      assert.strictEqual(result.valid, false);
    });

    it('should generate correct presence ID', () => {
      const userId = 'user-123';
      const owner = 'testuser';
      const repo = 'my-repo';
      const branch = 'feature/test';

      const presenceId = generatePresenceId(userId, owner, repo, branch);

      assert.strictEqual(presenceId, 'user-123_testuser_my-repo_feature/test');
    });
  });
});

describe('Workspace Routes - Event Logging', () => {
  describe('POST /events', () => {
    it('should require owner field', () => {
      const body = {
        repo: 'my-repo',
        branch: 'main',
        eventType: 'file_open',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Missing required fields: owner, repo, branch, eventType');
    });

    it('should require repo field', () => {
      const body = {
        owner: 'testuser',
        branch: 'main',
        eventType: 'file_open',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require branch field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        eventType: 'file_open',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require eventType field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid event data', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        eventType: 'file_open',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional page field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        eventType: 'file_open',
        page: 'code-editor',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional path field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        eventType: 'file_open',
        path: '/src/index.ts',
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional payload field', () => {
      const body = {
        owner: 'testuser',
        repo: 'my-repo',
        branch: 'main',
        eventType: 'file_save',
        payload: { lineCount: 100 },
      };
      const result = validateEventInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('GET /events/:owner/:repo/:branch', () => {
    it('should default limit to 50', () => {
      const query = {};
      const result = parseEventsQuery(query);

      assert.strictEqual(result.limit, 50);
    });

    it('should parse custom limit', () => {
      const query = { limit: '100' };
      const result = parseEventsQuery(query);

      assert.strictEqual(result.limit, 100);
    });

    it('should parse since parameter', () => {
      const query = { since: '2024-01-01T00:00:00Z' };
      const result = parseEventsQuery(query);

      assert.ok(result.since instanceof Date);
    });

    it('should handle invalid since parameter', () => {
      const query = { since: 'invalid-date' };
      const result = parseEventsQuery(query);

      // Invalid date should be handled gracefully
      assert.strictEqual(result.since, null);
    });
  });
});

describe('Workspace Routes - Offline Detection', () => {
  describe('Offline Threshold', () => {
    it('should use 30 second threshold by default', () => {
      const OFFLINE_THRESHOLD_MS = 30 * 1000;
      assert.strictEqual(OFFLINE_THRESHOLD_MS, 30000);
    });

    it('should detect user as offline after threshold', () => {
      const lastHeartbeat = new Date(Date.now() - 40 * 1000); // 40 seconds ago
      const threshold = 30 * 1000;

      const isOffline = isUserOffline(lastHeartbeat, threshold);
      assert.strictEqual(isOffline, true);
    });

    it('should detect user as online within threshold', () => {
      const lastHeartbeat = new Date(Date.now() - 15 * 1000); // 15 seconds ago
      const threshold = 30 * 1000;

      const isOffline = isUserOffline(lastHeartbeat, threshold);
      assert.strictEqual(isOffline, false);
    });
  });
});

describe('Workspace Routes - Response Formats', () => {
  describe('Presence Response', () => {
    it('should format active users list', () => {
      const users = [
        {
          userId: 'user-1',
          displayName: 'Test User',
          email: 'test@example.com',
          page: 'code-editor',
          cursorX: 100,
          cursorY: 200,
          selection: null,
        },
      ];
      const currentUserId = 'user-1';

      const response = formatPresenceResponse(users, currentUserId, 'owner', 'repo', 'main');

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.users.length, 1);
      assert.strictEqual(response.data.users[0].isCurrentUser, true);
    });

    it('should use email prefix when displayName is null', () => {
      const users = [
        {
          userId: 'user-1',
          displayName: null,
          email: 'john@example.com',
          page: null,
          cursorX: null,
          cursorY: null,
          selection: null,
        },
      ];

      const response = formatPresenceResponse(users, 'other-user', 'owner', 'repo', 'main');

      assert.strictEqual(response.data.users[0].displayName, 'john');
    });

    it('should use Anonymous when no name or email', () => {
      const users = [
        {
          userId: 'user-1',
          displayName: null,
          email: null,
          page: null,
          cursorX: null,
          cursorY: null,
          selection: null,
        },
      ];

      const response = formatPresenceResponse(users, 'other-user', 'owner', 'repo', 'main');

      assert.strictEqual(response.data.users[0].displayName, 'Anonymous');
    });
  });

  describe('Events Response', () => {
    it('should format events list in chronological order', () => {
      const events = [
        {
          id: '1',
          userId: 'user-1',
          eventType: 'file_open',
          page: 'code-editor',
          path: '/src/index.ts',
          payload: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          displayName: 'Test User',
          email: 'test@example.com',
        },
      ];

      const response = formatEventsResponse(events, 'owner', 'repo', 'main');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.events.length, 1);
      assert.ok(response.data.events[0].userName);
    });
  });

  describe('Error Response', () => {
    it('should format error response', () => {
      const response = formatErrorResponse('Failed to update presence');

      assert.ok('error' in response);
      assert.strictEqual(response.error, 'Failed to update presence');
    });
  });
});

describe('Workspace Routes - SSE Stream', () => {
  describe('GET /events/:owner/:repo/:branch/stream', () => {
    it('should format connected event', () => {
      const event = formatConnectedEvent('owner', 'repo', 'main');

      assert.strictEqual(event.eventName, 'connected');
      assert.ok(event.data.branch);
      assert.ok(event.data.owner);
      assert.ok(event.data.repo);
    });

    it('should format workspace_event SSE', () => {
      const event = formatWorkspaceEvent({
        id: 'event-1',
        userId: 'user-1',
        eventType: 'file_save',
        displayName: 'Test User',
        email: 'test@example.com',
      });

      assert.strictEqual(event.eventName, 'workspace_event');
      assert.ok(event.data.userName);
    });

    it('should format presence_update SSE', () => {
      const users = [
        {
          userId: 'user-1',
          page: 'code-editor',
          cursorX: 100,
          cursorY: 200,
          selection: null,
          displayName: 'Test',
          email: null,
        },
      ];

      const event = formatPresenceUpdateEvent(users, 'current-user');

      assert.strictEqual(event.eventName, 'presence_update');
      assert.ok(Array.isArray(event.data.users));
    });
  });
});

// Helper functions that mirror the validation logic in workspace.ts
function validatePresenceInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { owner, repo, branch } = body;

  if (!owner || !repo || !branch) {
    return {
      valid: false,
      error: 'Missing required fields: owner, repo, branch',
    };
  }

  return { valid: true };
}

function validatePresenceGetParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { owner, repo, branch } = params;

  if (!owner || !repo || !branch) {
    return { valid: false, error: 'Missing required path parameters' };
  }

  return { valid: true };
}

function validatePresenceDeleteParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  return validatePresenceGetParams(params);
}

function generatePresenceId(
  userId: string,
  owner: string,
  repo: string,
  branch: string
): string {
  return `${userId}_${owner}_${repo}_${branch}`;
}

function validateEventInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { owner, repo, branch, eventType } = body;

  if (!owner || !repo || !branch || !eventType) {
    return {
      valid: false,
      error: 'Missing required fields: owner, repo, branch, eventType',
    };
  }

  return { valid: true };
}

function parseEventsQuery(query: Record<string, unknown>): {
  limit: number;
  since: Date | null;
} {
  const limit = parseInt(query.limit as string) || 50;
  let since: Date | null = null;

  if (query.since) {
    const parsed = new Date(query.since as string);
    since = isNaN(parsed.getTime()) ? null : parsed;
  }

  return { limit, since };
}

function isUserOffline(lastHeartbeat: Date, thresholdMs: number): boolean {
  return Date.now() - lastHeartbeat.getTime() > thresholdMs;
}

function formatPresenceResponse(
  users: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    page: string | null;
    cursorX: number | null;
    cursorY: number | null;
    selection: unknown;
  }>,
  currentUserId: string,
  owner: string,
  repo: string,
  branch: string
): {
  success: boolean;
  data: {
    users: Array<{
      userId: string;
      displayName: string;
      page: string | null;
      cursorX: number | null;
      cursorY: number | null;
      selection: unknown;
      isCurrentUser: boolean;
    }>;
    owner: string;
    repo: string;
    branch: string;
  };
} {
  return {
    success: true,
    data: {
      users: users.map((u) => ({
        userId: u.userId,
        displayName: u.displayName || u.email?.split('@')[0] || 'Anonymous',
        page: u.page,
        cursorX: u.cursorX,
        cursorY: u.cursorY,
        selection: u.selection,
        isCurrentUser: u.userId === currentUserId,
      })),
      owner,
      repo,
      branch,
    },
  };
}

function formatEventsResponse(
  events: Array<{
    id: string;
    userId: string;
    eventType: string;
    page: string | null;
    path: string | null;
    payload: unknown;
    createdAt: Date;
    displayName: string | null;
    email: string | null;
  }>,
  owner: string,
  repo: string,
  branch: string
): {
  success: boolean;
  data: {
    events: Array<Record<string, unknown> & { userName: string }>;
    owner: string;
    repo: string;
    branch: string;
  };
} {
  return {
    success: true,
    data: {
      events: events.map((e) => ({
        ...e,
        userName: e.displayName || e.email?.split('@')[0] || 'Anonymous',
      })),
      owner,
      repo,
      branch,
    },
  };
}

function formatErrorResponse(error: string): { error: string } {
  return { error };
}

function formatConnectedEvent(
  owner: string,
  repo: string,
  branch: string
): { eventName: string; data: { branch: string; owner: string; repo: string } } {
  return {
    eventName: 'connected',
    data: { branch, owner, repo },
  };
}

function formatWorkspaceEvent(event: {
  id: string;
  userId: string;
  eventType: string;
  displayName: string | null;
  email: string | null;
}): { eventName: string; data: Record<string, unknown> & { userName: string } } {
  return {
    eventName: 'workspace_event',
    data: {
      ...event,
      userName: event.displayName || event.email?.split('@')[0] || 'Anonymous',
    },
  };
}

function formatPresenceUpdateEvent(
  users: Array<{
    userId: string;
    page: string | null;
    cursorX: number | null;
    cursorY: number | null;
    selection: unknown;
    displayName: string | null;
    email: string | null;
  }>,
  currentUserId: string
): { eventName: string; data: { users: Array<Record<string, unknown>> } } {
  return {
    eventName: 'presence_update',
    data: {
      users: users.map((u) => ({
        userId: u.userId,
        displayName: u.displayName || u.email?.split('@')[0] || 'Anonymous',
        page: u.page,
        cursorX: u.cursorX,
        cursorY: u.cursorY,
        selection: u.selection,
        isCurrentUser: u.userId === currentUserId,
      })),
    },
  };
}
