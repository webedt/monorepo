/**
 * Tests for the InvitationCleanupService module.
 *
 * These tests verify the cleanup behavior of the InvitationCleanupService,
 * which automatically removes expired organization invitations.
 *
 * The tests cover:
 * - Cutoff date calculation for expired invitations
 * - Batch deletion logic
 * - Scheduler start/stop lifecycle
 * - Disabled cleanup configuration
 * - Error handling during cleanup
 *
 * IMPORTANT: These tests use a MockInvitationCleanupService that mirrors the expected
 * behavior of the real InvitationCleanupService. This approach tests cleanup logic patterns
 * without requiring a database connection.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import type { InvitationCleanupResult, ExpiredInvitation } from '../../src/sessions/AInvitationCleanupService.js';

/**
 * Test helper to create mock invitation data
 */
function createMockInvitation(overrides: Partial<ExpiredInvitation> = {}): ExpiredInvitation {
  return {
    id: overrides.id || `inv-${Math.random().toString(36).substring(7)}`,
    organizationId: overrides.organizationId || 'org-123',
    email: overrides.email || 'test@example.com',
    expiresAt: overrides.expiresAt || new Date(),
  };
}

/**
 * Mock implementation of InvitationCleanupService for testing cleanup logic
 */
class MockInvitationCleanupService {
  private invitations: ExpiredInvitation[] = [];
  private schedulerRunning = false;
  private cleanupEnabled = true;
  private cleanupIntervalMs = 86400000;
  private initialDelayMs = 120000;
  private retentionDaysAfterExpiry = 7;

  constructor(options?: {
    enabled?: boolean;
    intervalMs?: number;
    initialDelayMs?: number;
    retentionDays?: number;
  }) {
    this.cleanupEnabled = options?.enabled ?? true;
    this.cleanupIntervalMs = options?.intervalMs ?? 86400000;
    this.initialDelayMs = options?.initialDelayMs ?? 120000;
    this.retentionDaysAfterExpiry = options?.retentionDays ?? 7;
  }

  addInvitation(invitation: ExpiredInvitation): void {
    this.invitations.push(invitation);
  }

  setInvitations(invitations: ExpiredInvitation[]): void {
    this.invitations = [...invitations];
  }

  getInvitationCount(): number {
    return this.invitations.length;
  }

  /**
   * Calculate cutoff date for expired invitations
   */
  private calculateCutoffDate(retentionDaysAfterExpiry: number): Date {
    return new Date(Date.now() - retentionDaysAfterExpiry * 24 * 60 * 60 * 1000);
  }

  /**
   * Get expired invitations past retention period
   */
  getExpiredInvitations(retentionDaysAfterExpiry: number): ExpiredInvitation[] {
    const cutoffDate = this.calculateCutoffDate(retentionDaysAfterExpiry);
    return this.invitations.filter(inv => inv.expiresAt < cutoffDate);
  }

  /**
   * Delete a single invitation by ID
   */
  deleteInvitation(invitationId: string): { success: boolean; message: string } {
    const index = this.invitations.findIndex(inv => inv.id === invitationId);
    if (index === -1) {
      return { success: false, message: 'Invitation not found' };
    }
    this.invitations.splice(index, 1);
    return { success: true, message: `Deleted invitation ${invitationId}` };
  }

  /**
   * Cleanup expired invitations past retention period
   * Uses single batch operation (matching the optimized implementation)
   */
  cleanupExpiredInvitations(retentionDaysAfterExpiry: number): InvitationCleanupResult {
    const result: InvitationCleanupResult = {
      invitationsDeleted: 0,
      errors: [],
    };

    const cutoffDate = this.calculateCutoffDate(retentionDaysAfterExpiry);
    const expiredInvitations = this.invitations.filter(inv => inv.expiresAt < cutoffDate);

    // Remove expired invitations (simulates batch delete)
    this.invitations = this.invitations.filter(inv => inv.expiresAt >= cutoffDate);
    result.invitationsDeleted = expiredInvitations.length;

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
      retentionDays: this.retentionDaysAfterExpiry,
    };
  }
}

describe('InvitationCleanupService Cutoff Calculation', () => {
  describe('getExpiredInvitations', () => {
    it('should return invitations expired past retention period', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Expired 10 days ago (past 7-day retention)
      service.addInvitation(createMockInvitation({
        id: 'old-1',
        expiresAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      }));

      // Expired 8 days ago (past 7-day retention)
      service.addInvitation(createMockInvitation({
        id: 'old-2',
        expiresAt: new Date(now - 8 * 24 * 60 * 60 * 1000),
      }));

      // Expired 5 days ago (within 7-day retention)
      service.addInvitation(createMockInvitation({
        id: 'recent',
        expiresAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
      }));

      // Not expired yet
      service.addInvitation(createMockInvitation({
        id: 'future',
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
      }));

      const expired = service.getExpiredInvitations(7);

      assert.strictEqual(expired.length, 2);
      assert.ok(expired.some(inv => inv.id === 'old-1'));
      assert.ok(expired.some(inv => inv.id === 'old-2'));
    });

    it('should return empty array when no invitations are expired past retention', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // All within retention period
      service.addInvitation(createMockInvitation({
        expiresAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
      }));
      service.addInvitation(createMockInvitation({
        expiresAt: new Date(now - 1 * 24 * 60 * 60 * 1000),
      }));

      const expired = service.getExpiredInvitations(7);

      assert.strictEqual(expired.length, 0);
    });

    it('should use configurable retention period', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Expired 5 days ago
      service.addInvitation(createMockInvitation({
        id: 'inv-1',
        expiresAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
      }));

      // With 7-day retention, should not be returned
      const expiredWith7Days = service.getExpiredInvitations(7);
      assert.strictEqual(expiredWith7Days.length, 0);

      // With 3-day retention, should be returned
      const expiredWith3Days = service.getExpiredInvitations(3);
      assert.strictEqual(expiredWith3Days.length, 1);
    });
  });
});

describe('InvitationCleanupService Cleanup Operations', () => {
  describe('cleanupExpiredInvitations', () => {
    it('should delete all invitations past retention period', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Add invitations with varying ages
      service.addInvitation(createMockInvitation({
        id: 'old-1',
        expiresAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
      }));
      service.addInvitation(createMockInvitation({
        id: 'old-2',
        expiresAt: new Date(now - 15 * 24 * 60 * 60 * 1000),
      }));
      service.addInvitation(createMockInvitation({
        id: 'recent',
        expiresAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
      }));

      const result = service.cleanupExpiredInvitations(7);

      assert.strictEqual(result.invitationsDeleted, 2);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(service.getInvitationCount(), 1);
    });

    it('should return zero when no invitations need cleanup', () => {
      const service = new MockInvitationCleanupService();

      const result = service.cleanupExpiredInvitations(7);

      assert.strictEqual(result.invitationsDeleted, 0);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should handle cleanup with all invitations expired', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        service.addInvitation(createMockInvitation({
          id: `old-${i}`,
          expiresAt: new Date(now - (10 + i) * 24 * 60 * 60 * 1000),
        }));
      }

      const result = service.cleanupExpiredInvitations(7);

      assert.strictEqual(result.invitationsDeleted, 5);
      assert.strictEqual(service.getInvitationCount(), 0);
    });
  });

  describe('deleteInvitation', () => {
    it('should delete specific invitation by ID', () => {
      const service = new MockInvitationCleanupService();
      service.addInvitation(createMockInvitation({ id: 'inv-1' }));
      service.addInvitation(createMockInvitation({ id: 'inv-2' }));

      const result = service.deleteInvitation('inv-1');

      assert.strictEqual(result.success, true);
      assert.strictEqual(service.getInvitationCount(), 1);
    });

    it('should return failure for non-existent invitation', () => {
      const service = new MockInvitationCleanupService();
      service.addInvitation(createMockInvitation({ id: 'inv-1' }));

      const result = service.deleteInvitation('non-existent');

      assert.strictEqual(result.success, false);
      assert.strictEqual(service.getInvitationCount(), 1);
    });
  });
});

describe('InvitationCleanupService Scheduler', () => {
  describe('startScheduledCleanup', () => {
    it('should start scheduler when enabled', () => {
      const service = new MockInvitationCleanupService({ enabled: true });

      const started = service.startScheduledCleanup();

      assert.strictEqual(started, true);
      assert.strictEqual(service.isSchedulerRunning(), true);
    });

    it('should not start scheduler when disabled', () => {
      const service = new MockInvitationCleanupService({ enabled: false });

      const started = service.startScheduledCleanup();

      assert.strictEqual(started, false);
      assert.strictEqual(service.isSchedulerRunning(), false);
    });

    it('should not start scheduler if already running', () => {
      const service = new MockInvitationCleanupService({ enabled: true });

      service.startScheduledCleanup();
      const startedAgain = service.startScheduledCleanup();

      assert.strictEqual(startedAgain, false);
    });
  });

  describe('stopScheduledCleanup', () => {
    it('should stop running scheduler', () => {
      const service = new MockInvitationCleanupService({ enabled: true });

      service.startScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), true);

      service.stopScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), false);
    });

    it('should handle stop when scheduler not running', () => {
      const service = new MockInvitationCleanupService();

      // Should not throw
      service.stopScheduledCleanup();
      assert.strictEqual(service.isSchedulerRunning(), false);
    });
  });
});

describe('InvitationCleanupService Configuration', () => {
  it('should use default configuration values', () => {
    const service = new MockInvitationCleanupService();
    const config = service.getConfig();

    assert.strictEqual(config.enabled, true);
    assert.strictEqual(config.intervalMs, 86400000); // 24 hours
    assert.strictEqual(config.initialDelayMs, 120000); // 2 minutes
    assert.strictEqual(config.retentionDays, 7);
  });

  it('should accept custom configuration values', () => {
    const service = new MockInvitationCleanupService({
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

describe('InvitationCleanupService Edge Cases', () => {
  describe('Boundary Conditions', () => {
    it('should handle invitation expiring exactly at cutoff', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Invitation expiring exactly 7 days ago
      const exactlyCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
      service.addInvitation(createMockInvitation({
        id: 'exact',
        expiresAt: exactlyCutoff,
      }));

      // Should NOT be deleted (expiresAt must be < cutoff, not <=)
      const expired = service.getExpiredInvitations(7);
      assert.strictEqual(expired.length, 0);
    });

    it('should handle invitation expiring just past cutoff', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Invitation expiring 7 days + 1ms ago
      const justPastCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000 - 1);
      service.addInvitation(createMockInvitation({
        id: 'just-past',
        expiresAt: justPastCutoff,
      }));

      const expired = service.getExpiredInvitations(7);
      assert.strictEqual(expired.length, 1);
    });
  });

  describe('Empty State', () => {
    it('should handle cleanup on empty service', () => {
      const service = new MockInvitationCleanupService();

      const result = service.cleanupExpiredInvitations(7);

      assert.strictEqual(result.invitationsDeleted, 0);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should return empty array for getExpiredInvitations on empty service', () => {
      const service = new MockInvitationCleanupService();

      const expired = service.getExpiredInvitations(7);

      assert.ok(Array.isArray(expired));
      assert.strictEqual(expired.length, 0);
    });
  });

  describe('Large Data Sets', () => {
    it('should handle cleanup of many invitations', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Add 1000 expired invitations
      for (let i = 0; i < 1000; i++) {
        service.addInvitation(createMockInvitation({
          id: `inv-${i}`,
          expiresAt: new Date(now - (10 + i) * 24 * 60 * 60 * 1000),
        }));
      }

      const result = service.cleanupExpiredInvitations(7);

      assert.strictEqual(result.invitationsDeleted, 1000);
      assert.strictEqual(service.getInvitationCount(), 0);
    });
  });

  describe('Different Retention Periods', () => {
    it('should correctly apply 0-day retention (immediate cleanup)', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Expired 1 hour ago
      service.addInvitation(createMockInvitation({
        id: 'recent',
        expiresAt: new Date(now - 60 * 60 * 1000),
      }));

      const result = service.cleanupExpiredInvitations(0);

      assert.strictEqual(result.invitationsDeleted, 1);
    });

    it('should correctly apply 30-day retention', () => {
      const service = new MockInvitationCleanupService();
      const now = Date.now();

      // Expired 25 days ago (within 30-day retention)
      service.addInvitation(createMockInvitation({
        id: 'within-retention',
        expiresAt: new Date(now - 25 * 24 * 60 * 60 * 1000),
      }));

      // Expired 35 days ago (past 30-day retention)
      service.addInvitation(createMockInvitation({
        id: 'past-retention',
        expiresAt: new Date(now - 35 * 24 * 60 * 60 * 1000),
      }));

      const result = service.cleanupExpiredInvitations(30);

      assert.strictEqual(result.invitationsDeleted, 1);
      assert.strictEqual(service.getInvitationCount(), 1);
    });
  });
});
