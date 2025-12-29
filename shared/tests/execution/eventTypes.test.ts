/**
 * Tests for ExecutionEventType helpers.
 * Covers type guards and exhaustive checking utilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isEventType, assertNeverEventType } from '../../src/execution/providers/types.js';
import type { ExecutionEvent, ExecutionEventType } from '../../src/execution/providers/types.js';

/**
 * Helper to create a mock ExecutionEvent
 */
function createMockEvent(type: ExecutionEventType, overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('ExecutionEventType Helpers', () => {
  describe('isEventType', () => {
    it('should return true when event type matches', () => {
      const event = createMockEvent('title_generation', {
        method: 'dust',
        status: 'success',
        title: 'Test Title',
      });

      assert.strictEqual(isEventType(event, 'title_generation'), true);
    });

    it('should return false when event type does not match', () => {
      const event = createMockEvent('error', {
        error: 'Something went wrong',
      });

      assert.strictEqual(isEventType(event, 'title_generation'), false);
      assert.strictEqual(isEventType(event, 'completed'), false);
      assert.strictEqual(isEventType(event, 'connected'), false);
    });

    it('should correctly narrow type for connected event', () => {
      const event = createMockEvent('connected', {
        sessionId: 'session-123',
        provider: 'claude',
      });

      if (isEventType(event, 'connected')) {
        // Type should be narrowed - these accesses should work
        assert.strictEqual(event.type, 'connected');
        assert.strictEqual(event.sessionId, 'session-123');
        assert.strictEqual(event.provider, 'claude');
      } else {
        assert.fail('isEventType should return true for connected event');
      }
    });

    it('should correctly narrow type for session_created event', () => {
      const event = createMockEvent('session_created', {
        remoteSessionId: 'remote-123',
        remoteWebUrl: 'https://example.com/session',
      });

      if (isEventType(event, 'session_created')) {
        assert.strictEqual(event.type, 'session_created');
        assert.strictEqual(event.remoteSessionId, 'remote-123');
        assert.strictEqual(event.remoteWebUrl, 'https://example.com/session');
      } else {
        assert.fail('isEventType should return true for session_created event');
      }
    });

    it('should correctly narrow type for error event', () => {
      const event = createMockEvent('error', {
        error: 'Test error message',
        code: 'ERR_TEST',
      });

      if (isEventType(event, 'error')) {
        assert.strictEqual(event.type, 'error');
        assert.strictEqual(event.error, 'Test error message');
        assert.strictEqual(event.code, 'ERR_TEST');
      } else {
        assert.fail('isEventType should return true for error event');
      }
    });

    it('should work with all defined event types', () => {
      const eventTypes: ExecutionEventType[] = [
        'connected', 'message', 'assistant_message', 'session_name', 'session_created',
        'title_generation', 'completed', 'error', 'input_preview', 'interrupted',
        'user', 'assistant', 'tool_use', 'tool_result', 'result', 'env_manager_log',
        'system', 'text', 'message_start', 'message_delta', 'message_complete',
      ];

      for (const type of eventTypes) {
        const event = createMockEvent(type);
        assert.strictEqual(isEventType(event, type), true, `isEventType should return true for ${type}`);
      }
    });
  });

  describe('assertNeverEventType', () => {
    it('should throw an error with the unhandled event type', () => {
      // We need to trick TypeScript to pass a value to assertNeverEventType
      // In real usage, this would be caught at compile time
      const unknownType = 'unknown_type' as never;

      assert.throws(
        () => assertNeverEventType(unknownType),
        {
          message: 'Unhandled event type: unknown_type',
        }
      );
    });

    it('should include event type in error message', () => {
      const testType = 'test_event' as never;

      try {
        assertNeverEventType(testType);
        assert.fail('assertNeverEventType should throw');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('test_event'));
      }
    });
  });

  describe('Type Safety', () => {
    it('should allow checking for any valid event type', () => {
      const event = createMockEvent('result', {
        total_cost_usd: 0.05,
        duration_ms: 1000,
      });

      // These should all compile and run without error
      assert.strictEqual(isEventType(event, 'result'), true);
      assert.strictEqual(isEventType(event, 'error'), false);
      assert.strictEqual(isEventType(event, 'completed'), false);
    });

    it('should preserve additional event properties after type narrowing', () => {
      const event = createMockEvent('title_generation', {
        method: 'openrouter',
        status: 'success',
        title: 'Generated Title',
        branch_name: 'claude/generated-title',
        // Additional properties
        uuid: 'test-uuid-123',
        source: 'claude',
      });

      if (isEventType(event, 'title_generation')) {
        assert.strictEqual(event.method, 'openrouter');
        assert.strictEqual(event.status, 'success');
        assert.strictEqual(event.title, 'Generated Title');
        assert.strictEqual(event.branch_name, 'claude/generated-title');
        assert.strictEqual(event.uuid, 'test-uuid-123');
        assert.strictEqual(event.source, 'claude');
      }
    });
  });
});
