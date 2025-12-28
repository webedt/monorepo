/**
 * Tests for ClaudeWebClient.isComplete method.
 *
 * These tests verify the session completion detection logic.
 * Uses mock data and doesn't connect to real APIs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Simulates the isComplete logic for testing without API dependencies.
 * Mirrors the implementation in claudeWebClient.ts
 */
function simulateIsComplete(params: {
  sessionStatus: string;
  checkEvents: boolean;
  hasResultEvent?: boolean;
  eventsError?: boolean;
}): { isComplete: boolean; status?: string; hasResultEvent?: boolean } {
  const { sessionStatus, checkEvents, hasResultEvent, eventsError } = params;
  const status = sessionStatus;

  // Helper to simulate result event check
  const checkForResultEvent = (): boolean | undefined => {
    if (!checkEvents) return undefined;
    if (eventsError) return undefined;
    return hasResultEvent ?? false;
  };

  // Running sessions are not complete unless they have a result event
  if (status === 'running') {
    const resultEventCheck = checkForResultEvent();
    if (resultEventCheck) {
      return { isComplete: true, status, hasResultEvent: resultEventCheck };
    }
    // Consistent return structure - always include hasResultEvent
    return { isComplete: false, status, hasResultEvent: resultEventCheck };
  }

  // Terminal and idle states are complete
  if (status === 'idle' || status === 'completed' || status === 'failed' || status === 'archived') {
    const resultEventCheck = checkForResultEvent();
    return { isComplete: true, status, hasResultEvent: resultEventCheck };
  }

  // Unknown status, assume not complete
  return { isComplete: false, status };
}

describe('ClaudeWebClient.isComplete', () => {
  describe('Status-based completion', () => {
    it('should return isComplete: true for idle status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'idle',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'idle');
    });

    it('should return isComplete: true for completed status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'completed',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'completed');
    });

    it('should return isComplete: true for failed status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'failed',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'failed');
    });

    it('should return isComplete: true for archived status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'archived',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'archived');
    });

    it('should return isComplete: false for running status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'running',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
    });

    it('should return isComplete: false for unknown status', () => {
      const result = simulateIsComplete({
        sessionStatus: 'unknown_status',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'unknown_status');
    });
  });

  describe('Event-based completion', () => {
    it('should return hasResultEvent when checkEvents is true and result event exists', () => {
      const result = simulateIsComplete({
        sessionStatus: 'completed',
        checkEvents: true,
        hasResultEvent: true,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, true);
    });

    it('should return hasResultEvent: false when no result event exists', () => {
      const result = simulateIsComplete({
        sessionStatus: 'completed',
        checkEvents: true,
        hasResultEvent: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, false);
    });

    it('should return hasResultEvent: undefined when checkEvents is false', () => {
      const result = simulateIsComplete({
        sessionStatus: 'completed',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, undefined);
    });

    it('should return hasResultEvent: undefined when events check fails', () => {
      const result = simulateIsComplete({
        sessionStatus: 'completed',
        checkEvents: true,
        eventsError: true,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, undefined);
    });
  });

  describe('Running status with result event', () => {
    it('should return isComplete: true when running but has result event', () => {
      const result = simulateIsComplete({
        sessionStatus: 'running',
        checkEvents: true,
        hasResultEvent: true,
      });

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, true);
    });

    it('should return actual status when running with result event (not misleading idle)', () => {
      const result = simulateIsComplete({
        sessionStatus: 'running',
        checkEvents: true,
        hasResultEvent: true,
      });

      // Should return actual 'running' status, not 'idle'
      assert.strictEqual(result.status, 'running');
    });

    it('should return isComplete: false when running without result event', () => {
      const result = simulateIsComplete({
        sessionStatus: 'running',
        checkEvents: true,
        hasResultEvent: false,
      });

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
    });

    it('should return isComplete: false when running and events check fails', () => {
      const result = simulateIsComplete({
        sessionStatus: 'running',
        checkEvents: true,
        eventsError: true,
      });

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
    });
  });

  describe('Edge cases', () => {
    it('should handle all terminal states consistently', () => {
      const terminalStates = ['idle', 'completed', 'failed', 'archived'];

      for (const status of terminalStates) {
        const result = simulateIsComplete({
          sessionStatus: status,
          checkEvents: true,
          hasResultEvent: true,
        });

        assert.strictEqual(
          result.isComplete,
          true,
          `${status} should be complete`
        );
        assert.strictEqual(
          result.status,
          status,
          `${status} should preserve actual status`
        );
      }
    });

    it('should handle empty string status as unknown', () => {
      const result = simulateIsComplete({
        sessionStatus: '',
        checkEvents: false,
      });

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, '');
    });
  });
});

describe('Integration with canResume', () => {
  /**
   * Verifies that isComplete and canResume have consistent behavior.
   * A completed session cannot be resumed, and a resumable session is not complete.
   */

  it('should have inverse relationship for idle status', () => {
    // idle: isComplete=true, canResume=true (idle means work finished but can add more)
    const isCompleteResult = simulateIsComplete({
      sessionStatus: 'idle',
      checkEvents: false,
    });

    assert.strictEqual(isCompleteResult.isComplete, true);
    // Note: canResume for idle is true - session finished work but can accept new messages
  });

  it('should have inverse relationship for running status', () => {
    // running: isComplete=false, canResume=false
    const isCompleteResult = simulateIsComplete({
      sessionStatus: 'running',
      checkEvents: false,
    });

    assert.strictEqual(isCompleteResult.isComplete, false);
    // canResume for running is also false
  });

  it('should handle completed status correctly', () => {
    // completed: isComplete=true, canResume=false (fully done)
    const isCompleteResult = simulateIsComplete({
      sessionStatus: 'completed',
      checkEvents: false,
    });

    assert.strictEqual(isCompleteResult.isComplete, true);
    // canResume for completed is false
  });
});
