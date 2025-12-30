import { db, organizationInvitations, eq, lt } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';
import {
  INVITATION_CLEANUP_ENABLED,
  INVITATION_CLEANUP_INTERVAL_MS,
  INVITATION_CLEANUP_INITIAL_DELAY_MS,
  INVITATION_RETENTION_DAYS_AFTER_EXPIRY,
} from '../config/index.js';

import { AInvitationCleanupService } from './AInvitationCleanupService.js';

import type { InvitationCleanupResult, ExpiredInvitation } from './AInvitationCleanupService.js';

export class InvitationCleanupService extends AInvitationCleanupService {
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

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

  async deleteInvitation(
    invitationId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await db
        .delete(organizationInvitations)
        .where(eq(organizationInvitations.id, invitationId));

      return {
        success: true,
        message: `Deleted invitation ${invitationId}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to delete invitation ${invitationId}`, error as Error, {
        component: 'InvitationCleanupService',
      });
      return {
        success: false,
        message: errorMessage,
      };
    }
  }

  async cleanupExpiredInvitations(
    retentionDaysAfterExpiry: number
  ): Promise<InvitationCleanupResult> {
    const result: InvitationCleanupResult = {
      invitationsDeleted: 0,
      errors: [],
    };

    logger.info(`Starting invitation cleanup (retention after expiry: ${retentionDaysAfterExpiry} days)`, {
      component: 'InvitationCleanupService',
    });

    try {
      const expiredInvitations = await this.getExpiredInvitations(retentionDaysAfterExpiry);

      if (expiredInvitations.length === 0) {
        logger.info('No expired invitations found', {
          component: 'InvitationCleanupService',
        });
        return result;
      }

      logger.info(`Found ${expiredInvitations.length} expired invitations to clean up`, {
        component: 'InvitationCleanupService',
      });

      // Batch delete for efficiency
      const cutoffDate = new Date(Date.now() - retentionDaysAfterExpiry * 24 * 60 * 60 * 1000);

      const deleted = await db
        .delete(organizationInvitations)
        .where(lt(organizationInvitations.expiresAt, cutoffDate))
        .returning();

      result.invitationsDeleted = deleted.length;

      logger.info('Invitation cleanup completed', {
        component: 'InvitationCleanupService',
        invitationsDeleted: result.invitationsDeleted,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Cleanup failed: ${errorMsg}`);
      logger.error('Invitation cleanup failed', error as Error, {
        component: 'InvitationCleanupService',
      });
      return result;
    }
  }

  private async runCleanupWithErrorHandling(): Promise<void> {
    try {
      await this.cleanupExpiredInvitations(INVITATION_RETENTION_DAYS_AFTER_EXPIRY);
    } catch (error) {
      logger.error('Scheduled invitation cleanup failed', error as Error, {
        component: 'InvitationCleanupService',
      });
    }
  }

  startScheduledCleanup(): void {
    if (!INVITATION_CLEANUP_ENABLED) {
      logger.info('Invitation cleanup is disabled', {
        component: 'InvitationCleanupService',
      });
      return;
    }

    if (this.cleanupIntervalId) {
      logger.warn('Invitation cleanup scheduler already running', {
        component: 'InvitationCleanupService',
      });
      return;
    }

    logger.info('Starting invitation cleanup scheduler', {
      component: 'InvitationCleanupService',
      intervalMs: INVITATION_CLEANUP_INTERVAL_MS,
      initialDelayMs: INVITATION_CLEANUP_INITIAL_DELAY_MS,
      retentionDaysAfterExpiry: INVITATION_RETENTION_DAYS_AFTER_EXPIRY,
    });

    // Initial cleanup after delay (with error handling)
    this.initialTimeoutId = setTimeout(() => {
      this.runCleanupWithErrorHandling();
    }, INVITATION_CLEANUP_INITIAL_DELAY_MS);

    // Schedule periodic cleanup (with error handling)
    this.cleanupIntervalId = setInterval(() => {
      this.runCleanupWithErrorHandling();
    }, INVITATION_CLEANUP_INTERVAL_MS);

    // Allow the process to exit cleanly even if this timer is running
    this.cleanupIntervalId.unref();
  }

  stopScheduledCleanup(): void {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.info('Invitation cleanup scheduler stopped', {
        component: 'InvitationCleanupService',
      });
    }
  }

  async initialize(): Promise<void> {
    this.startScheduledCleanup();
  }

  async dispose(): Promise<void> {
    this.stopScheduledCleanup();
  }
}

export const invitationCleanupService = new InvitationCleanupService();
