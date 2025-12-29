/**
 * Sessions Bulk Routes
 * Batch operations for managing multiple sessions at once
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, users, eq, and, or, isNull, isNotNull, inArray, ServiceProvider, ASessionQueryService, logger, decryptUserFields } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { sendBadRequest } from '../../middleware/sessionMiddleware.js';
import { sessionListBroadcaster } from '@webedt/shared';
import { deleteGitHubBranch, archiveClaudeRemoteSession } from './helpers.js';

// Helper type for the database user schema
type DbUser = typeof users.$inferSelect;

const router = Router();

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
    if (sessionIds.length > 100) {
      res.status(400).json({ success: false, error: 'Maximum 100 sessions per batch' });
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

    const deletedIds = validSessions.map(s => s.id);
    const results: { sessionId: string; archived?: boolean; branchDeleted?: boolean; error?: string }[] = [];

    // Get Claude auth from user for archiving
    const decryptedFields = archiveRemote ? decryptUserFields(authReq.user as unknown as Partial<DbUser>) : null;
    const claudeAuth = decryptedFields?.claudeAuth ?? null;

    // Process each session for cleanup operations
    for (const session of validSessions) {
      const result: { sessionId: string; archived?: boolean; branchDeleted?: boolean; error?: string } = { sessionId: session.id };

      try {
        // Archive Claude Remote session if requested
        if (archiveRemote && session.remoteSessionId && claudeAuth) {
          const archiveResult = await archiveClaudeRemoteSession(
            session.remoteSessionId,
            claudeAuth as ClaudeAuth,
            process.env.CLAUDE_ENVIRONMENT_ID
          );
          result.archived = archiveResult.success;
          if (!archiveResult.success) {
            logger.warn(`Failed to archive remote session: ${archiveResult.message}`, {
              component: 'Sessions',
              sessionId: session.id,
              remoteSessionId: session.remoteSessionId
            });
          }
        }

        // Delete GitHub branch if requested
        if (deleteGitBranch && githubToken && session.repositoryOwner && session.repositoryName && session.branch) {
          const branchResult = await deleteGitHubBranch(
            githubToken,
            session.repositoryOwner,
            session.repositoryName,
            session.branch
          );
          result.branchDeleted = branchResult.success;
          if (!branchResult.success) {
            logger.warn(`Failed to delete branch: ${branchResult.message}`, {
              component: 'Sessions',
              sessionId: session.id,
              branch: session.branch
            });
          }
        }
      } catch (error) {
        result.error = (error as Error).message;
        logger.error(`Error processing session cleanup`, error as Error, {
          component: 'Sessions',
          sessionId: session.id
        });
      }

      results.push(result);
    }

    if (permanent) {
      // Permanently delete sessions
      await db
        .delete(chatSessions)
        .where(inArray(chatSessions.id, deletedIds));

      logger.info(`Permanently deleted ${deletedIds.length} sessions`, {
        component: 'Sessions',
        userId: authReq.user!.id,
        count: deletedIds.length,
      });
    } else {
      // Soft delete - set deletedAt
      await db
        .update(chatSessions)
        .set({ deletedAt: new Date() })
        .where(inArray(chatSessions.id, deletedIds));

      // Notify session list subscribers
      for (const session of validSessions) {
        sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, session.id);
      }

      logger.info(`Soft deleted ${deletedIds.length} sessions`, {
        component: 'Sessions',
        userId: authReq.user!.id,
        count: deletedIds.length,
      });
    }

    res.json({
      success: true,
      data: {
        deleted: deletedIds.length,
        results,
        permanent,
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
    if (sessionIds.length > 100) {
      res.status(400).json({ success: false, error: 'Maximum 100 sessions per batch' });
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

    // Restore sessions
    await db
      .update(chatSessions)
      .set({ deletedAt: null })
      .where(inArray(chatSessions.id, restoredIds));

    logger.info(`Restored ${restoredIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: restoredIds.length,
    });

    res.json({
      success: true,
      data: {
        restored: restoredIds.length,
        sessionIds: restoredIds,
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

    const results: { sessionId: string; archived?: boolean; branchDeleted?: boolean; error?: string }[] = [];

    // Get Claude auth from user for archiving
    const decryptedFieldsForArchive = shouldArchiveRemote ? decryptUserFields(authReq.user as unknown as Partial<DbUser>) : null;
    const claudeAuth = decryptedFieldsForArchive?.claudeAuth ?? null;

    // Process each session for cleanup operations
    for (const session of sessions) {
      const result: { sessionId: string; archived?: boolean; branchDeleted?: boolean; error?: string } = { sessionId: session.id };

      try {
        // Archive Claude Remote session if requested
        if (shouldArchiveRemote && session.remoteSessionId && claudeAuth) {
          const archiveResult = await archiveClaudeRemoteSession(
            session.remoteSessionId,
            claudeAuth as ClaudeAuth,
            process.env.CLAUDE_ENVIRONMENT_ID
          );
          result.archived = archiveResult.success;
        }

        // Delete GitHub branch if requested
        if (shouldDeleteGitBranch && githubToken && session.repositoryOwner && session.repositoryName && session.branch) {
          const branchResult = await deleteGitHubBranch(
            githubToken,
            session.repositoryOwner,
            session.repositoryName,
            session.branch
          );
          result.branchDeleted = branchResult.success;
        }
      } catch (error) {
        result.error = (error as Error).message;
      }

      results.push(result);
    }

    // Permanently delete all trashed sessions
    const deletedIds = sessions.map(s => s.id);
    await db
      .delete(chatSessions)
      .where(inArray(chatSessions.id, deletedIds));

    logger.info(`Emptied trash - permanently deleted ${deletedIds.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      count: deletedIds.length,
    });

    res.json({
      success: true,
      data: {
        deleted: deletedIds.length,
        results,
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
    if (sessionIds.length > 50) {
      sendBadRequest(res, 'Maximum 50 sessions per batch');
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

    const results: { sessionId: string; success: boolean; message: string }[] = [];

    for (const session of sessions) {
      if (!session.remoteSessionId) {
        results.push({
          sessionId: session.id,
          success: false,
          message: 'No remote session ID'
        });
        continue;
      }

      const archiveResult = await archiveClaudeRemoteSession(
        session.remoteSessionId,
        claudeAuth as ClaudeAuth,
        process.env.CLAUDE_ENVIRONMENT_ID
      );

      results.push({
        sessionId: session.id,
        success: archiveResult.success,
        message: archiveResult.message
      });

      // Optionally soft delete the local session too
      if (archiveResult.success && archiveLocal) {
        await db
          .update(chatSessions)
          .set({ deletedAt: new Date() })
          .where(eq(chatSessions.id, session.id));

        sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, session.id);
      }
    }

    const successCount = results.filter(r => r.success).length;

    logger.info(`Archived ${successCount}/${sessions.length} remote sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      archiveLocal,
    });

    res.json({
      success: true,
      data: {
        archived: successCount,
        total: sessions.length,
        results,
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
    if (sessionIds.length > 100) {
      sendBadRequest(res, 'Maximum 100 sessions per batch');
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
