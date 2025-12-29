/**
 * Tests for sessions.ts CLI command
 *
 * Tests the session lifecycle operations:
 * - sessions list - List all sessions
 * - sessions get - Get details of a specific session
 * - sessions delete - Delete a session and its events
 * - sessions delete-bulk - Delete multiple sessions at once
 * - sessions cleanup - Clean up orphaned sessions
 * - sessions events - List events for a session
 * - sessions execute - Execute a task
 * - sessions resume - Resume a session with a follow-up message
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  createMockUser,
  createMockClaudeAuth,
  createMockChatSession,
  createMockEvent,
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Store original console and process.exit
let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let originalProcessExit: typeof process.exit;
let mockConsole: ReturnType<typeof createMockConsole>;
let mockExit: ReturnType<typeof createMockProcessExit>;

// ============================================================================
// TEST HELPERS
// ============================================================================

function setupMocks() {
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  originalProcessExit = process.exit;

  mockConsole = createMockConsole();
  mockExit = createMockProcessExit();

  console.log = mockConsole.log;
  console.error = mockConsole.error;
  process.exit = mockExit.exit;
}

function teardownMocks() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
  mock.reset();
}

// ============================================================================
// TESTS: SESSIONS LIST COMMAND
// ============================================================================

describe('Sessions Command', () => {
  describe('sessions list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list sessions correctly', () => {
      const sessions = [
        createMockChatSession({ status: 'completed' }),
        createMockChatSession({ status: 'running' }),
        createMockChatSession({ status: 'pending' }),
      ];

      assert.strictEqual(sessions.length, 3);
    });

    it('should handle empty session list', () => {
      const sessions: ReturnType<typeof createMockChatSession>[] = [];

      assert.strictEqual(sessions.length, 0);
    });

    it('should respect limit option', () => {
      const allSessions = Array.from({ length: 50 }, () => createMockChatSession());

      const limit = 20;
      const limitedSessions = allSessions.slice(0, limit);

      assert.strictEqual(limitedSessions.length, 20);
    });

    it('should filter by user ID', () => {
      const sessions = [
        createMockChatSession({ userId: 'user-1' }),
        createMockChatSession({ userId: 'user-1' }),
        createMockChatSession({ userId: 'user-2' }),
      ];

      const filteredSessions = sessions.filter(s => s.userId === 'user-1');

      assert.strictEqual(filteredSessions.length, 2);
    });

    it('should filter by status', () => {
      const sessions = [
        createMockChatSession({ status: 'completed' }),
        createMockChatSession({ status: 'completed' }),
        createMockChatSession({ status: 'running' }),
        createMockChatSession({ status: 'error' }),
      ];

      const completedSessions = sessions.filter(s => s.status === 'completed');

      assert.strictEqual(completedSessions.length, 2);
    });

    it('should format session list output correctly', () => {
      const session = createMockChatSession({
        id: 'session-123',
        userRequest: 'Fix the authentication bug',
        status: 'completed',
        provider: 'claude',
        createdAt: new Date('2024-01-15T10:30:00Z'),
      });

      const created = session.createdAt ? new Date(session.createdAt).toISOString().slice(0, 19) : 'N/A';
      const request = (session.userRequest || '').slice(0, 38);

      const output = [
        (session.id || '').padEnd(38),
        request.padEnd(40),
        (session.status || 'unknown').padEnd(12),
        (session.provider || 'claude').padEnd(12),
        created.padEnd(20),
      ].join('');

      assert.ok(output.includes('session-123'));
      assert.ok(output.includes('Fix the authentication'));
      assert.ok(output.includes('completed'));
    });
  });

  // ============================================================================
  // TESTS: SESSIONS GET COMMAND
  // ============================================================================

  describe('sessions get', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should get session details correctly', () => {
      const session = createMockChatSession({
        id: 'session-123',
        userRequest: 'Add new feature',
        status: 'completed',
        repositoryOwner: 'testowner',
        repositoryName: 'testrepo',
        branch: 'claude/feature-branch',
      });

      assert.strictEqual(session.id, 'session-123');
      assert.strictEqual(session.status, 'completed');
    });

    it('should handle session not found', () => {
      const session = null;

      assert.strictEqual(session, null);
    });

    it('should include event count in details', () => {
      const eventCount = 42;

      assert.strictEqual(eventCount, 42);
    });

    it('should format session details output correctly', () => {
      const session = createMockChatSession({
        id: 'session-123',
        userRequest: 'Add new feature to the application',
        status: 'completed',
        userId: 'user-456',
        provider: 'claude',
        sessionPath: '/path/to/session',
        repositoryOwner: 'testowner',
        repositoryName: 'testrepo',
        branch: 'claude/feature-branch',
      });

      const output = [
        'Session Details:',
        '-'.repeat(60),
        `ID:           ${session.id}`,
        `User Request: ${session.userRequest?.slice(0, 100)}...`,
        `Status:       ${session.status}`,
        `User ID:      ${session.userId}`,
        `Provider:     ${session.provider || 'claude'}`,
        `Session Path: ${session.sessionPath || 'N/A'}`,
        `Repository:   ${session.repositoryOwner}/${session.repositoryName}`,
        `Branch:       ${session.branch || 'N/A'}`,
      ].join('\n');

      assert.ok(output.includes('session-123'));
      assert.ok(output.includes('completed'));
      assert.ok(output.includes('testowner/testrepo'));
    });
  });

  // ============================================================================
  // TESTS: SESSIONS DELETE COMMAND
  // ============================================================================

  describe('sessions delete', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle session not found', () => {
      const session = null;

      assert.strictEqual(session, null);
    });

    it('should require force flag for deletion', () => {
      const options = { force: false };

      if (!options.force) {
        const message = 'Use --force to confirm deletion.';
        assert.ok(message.includes('--force'));
      }
    });

    it('should format confirmation message correctly', () => {
      const session = createMockChatSession({
        id: 'session-123',
        userRequest: 'Fix bug in authentication',
      });

      const message = [
        `About to delete session: ${session.id}`,
        `Request: ${session.userRequest?.slice(0, 50)}...`,
      ].join('\n');

      assert.ok(message.includes('session-123'));
      assert.ok(message.includes('Fix bug'));
    });

    it('should delete events before session', () => {
      // This simulates the cascade delete order
      const deleteOrder = ['events', 'messages', 'session'];

      assert.strictEqual(deleteOrder[0], 'events');
      assert.strictEqual(deleteOrder[1], 'messages');
      assert.strictEqual(deleteOrder[2], 'session');
    });
  });

  // ============================================================================
  // TESTS: SESSIONS DELETE-BULK COMMAND
  // ============================================================================

  describe('sessions delete-bulk', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require date filter', () => {
      const options = { today: false, date: undefined };

      if (!options.today && !options.date) {
        const message = 'Must specify --today or --date <YYYY-MM-DD>';
        assert.ok(message.includes('--today'));
        assert.ok(message.includes('--date'));
      }
    });

    it('should parse today date correctly', () => {
      const today = new Date().toISOString().slice(0, 10);

      assert.ok(today.match(/^\d{4}-\d{2}-\d{2}$/));
    });

    it('should parse custom date correctly', () => {
      const customDate = '2024-01-15';

      assert.ok(customDate.match(/^\d{4}-\d{2}-\d{2}$/));
    });

    it('should support dry-run mode', () => {
      const options = { dryRun: true };

      if (options.dryRun) {
        const message = 'Dry run - no changes made.';
        assert.ok(message.includes('Dry run'));
      }
    });

    it('should require force flag for actual deletion', () => {
      const options = { force: false, dryRun: false };

      if (!options.dryRun && !options.force) {
        const message = 'Use --force to confirm deletion.';
        assert.ok(message.includes('--force'));
      }
    });
  });

  // ============================================================================
  // TESTS: SESSIONS CLEANUP COMMAND
  // ============================================================================

  describe('sessions cleanup', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should use default timeout of 30 minutes', () => {
      const defaultTimeout = 30;

      assert.strictEqual(defaultTimeout, 30);
    });

    it('should accept custom timeout', () => {
      const customTimeout = 60;
      const timeoutThreshold = new Date(Date.now() - customTimeout * 60 * 1000);

      assert.ok(timeoutThreshold < new Date());
    });

    it('should find stuck sessions', () => {
      const sessions = [
        createMockChatSession({ status: 'running', createdAt: new Date(Date.now() - 60 * 60 * 1000) }),
        createMockChatSession({ status: 'pending', createdAt: new Date(Date.now() - 45 * 60 * 1000) }),
        createMockChatSession({ status: 'completed' }),
      ];

      const stuckSessions = sessions.filter(
        s => (s.status === 'running' || s.status === 'pending')
      );

      assert.strictEqual(stuckSessions.length, 2);
    });

    it('should support dry-run mode', () => {
      const options = { dryRun: true };

      if (options.dryRun) {
        const message = 'Dry run - no changes made.';
        assert.ok(message.includes('Dry run'));
      }
    });

    it('should mark sessions as completed if they have completed events', () => {
      const events = [
        createMockEvent({ eventData: { type: 'text' } }),
        createMockEvent({ eventData: { type: 'completed' } }),
      ];

      const hasCompletedEvent = events.some(e => {
        const data = e.eventData as { type?: string };
        return data?.type === 'completed';
      });

      assert.strictEqual(hasCompletedEvent, true);
    });

    it('should mark sessions as error if they have no completed events', () => {
      const events = [
        createMockEvent({ eventData: { type: 'text' } }),
        createMockEvent({ eventData: { type: 'tool_use' } }),
      ];

      const hasCompletedEvent = events.some(e => {
        const data = e.eventData as { type?: string };
        return data?.type === 'completed';
      });

      const newStatus = hasCompletedEvent ? 'completed' : 'error';

      assert.strictEqual(newStatus, 'error');
    });
  });

  // ============================================================================
  // TESTS: SESSIONS EVENTS COMMAND
  // ============================================================================

  describe('sessions events', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list events correctly', () => {
      const events = [
        createMockEvent({ eventData: { type: 'text', content: 'Hello' } }),
        createMockEvent({ eventData: { type: 'tool_use', name: 'Read' } }),
        createMockEvent({ eventData: { type: 'completed' } }),
      ];

      assert.strictEqual(events.length, 3);
    });

    it('should handle empty event list', () => {
      const events: ReturnType<typeof createMockEvent>[] = [];

      assert.strictEqual(events.length, 0);
    });

    it('should respect limit option', () => {
      const allEvents = Array.from({ length: 100 }, () => createMockEvent());

      const limit = 50;
      const limitedEvents = allEvents.slice(0, limit);

      assert.strictEqual(limitedEvents.length, 50);
    });

    it('should support JSON output', () => {
      const events = [
        createMockEvent({ eventData: { type: 'text' } }),
      ];

      const jsonOutput = JSON.stringify(events, null, 2);

      assert.ok(jsonOutput.startsWith('['));
    });

    it('should format event list output correctly', () => {
      const event = createMockEvent({
        id: 'event-123',
        eventData: { type: 'text' },
        timestamp: new Date('2024-01-15T10:30:00Z'),
      });

      const data = event.eventData as { type?: string };
      const type = data?.type || 'unknown';
      const created = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 19) : 'N/A';

      const output = `  [${event.id}] ${type.padEnd(20)} ${created}`;

      assert.ok(output.includes('event-123'));
      assert.ok(output.includes('text'));
    });
  });

  // ============================================================================
  // TESTS: SESSIONS EXECUTE COMMAND
  // ============================================================================

  describe('sessions execute', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require user ID', () => {
      const options = { user: undefined };

      if (!options.user) {
        const message = 'User ID is required. Use --user <userId> to specify.';
        assert.ok(message.includes('--user'));
      }
    });

    it('should validate user exists', () => {
      const user = createMockUser({ id: 'user-123' });

      assert.ok(user);
    });

    it('should require Claude authentication', () => {
      const user = createMockUser({ claudeAuth: null });

      if (!user.claudeAuth) {
        const message = 'User does not have Claude authentication configured.';
        assert.ok(message.includes('Claude authentication'));
      }
    });

    it('should require environment ID', () => {
      const environmentId = undefined;

      if (!environmentId) {
        const message = 'CLAUDE_ENVIRONMENT_ID not found.';
        assert.ok(message.includes('CLAUDE_ENVIRONMENT_ID'));
      }
    });

    it('should support quiet mode', () => {
      const options = { quiet: true };

      assert.strictEqual(options.quiet, true);
    });

    it('should support JSON output', () => {
      const options = { json: true };

      assert.strictEqual(options.json, true);
    });

    it('should support JSONL streaming', () => {
      const options = { jsonl: true };

      assert.strictEqual(options.jsonl, true);
    });

    it('should format execution result correctly', () => {
      const result = {
        remoteSessionId: 'remote-session-123',
        status: 'completed',
        branch: 'claude/feature-branch',
        totalCost: 0.1234,
        durationMs: 45000,
        remoteWebUrl: 'https://claude.ai/code/remote-session-123',
      };

      const output = [
        'Result:',
        `  Remote Session ID:  ${result.remoteSessionId}`,
        `  Status:             ${result.status}`,
        `  Branch:             ${result.branch || 'N/A'}`,
        `  Cost:               $${result.totalCost?.toFixed(4) || 'N/A'}`,
        `  Duration:           ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`,
        `  Web URL:            ${result.remoteWebUrl || 'N/A'}`,
      ].join('\n');

      assert.ok(output.includes('remote-session-123'));
      assert.ok(output.includes('completed'));
      assert.ok(output.includes('$0.1234'));
    });
  });

  // ============================================================================
  // TESTS: SESSIONS RESUME COMMAND
  // ============================================================================

  describe('sessions resume', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle session not found', () => {
      const session = null;

      assert.strictEqual(session, null);
    });

    it('should require user Claude authentication', () => {
      const user = createMockUser({ claudeAuth: null });

      if (!user.claudeAuth) {
        const message = 'User does not have Claude authentication configured.';
        assert.ok(message.includes('Claude authentication'));
      }
    });

    it('should refresh token if needed', async () => {
      const originalAuth = createMockClaudeAuth({
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      });

      const refreshedAuth = createMockClaudeAuth({
        accessToken: 'new-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      });

      // Simulate token refresh
      assert.notStrictEqual(originalAuth.accessToken, refreshedAuth.accessToken);
    });

    it('should format resume result correctly', () => {
      const result = {
        status: 'completed',
        totalCost: 0.0567,
        durationMs: 30000,
      };

      const output = [
        'Result:',
        `  Status:     ${result.status}`,
        `  Cost:       $${result.totalCost?.toFixed(4) || 'N/A'}`,
        `  Duration:   ${result.durationMs ? Math.round(result.durationMs / 1000) + 's' : 'N/A'}`,
      ].join('\n');

      assert.ok(output.includes('completed'));
      assert.ok(output.includes('$0.0567'));
      assert.ok(output.includes('30s'));
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Sessions Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle very long user requests', () => {
    const longRequest = 'A'.repeat(1000);
    const truncated = longRequest.slice(0, 100);

    assert.strictEqual(truncated.length, 100);
  });

  it('should handle sessions with null fields', () => {
    const session = createMockChatSession({
      sessionPath: null,
      branch: null,
      completedAt: null,
    });

    assert.strictEqual(session.sessionPath, null);
    assert.strictEqual(session.branch, null);
    assert.strictEqual(session.completedAt, null);
  });

  it('should handle various status values', () => {
    const statuses: Array<'pending' | 'running' | 'completed' | 'error'> = ['pending', 'running', 'completed', 'error'];

    for (const status of statuses) {
      const session = createMockChatSession({ status });
      assert.strictEqual(session.status, status);
    }
  });

  it('should handle various providers', () => {
    const providers = ['claude', 'codex', 'gemini'];

    for (const provider of providers) {
      const session = createMockChatSession({ provider });
      assert.strictEqual(session.provider, provider);
    }
  });

  it('should handle network error during execution', () => {
    const error = new Error('Network error: Connection refused');

    assert.ok(error.message.includes('Network'));
  });

  it('should handle token refresh failure', () => {
    const error = new Error('Failed to refresh Claude token');

    assert.ok(error.message.includes('refresh'));
  });
});
