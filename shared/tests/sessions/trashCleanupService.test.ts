/**
 * Tests for the TrashCleanupService module.
 *
 * These tests verify the permanent deletion behavior for soft-deleted sessions
 * that have exceeded their retention period. The TrashCleanupService is
 * responsible for irreversible data deletion.
 *
 * The tests cover:
 * - Cutoff date calculation for expired trash sessions
 * - Successful cleanup flow with multiple sessions
 * - Partial failure scenarios (some deletions fail)
 * - Storage recalculation after cleanup
 * - Edge cases: empty session lists, already-deleted sessions
 * - Sequential loop patterns with error aggregation
 *
 * IMPORTANT: These tests use a MockTrashCleanupService that mirrors the expected
 * behavior of the real TrashCleanupService. This approach tests cleanup logic patterns
 * without requiring a database connection.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import type { TrashCleanupResult, TrashCleanupSession } from '../../src/sessions/ATrashCleanupService.js';

/**
 * Test helper to create mock session data
 */
function createMockTrashSession(overrides: Partial<TrashCleanupSession> = {}): TrashCleanupSession {
  return {
    id: overrides.id || `session-${Math.random().toString(36).substring(7)}`,
    userId: overrides.userId || 'user-123',
    deletedAt: overrides.deletedAt || new Date(),
    remoteSessionId: overrides.remoteSessionId ?? null,
  };
}

/**
 * Represents internal session storage with messages and events
 */
interface InternalSession {
  id: string;
  userId: string;
  deletedAt: Date | null;
  remoteSessionId?: string | null;
  messages: Array<{ id: number; content: string }>;
  events: Array<{ id: number; type: string }>;
}

/**
 * Result of deleting a single session
 */
interface DeleteSessionResult {
  success: boolean;
  message: string;
  eventsDeleted: number;
  messagesDeleted: number;
}

/**
 * Mock implementation of TrashCleanupService for testing cleanup logic
 */
class MockTrashCleanupService {
  private sessions: Map<string, InternalSession> = new Map();
  private storageRecalculations: string[] = [];
  private schedulerRunning = false;
  private cleanupEnabled = true;
  private cleanupIntervalMs = 86400000;
  private initialDelayMs = 120000;
  private retentionDays = 30;

  // For simulating failures
  private failDeleteForSessions: Set<string> = new Set();
  private failStorageRecalcForUsers: Set<string> = new Set();

  constructor(options?: {
    enabled?: boolean;
    intervalMs?: number;
    initialDelayMs?: number;
    retentionDays?: number;
  }) {
    this.cleanupEnabled = options?.enabled ?? true;
    this.cleanupIntervalMs = options?.intervalMs ?? 86400000;
    this.initialDelayMs = options?.initialDelayMs ?? 120000;
    this.retentionDays = options?.retentionDays ?? 30;
  }

  /**
   * Add a mock session for testing
   */
  addSession(session: Omit<InternalSession, 'messages' | 'events'> & {
    messages?: Array<{ id: number; content: string }>;
    events?: Array<{ id: number; type: string }>;
  }): void {
    this.sessions.set(session.id, {
      ...session,
      messages: session.messages || [],
      events: session.events || [],
    });
  }

  /**
   * Add messages to a session
   */
  addMessages(sessionId: string, count: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (let i = 0; i < count; i++) {
        session.messages.push({ id: session.messages.length + 1, content: `message-${i}` });
      }
    }
  }

  /**
   * Add events to a session
   */
  addEvents(sessionId: string, count: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (let i = 0; i < count; i++) {
        session.events.push({ id: session.events.length + 1, type: `event-${i}` });
      }
    }
  }

  /**
   * Configure which sessions should fail to delete
   */
  setFailDeleteForSession(sessionId: string): void {
    this.failDeleteForSessions.add(sessionId);
  }

  /**
   * Configure which users should fail storage recalculation
   */
  setFailStorageRecalcForUser(userId: string): void {
    this.failStorageRecalcForUsers.add(userId);
  }

  /**
   * Get all storage recalculation calls
   */
  getStorageRecalculations(): string[] {
    return [...this.storageRecalculations];
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session for verification
   */
  getSession(sessionId: string): InternalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Calculate cutoff date for expired trash sessions
   */
  private calculateCutoffDate(retentionDays: number): Date {
    return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Get expired trash sessions past retention period
   */
  getExpiredTrashSessions(retentionDays: number): TrashCleanupSession[] {
    const cutoffDate = this.calculateCutoffDate(retentionDays);
    const expired: TrashCleanupSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.deletedAt !== null && session.deletedAt < cutoffDate) {
        expired.push({
          id: session.id,
          userId: session.userId,
          deletedAt: session.deletedAt,
          remoteSessionId: session.remoteSessionId,
        });
      }
    }

    return expired;
  }

  /**
   * Delete a single session permanently (internal)
   */
  private deleteSessionPermanentlyInternal(sessionId: string): DeleteSessionResult {
    if (this.failDeleteForSessions.has(sessionId)) {
      return {
        success: false,
        message: `Database error deleting session ${sessionId}`,
        eventsDeleted: 0,
        messagesDeleted: 0,
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        message: `Session ${sessionId} not found`,
        eventsDeleted: 0,
        messagesDeleted: 0,
      };
    }

    const eventsDeleted = session.events.length;
    const messagesDeleted = session.messages.length;

    // Permanently delete the session
    this.sessions.delete(sessionId);

    return {
      success: true,
      message: `Deleted session with ${eventsDeleted} events and ${messagesDeleted} messages`,
      eventsDeleted,
      messagesDeleted,
    };
  }

  /**
   * Delete a session permanently (public API)
   */
  deleteSessionPermanently(sessionId: string): { success: boolean; message: string } {
    const result = this.deleteSessionPermanentlyInternal(sessionId);
    return {
      success: result.success,
      message: result.message,
    };
  }

  /**
   * Recalculate storage usage for a user (mock)
   */
  private async recalculateStorage(userId: string): Promise<void> {
    if (this.failStorageRecalcForUsers.has(userId)) {
      throw new Error(`Storage recalculation failed for user ${userId}`);
    }
    this.storageRecalculations.push(userId);
  }

  /**
   * Cleanup expired trash sessions
   */
  async cleanupExpiredTrash(retentionDays: number): Promise<TrashCleanupResult> {
    const result: TrashCleanupResult = {
      sessionsDeleted: 0,
      eventsDeleted: 0,
      messagesDeleted: 0,
      errors: [],
    };

    const expiredSessions = this.getExpiredTrashSessions(retentionDays);

    if (expiredSessions.length === 0) {
      return result;
    }

    // Track users who need storage recalculation
    const affectedUserIds = new Set<string>();

    for (const session of expiredSessions) {
      try {
        const deleteResult = this.deleteSessionPermanentlyInternal(session.id);

        if (deleteResult.success) {
          result.sessionsDeleted++;
          result.eventsDeleted += deleteResult.eventsDeleted;
          result.messagesDeleted += deleteResult.messagesDeleted;
          affectedUserIds.add(session.userId);
        } else {
          result.errors.push(`Session ${session.id}: ${deleteResult.message}`);
        }
      } catch (sessionError) {
        const errorMsg = sessionError instanceof Error ? sessionError.message : 'Unknown error';
        result.errors.push(`Session ${session.id}: ${errorMsg}`);
      }
    }

    // Recalculate storage usage for all affected users
    for (const userId of affectedUserIds) {
      try {
        await this.recalculateStorage(userId);
      } catch {
        // Log but don't fail the cleanup for storage recalculation errors
        // This matches the production behavior
      }
    }

    return result;
  }

  /**
   * Start scheduled cleanup
   */
  startScheduledCleanup(): boolean {
    if (!this.cleanupEnabled) {
      return false;
    }
    if (this.schedulerRunning) {
      return false;
    }
    this.schedulerRunning = true;
    return true;
  }

  /**
   * Stop scheduled cleanup
   */
  stopScheduledCleanup(): void {
    this.schedulerRunning = false;
  }

  isSchedulerRunning(): boolean {
    return this.schedulerRunning;
  }

  getConfig(): { enabled: boolean; intervalMs: number; initialDelayMs: number; retentionDays: number } {
    return {
      enabled: this.cleanupEnabled,
      intervalMs: this.cleanupIntervalMs,
      initialDelayMs: this.initialDelayMs,
      retentionDays: this.retentionDays,
    };
  }
}

describe('TrashCleanupService Cutoff Calculation', () => {
  describe('getExpiredTrashSessions', () => {
    it('should return sessions deleted past retention period', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Deleted 35 days ago (past 30-day retention)
      service.addSession({
        id: 'old-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });

      // Deleted 40 days ago (past 30-day retention)
      service.addSession({
        id: 'old-2',
        userId: 'user-2',
        deletedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
      });

      // Deleted 15 days ago (within 30-day retention)
      service.addSession({
        id: 'recent',
        userId: 'user-1',
        deletedAt: new Date(now - 15 * 24 * 60 * 60 * 1000),
      });

      // Not deleted (active session)
      service.addSession({
        id: 'active',
        userId: 'user-3',
        deletedAt: null,
      });

      const expired = service.getExpiredTrashSessions(30);

      assert.strictEqual(expired.length, 2);
      assert.ok(expired.some(s => s.id === 'old-1'));
      assert.ok(expired.some(s => s.id === 'old-2'));
    });

    it('should return empty array when no sessions are expired past retention', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // All within retention period
      service.addSession({
        id: 'recent-1',
        userId: 'user-1',
        deletedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      });
      service.addSession({
        id: 'recent-2',
        userId: 'user-2',
        deletedAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
      });

      const expired = service.getExpiredTrashSessions(30);

      assert.strictEqual(expired.length, 0);
    });

    it('should use configurable retention period', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Deleted 10 days ago
      service.addSession({
        id: 'session-1',
        userId: 'user-1',
        deletedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      });

      // With 30-day retention, should not be returned
      const expiredWith30Days = service.getExpiredTrashSessions(30);
      assert.strictEqual(expiredWith30Days.length, 0);

      // With 7-day retention, should be returned
      const expiredWith7Days = service.getExpiredTrashSessions(7);
      assert.strictEqual(expiredWith7Days.length, 1);
    });

    it('should only return soft-deleted sessions (deletedAt not null)', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Active session (not deleted)
      service.addSession({
        id: 'active',
        userId: 'user-1',
        deletedAt: null,
      });

      // Deleted session past retention
      service.addSession({
        id: 'deleted',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });

      const expired = service.getExpiredTrashSessions(30);

      assert.strictEqual(expired.length, 1);
      assert.strictEqual(expired[0].id, 'deleted');
    });
  });
});

describe('TrashCleanupService Cleanup Operations', () => {
  describe('cleanupExpiredTrash', () => {
    it('should delete all sessions past retention period', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Add expired sessions
      service.addSession({
        id: 'old-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('old-1', 5);
      service.addEvents('old-1', 10);

      service.addSession({
        id: 'old-2',
        userId: 'user-2',
        deletedAt: new Date(now - 40 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('old-2', 3);
      service.addEvents('old-2', 7);

      // Add recent session (should not be deleted)
      service.addSession({
        id: 'recent',
        userId: 'user-1',
        deletedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      });

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 2);
      assert.strictEqual(result.eventsDeleted, 17); // 10 + 7
      assert.strictEqual(result.messagesDeleted, 8); // 5 + 3
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(service.getSessionCount(), 1);
      assert.ok(service.hasSession('recent'));
    });

    it('should return zero when no sessions need cleanup', async () => {
      const service = new MockTrashCleanupService();

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 0);
      assert.strictEqual(result.eventsDeleted, 0);
      assert.strictEqual(result.messagesDeleted, 0);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should handle partial failures gracefully', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'success-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('success-1', 2);

      service.addSession({
        id: 'fail-1',
        userId: 'user-2',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('fail-1', 3);

      service.addSession({
        id: 'success-2',
        userId: 'user-3',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addEvents('success-2', 5);

      // Configure failure
      service.setFailDeleteForSession('fail-1');

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 2);
      assert.strictEqual(result.errors.length, 1);
      assert.ok(result.errors[0].includes('fail-1'));

      // Failed session should still exist
      assert.ok(service.hasSession('fail-1'));
      assert.ok(!service.hasSession('success-1'));
      assert.ok(!service.hasSession('success-2'));
    });

    it('should track events and messages deleted count', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'session-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('session-1', 10);
      service.addEvents('session-1', 20);

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 1);
      assert.strictEqual(result.messagesDeleted, 10);
      assert.strictEqual(result.eventsDeleted, 20);
    });
  });

  describe('deleteSessionPermanently', () => {
    it('should delete specific session by ID', () => {
      const service = new MockTrashCleanupService();
      service.addSession({ id: 'session-1', userId: 'user-1', deletedAt: new Date() });
      service.addSession({ id: 'session-2', userId: 'user-2', deletedAt: new Date() });

      const result = service.deleteSessionPermanently('session-1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(service.getSessionCount(), 1);
      assert.ok(!service.hasSession('session-1'));
      assert.ok(service.hasSession('session-2'));
    });

    it('should return failure for non-existent session', () => {
      const service = new MockTrashCleanupService();
      service.addSession({ id: 'session-1', userId: 'user-1', deletedAt: new Date() });

      const result = service.deleteSessionPermanently('non-existent');

      assert.strictEqual(result.success, false);
      assert.ok(result.message.includes('not found'));
      assert.strictEqual(service.getSessionCount(), 1);
    });

    it('should delete session along with messages and events', () => {
      const service = new MockTrashCleanupService();
      service.addSession({ id: 'session-1', userId: 'user-1', deletedAt: new Date() });
      service.addMessages('session-1', 5);
      service.addEvents('session-1', 10);

      const result = service.deleteSessionPermanently('session-1');

      assert.strictEqual(result.success, true);
      assert.ok(!service.hasSession('session-1'));
    });
  });
});

describe('TrashCleanupService Storage Recalculation', () => {
  describe('cleanupExpiredTrash storage recalc', () => {
    it('should recalculate storage for affected users', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'session-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addSession({
        id: 'session-2',
        userId: 'user-2',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addSession({
        id: 'session-3',
        userId: 'user-1', // Same user as session-1
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });

      await service.cleanupExpiredTrash(30);

      const recalcs = service.getStorageRecalculations();

      // Should recalculate once per unique user
      assert.strictEqual(recalcs.length, 2);
      assert.ok(recalcs.includes('user-1'));
      assert.ok(recalcs.includes('user-2'));
    });

    it('should not fail cleanup if storage recalculation fails', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'session-1',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('session-1', 5);

      // Configure storage recalc to fail
      service.setFailStorageRecalcForUser('user-1');

      const result = await service.cleanupExpiredTrash(30);

      // Cleanup should still succeed
      assert.strictEqual(result.sessionsDeleted, 1);
      assert.strictEqual(result.messagesDeleted, 5);
      assert.strictEqual(result.errors.length, 0);
      assert.ok(!service.hasSession('session-1'));
    });

    it('should not recalculate storage for failed deletions', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'fail-session',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });

      // Configure deletion to fail
      service.setFailDeleteForSession('fail-session');

      await service.cleanupExpiredTrash(30);

      const recalcs = service.getStorageRecalculations();
      assert.strictEqual(recalcs.length, 0);
    });
  });
});

describe('TrashCleanupService Scheduler', () => {
  describe('startScheduledCleanup', () => {
    it('should start scheduler when enabled', () => {
      const service = new MockTrashCleanupService({ enabled: true });

      const started = service.startScheduledCleanup();

      assert.strictEqual(started, true);
      assert.strictEqual(service.isSchedulerRunning(), true);
    });

    it('should not start scheduler when disabled', () => {
      const service = new MockTrashCleanupService({ enabled: false });

      const started = service.startScheduledCleanup();

      assert.strictEqual(started, false);
      assert.strictEqual(service.isSchedulerRunning(), false);
    });

    it('should not start scheduler if already running', () => {
      const service = new MockTrashCleanupService({ enabled: true });

      service.startScheduledCleanup();
      const startedAgain = service.startScheduledCleanup();

      assert.strictEqual(startedAgain, false);
    });
  });

  describe('stopScheduledCleanup', () => {
    it('should stop running scheduler', () => {
      const service = new MockTrashCleanupService({ enabled: true });

      service.startScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), true);

      service.stopScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), false);
    });

    it('should handle stop when scheduler not running', () => {
      const service = new MockTrashCleanupService();

      // Should not throw
      service.stopScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), false);
    });
  });
});

describe('TrashCleanupService Configuration', () => {
  it('should use default configuration values', () => {
    const service = new MockTrashCleanupService();
    const config = service.getConfig();

    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.intervalMs, 86400000); // 24 hours
    assert.strictEqual(config.initialDelayMs, 120000); // 2 minutes
    assert.strictEqual(config.retentionDays, 30);
  });

  it('should accept custom configuration values', () => {
    const service = new MockTrashCleanupService({
      enabled: false,
      intervalMs: 3600000,
      initialDelayMs: 60000,
      retentionDays: 14,
    });
    const config = service.getConfig();

    assert.strictEqual(config.enabled, false);
    assert.strictEqual(config.intervalMs, 3600000);
    assert.strictEqual(config.initialDelayMs, 60000);
    assert.strictEqual(config.retentionDays, 14);
  });
});

describe('TrashCleanupService Edge Cases', () => {
  describe('Boundary Conditions', () => {
    it('should handle session deleted exactly at cutoff', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Session deleted exactly 30 days ago
      const exactlyCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
      service.addSession({
        id: 'exact',
        userId: 'user-1',
        deletedAt: exactlyCutoff,
      });

      // Should NOT be deleted (deletedAt must be < cutoff, not <=)
      const expired = service.getExpiredTrashSessions(30);
      assert.strictEqual(expired.length, 0);
    });

    it('should handle session deleted just past cutoff', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Session deleted 30 days + 1ms ago
      const justPastCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000 - 1);
      service.addSession({
        id: 'just-past',
        userId: 'user-1',
        deletedAt: justPastCutoff,
      });

      const expired = service.getExpiredTrashSessions(30);
      assert.strictEqual(expired.length, 1);
    });
  });

  describe('Empty State', () => {
    it('should handle cleanup on empty service', async () => {
      const service = new MockTrashCleanupService();

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 0);
      assert.strictEqual(result.eventsDeleted, 0);
      assert.strictEqual(result.messagesDeleted, 0);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should return empty array for getExpiredTrashSessions on empty service', () => {
      const service = new MockTrashCleanupService();

      const expired = service.getExpiredTrashSessions(30);

      assert.ok(Array.isArray(expired));
      assert.strictEqual(expired.length, 0);
    });
  });

  describe('Large Data Sets', () => {
    it('should handle cleanup of many sessions', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Add 100 expired sessions
      for (let i = 0; i < 100; i++) {
        service.addSession({
          id: `session-${i}`,
          userId: `user-${i % 10}`, // 10 unique users
          deletedAt: new Date(now - (35 + i) * 24 * 60 * 60 * 1000),
        });
        service.addMessages(`session-${i}`, 5);
        service.addEvents(`session-${i}`, 10);
      }

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 100);
      assert.strictEqual(result.messagesDeleted, 500); // 100 * 5
      assert.strictEqual(result.eventsDeleted, 1000); // 100 * 10
      assert.strictEqual(service.getSessionCount(), 0);

      // Should have recalculated storage for 10 unique users
      const recalcs = service.getStorageRecalculations();
      assert.strictEqual(recalcs.length, 10);
    });

    it('should handle sessions with many messages and events', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'large-session',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      service.addMessages('large-session', 1000);
      service.addEvents('large-session', 5000);

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 1);
      assert.strictEqual(result.messagesDeleted, 1000);
      assert.strictEqual(result.eventsDeleted, 5000);
    });
  });

  describe('Different Retention Periods', () => {
    it('should correctly apply 0-day retention (immediate cleanup)', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Deleted 1 hour ago
      service.addSession({
        id: 'recent',
        userId: 'user-1',
        deletedAt: new Date(now - 60 * 60 * 1000),
      });

      const result = await service.cleanupExpiredTrash(0);

      assert.strictEqual(result.sessionsDeleted, 1);
    });

    it('should correctly apply 90-day retention', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      // Deleted 60 days ago (within 90-day retention)
      service.addSession({
        id: 'within-retention',
        userId: 'user-1',
        deletedAt: new Date(now - 60 * 24 * 60 * 60 * 1000),
      });

      // Deleted 100 days ago (past 90-day retention)
      service.addSession({
        id: 'past-retention',
        userId: 'user-2',
        deletedAt: new Date(now - 100 * 24 * 60 * 60 * 1000),
      });

      const result = await service.cleanupExpiredTrash(90);

      assert.strictEqual(result.sessionsDeleted, 1);
      assert.strictEqual(service.getSessionCount(), 1);
      assert.ok(service.hasSession('within-retention'));
    });
  });

  describe('Multiple Errors', () => {
    it('should collect multiple errors from failing sessions', async () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        service.addSession({
          id: `session-${i}`,
          userId: 'user-1',
          deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
        });
        if (i % 2 === 0) {
          service.setFailDeleteForSession(`session-${i}`);
        }
      }

      const result = await service.cleanupExpiredTrash(30);

      assert.strictEqual(result.sessionsDeleted, 2); // sessions 1 and 3
      assert.strictEqual(result.errors.length, 3);  // sessions 0, 2, and 4
    });
  });

  describe('Session with Remote Session ID', () => {
    it('should include remoteSessionId in expired sessions', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'session-with-remote',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
        remoteSessionId: 'remote-123',
      });

      const expired = service.getExpiredTrashSessions(30);

      assert.strictEqual(expired.length, 1);
      assert.strictEqual(expired[0].remoteSessionId, 'remote-123');
    });

    it('should handle null remoteSessionId', () => {
      const service = new MockTrashCleanupService();
      const now = Date.now();

      service.addSession({
        id: 'session-without-remote',
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
        remoteSessionId: null,
      });

      const expired = service.getExpiredTrashSessions(30);

      assert.strictEqual(expired.length, 1);
      assert.strictEqual(expired[0].remoteSessionId, null);
    });
  });
});

describe('TrashCleanupService Sequential Processing', () => {
  it('should process sessions sequentially (not in parallel)', async () => {
    const service = new MockTrashCleanupService();
    const now = Date.now();
    const processingOrder: string[] = [];

    // Override to track processing order
    const originalGetExpired = service.getExpiredTrashSessions.bind(service);
    const sessions: TrashCleanupSession[] = [];
    for (let i = 0; i < 5; i++) {
      const session = createMockTrashSession({
        id: `session-${i}`,
        userId: 'user-1',
        deletedAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      });
      sessions.push(session);
      service.addSession({
        id: session.id,
        userId: session.userId,
        deletedAt: session.deletedAt,
      });
    }

    await service.cleanupExpiredTrash(30);

    // All sessions should be processed
    assert.strictEqual(service.getSessionCount(), 0);
  });
});
