import { db, chatSessions, events, messages, withTransactionOrThrow } from '../db/index.js';
import type { TransactionContext } from '../db/index.js';
import { eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { logger } from '../utils/logging/logger.js';

import { ASessionSoftDeleteService } from './ASessionSoftDeleteService.js';

import type {
  SoftDeleteResult,
  RestoreResult,
  BulkSoftDeleteResult,
  BulkRestoreResult,
} from './ASessionSoftDeleteService.js';

export class SessionSoftDeleteService extends ASessionSoftDeleteService {
  async softDeleteSession(
    sessionId: string
  ): Promise<SoftDeleteResult> {
    try {
      const now = new Date();

      const result = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
        // First verify the session exists and is not already deleted
        const [session] = await tx
          .select({ id: chatSessions.id, deletedAt: chatSessions.deletedAt })
          .from(chatSessions)
          .where(eq(chatSessions.id, sessionId))
          .limit(1);

        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }

        if (session.deletedAt !== null) {
          throw new Error(`Session ${sessionId} is already deleted`);
        }

        // Soft delete the session
        await tx
          .update(chatSessions)
          .set({ deletedAt: now })
          .where(eq(chatSessions.id, sessionId));

        // Cascade soft delete to messages
        const deletedMessages = await tx
          .update(messages)
          .set({ deletedAt: now })
          .where(eq(messages.chatSessionId, sessionId))
          .returning({ id: messages.id });

        // Cascade soft delete to events
        const deletedEvents = await tx
          .update(events)
          .set({ deletedAt: now })
          .where(eq(events.chatSessionId, sessionId))
          .returning({ id: events.id });

        return {
          messagesDeleted: deletedMessages.length,
          eventsDeleted: deletedEvents.length,
        };
      }, {
        context: { operation: 'softDeleteSession', sessionId },
      });

      logger.debug(`Soft deleted session ${sessionId} with ${result.messagesDeleted} messages and ${result.eventsDeleted} events`, {
        component: 'SessionSoftDeleteService',
        sessionId,
      });

      return {
        sessionId,
        success: true,
        messagesDeleted: result.messagesDeleted,
        eventsDeleted: result.eventsDeleted,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to soft delete session ${sessionId}`, error as Error, {
        component: 'SessionSoftDeleteService',
      });
      return {
        sessionId,
        success: false,
        messagesDeleted: 0,
        eventsDeleted: 0,
        error: errorMessage,
      };
    }
  }

  async softDeleteSessions(
    sessionIds: string[]
  ): Promise<BulkSoftDeleteResult> {
    if (sessionIds.length === 0) {
      return { successCount: 0, failureCount: 0, results: [] };
    }

    const results: SoftDeleteResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each session individually to handle errors gracefully
    for (const sessionId of sessionIds) {
      const result = await this.softDeleteSession(sessionId);
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    logger.info(`Bulk soft delete completed: ${successCount} succeeded, ${failureCount} failed`, {
      component: 'SessionSoftDeleteService',
      total: sessionIds.length,
    });

    return { successCount, failureCount, results };
  }

  async restoreSession(
    sessionId: string
  ): Promise<RestoreResult> {
    try {
      const result = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
        // First verify the session exists and is deleted
        const [session] = await tx
          .select({ id: chatSessions.id, deletedAt: chatSessions.deletedAt })
          .from(chatSessions)
          .where(eq(chatSessions.id, sessionId))
          .limit(1);

        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }

        if (session.deletedAt === null) {
          throw new Error(`Session ${sessionId} is not deleted`);
        }

        // Restore the session
        await tx
          .update(chatSessions)
          .set({ deletedAt: null })
          .where(eq(chatSessions.id, sessionId));

        // Restore messages (only those that were soft-deleted)
        const restoredMessages = await tx
          .update(messages)
          .set({ deletedAt: null })
          .where(eq(messages.chatSessionId, sessionId))
          .returning({ id: messages.id });

        // Restore events (only those that were soft-deleted)
        const restoredEvents = await tx
          .update(events)
          .set({ deletedAt: null })
          .where(eq(events.chatSessionId, sessionId))
          .returning({ id: events.id });

        return {
          messagesRestored: restoredMessages.length,
          eventsRestored: restoredEvents.length,
        };
      }, {
        context: { operation: 'restoreSession', sessionId },
      });

      logger.debug(`Restored session ${sessionId} with ${result.messagesRestored} messages and ${result.eventsRestored} events`, {
        component: 'SessionSoftDeleteService',
        sessionId,
      });

      return {
        sessionId,
        success: true,
        messagesRestored: result.messagesRestored,
        eventsRestored: result.eventsRestored,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to restore session ${sessionId}`, error as Error, {
        component: 'SessionSoftDeleteService',
      });
      return {
        sessionId,
        success: false,
        messagesRestored: 0,
        eventsRestored: 0,
        error: errorMessage,
      };
    }
  }

  async restoreSessions(
    sessionIds: string[]
  ): Promise<BulkRestoreResult> {
    if (sessionIds.length === 0) {
      return { successCount: 0, failureCount: 0, results: [] };
    }

    const results: RestoreResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process each session individually to handle errors gracefully
    for (const sessionId of sessionIds) {
      const result = await this.restoreSession(sessionId);
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    logger.info(`Bulk restore completed: ${successCount} succeeded, ${failureCount} failed`, {
      component: 'SessionSoftDeleteService',
      total: sessionIds.length,
    });

    return { successCount, failureCount, results };
  }

  async initialize(): Promise<void> {
    // No initialization needed
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}

export const sessionSoftDeleteService = new SessionSoftDeleteService();
