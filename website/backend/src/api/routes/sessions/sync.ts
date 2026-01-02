/**
 * Sessions Sync Routes
 * Endpoints for syncing sessions with Claude Remote API
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, users, events, eq, and, isNull, sql, logger, syncUserSessions, ServiceProvider, ASession, CLAUDE_ENVIRONMENT_ID, requestDeduplicatorRegistry, generateRequestKey, DEDUPLICATION } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { sendUnauthorized } from '../../middleware/sessionMiddleware.js';
import { syncOperationRateLimiter } from '../../middleware/rateLimit.js';

const router = Router();

/**
 * POST /api/sessions/sync
 * Sync sessions from Anthropic's Claude Remote API
 *
 * This endpoint uses syncUserSessions from the shared package which provides:
 * - Sophisticated duplicate prevention (branch matching, time window matching, sessionPath matching)
 * - Running session status updates
 * - Event deduplication and import
 * - Cleanup of redundant pending sessions
 * - Session list broadcaster notifications
 *
 * The shared sync logic handles:
 * 1. Checking and updating running sessions that may have completed
 * 2. Importing new sessions with duplicate prevention
 * 3. Linking existing local sessions to remote sessions
 * 4. Cleaning up orphaned pending sessions
 *
 * Query params (for backward compatibility, logged but not all are used by shared sync):
 * - activeOnly: boolean (default: true) - Note: shared sync skips archived sessions by default
 * - stream: boolean (default: false) - Note: streaming should use /events/stream endpoint
 * - limit: number (default: 50) - Note: shared sync uses CLAUDE_SYNC_LIMIT from env
 */
// Rate limited to prevent excessive sync requests to Claude Remote API (5/min per user)
router.post('/sync', requireAuth, syncOperationRateLimiter, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendUnauthorized(res, 'Not authenticated');
    return;
  }

  // Parse query params for backward compatibility (logged for debugging)
  // Prefixed with underscore as they are intentionally unused by shared sync
  const _activeOnly = req.query.activeOnly !== 'false';
  const _shouldStream = req.query.stream === 'true';
  const _limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  // Use request deduplicator to prevent duplicate concurrent sync requests
  // This handles the case where users rapidly click the "Sync" button
  const deduplicator = requestDeduplicatorRegistry.get('sessions-sync', {
    defaultTtlMs: DEDUPLICATION.SYNC_TTL_MS,
  });

  const requestKey = generateRequestKey(userId, 'sessions-sync');

  try {
    const { data: result, wasDeduplicated } = await deduplicator.deduplicate(
      requestKey,
      async () => {
        logger.info('Starting session sync using shared syncUserSessions', {
          component: 'SessionSync',
          userId,
          queryParams: { activeOnly: _activeOnly, shouldStream: _shouldStream, limit: _limit },
        });

        // Get user's Claude auth
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user?.claudeAuth) {
          throw new Error('Claude authentication not configured. Please connect your Claude account in settings.');
        }

        // Use syncUserSessions from shared package
        // This provides sophisticated duplicate prevention and session linking logic
        const syncResult = await syncUserSessions(userId, user.claudeAuth);

        logger.info('Session sync completed using shared syncUserSessions', {
          component: 'SessionSync',
          userId,
          imported: syncResult.imported,
          updated: syncResult.updated,
          errors: syncResult.errors,
          skipped: syncResult.skipped,
        });

        return syncResult;
      }
    );

    if (wasDeduplicated) {
      logger.info('Session sync request was deduplicated (concurrent request detected)', {
        component: 'SessionSync',
        userId,
      });
    }

    // Return response with both new fields and backward-compatible structure
    // Note: Some detailed fields from the old API are no longer available
    // as the shared sync logic aggregates results internally
    return res.json({
      success: true,
      data: {
        // New fields from shared sync
        imported: result.imported,
        updated: result.updated,
        errors: result.errors,
        skipped: result.skipped,
        // Backward-compatible fields (best-effort mapping)
        alreadyExists: result.skipped,
        runningSessions: result.updated,
        // Indicate if this was a deduplicated response
        wasDeduplicated,
      }
    });

  } catch (error) {
    logger.error('Session sync failed', error as Error, { component: 'SessionSync' });

    // Handle auth configuration error specifically
    if (error instanceof Error && error.message.includes('Claude authentication not configured')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync sessions'
    });
  }
});

/**
 * POST /api/sessions/:id/sync-events
 * Sync events for a specific session from Anthropic API
 *
 * This is useful for:
 * - Catching up on events for a session that was running
 * - Re-syncing events if some were missed
 *
 * Uses SessionService.sync() from the shared package which provides:
 * - Proper event deduplication by UUID
 * - Transaction-safe event insertion and session updates
 * - Correct null/undefined normalization
 * - SessionPath generation
 */
// Rate limited to prevent excessive sync requests to Claude Remote API (5/min per user)
router.post('/:id/sync-events', requireAuth, syncOperationRateLimiter, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  const sessionId = req.params.id;

  if (!userId) {
    sendUnauthorized(res, 'Not authenticated');
    return;
  }

  // Use request deduplicator to prevent duplicate concurrent event sync requests
  const deduplicator = requestDeduplicatorRegistry.get('session-sync-events', {
    defaultTtlMs: DEDUPLICATION.SYNC_TTL_MS,
  });

  const requestKey = generateRequestKey(userId, sessionId, 'sync-events');

  try {
    const { data: responseData, wasDeduplicated } = await deduplicator.deduplicate(
      requestKey,
      async () => {
        // Verify session belongs to user and is not deleted
        const [session] = await db
          .select()
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.id, sessionId),
              eq(chatSessions.userId, userId),
              isNull(chatSessions.deletedAt)
            )
          )
          .limit(1);

        if (!session) {
          throw Object.assign(new Error('Session not found'), { statusCode: 404 });
        }

        if (!session.remoteSessionId) {
          throw Object.assign(new Error('Session is not a Claude Remote session'), { statusCode: 400 });
        }

        // Get user's Claude auth
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user?.claudeAuth) {
          throw Object.assign(new Error('Claude authentication not configured'), { statusCode: 400 });
        }

        // Count existing events before sync for backward-compatible response
        // Use COUNT(*) instead of fetching all eventData for better performance
        const [{ count: existingEventsCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(events)
          .where(eq(events.chatSessionId, sessionId));

        // Use SessionService.sync() from shared package via ServiceProvider
        // This provides proper event deduplication, transaction safety, and status mapping
        const sessionService = ServiceProvider.get(ASession);
        const syncResult = await sessionService.sync(sessionId, {
          claudeAuth: user.claudeAuth,
          environmentId: CLAUDE_ENVIRONMENT_ID,
        });

        // Count events after sync to calculate new events imported
        // Use COUNT(*) instead of fetching all eventData for better performance
        const [{ count: totalEventsCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(events)
          .where(eq(events.chatSessionId, sessionId));
        const newEventsImported = totalEventsCount - existingEventsCount;

        // Map local status back to remote status for backward compatibility
        const statusToRemoteStatus: Record<string, string> = {
          'completed': 'idle',
          'running': 'running',
          'error': 'failed',
          'pending': 'idle',
        };
        const remoteStatus = statusToRemoteStatus[syncResult.status] || 'idle';

        logger.info(`Synced session using SessionService.sync()`, {
          component: 'SessionSync',
          sessionId,
          remoteSessionId: session.remoteSessionId,
          existingEvents: existingEventsCount,
          newEvents: newEventsImported,
          status: syncResult.status,
          remoteStatus,
        });

        return {
          sessionId: syncResult.id,
          remoteSessionId: syncResult.remoteSessionId,
          existingEvents: existingEventsCount,
          newEventsImported,
          totalEvents: totalEventsCount,
          remoteStatus,
          localStatus: syncResult.status,
          status: syncResult.status,
          totalCost: syncResult.totalCost,
          branch: syncResult.branch,
          completedAt: syncResult.completedAt,
        };
      }
    );

    if (wasDeduplicated) {
      logger.info('Session event sync request was deduplicated (concurrent request detected)', {
        component: 'SessionSync',
        sessionId,
        userId,
      });
    }

    // Return response with both new fields and backward-compatible structure
    return res.json({
      success: true,
      data: {
        ...responseData,
        wasDeduplicated,
      }
    });

  } catch (error) {
    const err = error as Error & { statusCode?: number };
    logger.error('Event sync failed', err, {
      component: 'SessionSync',
      sessionId
    });

    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to sync events'
    });
  }
});

export default router;
