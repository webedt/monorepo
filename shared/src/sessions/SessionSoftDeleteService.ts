import { db, chatSessions, events, messages } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { BaseService } from '../services/BaseService.js';

import { ASessionSoftDeleteService } from './ASessionSoftDeleteService.js';

import type {
  SoftDeleteResult,
  RestoreResult,
  BulkSoftDeleteResult,
  BulkRestoreResult,
} from './ASessionSoftDeleteService.js';

export class SessionSoftDeleteService extends BaseService(ASessionSoftDeleteService) {
  async softDeleteSession(
    sessionId: string
  ): Promise<SoftDeleteResult> {
    try {
      const now = new Date();

      const result = await this.withTransaction(async (tx) => {
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

      this.log.debug(`Soft deleted session ${sessionId} with ${result.messagesDeleted} messages and ${result.eventsDeleted} events`, {
        sessionId,
      });

      return {
        sessionId,
        success: true,
        messagesDeleted: result.messagesDeleted,
        eventsDeleted: result.eventsDeleted,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.log.error(`Failed to soft delete session ${sessionId}`, error);
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
    const bulkResult = await this.executeBulkOperation(
      sessionIds,
      (id) => this.softDeleteSession(id),
      { operationName: 'soft delete' }
    );

    return {
      successCount: bulkResult.successCount,
      failureCount: bulkResult.failureCount,
      results: bulkResult.results,
    };
  }

  async restoreSession(
    sessionId: string
  ): Promise<RestoreResult> {
    try {
      const result = await this.withTransaction(async (tx) => {
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

        // Restore all messages associated with this session
        const restoredMessages = await tx
          .update(messages)
          .set({ deletedAt: null })
          .where(eq(messages.chatSessionId, sessionId))
          .returning({ id: messages.id });

        // Restore all events associated with this session
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

      this.log.debug(`Restored session ${sessionId} with ${result.messagesRestored} messages and ${result.eventsRestored} events`, {
        sessionId,
      });

      return {
        sessionId,
        success: true,
        messagesRestored: result.messagesRestored,
        eventsRestored: result.eventsRestored,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.log.error(`Failed to restore session ${sessionId}`, error);
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
    const bulkResult = await this.executeBulkOperation(
      sessionIds,
      (id) => this.restoreSession(id),
      { operationName: 'restore' }
    );

    return {
      successCount: bulkResult.successCount,
      failureCount: bulkResult.failureCount,
      results: bulkResult.results,
    };
  }

  async initialize(): Promise<void> {
    // No initialization needed
  }

  // dispose() inherited from BaseService - handles shutdown handlers automatically
}

export const sessionSoftDeleteService = new SessionSoftDeleteService();
