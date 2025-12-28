import { db, chatSessions, events, messages } from '../db/index.js';
import { eq, lt, and, isNotNull } from 'drizzle-orm';
import { logger } from '../utils/logging/logger.js';
import {
  TRASH_CLEANUP_ENABLED,
  TRASH_CLEANUP_INTERVAL_MS,
  TRASH_CLEANUP_INITIAL_DELAY_MS,
  TRASH_RETENTION_DAYS,
} from '../config/index.js';

import { ATrashCleanupService } from './ATrashCleanupService.js';

import type { TrashCleanupResult, TrashCleanupSession } from './ATrashCleanupService.js';

export class TrashCleanupService extends ATrashCleanupService {
  private cleanupIntervalId: NodeJS.Timeout | null = null;

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

  async deleteSessionPermanently(
    sessionId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Delete events first (foreign key constraint)
      const deletedEvents = await db
        .delete(events)
        .where(eq(events.chatSessionId, sessionId))
        .returning();

      // Delete messages
      const deletedMessages = await db
        .delete(messages)
        .where(eq(messages.chatSessionId, sessionId))
        .returning();

      // Delete the session
      await db
        .delete(chatSessions)
        .where(eq(chatSessions.id, sessionId));

      return {
        success: true,
        message: `Deleted session with ${deletedEvents.length} events and ${deletedMessages.length} messages`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to permanently delete session ${sessionId}`, error as Error, {
        component: 'TrashCleanupService',
      });
      return {
        success: false,
        message: errorMessage,
      };
    }
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

    logger.info(`Starting trash cleanup (retention: ${retentionDays} days)`, {
      component: 'TrashCleanupService',
    });

    try {
      const expiredSessions = await this.getExpiredTrashSessions(retentionDays);

      if (expiredSessions.length === 0) {
        logger.info('No expired trash sessions found', {
          component: 'TrashCleanupService',
        });
        return result;
      }

      logger.info(`Found ${expiredSessions.length} expired trash sessions to clean up`, {
        component: 'TrashCleanupService',
      });

      for (const session of expiredSessions) {
        try {
          // Count events and messages before deletion
          const eventCount = await db
            .select({ id: events.id })
            .from(events)
            .where(eq(events.chatSessionId, session.id));

          const messageCount = await db
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.chatSessionId, session.id));

          const deleteResult = await this.deleteSessionPermanently(session.id);

          if (deleteResult.success) {
            result.sessionsDeleted++;
            result.eventsDeleted += eventCount.length;
            result.messagesDeleted += messageCount.length;

            logger.info(`Cleaned up expired trash session ${session.id}`, {
              component: 'TrashCleanupService',
              sessionId: session.id,
              userId: session.userId,
              deletedAt: session.deletedAt.toISOString(),
              eventsDeleted: eventCount.length,
              messagesDeleted: messageCount.length,
            });
          } else {
            result.errors.push(`Session ${session.id}: ${deleteResult.message}`);
          }
        } catch (sessionError) {
          const errorMsg = sessionError instanceof Error ? sessionError.message : 'Unknown error';
          result.errors.push(`Session ${session.id}: ${errorMsg}`);
          logger.error(`Error cleaning up session ${session.id}`, sessionError as Error, {
            component: 'TrashCleanupService',
          });
        }
      }

      logger.info('Trash cleanup completed', {
        component: 'TrashCleanupService',
        sessionsDeleted: result.sessionsDeleted,
        eventsDeleted: result.eventsDeleted,
        messagesDeleted: result.messagesDeleted,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Cleanup failed: ${errorMsg}`);
      logger.error('Trash cleanup failed', error as Error, {
        component: 'TrashCleanupService',
      });
      return result;
    }
  }

  startScheduledCleanup(): void {
    if (!TRASH_CLEANUP_ENABLED) {
      logger.info('Trash cleanup is disabled', {
        component: 'TrashCleanupService',
      });
      return;
    }

    if (this.cleanupIntervalId) {
      logger.warn('Trash cleanup scheduler already running', {
        component: 'TrashCleanupService',
      });
      return;
    }

    logger.info('Starting trash cleanup scheduler', {
      component: 'TrashCleanupService',
      intervalMs: TRASH_CLEANUP_INTERVAL_MS,
      initialDelayMs: TRASH_CLEANUP_INITIAL_DELAY_MS,
      retentionDays: TRASH_RETENTION_DAYS,
    });

    // Initial cleanup after delay
    setTimeout(async () => {
      await this.cleanupExpiredTrash(TRASH_RETENTION_DAYS);
    }, TRASH_CLEANUP_INITIAL_DELAY_MS);

    // Schedule periodic cleanup
    this.cleanupIntervalId = setInterval(async () => {
      await this.cleanupExpiredTrash(TRASH_RETENTION_DAYS);
    }, TRASH_CLEANUP_INTERVAL_MS);
  }

  stopScheduledCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.info('Trash cleanup scheduler stopped', {
        component: 'TrashCleanupService',
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

export const trashCleanupService = new TrashCleanupService();
