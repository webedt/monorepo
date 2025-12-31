import { db, organizationInvitations, eq, lt } from '../db/index.js';
import {
  INVITATION_CLEANUP_ENABLED,
  INVITATION_CLEANUP_INTERVAL_MS,
  INVITATION_CLEANUP_INITIAL_DELAY_MS,
  INVITATION_RETENTION_DAYS_AFTER_EXPIRY,
} from '../config/index.js';
import { ScheduledCleanupService } from '../services/BaseService.js';

import { AInvitationCleanupService } from './AInvitationCleanupService.js';

import type { ScheduledTaskConfig } from '../services/BaseService.js';
import type { InvitationCleanupResult, ExpiredInvitation } from './AInvitationCleanupService.js';

export class InvitationCleanupService extends ScheduledCleanupService(AInvitationCleanupService) {
  getScheduledTaskConfig(): ScheduledTaskConfig {
    return {
      enabled: INVITATION_CLEANUP_ENABLED,
      intervalMs: INVITATION_CLEANUP_INTERVAL_MS,
      initialDelayMs: INVITATION_CLEANUP_INITIAL_DELAY_MS,
    };
  }

  getTaskName(): string {
    return 'invitation cleanup';
  }

  getSchedulerLogConfig(): Record<string, unknown> {
    return {
      retentionDaysAfterExpiry: INVITATION_RETENTION_DAYS_AFTER_EXPIRY,
    };
  }

  async runScheduledTask(): Promise<void> {
    await this.cleanupExpiredInvitations(INVITATION_RETENTION_DAYS_AFTER_EXPIRY);
  }

  async getExpiredInvitations(
    retentionDaysAfterExpiry: number
  ): Promise<ExpiredInvitation[]> {
    // Calculate cutoff: invitations that expired more than retentionDaysAfterExpiry ago
    const cutoffDate = new Date(Date.now() - retentionDaysAfterExpiry * 24 * 60 * 60 * 1000);

    const invitations = await db
      .select({
        id: organizationInvitations.id,
        organizationId: organizationInvitations.organizationId,
        email: organizationInvitations.email,
        expiresAt: organizationInvitations.expiresAt,
      })
      .from(organizationInvitations)
      .where(lt(organizationInvitations.expiresAt, cutoffDate));

    return invitations.map(inv => ({
      id: inv.id,
      organizationId: inv.organizationId,
      email: inv.email,
      expiresAt: inv.expiresAt,
    }));
  }

  /**
   * Delete a single invitation by ID.
   * This method is intended for external/API use when deleting individual invitations
   * (e.g., when an invitation is accepted or manually revoked).
   * The batch cleanup uses cleanupExpiredInvitations() directly for efficiency.
   */
  async deleteInvitation(
    invitationId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await db
        .delete(organizationInvitations)
        .where(eq(organizationInvitations.id, invitationId));

      return this.successResult(`Deleted invitation ${invitationId}`);
    } catch (error) {
      return this.handleError(error, 'delete invitation', { invitationId });
    }
  }

  async cleanupExpiredInvitations(
    retentionDaysAfterExpiry: number
  ): Promise<InvitationCleanupResult> {
    const result: InvitationCleanupResult = {
      invitationsDeleted: 0,
      errors: [],
    };

    this.log.info(`Starting invitation cleanup (retention after expiry: ${retentionDaysAfterExpiry} days)`);

    try {
      // Calculate cutoff once: invitations that expired more than retentionDaysAfterExpiry ago
      const cutoffDate = new Date(Date.now() - retentionDaysAfterExpiry * 24 * 60 * 60 * 1000);

      // Single batch delete - using .returning() to get the count without a separate SELECT
      const deleted = await db
        .delete(organizationInvitations)
        .where(lt(organizationInvitations.expiresAt, cutoffDate))
        .returning();

      result.invitationsDeleted = deleted.length;

      if (deleted.length === 0) {
        this.log.info('No expired invitations found');
      } else {
        this.log.info('Invitation cleanup completed', {
          invitationsDeleted: result.invitationsDeleted,
        });
      }

      return result;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      result.errors.push(`Cleanup failed: ${errorMsg}`);
      this.log.error('Invitation cleanup failed', error);
      return result;
    }
  }
}

export const invitationCleanupService = new InvitationCleanupService();
