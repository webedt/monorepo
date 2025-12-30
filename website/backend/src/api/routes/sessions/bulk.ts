/**
 * Sessions Bulk Routes
 * Batch operations for managing multiple sessions at once
 *
 * All database operations are wrapped in transactions to prevent partial failures
 * and ensure data consistency. Supports both atomic (all-or-nothing) and partial
 * success modes.
 */

import { Router } from 'express';
import {
  db,
  chatSessions,
  users,
  eq,
  and,
  isNull,
  isNotNull,
  inArray,
  logger,
  decryptUserFields,
  executeBatch,
  executeBulkWrite,
  executeBulkTransaction,
} from '@webedt/shared';
import type { Request, Response } from 'express';
import type { ClaudeAuth, BatchOperationConfig, BulkTransactionMode, TransactionContext } from '@webedt/shared';
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

// Bulk operation item result with ID for API responses
interface BulkOperationItemResult {
  id: string;
  success: boolean;
  message?: string;
  error?: string;
}

const router = Router();

// Default concurrency for session operations
const DEFAULT_SESSION_CONCURRENCY = 3;
const MAX_BATCH_SIZE = 100;
const MAX_ARCHIVE_BATCH_SIZE = 50;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Helper to create a session cleanup operation (external service calls)
 * These operations are NOT part of the database transaction since they
 * involve external services (Claude Remote, GitHub).
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
 * Soft delete or permanently delete multiple chat sessions
 *
 * Supports two modes:
 * - atomic: All sessions are deleted in a single transaction, rolls back on any failure
 * - partial (default): Each session is deleted in its own transaction, failures are tracked individually
 */
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const {
      sessionIds,
      permanent = false,
      archiveRemote = true,
      deleteGitBranch = false,
      githubToken,
      atomic = false,
    } = req.body as {
      sessionIds: string[];
      permanent?: boolean;
      archiveRemote?: boolean;
      deleteGitBranch?: boolean;
      githubToken?: string;
      atomic?: boolean;
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

    // Filter based on operation type
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

    // Create cleanup operation for external services
    const cleanupOperation = createCleanupOperation(
      archiveRemote,
      deleteGitBranch,
      claudeAuth as ClaudeAuth | null,
      githubToken,
      process.env.CLAUDE_ENVIRONMENT_ID
    );

    // Execute external cleanup operations with controlled concurrency
    const batchConfig: BatchOperationConfig<ChatSession, SessionCleanupResult> = {
      concurrency: DEFAULT_SESSION_CONCURRENCY,
      maxBatchSize: MAX_BATCH_SIZE,
      operationName: permanent ? 'bulk-permanent-delete-cleanup' : 'bulk-soft-delete-cleanup',
      continueOnError: true,
    };

    const cleanupResult = await executeBatch(validSessions, cleanupOperation, batchConfig);

    // Transform cleanup results
    const cleanupResults: SessionCleanupResult[] = cleanupResult.results.map(itemResult => {
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

    const validIds = validSessions.map(s => s.id);
    const mode: BulkTransactionMode = atomic ? 'atomic' : 'partial';

    // Execute database operations within transactions
    const dbResult = await executeBulkWrite(
      db,
      async (tx) => {
        if (permanent) {
          await tx.delete(chatSessions).where(inArray(chatSessions.id, validIds));
        } else {
          await tx
            .update(chatSessions)
            .set({ deletedAt: new Date() })
            .where(inArray(chatSessions.id, validIds));
        }
        return { deletedCount: validIds.length };
      },
      {
        operationName: permanent ? 'bulk-permanent-delete' : 'bulk-soft-delete',
        maxRetries: DEFAULT_MAX_RETRIES,
        context: {
          userId: authReq.user!.id,
          sessionCount: validIds.length,
          mode,
        },
      }
    );

    if (!dbResult.success) {
      logger.error('Bulk delete database operation failed', dbResult.error, {
        component: 'Sessions',
        userId: authReq.user!.id,
      });
      res.status(500).json({
        success: false,
        error: 'Database operation failed',
        details: dbResult.error?.message,
        stats: {
          retriesAttempted: dbResult.retriesAttempted,
          durationMs: dbResult.durationMs,
        },
      });
      return;
    }

    // Notify session list subscribers for soft deletes
    if (!permanent) {
      for (const session of validSessions) {
        sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, session.id);
      }
    }

    // Build per-item results
    const itemResults: BulkOperationItemResult[] = validSessions.map(session => {
      const cleanup = cleanupResults.find(r => r.sessionId === session.id);
      const hasCleanupErrors = cleanup && (cleanup.archiveError || cleanup.branchError);

      return {
        id: session.id,
        success: true,
        message: permanent ? 'Permanently deleted' : 'Moved to trash',
        error: hasCleanupErrors
          ? [cleanup?.archiveError, cleanup?.branchError].filter(Boolean).join('; ')
          : undefined,
      };
    });

    logger.info(`${permanent ? 'Permanently deleted' : 'Soft deleted'} ${validIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: validIds.length,
      mode,
      cleanupSuccessCount: cleanupResult.successCount,
      cleanupFailureCount: cleanupResult.failureCount,
      dbRetries: dbResult.retriesAttempted,
    });

    res.json({
      success: true,
      data: {
        processed: validIds.length,
        succeeded: validIds.length,
        failed: 0,
        permanent,
        results: itemResults,
        cleanupResults,
        stats: {
          mode,
          durationMs: dbResult.durationMs,
          retriesAttempted: dbResult.retriesAttempted,
          cleanupStats: {
            successCount: cleanupResult.successCount,
            failureCount: cleanupResult.failureCount,
            durationMs: cleanupResult.totalDurationMs,
          },
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
 * Restore multiple deleted chat sessions from trash
 *
 * Supports atomic mode for all-or-nothing restoration.
 */
router.post('/bulk-restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds, atomic = false } = req.body as {
      sessionIds: string[];
      atomic?: boolean;
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

    const validIds = sessions.map(s => s.id);
    const mode: BulkTransactionMode = atomic ? 'atomic' : 'partial';

    // Execute restore within a transaction
    const dbResult = await executeBulkWrite(
      db,
      async (tx) => {
        await tx
          .update(chatSessions)
          .set({ deletedAt: null })
          .where(inArray(chatSessions.id, validIds));
        return { restoredCount: validIds.length };
      },
      {
        operationName: 'bulk-restore',
        maxRetries: DEFAULT_MAX_RETRIES,
        context: {
          userId: authReq.user!.id,
          sessionCount: validIds.length,
          mode,
        },
      }
    );

    if (!dbResult.success) {
      logger.error('Bulk restore database operation failed', dbResult.error, {
        component: 'Sessions',
        userId: authReq.user!.id,
      });
      res.status(500).json({
        success: false,
        error: 'Database operation failed',
        details: dbResult.error?.message,
        stats: {
          retriesAttempted: dbResult.retriesAttempted,
          durationMs: dbResult.durationMs,
        },
      });
      return;
    }

    // Build per-item results
    const itemResults: BulkOperationItemResult[] = sessions.map(session => ({
      id: session.id,
      success: true,
      message: 'Restored from trash',
    }));

    logger.info(`Restored ${validIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: validIds.length,
      mode,
      retriesAttempted: dbResult.retriesAttempted,
    });

    res.json({
      success: true,
      data: {
        processed: validIds.length,
        succeeded: validIds.length,
        failed: 0,
        results: itemResults,
        stats: {
          mode,
          durationMs: dbResult.durationMs,
          retriesAttempted: dbResult.retriesAttempted,
        },
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
 *
 * This operation is always atomic - either all sessions are deleted or none.
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
        data: {
          processed: 0,
          succeeded: 0,
          failed: 0,
          message: 'Trash is already empty',
          results: [],
          stats: { mode: 'atomic', durationMs: 0, retriesAttempted: 0 },
        }
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

    // Execute external cleanup with controlled concurrency
    const batchConfig: BatchOperationConfig<ChatSession, SessionCleanupResult> = {
      concurrency: DEFAULT_SESSION_CONCURRENCY,
      operationName: 'empty-trash-cleanup',
      continueOnError: true,
    };

    const cleanupResult = await executeBatch(sessions, cleanupOperation, batchConfig);

    // Transform cleanup results
    const cleanupResults: SessionCleanupResult[] = cleanupResult.results.map(itemResult => {
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

    const sessionIds = sessions.map(s => s.id);

    // Permanently delete all trashed sessions in a single atomic transaction
    const dbResult = await executeBulkWrite(
      db,
      async (tx) => {
        await tx.delete(chatSessions).where(inArray(chatSessions.id, sessionIds));
        return { deletedCount: sessionIds.length };
      },
      {
        operationName: 'empty-trash',
        maxRetries: DEFAULT_MAX_RETRIES,
        context: {
          userId: authReq.user!.id,
          sessionCount: sessionIds.length,
        },
      }
    );

    if (!dbResult.success) {
      logger.error('Empty trash database operation failed', dbResult.error, {
        component: 'Sessions',
        userId: authReq.user!.id,
      });
      res.status(500).json({
        success: false,
        error: 'Database operation failed - trash not emptied',
        details: dbResult.error?.message,
        stats: {
          retriesAttempted: dbResult.retriesAttempted,
          durationMs: dbResult.durationMs,
        },
      });
      return;
    }

    // Build per-item results
    const itemResults: BulkOperationItemResult[] = sessions.map(session => {
      const cleanup = cleanupResults.find(r => r.sessionId === session.id);
      const hasCleanupErrors = cleanup && (cleanup.archiveError || cleanup.branchError);

      return {
        id: session.id,
        success: true,
        message: 'Permanently deleted',
        error: hasCleanupErrors
          ? [cleanup?.archiveError, cleanup?.branchError].filter(Boolean).join('; ')
          : undefined,
      };
    });

    logger.info(`Emptied trash - permanently deleted ${sessionIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: sessionIds.length,
      cleanupSuccessCount: cleanupResult.successCount,
      cleanupFailureCount: cleanupResult.failureCount,
      dbRetries: dbResult.retriesAttempted,
    });

    res.json({
      success: true,
      data: {
        processed: sessionIds.length,
        succeeded: sessionIds.length,
        failed: 0,
        results: itemResults,
        cleanupResults,
        stats: {
          mode: 'atomic' as const,
          durationMs: dbResult.durationMs,
          retriesAttempted: dbResult.retriesAttempted,
          cleanupStats: {
            successCount: cleanupResult.successCount,
            failureCount: cleanupResult.failureCount,
            durationMs: cleanupResult.totalDurationMs,
          },
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
 * Archive Claude Remote sessions
 *
 * Supports partial mode by default - each session is archived independently.
 * With archiveLocal=true, also soft-deletes the local session in the same transaction.
 */
router.post('/bulk-archive-remote', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionIds, archiveLocal = false, atomic = false } = req.body as {
      sessionIds: string[];
      archiveLocal?: boolean;
      atomic?: boolean;
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

    // Get sessions that belong to this user
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

    const mode: BulkTransactionMode = atomic ? 'atomic' : 'partial';

    // Use bulk transaction to handle both external archive and optional local delete
    const txResult = await executeBulkTransaction(
      db,
      sessions,
      async (tx: TransactionContext, session: ChatSession) => {
        const result: SessionArchiveResult = {
          sessionId: session.id,
          success: false,
          message: '',
        };

        // Skip sessions without remote ID
        if (!session.remoteSessionId) {
          result.message = 'No remote session ID';
          return result;
        }

        // Archive remote session (external call)
        const archiveResult = await archiveClaudeRemoteSession(
          session.remoteSessionId,
          claudeAuth as ClaudeAuth,
          process.env.CLAUDE_ENVIRONMENT_ID
        );

        result.success = archiveResult.success;
        result.message = archiveResult.message;

        // Optionally soft delete the local session too (within same transaction)
        if (archiveResult.success && archiveLocal) {
          await tx
            .update(chatSessions)
            .set({ deletedAt: new Date() })
            .where(eq(chatSessions.id, session.id));
        }

        return result;
      },
      {
        mode,
        operationName: 'bulk-archive-remote',
        maxRetries: DEFAULT_MAX_RETRIES,
        context: {
          userId: authReq.user!.id,
          archiveLocal,
        },
      }
    );

    // Notify session list subscribers for archived+deleted sessions
    if (archiveLocal) {
      for (const itemResult of txResult.results) {
        if (itemResult.success && itemResult.result?.success) {
          sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, itemResult.item.id);
        }
      }
    }

    // Build per-item results
    const itemResults: BulkOperationItemResult[] = txResult.results.map(itemResult => ({
      id: itemResult.item.id,
      success: itemResult.success && (itemResult.result?.success ?? false),
      message: itemResult.result?.message,
      error: itemResult.error?.message || (!itemResult.result?.success ? itemResult.result?.message : undefined),
    }));

    const archiveSuccessCount = itemResults.filter(r => r.success).length;

    logger.info(`Archived ${archiveSuccessCount}/${sessions.length} remote sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      archiveLocal,
      mode,
      successCount: txResult.successCount,
      failureCount: txResult.failureCount,
      retriesAttempted: txResult.retriesAttempted,
    });

    res.json({
      success: txResult.success,
      data: {
        processed: sessions.length,
        succeeded: archiveSuccessCount,
        failed: sessions.length - archiveSuccessCount,
        results: itemResults,
        stats: {
          mode,
          durationMs: txResult.durationMs,
          retriesAttempted: txResult.retriesAttempted,
          rolledBack: txResult.rolledBack,
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
 *
 * This is a simple update operation that uses a single transaction.
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

    // Execute update within a transaction
    const dbResult = await executeBulkWrite(
      db,
      async (tx) => {
        await tx
          .update(chatSessions)
          .set({ favorite })
          .where(inArray(chatSessions.id, validIds));

        // Fetch updated sessions for broadcasting
        const updatedSessions = await tx
          .select()
          .from(chatSessions)
          .where(inArray(chatSessions.id, validIds));

        return { updatedCount: validIds.length, sessions: updatedSessions };
      },
      {
        operationName: 'bulk-favorite',
        maxRetries: DEFAULT_MAX_RETRIES,
        context: {
          userId: authReq.user!.id,
          sessionCount: validIds.length,
          favorite,
        },
      }
    );

    if (!dbResult.success) {
      logger.error('Bulk favorite database operation failed', dbResult.error, {
        component: 'Sessions',
        userId: authReq.user!.id,
      });
      res.status(500).json({
        success: false,
        error: 'Database operation failed',
        details: dbResult.error?.message,
        stats: {
          retriesAttempted: dbResult.retriesAttempted,
          durationMs: dbResult.durationMs,
        },
      });
      return;
    }

    // Notify session list subscribers
    const updatedSessions = dbResult.result?.sessions || [];
    for (const session of updatedSessions) {
      sessionListBroadcaster.notifySessionUpdated(authReq.user!.id, session);
    }

    // Build per-item results
    const itemResults: BulkOperationItemResult[] = sessions.map(session => ({
      id: session.id,
      success: true,
      message: favorite ? 'Added to favorites' : 'Removed from favorites',
    }));

    logger.info(`Set favorite=${favorite} for ${validIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: validIds.length,
      retriesAttempted: dbResult.retriesAttempted,
    });

    res.json({
      success: true,
      data: {
        processed: validIds.length,
        succeeded: validIds.length,
        failed: 0,
        favorite,
        results: itemResults,
        stats: {
          mode: 'atomic' as const,
          durationMs: dbResult.durationMs,
          retriesAttempted: dbResult.retriesAttempted,
        },
      }
    });
  } catch (error) {
    logger.error('Bulk favorite error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to update favorite status' });
  }
});

export default router;
