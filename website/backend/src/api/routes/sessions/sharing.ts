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
import { db, chatSessions, events, eq, and, asc, isNull, ServiceProvider, ASessionAuthorizationService, getPreviewUrlFromSession, logger, generateSecureShareToken, calculateShareTokenExpiration, isValidShareToken, SHARE_TOKEN_CONFIG, shareTokenAccessLogService } from '@webedt/shared';
import type { ShareTokenAccessType, ShareTokenFailureReason } from '@webedt/shared';
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
import { shareTokenValidationRateLimiter } from '../../middleware/rateLimit.js';
import { sessionEventBroadcaster } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Extract client IP address from request, handling proxied requests.
 * Note: Used for audit logging only, not security decisions.
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Log share token access for audit trail
 */
async function logShareAccess(
  sessionId: string,
  shareToken: string,
  accessType: ShareTokenAccessType,
  req: Request,
  success: boolean,
  failureReason?: ShareTokenFailureReason
): Promise<void> {
  try {
    await shareTokenAccessLogService.logAccess({
      sessionId,
      shareToken,
      accessType,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
      success,
      failureReason,
    });
  } catch (error) {
    // Log error but don't block the request
    logger.error('Failed to log share token access', error as Error, {
      component: 'Sessions',
      sessionId,
      accessType,
    });
  }
}

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
router.get('/shared/:token', shareTokenValidationRateLimiter, async (req: Request, res: Response) => {
  const shareToken = req.params.token;

  try {
    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Validate token format before database lookup
    if (!isValidShareToken(shareToken)) {
      res.status(400).json({ success: false, error: 'Invalid share token format' });
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
      // Log failed access only if we have a valid session (FK constraint requires valid session_id)
      const failureReason: ShareTokenFailureReason = authResult.statusCode === 410 ? 'expired'
        : authResult.statusCode === 404 ? 'not_found' : 'invalid';
      if (session) {
        await logShareAccess(session.id, shareToken, 'view', req, false, failureReason);
      }
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Log successful access
    await logShareAccess(session.id, shareToken, 'view', req, true);

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
router.get('/shared/:token/events', shareTokenValidationRateLimiter, async (req: Request, res: Response) => {
  const shareToken = req.params.token;

  try {
    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Validate token format before database lookup
    if (!isValidShareToken(shareToken)) {
      res.status(400).json({ success: false, error: 'Invalid share token format' });
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
      // Log failed access only if we have a valid session (FK constraint requires valid session_id)
      const failureReason: ShareTokenFailureReason = authResult.statusCode === 410 ? 'expired'
        : authResult.statusCode === 404 ? 'not_found' : 'invalid';
      if (session) {
        await logShareAccess(session.id, shareToken, 'events', req, false, failureReason);
      }
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Log successful access
    await logShareAccess(session.id, shareToken, 'events', req, true);

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
router.get('/shared/:token/events/stream', shareTokenValidationRateLimiter, async (req: Request, res: Response) => {
  const shareToken = req.params.token;

  try {
    if (!shareToken) {
      res.status(400).json({ success: false, error: 'Share token is required' });
      return;
    }

    // Validate token format before database lookup
    if (!isValidShareToken(shareToken)) {
      res.status(400).json({ success: false, error: 'Invalid share token format' });
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
      // Log failed access only if we have a valid session (FK constraint requires valid session_id)
      const failureReason: ShareTokenFailureReason = authResult.statusCode === 410 ? 'expired'
        : authResult.statusCode === 404 ? 'not_found' : 'invalid';
      if (session) {
        await logShareAccess(session.id, shareToken, 'stream', req, false, failureReason);
      }
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Log successful access
    await logShareAccess(session.id, shareToken, 'stream', req, true);

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
 * Optional body: { expiresInDays?: number } - defaults to 7 days (security best practice)
 * Min: 1 day, Max: 365 days
 */
router.post('/:id/share', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { expiresInDays } = req.body as { expiresInDays?: number };

  // Validate expiresInDays if provided
  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' ||
        expiresInDays < SHARE_TOKEN_CONFIG.MIN_EXPIRATION_DAYS ||
        expiresInDays > SHARE_TOKEN_CONFIG.MAX_EXPIRATION_DAYS) {
      sendBadRequest(res, `expiresInDays must be between ${SHARE_TOKEN_CONFIG.MIN_EXPIRATION_DAYS} and ${SHARE_TOKEN_CONFIG.MAX_EXPIRATION_DAYS}`);
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

  // Generate new share token using crypto-secure generation (or reuse existing if already shared)
  // New tokens use 256-bit entropy (base64url encoded) instead of UUID v4
  const shareToken = session.shareToken || generateSecureShareToken();

  // Calculate expiration date:
  // - If expiresInDays is explicitly provided, use it
  // - If creating a new share (no existing token), default to 7 days
  // - If extending an existing share without specifying days, preserve existing expiration
  let shareExpiresAt: Date | null;
  if (expiresInDays !== undefined) {
    shareExpiresAt = calculateShareTokenExpiration(expiresInDays);
  } else if (!session.shareToken) {
    // New share: apply default 7-day expiration for security
    shareExpiresAt = calculateShareTokenExpiration(SHARE_TOKEN_CONFIG.DEFAULT_EXPIRATION_DAYS);
  } else {
    // Existing share without new expiration: preserve current setting
    shareExpiresAt = session.shareExpiresAt;
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
    tokenFormat: shareToken.includes('-') ? 'uuid' : 'base64url',
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

/**
 * POST /api/sessions/:id/share/regenerate
 * Rotate the share token for a session (invalidates old token, generates new one)
 * Security feature to prevent continued access after sharing with someone
 * Optional body: { expiresInDays?: number } - defaults to 7 days
 */
router.post('/:id/share/regenerate', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { expiresInDays } = req.body as { expiresInDays?: number };

  // Validate expiresInDays if provided
  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' ||
        expiresInDays < SHARE_TOKEN_CONFIG.MIN_EXPIRATION_DAYS ||
        expiresInDays > SHARE_TOKEN_CONFIG.MAX_EXPIRATION_DAYS) {
      sendBadRequest(res, `expiresInDays must be between ${SHARE_TOKEN_CONFIG.MIN_EXPIRATION_DAYS} and ${SHARE_TOKEN_CONFIG.MAX_EXPIRATION_DAYS}`);
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

  if (!session.shareToken) {
    sendBadRequest(res, 'Session is not currently shared. Use POST /share to create a share link first.');
    return;
  }

  // Generate new secure token (always new - this is rotation, not reuse)
  const newShareToken = generateSecureShareToken();
  const shareExpiresAt = calculateShareTokenExpiration(expiresInDays ?? SHARE_TOKEN_CONFIG.DEFAULT_EXPIRATION_DAYS);

  // Update session with new share token
  await db
    .update(chatSessions)
    .set({
      shareToken: newShareToken,
      shareExpiresAt,
    })
    .where(eq(chatSessions.id, sessionId));

  logger.info(`Session ${sessionId} share token rotated`, {
    component: 'Sessions',
    sessionId,
    expiresAt: shareExpiresAt.toISOString(),
  });

  sendData(res, {
    shareToken: newShareToken,
    shareUrl: `/sessions/shared/${newShareToken}`,
    expiresAt: shareExpiresAt.toISOString(),
    message: 'Share link regenerated. Previous link is now invalid.',
  });
}, { errorMessage: 'Failed to regenerate share token' }));

/**
 * GET /api/sessions/:id/share/access-logs
 * Get access logs for a shared session (audit trail)
 * Query params: limit (default 50), offset (default 0), success (optional filter)
 */
router.get('/:id/share/access-logs', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { limit = '50', offset = '0', success } = req.query;

  // Parse query params
  const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 100);
  const parsedOffset = Math.max(parseInt(offset as string, 10) || 0, 0);
  const successFilter = success === 'true' ? true : success === 'false' ? false : undefined;

  // Verify session ownership
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

  // Get access logs
  const { logs, total } = await shareTokenAccessLogService.getAccessLogs({
    sessionId,
    limit: parsedLimit,
    offset: parsedOffset,
    success: successFilter,
  });

  sendData(res, {
    logs,
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    hasMore: parsedOffset + logs.length < total,
  });
}, { errorMessage: 'Failed to get share access logs' }));

/**
 * GET /api/sessions/:id/share/access-stats
 * Get access statistics for a shared session
 * Query params: startDate (optional ISO date), endDate (optional ISO date)
 */
router.get('/:id/share/access-stats', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { startDate, endDate } = req.query;

  // Parse date params
  const start = startDate ? new Date(startDate as string) : undefined;
  const end = endDate ? new Date(endDate as string) : undefined;

  // Validate dates if provided
  if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
    sendBadRequest(res, 'Invalid date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)');
    return;
  }

  // Verify session ownership
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

  // Get access stats
  const stats = await shareTokenAccessLogService.getAccessStats(sessionId, start, end);

  sendData(res, stats);
}, { errorMessage: 'Failed to get share access stats' }));

export default router;
