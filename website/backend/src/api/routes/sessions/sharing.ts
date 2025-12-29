/**
 * Sessions Sharing Routes
 * Public endpoints for session sharing via share tokens
 *
 * SECURITY NOTE: These endpoints are protected by rate limiting middleware
 * to prevent brute-force enumeration of share tokens. UUID v4 tokens provide
 * 122 bits of entropy, making guessing impractical, but rate limiting adds
 * defense in depth alongside infrastructure-level limits (nginx, Traefik, etc).
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, events, eq, and, asc, isNull, ServiceProvider, ASessionAuthorizationService, getPreviewUrlFromSession, logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import {
  validateSessionId,
  asyncHandler,
  sendSuccess,
  sendData,
  sendNotFound,
  sendBadRequest,
  sendForbidden,
  setupSSEHeaders,
} from '../../middleware/sessionMiddleware.js';
import type { SessionRequest } from '../../middleware/sessionMiddleware.js';
import { publicShareRateLimiter } from '../../middleware/rateLimit.js';
import { sessionEventBroadcaster } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * @openapi
 * /sessions/shared/{token}:
 *   get:
 *     tags:
 *       - Sessions-Public
 *     summary: Get shared session by token
 *     description: Public endpoint to access a shared session via share token. No authentication required. Rate limited to prevent enumeration attacks.
 *     security: []
 *     parameters:
 *       - name: token
 *         in: path
 *         required: true
 *         description: Share token (UUID)
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Shared session retrieved successfully
 *       400:
 *         description: Share token is required
 *       404:
 *         description: Session not found or share link expired
 *       429:
 *         description: Too many requests - rate limited
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/shared/:token', publicShareRateLimiter, async (req: Request, res: Response) => {
  try {
    const shareToken = req.params.token;

    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Find session by share token
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.shareToken, shareToken),
          isNull(chatSessions.deletedAt)
        )
      )
      .limit(1);

    // Verify share token access
    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const authResult = authService.verifyShareTokenAccess(session, shareToken);

    if (!authResult.authorized) {
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Get preview URL if applicable
    const previewUrl = await getPreviewUrlFromSession(session);

    // Return session with limited info (public-safe fields only)
    res.json({
      success: true,
      session: {
        id: session.id,
        userRequest: session.userRequest,
        status: session.status,
        repositoryOwner: session.repositoryOwner,
        repositoryName: session.repositoryName,
        branch: session.branch,
        provider: session.provider,
        createdAt: session.createdAt,
        completedAt: session.completedAt,
        previewUrl,
        isShared: true,
      }
    });
  } catch (error) {
    logger.error('Get shared session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch shared session' });
  }
});

/**
 * GET /api/sessions/shared/:token/events
 * Public endpoint to get events for a shared session
 * Rate limited to prevent enumeration attacks
 */
router.get('/shared/:token/events', publicShareRateLimiter, async (req: Request, res: Response) => {
  try {
    const shareToken = req.params.token;

    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Find session by share token
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.shareToken, shareToken),
          isNull(chatSessions.deletedAt)
        )
      )
      .limit(1);

    // Verify share token access
    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const authResult = authService.verifyShareTokenAccess(session, shareToken);

    if (!authResult.authorized) {
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Get events ordered by timestamp
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, session.id))
      .orderBy(asc(events.id));

    res.json({
      success: true,
      data: {
        events: sessionEvents,
        total: sessionEvents.length,
      },
    });
  } catch (error) {
    logger.error('Get shared session events error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch shared session events' });
  }
});

/**
 * GET /api/sessions/shared/:token/events/stream
 * Public SSE endpoint to stream events for a shared session
 * Rate limited to prevent enumeration attacks
 */
router.get('/shared/:token/events/stream', publicShareRateLimiter, async (req: Request, res: Response) => {
  try {
    const shareToken = req.params.token;

    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Find session by share token
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.shareToken, shareToken),
          isNull(chatSessions.deletedAt)
        )
      )
      .limit(1);

    // Verify share token access
    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const authResult = authService.verifyShareTokenAccess(session, shareToken);

    if (!authResult.authorized) {
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Check if session is actively streaming
    const isActive = sessionEventBroadcaster.isSessionActive(session.id);

    logger.info(`Streaming shared session events: ${session.id}`, {
      component: 'Sessions',
      status: session.status,
      isActive
    });

    // Set up SSE headers
    setupSSEHeaders(res);

    // Replay stored events
    const storedEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, session.id))
      .orderBy(asc(events.id));

    for (const event of storedEvents) {
      if (res.writableEnded) break;
      const eventData = {
        ...(event.eventData as object),
        _replayed: true,
        _originalTimestamp: event.timestamp
      };
      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    // Handle live streaming or completion
    if (isActive) {
      const subscriberId = uuidv4();

      const unsubscribe = sessionEventBroadcaster.subscribe(session.id, subscriberId, (event) => {
        try {
          if (res.writableEnded) {
            unsubscribe();
            return;
          }

          res.write(`data: ${JSON.stringify(event.data)}\n\n`);

          if (event.eventType === 'completed') {
            res.write(`event: completed\n`);
            res.write(`data: ${JSON.stringify({
              websiteSessionId: session.id,
              completed: true,
              replayed: false
            })}\n\n`);
            res.end();
            unsubscribe();
          }
        } catch (err) {
          logger.error(`Error writing to shared stream for subscriber ${subscriberId}`, err as Error, { component: 'Sessions' });
          unsubscribe();
        }
      });

      req.on('close', () => {
        logger.info(`Client disconnected from shared session stream: ${session.id}`, { component: 'Sessions' });
        unsubscribe();
      });

      req.on('error', (err) => {
        logger.error(`Shared stream error for session ${session.id}`, err, { component: 'Sessions' });
        unsubscribe();
      });
    } else {
      // Session not active - send completion and close
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({
        websiteSessionId: session.id,
        completed: true,
        replayed: true,
        status: session.status
      })}\n\n`);
      res.end();
    }
  } catch (error) {
    logger.error('Shared session stream error', error as Error, { component: 'Sessions' });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to stream shared session events' });
    }
  }
});

/**
 * POST /api/sessions/:id/share
 * Generate a share token for a session (public but unlisted - shareable if you know the link)
 * Optional body: { expiresInDays?: number } - defaults to preserving existing expiration or no expiration
 * Max expiration: 365 days
 */
router.post('/:id/share', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { expiresInDays } = req.body as { expiresInDays?: number };

  // Validate expiresInDays if provided
  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
      sendBadRequest(res, 'expiresInDays must be between 1 and 365');
      return;
    }
  }

  // Verify session ownership (include deletedAt check for share operations)
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  if (session.userId !== authReq.user!.id) {
    sendForbidden(res);
    return;
  }

  // Generate new share token (or reuse existing if already shared)
  const shareToken = session.shareToken || uuidv4();

  // Calculate expiration date:
  // - If expiresInDays is explicitly provided, use it
  // - Otherwise, preserve existing expiration (or null if never set)
  let shareExpiresAt: Date | null = session.shareExpiresAt;
  if (expiresInDays !== undefined) {
    shareExpiresAt = new Date();
    shareExpiresAt.setDate(shareExpiresAt.getDate() + expiresInDays);
  }

  // Update session with share token
  await db
    .update(chatSessions)
    .set({
      shareToken,
      shareExpiresAt,
    })
    .where(eq(chatSessions.id, sessionId));

  logger.info(`Session ${sessionId} share token generated`, {
    component: 'Sessions',
    sessionId,
    hasExpiration: !!shareExpiresAt,
    expiresAt: shareExpiresAt?.toISOString(),
  });

  sendData(res, {
    shareToken,
    shareUrl: `/sessions/shared/${shareToken}`,
    expiresAt: shareExpiresAt?.toISOString() || null,
  });
}, { errorMessage: 'Failed to generate share token' }));

/**
 * DELETE /api/sessions/:id/share
 * Revoke the share token for a session (stop sharing)
 */
router.delete('/:id/share', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  // Verify session ownership (include deletedAt check for share operations)
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  if (session.userId !== authReq.user!.id) {
    sendForbidden(res);
    return;
  }

  if (!session.shareToken) {
    sendBadRequest(res, 'Session is not currently shared');
    return;
  }

  // Revoke share token
  await db
    .update(chatSessions)
    .set({
      shareToken: null,
      shareExpiresAt: null,
    })
    .where(eq(chatSessions.id, sessionId));

  logger.info(`Session ${sessionId} share token revoked`, {
    component: 'Sessions',
    sessionId,
  });

  sendSuccess(res, { message: 'Share link revoked' });
}, { errorMessage: 'Failed to revoke share token' }));

/**
 * GET /api/sessions/:id/share
 * Get the current share status for a session
 */
router.get('/:id/share', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  // Verify session ownership (include deletedAt check for share operations)
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  if (session.userId !== authReq.user!.id) {
    sendForbidden(res);
    return;
  }

  const authService = ServiceProvider.get(ASessionAuthorizationService);
  const isValid = session.shareToken ? authService.isShareTokenValid(session) : false;

  sendData(res, {
    isShared: !!session.shareToken,
    shareToken: session.shareToken || null,
    shareUrl: session.shareToken ? `/sessions/shared/${session.shareToken}` : null,
    expiresAt: session.shareExpiresAt?.toISOString() || null,
    isExpired: session.shareToken ? !isValid : false,
  });
}, { errorMessage: 'Failed to get share status' }));

export default router;
