import { db, chatSessions, events, messages } from '../db/index.js';
import { eq, lt, and, isNotNull } from 'drizzle-orm';
import { StorageService } from '../storage/StorageService.js';
import {
  TRASH_CLEANUP_ENABLED,
  TRASH_CLEANUP_INTERVAL_MS,
  TRASH_CLEANUP_INITIAL_DELAY_MS,
  TRASH_RETENTION_DAYS,
} from '../config/index.js';
import { ScheduledCleanupService } from '../services/BaseService.js';

import { ATrashCleanupService } from './ATrashCleanupService.js';

import type { ScheduledTaskConfig } from '../services/BaseService.js';
import type { TrashCleanupResult, TrashCleanupSession } from './ATrashCleanupService.js';

interface DeleteSessionResult {
  success: boolean;
  message: string;
  eventsDeleted: number;
  messagesDeleted: number;
}

export class TrashCleanupService extends ScheduledCleanupService(ATrashCleanupService) {
  getScheduledTaskConfig(): ScheduledTaskConfig {
    return {
      enabled: TRASH_CLEANUP_ENABLED,
      intervalMs: TRASH_CLEANUP_INTERVAL_MS,
      initialDelayMs: TRASH_CLEANUP_INITIAL_DELAY_MS,
    };
  }

  getTaskName(): string {
    return 'trash cleanup';
  }

  getSchedulerLogConfig(): Record<string, unknown> {
    return {
      retentionDays: TRASH_RETENTION_DAYS,
    };
  }

  async runScheduledTask(): Promise<void> {
    await this.cleanupExpiredTrash(TRASH_RETENTION_DAYS);
  }

  async getExpiredTrashSessions(
    retentionDays: number
  ): Promise<TrashCleanupSession[]> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const sessions = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        deletedAt: chatSessions.deletedAt,
        remoteSessionId: chatSessions.remoteSessionId,
      })
      .from(chatSessions)
      .where(
        and(
          isNotNull(chatSessions.deletedAt),
          lt(chatSessions.deletedAt, cutoffDate)
        )
      );

    return sessions
      .filter((s): s is typeof s & { deletedAt: Date } => s.deletedAt !== null)
      .map(s => ({
        id: s.id,
        userId: s.userId,
        deletedAt: s.deletedAt,
        remoteSessionId: s.remoteSessionId,
      }));
  }

  private async deleteSessionPermanentlyInternal(
    sessionId: string
  ): Promise<DeleteSessionResult> {
    try {
      // Use transaction to ensure atomicity - either all deletes succeed or none do
      const result = await this.withTransaction(async (tx) => {
        // Delete events first (foreign key constraint)
        const deletedEvents = await tx
          .delete(events)
          .where(eq(events.chatSessionId, sessionId))
          .returning();

        // Delete messages
        const deletedMessages = await tx
          .delete(messages)
          .where(eq(messages.chatSessionId, sessionId))
          .returning();

        // Delete the session
        await tx
          .delete(chatSessions)
          .where(eq(chatSessions.id, sessionId));

        return {
          eventsDeleted: deletedEvents.length,
          messagesDeleted: deletedMessages.length,
        };
      }, {
        context: { operation: 'deleteSessionPermanently', sessionId },
      });

      return {
        success: true,
        message: `Deleted session with ${result.eventsDeleted} events and ${result.messagesDeleted} messages`,
        eventsDeleted: result.eventsDeleted,
        messagesDeleted: result.messagesDeleted,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.log.error(`Failed to permanently delete session ${sessionId}`, error as Error);
      return {
        success: false,
        message: errorMessage,
        eventsDeleted: 0,
        messagesDeleted: 0,
      };
    }
  }

  async deleteSessionPermanently(
    sessionId: string
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.deleteSessionPermanentlyInternal(sessionId);
    return {
      success: result.success,
      message: result.message,
    };
  }

  async cleanupExpiredTrash(
    retentionDays: number
  ): Promise<TrashCleanupResult> {
    const result: TrashCleanupResult = {
      sessionsDeleted: 0,
      eventsDeleted: 0,
      messagesDeleted: 0,
      errors: [],
    };

    this.log.info(`Starting trash cleanup (retention: ${retentionDays} days)`);

    try {
      const expiredSessions = await this.getExpiredTrashSessions(retentionDays);

      if (expiredSessions.length === 0) {
        this.log.info('No expired trash sessions found');
        return result;
      }

      this.log.info(`Found ${expiredSessions.length} expired trash sessions to clean up`);

      // Track users who need storage recalculation
      const affectedUserIds = new Set<string>();

      for (const session of expiredSessions) {
        try {
          const deleteResult = await this.deleteSessionPermanentlyInternal(session.id);

          if (deleteResult.success) {
            result.sessionsDeleted++;
            result.eventsDeleted += deleteResult.eventsDeleted;
            result.messagesDeleted += deleteResult.messagesDeleted;
            affectedUserIds.add(session.userId);

            this.log.info(`Cleaned up expired trash session ${session.id}`, {
              sessionId: session.id,
              userId: session.userId,
              deletedAt: session.deletedAt.toISOString(),
              eventsDeleted: deleteResult.eventsDeleted,
              messagesDeleted: deleteResult.messagesDeleted,
            });
          } else {
            result.errors.push(`Session ${session.id}: ${deleteResult.message}`);
          }
        } catch (sessionError) {
          const errorMsg = this.getErrorMessage(sessionError);
          result.errors.push(`Session ${session.id}: ${errorMsg}`);
          this.log.error(`Error cleaning up session ${session.id}`, sessionError as Error);
        }
      }

      // Recalculate storage usage for all affected users
      for (const userId of affectedUserIds) {
        try {
          await StorageService.recalculateUsage(userId);
          this.log.debug(`Recalculated storage usage for user ${userId}`);
        } catch (storageError) {
          // Log but don't fail the cleanup for storage recalculation errors
          this.log.error(`Failed to recalculate storage for user ${userId}`, storageError as Error);
        }
      }

      this.log.info('Trash cleanup completed', {
        sessionsDeleted: result.sessionsDeleted,
        eventsDeleted: result.eventsDeleted,
        messagesDeleted: result.messagesDeleted,
        usersAffected: affectedUserIds.size,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = this.getErrorMessage(error);
      result.errors.push(`Cleanup failed: ${errorMsg}`);
      this.log.error('Trash cleanup failed', error as Error);
      return result;
    }
  }
}

export const trashCleanupService = new TrashCleanupService();
