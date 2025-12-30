/**
 * Tests for the Session Locking module.
 *
 * These tests verify the optimistic and pessimistic locking behavior
 * for session status transitions, preventing race conditions in
 * concurrent session updates.
 *
 * The tests cover:
 * - Status transition validation: Valid/invalid state machine transitions
 * - Version conflict detection: Optimistic locking error handling
 * - Error type guards: Helper functions for error identification
 * - Error class behavior: Correct error codes and messages
 *
 * Note: Integration tests with actual database transactions are in
 * the integration test suite. These unit tests verify the pure logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isValidStatusTransition,
  isVersionConflict,
  isSessionNotFound,
  isInvalidStatusTransition,
  isSessionLocked,
  VersionConflictError,
  SessionNotFoundError,
  InvalidStatusTransitionError,
  SessionLockedError,
} from '../../src/sessions/sessionLocking.js';

import type { SessionStatus } from '../../src/sessions/sessionLocking.js';

describe('Session Locking', () => {
  describe('isValidStatusTransition', () => {
    describe('From pending status', () => {
      it('should allow transition to running', () => {
        assert.strictEqual(isValidStatusTransition('pending', 'running'), true);
      });

      it('should allow transition to error', () => {
        assert.strictEqual(isValidStatusTransition('pending', 'error'), true);
      });

      it('should NOT allow transition to completed', () => {
        assert.strictEqual(isValidStatusTransition('pending', 'completed'), false);
      });

      it('should NOT allow transition to pending (same state)', () => {
        assert.strictEqual(isValidStatusTransition('pending', 'pending'), false);
      });
    });

    describe('From running status', () => {
      it('should allow transition to completed', () => {
        assert.strictEqual(isValidStatusTransition('running', 'completed'), true);
      });

      it('should allow transition to error', () => {
        assert.strictEqual(isValidStatusTransition('running', 'error'), true);
      });

      it('should NOT allow transition to pending', () => {
        assert.strictEqual(isValidStatusTransition('running', 'pending'), false);
      });

      it('should NOT allow transition to running (same state)', () => {
        assert.strictEqual(isValidStatusTransition('running', 'running'), false);
      });
    });

    describe('From completed status', () => {
      it('should allow transition to running (resume)', () => {
        assert.strictEqual(isValidStatusTransition('completed', 'running'), true);
      });

      it('should NOT allow transition to pending', () => {
        assert.strictEqual(isValidStatusTransition('completed', 'pending'), false);
      });

      it('should NOT allow transition to error', () => {
        assert.strictEqual(isValidStatusTransition('completed', 'error'), false);
      });

      it('should NOT allow transition to completed (same state)', () => {
        assert.strictEqual(isValidStatusTransition('completed', 'completed'), false);
      });
    });

    describe('From error status', () => {
      it('should allow transition to running (retry)', () => {
        assert.strictEqual(isValidStatusTransition('error', 'running'), true);
      });

      it('should NOT allow transition to pending', () => {
        assert.strictEqual(isValidStatusTransition('error', 'pending'), false);
      });

      it('should NOT allow transition to completed', () => {
        assert.strictEqual(isValidStatusTransition('error', 'completed'), false);
      });

      it('should NOT allow transition to error (same state)', () => {
        assert.strictEqual(isValidStatusTransition('error', 'error'), false);
      });
    });

    describe('Edge cases', () => {
      it('should handle unknown current status gracefully', () => {
        // TypeScript wouldn't allow this, but at runtime it could happen
        const result = isValidStatusTransition('unknown' as SessionStatus, 'running');
        assert.strictEqual(result, false);
      });
    });
  });

  describe('VersionConflictError', () => {
    it('should create error with correct properties', () => {
      const error = new VersionConflictError('session-123', 5);

      assert.strictEqual(error.name, 'VersionConflictError');
      assert.strictEqual(error.sessionId, 'session-123');
      assert.strictEqual(error.expectedVersion, 5);
      assert.strictEqual(error.code, 'VERSION_CONFLICT');
      assert.ok(error.message.includes('session-123'));
      assert.ok(error.message.includes('5'));
    });

    it('should be instanceof Error', () => {
      const error = new VersionConflictError('session-123', 5);
      assert.ok(error instanceof Error);
    });
  });

  describe('SessionNotFoundError', () => {
    it('should create error with correct properties', () => {
      const error = new SessionNotFoundError('session-456');

      assert.strictEqual(error.name, 'SessionNotFoundError');
      assert.strictEqual(error.sessionId, 'session-456');
      assert.strictEqual(error.code, 'SESSION_NOT_FOUND');
      assert.ok(error.message.includes('session-456'));
    });

    it('should be instanceof Error', () => {
      const error = new SessionNotFoundError('session-456');
      assert.ok(error instanceof Error);
    });
  });

  describe('InvalidStatusTransitionError', () => {
    it('should create error with correct properties', () => {
      const error = new InvalidStatusTransitionError('session-789', 'completed', 'pending');

      assert.strictEqual(error.name, 'InvalidStatusTransitionError');
      assert.strictEqual(error.sessionId, 'session-789');
      assert.strictEqual(error.currentStatus, 'completed');
      assert.strictEqual(error.targetStatus, 'pending');
      assert.strictEqual(error.code, 'INVALID_STATUS_TRANSITION');
      assert.ok(error.message.includes('session-789'));
      assert.ok(error.message.includes('completed'));
      assert.ok(error.message.includes('pending'));
    });

    it('should be instanceof Error', () => {
      const error = new InvalidStatusTransitionError('session-789', 'completed', 'pending');
      assert.ok(error instanceof Error);
    });
  });

  describe('SessionLockedError', () => {
    it('should create error with correct properties', () => {
      const error = new SessionLockedError('session-locked');

      assert.strictEqual(error.name, 'SessionLockedError');
      assert.strictEqual(error.sessionId, 'session-locked');
      assert.strictEqual(error.code, 'SESSION_LOCKED');
      assert.ok(error.message.includes('session-locked'));
      assert.ok(error.message.includes('locked'));
    });

    it('should be instanceof Error', () => {
      const error = new SessionLockedError('session-locked');
      assert.ok(error instanceof Error);
    });
  });

  describe('Error type guards', () => {
    describe('isVersionConflict', () => {
      it('should return true for VersionConflictError', () => {
        const error = new VersionConflictError('session-123', 5);
        assert.strictEqual(isVersionConflict(error), true);
      });

      it('should return false for other Error types', () => {
        assert.strictEqual(isVersionConflict(new Error('generic')), false);
        assert.strictEqual(isVersionConflict(new SessionNotFoundError('s')), false);
        assert.strictEqual(isVersionConflict(new InvalidStatusTransitionError('s', 'a', 'b')), false);
        assert.strictEqual(isVersionConflict(new SessionLockedError('s')), false);
      });

      it('should return false for non-Error values', () => {
        assert.strictEqual(isVersionConflict(null), false);
        assert.strictEqual(isVersionConflict(undefined), false);
        assert.strictEqual(isVersionConflict('string'), false);
        assert.strictEqual(isVersionConflict(123), false);
        assert.strictEqual(isVersionConflict({}), false);
      });
    });

    describe('isSessionNotFound', () => {
      it('should return true for SessionNotFoundError', () => {
        const error = new SessionNotFoundError('session-123');
        assert.strictEqual(isSessionNotFound(error), true);
      });

      it('should return false for other Error types', () => {
        assert.strictEqual(isSessionNotFound(new Error('generic')), false);
        assert.strictEqual(isSessionNotFound(new VersionConflictError('s', 1)), false);
        assert.strictEqual(isSessionNotFound(new InvalidStatusTransitionError('s', 'a', 'b')), false);
        assert.strictEqual(isSessionNotFound(new SessionLockedError('s')), false);
      });

      it('should return false for non-Error values', () => {
        assert.strictEqual(isSessionNotFound(null), false);
        assert.strictEqual(isSessionNotFound(undefined), false);
        assert.strictEqual(isSessionNotFound('string'), false);
      });
    });

    describe('isInvalidStatusTransition', () => {
      it('should return true for InvalidStatusTransitionError', () => {
        const error = new InvalidStatusTransitionError('session-123', 'completed', 'pending');
        assert.strictEqual(isInvalidStatusTransition(error), true);
      });

      it('should return false for other Error types', () => {
        assert.strictEqual(isInvalidStatusTransition(new Error('generic')), false);
        assert.strictEqual(isInvalidStatusTransition(new VersionConflictError('s', 1)), false);
        assert.strictEqual(isInvalidStatusTransition(new SessionNotFoundError('s')), false);
        assert.strictEqual(isInvalidStatusTransition(new SessionLockedError('s')), false);
      });

      it('should return false for non-Error values', () => {
        assert.strictEqual(isInvalidStatusTransition(null), false);
        assert.strictEqual(isInvalidStatusTransition(undefined), false);
        assert.strictEqual(isInvalidStatusTransition({ code: 'INVALID_STATUS_TRANSITION' }), false);
      });
    });

    describe('isSessionLocked', () => {
      it('should return true for SessionLockedError', () => {
        const error = new SessionLockedError('session-123');
        assert.strictEqual(isSessionLocked(error), true);
      });

      it('should return false for other Error types', () => {
        assert.strictEqual(isSessionLocked(new Error('generic')), false);
        assert.strictEqual(isSessionLocked(new VersionConflictError('s', 1)), false);
        assert.strictEqual(isSessionLocked(new SessionNotFoundError('s')), false);
        assert.strictEqual(isSessionLocked(new InvalidStatusTransitionError('s', 'a', 'b')), false);
      });

      it('should return false for non-Error values', () => {
        assert.strictEqual(isSessionLocked(null), false);
        assert.strictEqual(isSessionLocked(undefined), false);
        assert.strictEqual(isSessionLocked({ code: 'SESSION_LOCKED' }), false);
      });
    });
  });

  describe('State machine integrity', () => {
    it('should form a valid state machine with expected transitions', () => {
      // Define the expected state machine
      const expectedTransitions: Record<SessionStatus, SessionStatus[]> = {
        pending: ['running', 'error'],
        running: ['completed', 'error'],
        completed: ['running'],  // resume
        error: ['running'],      // retry
      };

      // Verify all expected transitions are valid
      for (const [from, toStates] of Object.entries(expectedTransitions)) {
        for (const to of toStates) {
          assert.strictEqual(
            isValidStatusTransition(from as SessionStatus, to as SessionStatus),
            true,
            `Expected ${from} -> ${to} to be valid`
          );
        }
      }

      // Verify no self-transitions are allowed
      const allStates: SessionStatus[] = ['pending', 'running', 'completed', 'error'];
      for (const state of allStates) {
        assert.strictEqual(
          isValidStatusTransition(state, state),
          false,
          `Expected ${state} -> ${state} (self-transition) to be invalid`
        );
      }
    });

    it('should ensure all terminal states can be resumed', () => {
      // Terminal states are 'completed' and 'error'
      // Both should allow transition back to 'running' for resume/retry
      assert.strictEqual(isValidStatusTransition('completed', 'running'), true);
      assert.strictEqual(isValidStatusTransition('error', 'running'), true);
    });

    it('should ensure running can only go to terminal states', () => {
      // Running should only be able to transition to completed or error
      assert.strictEqual(isValidStatusTransition('running', 'completed'), true);
      assert.strictEqual(isValidStatusTransition('running', 'error'), true);
      assert.strictEqual(isValidStatusTransition('running', 'pending'), false);
    });
  });
});
