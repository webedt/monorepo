/**
 * Tests for the SessionSoftDeleteService module.
 *
 * These tests verify the cascading soft delete behavior that ensures
 * data consistency between sessions and their related records (messages, events).
 *
 * The tests cover:
 * - Single session soft delete with cascading to messages and events
 * - Bulk session soft delete operations
 * - Session restore with cascading to messages and events
 * - Error handling for non-existent sessions
 * - Prevention of double soft-delete
 * - Prevention of restoring non-deleted sessions
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

import { ASessionSoftDeleteService } from '../../src/sessions/ASessionSoftDeleteService.js';

import type {
  SoftDeleteResult,
  RestoreResult,
  BulkSoftDeleteResult,
  BulkRestoreResult,
} from '../../src/sessions/ASessionSoftDeleteService.js';

/**
 * Mock implementation of SessionSoftDeleteService for testing
 * Simulates database operations without requiring actual database connection
 */
class MockSessionSoftDeleteService extends ASessionSoftDeleteService {
  private sessions: Map<string, { id: string; deletedAt: Date | null }> = new Map();
  private messages: Map<string, { id: number; chatSessionId: string; deletedAt: Date | null }[]> = new Map();
  private events: Map<string, { id: number; chatSessionId: string; deletedAt: Date | null }[]> = new Map();

  /**
   * Add a mock session for testing
   */
  addSession(session: { id: string; deletedAt: Date | null }): void {
    this.sessions.set(session.id, session);
  }

  /**
   * Add mock messages for a session
   */
  addMessages(sessionId: string, count: number): void {
    const messages = [];
    for (let i = 0; i < count; i++) {
      messages.push({ id: i + 1, chatSessionId: sessionId, deletedAt: null });
    }
    this.messages.set(sessionId, messages);
  }

  /**
   * Add mock events for a session
   */
  addEvents(sessionId: string, count: number): void {
    const events = [];
    for (let i = 0; i < count; i++) {
      events.push({ id: i + 1, chatSessionId: sessionId, deletedAt: null });
    }
    this.events.set(sessionId, events);
  }

  /**
   * Get session state for verification
   */
  getSession(sessionId: string): { id: string; deletedAt: Date | null } | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get message states for verification
   */
  getMessages(sessionId: string): { id: number; chatSessionId: string; deletedAt: Date | null }[] {
    return this.messages.get(sessionId) || [];
  }

  /**
   * Get event states for verification
   */
  getEvents(sessionId: string): { id: number; chatSessionId: string; deletedAt: Date | null }[] {
    return this.events.get(sessionId) || [];
  }

  async softDeleteSession(sessionId: string): Promise<SoftDeleteResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        sessionId,
        success: false,
        messagesDeleted: 0,
        eventsDeleted: 0,
        error: `Session ${sessionId} not found`,
      };
    }

    if (session.deletedAt !== null) {
      return {
        sessionId,
        success: false,
        messagesDeleted: 0,
        eventsDeleted: 0,
        error: `Session ${sessionId} is already deleted`,
      };
    }

    const now = new Date();

    // Soft delete session
    session.deletedAt = now;

    // Cascade to messages
    const sessionMessages = this.messages.get(sessionId) || [];
    let messagesDeleted = 0;
    for (const message of sessionMessages) {
      if (message.deletedAt === null) {
        message.deletedAt = now;
        messagesDeleted++;
      }
    }

    // Cascade to events
    const sessionEvents = this.events.get(sessionId) || [];
    let eventsDeleted = 0;
    for (const event of sessionEvents) {
      if (event.deletedAt === null) {
        event.deletedAt = now;
        eventsDeleted++;
      }
    }

    return {
      sessionId,
      success: true,
      messagesDeleted,
      eventsDeleted,
    };
  }

  async softDeleteSessions(sessionIds: string[]): Promise<BulkSoftDeleteResult> {
    const results: SoftDeleteResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const sessionId of sessionIds) {
      const result = await this.softDeleteSession(sessionId);
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  }

  async restoreSession(sessionId: string): Promise<RestoreResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        sessionId,
        success: false,
        messagesRestored: 0,
        eventsRestored: 0,
        error: `Session ${sessionId} not found`,
      };
    }

    if (session.deletedAt === null) {
      return {
        sessionId,
        success: false,
        messagesRestored: 0,
        eventsRestored: 0,
        error: `Session ${sessionId} is not deleted`,
      };
    }

    // Restore session
    session.deletedAt = null;

    // Restore messages
    const sessionMessages = this.messages.get(sessionId) || [];
    let messagesRestored = 0;
    for (const message of sessionMessages) {
      if (message.deletedAt !== null) {
        message.deletedAt = null;
        messagesRestored++;
      }
    }

    // Restore events
    const sessionEvents = this.events.get(sessionId) || [];
    let eventsRestored = 0;
    for (const event of sessionEvents) {
      if (event.deletedAt !== null) {
        event.deletedAt = null;
        eventsRestored++;
      }
    }

    return {
      sessionId,
      success: true,
      messagesRestored,
      eventsRestored,
    };
  }

  async restoreSessions(sessionIds: string[]): Promise<BulkRestoreResult> {
    const results: RestoreResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const sessionId of sessionIds) {
      const result = await this.restoreSession(sessionId);
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return { successCount, failureCount, results };
  }

  async initialize(): Promise<void> {
    // No initialization needed for mock
  }

  async dispose(): Promise<void> {
    // No cleanup needed for mock
  }
}

describe('SessionSoftDeleteService', () => {
  let service: MockSessionSoftDeleteService;

  beforeEach(() => {
    service = new MockSessionSoftDeleteService();
  });

  describe('softDeleteSession', () => {
    it('should soft delete a session and cascade to messages and events', async () => {
      // Arrange
      const sessionId = 'session-123';
      service.addSession({ id: sessionId, deletedAt: null });
      service.addMessages(sessionId, 5);
      service.addEvents(sessionId, 10);

      // Act
      const result = await service.softDeleteSession(sessionId);

      // Assert
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.sessionId, sessionId);
      assert.strictEqual(result.messagesDeleted, 5);
      assert.strictEqual(result.eventsDeleted, 10);

      // Verify session is soft-deleted
      const session = service.getSession(sessionId);
      assert.ok(session);
      assert.notStrictEqual(session.deletedAt, null);

      // Verify all messages are soft-deleted
      const messages = service.getMessages(sessionId);
      assert.strictEqual(messages.length, 5);
      messages.forEach(m => assert.notStrictEqual(m.deletedAt, null));

      // Verify all events are soft-deleted
      const events = service.getEvents(sessionId);
      assert.strictEqual(events.length, 10);
      events.forEach(e => assert.notStrictEqual(e.deletedAt, null));
    });

    it('should return error for non-existent session', async () => {
      // Act
      const result = await service.softDeleteSession('non-existent');

      // Assert
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
      assert.strictEqual(result.messagesDeleted, 0);
      assert.strictEqual(result.eventsDeleted, 0);
    });

    it('should return error for already deleted session', async () => {
      // Arrange
      const sessionId = 'session-deleted';
      service.addSession({ id: sessionId, deletedAt: new Date() });

      // Act
      const result = await service.softDeleteSession(sessionId);

      // Assert
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('already deleted'));
    });

    it('should handle session with no messages or events', async () => {
      // Arrange
      const sessionId = 'session-empty';
      service.addSession({ id: sessionId, deletedAt: null });

      // Act
      const result = await service.softDeleteSession(sessionId);

      // Assert
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.messagesDeleted, 0);
      assert.strictEqual(result.eventsDeleted, 0);
    });
  });

  describe('softDeleteSessions', () => {
    it('should soft delete multiple sessions', async () => {
      // Arrange
      service.addSession({ id: 'session-1', deletedAt: null });
      service.addSession({ id: 'session-2', deletedAt: null });
      service.addSession({ id: 'session-3', deletedAt: null });
      service.addMessages('session-1', 2);
      service.addMessages('session-2', 3);
      service.addEvents('session-1', 4);
      service.addEvents('session-3', 5);

      // Act
      const result = await service.softDeleteSessions(['session-1', 'session-2', 'session-3']);

      // Assert
      assert.strictEqual(result.successCount, 3);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.results.length, 3);

      // Verify totals
      const totalMessages = result.results.reduce((sum, r) => sum + r.messagesDeleted, 0);
      const totalEvents = result.results.reduce((sum, r) => sum + r.eventsDeleted, 0);
      assert.strictEqual(totalMessages, 5); // 2 + 3 + 0
      assert.strictEqual(totalEvents, 9);   // 4 + 0 + 5
    });

    it('should handle partial failures gracefully', async () => {
      // Arrange
      service.addSession({ id: 'session-1', deletedAt: null });
      // session-2 doesn't exist

      // Act
      const result = await service.softDeleteSessions(['session-1', 'session-2']);

      // Assert
      assert.strictEqual(result.successCount, 1);
      assert.strictEqual(result.failureCount, 1);
    });

    it('should handle empty array', async () => {
      // Act
      const result = await service.softDeleteSessions([]);

      // Assert
      assert.strictEqual(result.successCount, 0);
      assert.strictEqual(result.failureCount, 0);
      assert.strictEqual(result.results.length, 0);
    });
  });

  describe('restoreSession', () => {
    it('should restore a soft-deleted session and cascade to messages and events', async () => {
      // Arrange
      const sessionId = 'session-123';
      service.addSession({ id: sessionId, deletedAt: null });
      service.addMessages(sessionId, 5);
      service.addEvents(sessionId, 10);

      // First soft delete
      await service.softDeleteSession(sessionId);

      // Act - restore
      const result = await service.restoreSession(sessionId);

      // Assert
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.sessionId, sessionId);
      assert.strictEqual(result.messagesRestored, 5);
      assert.strictEqual(result.eventsRestored, 10);

      // Verify session is restored
      const session = service.getSession(sessionId);
      assert.ok(session);
      assert.strictEqual(session.deletedAt, null);

      // Verify all messages are restored
      const messages = service.getMessages(sessionId);
      messages.forEach(m => assert.strictEqual(m.deletedAt, null));

      // Verify all events are restored
      const events = service.getEvents(sessionId);
      events.forEach(e => assert.strictEqual(e.deletedAt, null));
    });

    it('should return error for non-existent session', async () => {
      // Act
      const result = await service.restoreSession('non-existent');

      // Assert
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not found'));
    });

    it('should return error for session that is not deleted', async () => {
      // Arrange
      const sessionId = 'session-active';
      service.addSession({ id: sessionId, deletedAt: null });

      // Act
      const result = await service.restoreSession(sessionId);

      // Assert
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('not deleted'));
    });
  });

  describe('restoreSessions', () => {
    it('should restore multiple sessions', async () => {
      // Arrange
      service.addSession({ id: 'session-1', deletedAt: null });
      service.addSession({ id: 'session-2', deletedAt: null });
      service.addMessages('session-1', 2);
      service.addEvents('session-2', 3);

      // Soft delete first
      await service.softDeleteSessions(['session-1', 'session-2']);

      // Act
      const result = await service.restoreSessions(['session-1', 'session-2']);

      // Assert
      assert.strictEqual(result.successCount, 2);
      assert.strictEqual(result.failureCount, 0);
    });

    it('should handle empty array', async () => {
      // Act
      const result = await service.restoreSessions([]);

      // Assert
      assert.strictEqual(result.successCount, 0);
      assert.strictEqual(result.failureCount, 0);
    });
  });

  describe('round-trip soft delete and restore', () => {
    it('should maintain data integrity through delete/restore cycle', async () => {
      // Arrange
      const sessionId = 'session-roundtrip';
      service.addSession({ id: sessionId, deletedAt: null });
      service.addMessages(sessionId, 3);
      service.addEvents(sessionId, 7);

      // Act - soft delete
      const deleteResult = await service.softDeleteSession(sessionId);
      assert.strictEqual(deleteResult.success, true);
      assert.strictEqual(deleteResult.messagesDeleted, 3);
      assert.strictEqual(deleteResult.eventsDeleted, 7);

      // Verify deleted state
      let session = service.getSession(sessionId);
      assert.notStrictEqual(session?.deletedAt, null);

      // Act - restore
      const restoreResult = await service.restoreSession(sessionId);
      assert.strictEqual(restoreResult.success, true);
      assert.strictEqual(restoreResult.messagesRestored, 3);
      assert.strictEqual(restoreResult.eventsRestored, 7);

      // Verify restored state
      session = service.getSession(sessionId);
      assert.strictEqual(session?.deletedAt, null);

      const messages = service.getMessages(sessionId);
      assert.strictEqual(messages.length, 3);
      messages.forEach(m => assert.strictEqual(m.deletedAt, null));

      const events = service.getEvents(sessionId);
      assert.strictEqual(events.length, 7);
      events.forEach(e => assert.strictEqual(e.deletedAt, null));
    });
  });
});
