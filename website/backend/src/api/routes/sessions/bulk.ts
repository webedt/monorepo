/**
 * Sessions Bulk Routes
 * Batch operations for managing multiple sessions at once
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, users, eq, and, isNull, isNotNull, inArray, logger, decryptUserFields, executeBatch, sessionSoftDeleteService, LIMITS } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import type { BatchOperationConfig } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { sendBadRequest } from '../../middleware/sessionMiddleware.js';
import { sessionListBroadcaster } from '@webedt/shared';
import { deleteGitHubBranch, archiveClaudeRemoteSession } from './helpers.js';

// Helper type for the database user schema
type DbUser = typeof users.$inferSelect;

// Session type from the database
type ChatSession = typeof chatSessions.$inferSelect;

// Result types for session operations
interface SessionCleanupResult {
  sessionId: string;
  archived?: boolean;
  branchDeleted?: boolean;
  archiveError?: string;
  branchError?: string;
}

interface SessionArchiveResult {
  sessionId: string;
  success: boolean;
  message: string;
}

const router = Router();

// Session operation limits from centralized config
const { CONCURRENCY: DEFAULT_SESSION_CONCURRENCY, MAX_BATCH_SIZE, MAX_ARCHIVE_BATCH_SIZE } = LIMITS.SESSION;

/**
 * Helper to create a session cleanup operation
 */
function createCleanupOperation(
  archiveRemote: boolean,
  deleteGitBranch: boolean,
  claudeAuth: ClaudeAuth | null,
  githubToken?: string,
  environmentId?: string
): (session: ChatSession) => Promise<SessionCleanupResult> {
  return async (session: ChatSession): Promise<SessionCleanupResult> => {
    const result: SessionCleanupResult = { sessionId: session.id };

    // Archive Claude Remote session if requested
    if (archiveRemote && session.remoteSessionId && claudeAuth) {
      try {
        const archiveResult = await archiveClaudeRemoteSession(
          session.remoteSessionId,
          claudeAuth,
          environmentId
        );
        result.archived = archiveResult.success;
        if (!archiveResult.success) {
          result.archiveError = archiveResult.message;
        }
      } catch (error) {
        result.archived = false;
        result.archiveError = (error as Error).message;
      }
    }

    // Delete GitHub branch if requested
    if (deleteGitBranch && githubToken && session.repositoryOwner && session.repositoryName && session.branch) {
      try {
        const branchResult = await deleteGitHubBranch(
          githubToken,
          session.repositoryOwner,
          session.repositoryName,
          session.branch
        );
        result.branchDeleted = branchResult.success;
        if (!branchResult.success) {
          result.branchError = branchResult.message;
        }
      } catch (error) {
        result.branchDeleted = false;
        result.branchError = (error as Error).message;
      }
    }

    return result;
  };
}

/**
 * POST /api/sessions/bulk-delete
 * Soft delete multiple chat sessions (move to trash)
 */
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds, permanent = false, archiveRemote = true, deleteGitBranch = false, githubToken } = req.body as {
      sessionIds: string[];
      permanent?: boolean;
      archiveRemote?: boolean;
      deleteGitBranch?: boolean;
      githubToken?: string;
    };

    // Validate sessionIds
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ success: false, error: 'Session IDs array is required' });
      return;
    }

    // Limit to reasonable batch size
    if (sessionIds.length > MAX_BATCH_SIZE) {
      res.status(400).json({ success: false, error: `Maximum ${MAX_BATCH_SIZE} sessions per batch` });
      return;
    }

    // Verify all sessions belong to this user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, sessionIds),
          eq(chatSessions.userId, authReq.user!.id)
        )
      );

    // Filter out already deleted if doing permanent delete
    const validSessions = permanent
      ? sessions.filter(s => s.deletedAt !== null) // For permanent, must already be soft-deleted
      : sessions.filter(s => s.deletedAt === null); // For soft delete, must not be deleted

    if (validSessions.length === 0) {
      res.status(400).json({
        success: false,
        error: permanent
          ? 'No valid sessions found in trash to permanently delete'
          : 'No valid sessions found to delete'
      });
      return;
    }

    // Get Claude auth from user for archiving
    const decryptedFields = archiveRemote ? decryptUserFields(authReq.user as unknown as Partial<DbUser>) : null;
    const claudeAuth = decryptedFields?.claudeAuth ?? null;

    // Create cleanup operation
    const cleanupOperation = createCleanupOperation(
      archiveRemote,
      deleteGitBranch,
      claudeAuth as ClaudeAuth | null,
      githubToken,
      process.env.CLAUDE_ENVIRONMENT_ID
    );

    // Execute batch cleanup operations with controlled concurrency
    const batchConfig: BatchOperationConfig<ChatSession, SessionCleanupResult> = {
      concurrency: DEFAULT_SESSION_CONCURRENCY,
      maxBatchSize: MAX_BATCH_SIZE,
      operationName: permanent ? 'bulk-permanent-delete' : 'bulk-soft-delete',
      continueOnError: true, // Continue processing even if some cleanup fails
    };

    const batchResult = await executeBatch(validSessions, cleanupOperation, batchConfig);

    // Transform batch results to the expected format
    const results: SessionCleanupResult[] = batchResult.results.map(itemResult => {
      if (itemResult.success && itemResult.result) {
        return itemResult.result;
      }
      // If the batch item itself failed, return error info
      return {
        sessionId: itemResult.item.id,
        archived: false,
        branchDeleted: false,
        archiveError: itemResult.error?.message,
      };
    });

    const deletedIds = validSessions.map(s => s.id);

    if (permanent) {
      // Permanently delete sessions
      await db
        .delete(chatSessions)
        .where(inArray(chatSessions.id, deletedIds));

      logger.info(`Permanently deleted ${deletedIds.length} sessions`, {
        component: 'Sessions',
        userId: authReq.user!.id,
        count: deletedIds.length,
        batchSuccessCount: batchResult.successCount,
        batchFailureCount: batchResult.failureCount,
      });
    } else {
      // Soft delete with cascading to messages and events
      const softDeleteResult = await sessionSoftDeleteService.softDeleteSessions(deletedIds);

      // Notify session list subscribers
      for (const session of validSessions) {
        sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, session.id);
      }

      logger.info(`Soft deleted ${softDeleteResult.successCount} sessions with cascading`, {
        component: 'Sessions',
        userId: authReq.user!.id,
        count: deletedIds.length,
        softDeleteSuccessCount: softDeleteResult.successCount,
        softDeleteFailureCount: softDeleteResult.failureCount,
        batchSuccessCount: batchResult.successCount,
        batchFailureCount: batchResult.failureCount,
      });
    }

    res.json({
      success: true,
      data: {
        deleted: deletedIds.length,
        results,
        permanent,
        batchStats: {
          successCount: batchResult.successCount,
          failureCount: batchResult.failureCount,
          durationMs: batchResult.totalDurationMs,
        },
      }
    });
  } catch (error) {
    logger.error('Bulk delete error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to delete sessions' });
  }
});

/**
 * POST /api/sessions/bulk-restore
 * Restore multiple deleted chat sessions
 */
router.post('/bulk-restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds } = req.body as { sessionIds: string[] };

    // Validate sessionIds
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      res.status(400).json({ success: false, error: 'Session IDs array is required' });
      return;
    }

    // Limit to reasonable batch size
    if (sessionIds.length > MAX_BATCH_SIZE) {
      res.status(400).json({ success: false, error: `Maximum ${MAX_BATCH_SIZE} sessions per batch` });
      return;
    }

    // Find all deleted sessions belonging to this user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, sessionIds),
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid deleted sessions found to restore'
      });
      return;
    }

    const restoredIds = sessions.map(s => s.id);

    // Restore sessions with cascading to messages and events
    const restoreResult = await sessionSoftDeleteService.restoreSessions(restoredIds);

    logger.info(`Restored ${restoreResult.successCount} sessions with cascading`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: restoredIds.length,
      restoreSuccessCount: restoreResult.successCount,
      restoreFailureCount: restoreResult.failureCount,
    });

    res.json({
      success: true,
      data: {
        restored: restoreResult.successCount,
        sessionIds: restoredIds,
        results: restoreResult.results,
      }
    });
  } catch (error) {
    logger.error('Bulk restore error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to restore sessions' });
  }
});

/**
 * DELETE /api/sessions/deleted
 * Empty trash - permanently delete all deleted sessions for a user
 */
router.delete('/deleted', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { archiveRemote = true, deleteGitBranch = false, githubToken } = req.query as {
      archiveRemote?: string;
      deleteGitBranch?: string;
      githubToken?: string;
    };

    const shouldArchiveRemote = archiveRemote !== 'false';
    const shouldDeleteGitBranch = deleteGitBranch === 'true';

    // Get all deleted sessions for this user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length === 0) {
      res.json({
        success: true,
        data: { deleted: 0, message: 'Trash is already empty' }
      });
      return;
    }

    // Get Claude auth from user for archiving
    const decryptedFieldsForArchive = shouldArchiveRemote ? decryptUserFields(authReq.user as unknown as Partial<DbUser>) : null;
    const claudeAuth = decryptedFieldsForArchive?.claudeAuth ?? null;

    // Create cleanup operation
    const cleanupOperation = createCleanupOperation(
      shouldArchiveRemote,
      shouldDeleteGitBranch,
      claudeAuth as ClaudeAuth | null,
      githubToken,
      process.env.CLAUDE_ENVIRONMENT_ID
    );

    // Execute batch cleanup with controlled concurrency
    const batchConfig: BatchOperationConfig<ChatSession, SessionCleanupResult> = {
      concurrency: DEFAULT_SESSION_CONCURRENCY,
      operationName: 'empty-trash',
      continueOnError: true,
    };

    const batchResult = await executeBatch(sessions, cleanupOperation, batchConfig);

    // Transform results
    const results: SessionCleanupResult[] = batchResult.results.map(itemResult => {
      if (itemResult.success && itemResult.result) {
        return itemResult.result;
      }
      return {
        sessionId: itemResult.item.id,
        archived: false,
        branchDeleted: false,
        archiveError: itemResult.error?.message,
      };
    });

    // Permanently delete all trashed sessions
    const deletedIds = sessions.map(s => s.id);
    await db
      .delete(chatSessions)
      .where(inArray(chatSessions.id, deletedIds));

    logger.info(`Emptied trash - permanently deleted ${deletedIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: deletedIds.length,
      batchSuccessCount: batchResult.successCount,
      batchFailureCount: batchResult.failureCount,
    });

    res.json({
      success: true,
      data: {
        deleted: deletedIds.length,
        results,
        batchStats: {
          successCount: batchResult.successCount,
          failureCount: batchResult.failureCount,
          durationMs: batchResult.totalDurationMs,
        },
      }
    });
  } catch (error) {
    logger.error('Empty trash error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to empty trash' });
  }
});

/**
 * POST /api/sessions/bulk-archive-remote
 * Archive Claude Remote sessions (for sessions stored locally but need remote cleanup)
 */
router.post('/bulk-archive-remote', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds, archiveLocal = false } = req.body as {
      sessionIds: string[];
      archiveLocal?: boolean;
    };

    // Validate sessionIds
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      sendBadRequest(res, 'Session IDs array is required');
      return;
    }

    // Limit to reasonable batch size
    if (sessionIds.length > MAX_ARCHIVE_BATCH_SIZE) {
      sendBadRequest(res, `Maximum ${MAX_ARCHIVE_BATCH_SIZE} sessions per batch`);
      return;
    }

    // Get Claude auth from user
    const decryptedFieldsForBulk = decryptUserFields(authReq.user as unknown as Partial<DbUser>);
    const claudeAuth = decryptedFieldsForBulk.claudeAuth ?? null;

    if (!claudeAuth) {
      sendBadRequest(res, 'Claude authentication not configured');
      return;
    }

    // Get sessions that belong to this user and have remote session IDs
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, sessionIds),
          eq(chatSessions.userId, authReq.user!.id),
          isNull(chatSessions.deletedAt)
        )
      );

    // Create archive operation
    const archiveOperation = async (session: ChatSession): Promise<SessionArchiveResult> => {
      if (!session.remoteSessionId) {
        return {
          sessionId: session.id,
          success: false,
          message: 'No remote session ID'
        };
      }

      const archiveResult = await archiveClaudeRemoteSession(
        session.remoteSessionId,
        claudeAuth as ClaudeAuth,
        process.env.CLAUDE_ENVIRONMENT_ID
      );

      // Optionally soft delete the local session too (with cascading)
      if (archiveResult.success && archiveLocal) {
        await sessionSoftDeleteService.softDeleteSession(session.id);
        sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, session.id);
      }

      return {
        sessionId: session.id,
        success: archiveResult.success,
        message: archiveResult.message
      };
    };

    // Execute batch archive with controlled concurrency
    const batchConfig: BatchOperationConfig<ChatSession, SessionArchiveResult> = {
      concurrency: DEFAULT_SESSION_CONCURRENCY,
      maxBatchSize: MAX_ARCHIVE_BATCH_SIZE,
      operationName: 'bulk-archive-remote',
      continueOnError: true,
    };

    const batchResult = await executeBatch(sessions, archiveOperation, batchConfig);

    // Transform results
    const results: SessionArchiveResult[] = batchResult.results.map(itemResult => {
      if (itemResult.success && itemResult.result) {
        return itemResult.result;
      }
      return {
        sessionId: itemResult.item.id,
        success: false,
        message: itemResult.error?.message || 'Unknown error'
      };
    });

    const successCount = results.filter(r => r.success).length;

    logger.info(`Archived ${successCount}/${sessions.length} remote sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      archiveLocal,
      batchSuccessCount: batchResult.successCount,
      batchFailureCount: batchResult.failureCount,
    });

    res.json({
      success: true,
      data: {
        archived: successCount,
        total: sessions.length,
        results,
        batchStats: {
          successCount: batchResult.successCount,
          failureCount: batchResult.failureCount,
          durationMs: batchResult.totalDurationMs,
        },
      }
    });
  } catch (error) {
    logger.error('Bulk archive remote error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to archive remote sessions' });
  }
});

/**
 * POST /api/sessions/bulk-favorite
 * Set favorite status for multiple sessions
 */
router.post('/bulk-favorite', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds, favorite = true } = req.body as {
      sessionIds: string[];
      favorite?: boolean;
    };

    // Validate sessionIds
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
      sendBadRequest(res, 'Session IDs array is required');
      return;
    }

    // Limit to reasonable batch size
    if (sessionIds.length > MAX_BATCH_SIZE) {
      sendBadRequest(res, `Maximum ${MAX_BATCH_SIZE} sessions per batch`);
      return;
    }

    // Verify sessions belong to this user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, sessionIds),
          eq(chatSessions.userId, authReq.user!.id),
          isNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length === 0) {
      sendBadRequest(res, 'No valid sessions found');
      return;
    }

    const validIds = sessions.map(s => s.id);

    // Update favorite status
    await db
      .update(chatSessions)
      .set({ favorite })
      .where(inArray(chatSessions.id, validIds));

    // Notify session list subscribers
    const updatedSessions = await db
      .select()
      .from(chatSessions)
      .where(inArray(chatSessions.id, validIds));

    for (const session of updatedSessions) {
      sessionListBroadcaster.notifySessionUpdated(authReq.user!.id, session);
    }

    logger.info(`Set favorite=${favorite} for ${validIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: validIds.length,
    });

    res.json({
      success: true,
      data: {
        updated: validIds.length,
        favorite,
      }
    });
  } catch (error) {
    logger.error('Bulk favorite error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to update favorite status' });
  }
});

export default router;
