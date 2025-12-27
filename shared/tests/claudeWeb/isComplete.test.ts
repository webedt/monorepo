/**
 * Unit Tests for ClaudeWebClient.isComplete method
 *
 * Tests the isComplete method which checks if a Claude session has finished execution.
 * Uses mocked getSession and getEvents calls to test all scenarios.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ClaudeWebClient } from '../../src/claudeWeb/claudeWebClient.js';
import type { Session, SessionEvent, EventsResponse } from '../../src/claudeWeb/types.js';

/**
 * Create a mock session with the given status
 */
function createMockSession(status: string): Session {
  return {
    id: 'session_test123',
    title: 'Test Session',
    session_status: status as Session['session_status'],
    environment_id: 'env_test',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Create a mock events response
 */
function createMockEventsResponse(events: Partial<SessionEvent>[]): EventsResponse {
  return {
    data: events.map((e, i) => ({
      uuid: `event_${i}`,
      type: e.type || 'unknown',
      ...e,
    })),
    has_more: false,
  };
}

/**
 * Create a testable client with mocked methods
 */
function createMockClient(
  sessionStatus: string,
  events: Partial<SessionEvent>[] = [],
  options: { throwOnGetEvents?: boolean } = {}
): ClaudeWebClient {
  const client = new ClaudeWebClient({
    accessToken: 'test_token',
    environmentId: 'env_test',
  });

  // Mock getSession
  (client as unknown as { getSession: () => Promise<Session> }).getSession = async () => {
    return createMockSession(sessionStatus);
  };

  // Mock getEvents
  (client as unknown as { getEvents: () => Promise<EventsResponse> }).getEvents = async () => {
    if (options.throwOnGetEvents) {
      throw new Error('Network error');
    }
    return createMockEventsResponse(events);
  };

  return client;
}

describe('ClaudeWebClient.isComplete', () => {
  describe('Terminal States', () => {
    it('should return isComplete=true for completed sessions', async () => {
      const client = createMockClient('completed');

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.reason, 'Session completed successfully');
    });

    it('should return isComplete=true for failed sessions', async () => {
      const client = createMockClient('failed');

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.reason, 'Session failed');
    });

    it('should return isComplete=true for archived sessions', async () => {
      const client = createMockClient('archived');

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'archived');
      assert.strictEqual(result.reason, 'Session is archived');
    });
  });

  describe('Running/Idle Sessions with Event Check', () => {
    it('should return isComplete=true when result event exists', async () => {
      const client = createMockClient('running', [
        { type: 'user' },
        { type: 'assistant' },
        { type: 'result' },
      ]);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'running');
      assert.strictEqual(result.hasResultEvent, true);
      assert.ok(result.reason?.includes('result event'));
    });

    it('should return isComplete=false when no result event exists', async () => {
      const client = createMockClient('running', [
        { type: 'user' },
        { type: 'assistant' },
        { type: 'tool_use' },
      ]);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
      assert.strictEqual(result.hasResultEvent, false);
    });

    it('should handle result event type case-insensitively', async () => {
      const client = createMockClient('idle', [
        { type: 'RESULT' },
      ]);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, true);
    });

    it('should return isComplete=false for idle sessions without result event', async () => {
      const client = createMockClient('idle', [
        { type: 'user' },
      ]);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'idle');
    });
  });

  describe('Event Fetch Failures', () => {
    it('should fall back to status-based check when event fetch fails', async () => {
      const client = createMockClient('running', [], { throwOnGetEvents: true });

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
      assert.strictEqual(result.hasResultEvent, undefined);
    });
  });

  describe('Skip Event Check Option', () => {
    it('should skip event check when checkEvents=false', async () => {
      const client = createMockClient('running', [
        { type: 'result' }, // This would make it complete if events were checked
      ]);

      const result = await client.isComplete('session_test123', false);

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
      assert.strictEqual(result.hasResultEvent, undefined);
    });

    it('should still return isComplete=true for terminal states when checkEvents=false', async () => {
      const client = createMockClient('completed');

      const result = await client.isComplete('session_test123', false);

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty events array', async () => {
      const client = createMockClient('running', []);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.hasResultEvent, false);
    });

    it('should handle events with undefined type', async () => {
      const client = createMockClient('running', [
        { uuid: 'event_1' }, // type is undefined
      ]);

      const result = await client.isComplete('session_test123');

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.hasResultEvent, false);
    });
  });
});
