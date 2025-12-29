/**
 * Sessions Routes
 * Handles chat session CRUD operations
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, messages, users, events, eq, desc, inArray, and, asc, isNull, isNotNull, StorageService, sql, withTransactionOrThrow } from '@webedt/shared';
import type { TransactionContext } from '@webedt/shared';
import type { ChatSession, ClaudeAuth } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import {
  validateSessionId,
  requireSessionOwnership,
  setupSSEHeaders,
  asyncHandler,
  sendSuccess,
  sendData,
  sendSession,
  sendNotFound,
  sendBadRequest,
  sendForbidden,
  sendUnauthorized,
} from '../middleware/sessionMiddleware.js';
import type { SessionRequest } from '../middleware/sessionMiddleware.js';
import { getPreviewUrlFromSession, logger, generateSessionPath, fetchEnvironmentIdFromSessions, ServiceProvider, AClaudeWebClient, ASessionCleanupService, AEventStorageService, ASseHelper, ASessionQueryService, ASessionAuthorizationService, ensureValidToken, requestDeduplicatorRegistry, generateRequestKey, extractEventUuid, type ClaudeWebClientConfig, generateSecureShareToken, calculateShareTokenExpiration, isValidShareToken, SHARE_TOKEN_CONFIG, shareTokenAccessLogService } from '@webedt/shared';
import type { ShareTokenAccessType, ShareTokenFailureReason } from '@webedt/shared';
import { publicShareRateLimiter, syncOperationRateLimiter, sseRateLimiter, shareTokenValidationRateLimiter } from '../middleware/rateLimit.js';
import { sessionEventBroadcaster } from '@webedt/shared';
import { sessionListBroadcaster } from '@webedt/shared';
import { ASession, syncUserSessions } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '@webedt/shared';

/**
 * Helper to write SSE data safely using the shared SSE helper service.
 */
function sseWrite(res: Response, data: string): boolean {
  const sseHelper = ServiceProvider.get(ASseHelper);
  return sseHelper.write(res, data);
}

/**
 * Extract client IP address from request, handling proxied requests.
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

/**
 * Synchronous SSE write helper - same as sseWrite but named for clarity.
 */
function sseWriteSync(res: Response, data: string): boolean {
  return sseWrite(res, data);
}

// Helper function to delete a GitHub branch using SessionCleanupService
async function deleteGitHubBranch(
  githubAccessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = ServiceProvider.get(ASessionCleanupService);
  return cleanupService.deleteGitHubBranch(githubAccessToken, owner, repo, branch);
}

/**
 * Get and configure the Claude Web Client with the given credentials.
 */
function getClaudeClient(config: ClaudeWebClientConfig): AClaudeWebClient {
  const client = ServiceProvider.get(AClaudeWebClient);
  client.configure(config);
  return client;
}

// Helper function to archive Claude Remote session using SessionCleanupService
async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = ServiceProvider.get(ASessionCleanupService);
  return cleanupService.archiveClaudeRemoteSession(remoteSessionId, claudeAuth, environmentId);
}

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Sessions
 *     description: AI coding session management
 *   - name: Sessions-Public
 *     description: Public session sharing endpoints (no auth required)
 */

// Log all incoming requests to sessions routes for debugging
router.use((req: Request, res: Response, next) => {
  logger.info(`Sessions route request: ${req.method} ${req.path}`, {
    component: 'Sessions',
    method: req.method,
    path: req.path,
    fullUrl: req.originalUrl,
    hasAuth: !!(req as AuthRequest).user
  });
  next();
});

// ============================================================================
// PUBLIC SHARE ROUTES (no authentication required)
// These must be defined BEFORE /:id routes to avoid parameter conflicts
//
// SECURITY NOTE: These endpoints are protected by rate limiting middleware
// to prevent brute-force enumeration of share tokens. UUID v4 tokens provide
// 122 bits of entropy, making guessing impractical, but rate limiting adds
// defense in depth alongside infrastructure-level limits (nginx, Traefik, etc).
// ============================================================================

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 session:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userRequest:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending, running, completed, error]
 *                     repositoryOwner:
 *                       type: string
 *                     repositoryName:
 *                       type: string
 *                     branch:
 *                       type: string
 *                     provider:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     completedAt:
 *                       type: string
 *                       format: date-time
 *                     previewUrl:
 *                       type: string
 *                       nullable: true
 *                     isShared:
 *                       type: boolean
 *                       example: true
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

// ============================================================================
// END PUBLIC SHARE ROUTES
// ============================================================================

/**
 * @openapi
 * /sessions/create-code-session:
 *   post:
 *     tags:
 *       - Sessions
 *     summary: Create a new code session
 *     description: Creates a new AI coding session with specified repository and branch.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - repositoryOwner
 *               - repositoryName
 *               - baseBranch
 *               - branch
 *             properties:
 *               title:
 *                 type: string
 *                 description: Session title
 *               repositoryOwner:
 *                 type: string
 *                 description: GitHub repository owner
 *                 example: octocat
 *               repositoryName:
 *                 type: string
 *                 description: GitHub repository name
 *                 example: hello-world
 *               baseBranch:
 *                 type: string
 *                 description: Base branch to fork from
 *                 example: main
 *               branch:
 *                 type: string
 *                 description: Feature branch name
 *                 example: feature/add-readme
 *     responses:
 *       200:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 session:
 *                   $ref: '#/components/schemas/ChatSession'
 *       400:
 *         description: Missing required fields
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Create a new code session
router.post('/create-code-session', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const {
      title,
      repositoryOwner,
      repositoryName,
      baseBranch,
      branch,
    } = req.body;

    // Validate required fields
    if (!repositoryOwner || !repositoryName || !baseBranch || !branch) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: repositoryOwner, repositoryName, baseBranch, branch',
      });
      return;
    }

    // Generate session ID
    const sessionId = uuidv4();

    // Generate session path (format: owner__repo__branch)
    const sessionPath = generateSessionPath(repositoryOwner, repositoryName, branch);

    // Build repository URL
    const repositoryUrl = `https://github.com/${repositoryOwner}/${repositoryName}`;

    // Create session in database
    const [session] = await db.insert(chatSessions).values({
      id: sessionId,
      userId: authReq.user!.id,
      sessionPath,
      repositoryOwner,
      repositoryName,
      repositoryUrl,
      baseBranch,
      branch,
      userRequest: title || 'New coding session',
      status: 'pending',
      provider: 'claude',
      autoCommit: false,
      locked: false,
    }).returning();

    logger.info(`Created code session ${sessionId}`, {
      component: 'Sessions',
      sessionId,
      repositoryOwner,
      repositoryName,
      branch,
    });

    // Broadcast session list update
    sessionListBroadcaster.notifySessionUpdated(authReq.user!.id, session);

    res.json({ success: true, session });
  } catch (error) {
    logger.error('Create code session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to create session' });
  }
});

/**
 * @openapi
 * /sessions:
 *   get:
 *     tags:
 *       - Sessions
 *     summary: List all sessions
 *     description: Returns all active (non-deleted) chat sessions for the authenticated user.
 *     responses:
 *       200:
 *         description: Sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ChatSession'
 *                     total:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get all chat sessions for user (excluding deleted ones)
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const queryService = ServiceProvider.get(ASessionQueryService);

    const sessions = await queryService.listActive(authReq.user!.id);

    res.json({
      success: true,
      data: {
        sessions,
        total: sessions.length,
      },
    });
  } catch (error) {
    logger.error('Get sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
  }
});

/**
 * @openapi
 * /sessions/search:
 *   get:
 *     tags:
 *       - Sessions
 *     summary: Search sessions
 *     description: Search sessions by query string with optional filters.
 *     parameters:
 *       - name: q
 *         in: query
 *         required: true
 *         description: Search query string
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         description: Maximum number of results (max 100)
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - name: offset
 *         in: query
 *         description: Number of results to skip
 *         schema:
 *           type: integer
 *           default: 0
 *       - name: status
 *         in: query
 *         description: Filter by session status
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, error]
 *       - name: favorite
 *         in: query
 *         description: Filter by favorite status
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ChatSession'
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *                     query:
 *                       type: string
 *       400:
 *         description: Search query is required or invalid status
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Search sessions by query string
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const queryService = ServiceProvider.get(ASessionQueryService);

    // Parse query parameters
    const query = (req.query.q as string) || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const statusParam = req.query.status as string | undefined;
    const favorite = req.query.favorite === 'true' ? true : req.query.favorite === 'false' ? false : undefined;

    // Validate status parameter if provided
    const validStatuses = ['pending', 'running', 'completed', 'error'];
    let status: string | undefined;
    if (statusParam) {
      if (!validStatuses.includes(statusParam)) {
        res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
      }
      status = statusParam;
    }

    // Require a query string
    if (!query.trim()) {
      res.status(400).json({ success: false, error: 'Search query (q) is required' });
      return;
    }

    const result = await queryService.search(authReq.user!.id, {
      query: query.trim(),
      limit,
      offset,
      status,
      favorite,
    });

    res.json({
      success: true,
      data: {
        sessions: result.items,
        total: result.total,
        limit,
        offset,
        hasMore: result.hasMore,
        query: query.trim(),
      },
    });
  } catch (error) {
    logger.error('Search sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to search sessions' });
  }
});

/**
 * SSE endpoint for real-time session list updates
 *
 * Clients subscribe to this endpoint to receive updates when:
 * - A new session is created
 * - A session status changes (running -> completed, etc.)
 * - A session is updated (title change, etc.)
 * - A session is deleted
 *
 * This eliminates the need for polling the sessions list.
 */
// Rate limited to prevent aggressive reconnection patterns (10 reconnects/min per user)
router.get('/updates', requireAuth, sseRateLimiter, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.id;
  const subscriberId = uuidv4();

  logger.info(`Client subscribing to session list updates`, {
    component: 'Sessions',
    userId,
    subscriberId
  });

  // Set up SSE headers
  setupSSEHeaders(res);

  // Send initial connected event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    subscriberId,
    userId,
    timestamp: new Date().toISOString()
  })}\n\n`);

  // Subscribe to session list updates for this user
  const unsubscribe = sessionListBroadcaster.subscribe(userId, subscriberId, (event) => {
    try {
      // Check if response is still writable
      if (res.writableEnded) {
        unsubscribe();
        return;
      }

      // Write the event in SSE format
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify({
        type: event.type,
        session: event.session,
        timestamp: event.timestamp.toISOString()
      })}\n\n`);
    } catch (err) {
      logger.error(`Error writing to session list stream for subscriber ${subscriberId}`, err as Error, {
        component: 'Sessions'
      });
      unsubscribe();
    }
  });

  // Send heartbeat every 15 seconds to keep connection alive
  // Reduced from 30s to prevent proxy timeouts (Traefik default is ~30-60s)
  const heartbeatInterval = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeatInterval);
      return;
    }
    res.write(`:heartbeat\n\n`);
  }, 15000);

  // Handle client disconnect
  req.on('close', () => {
    logger.info(`Client disconnected from session list updates`, {
      component: 'Sessions',
      userId,
      subscriberId
    });
    clearInterval(heartbeatInterval);
    unsubscribe();
  });

  // Handle errors
  req.on('error', (err) => {
    logger.error(`Session list stream error for subscriber ${subscriberId}`, err, {
      component: 'Sessions'
    });
    clearInterval(heartbeatInterval);
    unsubscribe();
  });
});

// Get all deleted chat sessions for user (with pagination)
router.get('/deleted', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const queryService = ServiceProvider.get(ASessionQueryService);

    // Parse pagination params
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 per request
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await queryService.listDeleted(authReq.user!.id, { limit, offset });

    res.json({
      success: true,
      data: {
        sessions: result.items,
        total: result.total,
        limit,
        offset,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    logger.error('Get deleted sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch deleted sessions' });
  }
});

/**
 * @openapi
 * /sessions/{id}:
 *   get:
 *     tags:
 *       - Sessions
 *     summary: Get session by ID
 *     description: Returns a specific chat session with preview URL if applicable.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Session ID (UUID)
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 session:
 *                   $ref: '#/components/schemas/ChatSession'
 *       400:
 *         description: Invalid session ID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get specific chat session
router.get('/:id', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  const queryService = ServiceProvider.get(ASessionQueryService);
  const session = await queryService.getByIdWithPreview(sessionId, authReq.user!.id);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  sendSession(res, session);
}, { errorMessage: 'Failed to fetch session' }));

// Create an event for a session
router.post('/:id/events', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { eventData } = req.body;

  if (!eventData) {
    sendBadRequest(res, 'Event data is required');
    return;
  }

  // Create event - extract uuid for efficient deduplication queries
  const eventUuid = extractEventUuid(eventData as Record<string, unknown>);
  const [newEvent] = await db
    .insert(events)
    .values({
      chatSessionId: sessionId,
      uuid: eventUuid,
      eventData,
    })
    .returning();

  sendData(res, newEvent);
}, { errorMessage: 'Failed to create event' }));

// Create a message for a session
router.post('/:id/messages', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { type, content } = req.body;

  if (!type || !content) {
    sendBadRequest(res, 'Type and content are required');
    return;
  }

  // Validate message type
  const validTypes = ['user', 'assistant', 'system', 'error'];
  if (!validTypes.includes(type)) {
    sendBadRequest(res, 'Invalid message type');
    return;
  }

  // Create message
  const [newMessage] = await db
    .insert(messages)
    .values({
      chatSessionId: sessionId,
      type,
      content,
    })
    .returning();

  sendData(res, newMessage);
}, { errorMessage: 'Failed to create message' }));

// Get messages for a session
router.get('/:id/messages', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;

  // Get messages
  const sessionMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.chatSessionId, sessionId))
    .orderBy(messages.timestamp);

  sendData(res, {
    messages: sessionMessages,
    total: sessionMessages.length,
  });
}, { errorMessage: 'Failed to fetch messages' }));

// Get events for a session
router.get('/:id/events', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  logger.info('Getting events for session', {
    component: 'Sessions',
    sessionId,
    userId: authReq.user?.id
  });

  // Get events ordered by timestamp (ascending for replay order)
  const sessionEvents = await db
    .select()
    .from(events)
    .where(eq(events.chatSessionId, sessionId))
    .orderBy(asc(events.timestamp));

  logger.info('Events fetched for session', {
    component: 'Sessions',
    sessionId,
    eventCount: sessionEvents.length
  });

  sendData(res, {
    events: sessionEvents,
    total: sessionEvents.length,
  });
}, { errorMessage: 'Failed to fetch events' }));

// Update a chat session
router.patch('/:id', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { userRequest, branch } = req.body;

  // At least one field must be provided
  const hasUserRequest = userRequest && typeof userRequest === 'string' && userRequest.trim().length > 0;
  const hasBranch = branch && typeof branch === 'string' && branch.trim().length > 0;

  if (!hasUserRequest && !hasBranch) {
    sendBadRequest(res, 'At least one field (userRequest or branch) must be provided');
    return;
  }

  // Build update object with only provided fields
  const updateData: { userRequest?: string; branch?: string } = {};
  if (hasUserRequest) {
    updateData.userRequest = userRequest.trim();
  }
  if (hasBranch) {
    updateData.branch = branch.trim();
  }

  // Update session
  const [updatedSession] = await db
    .update(chatSessions)
    .set(updateData)
    .where(eq(chatSessions.id, sessionId))
    .returning();

  sendData(res, updatedSession);
}, { errorMessage: 'Failed to update session' }));

// Unlock a chat session
router.post('/:id/unlock', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;

  // Unlock session
  const [unlockedSession] = await db
    .update(chatSessions)
    .set({ locked: false })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  sendData(res, unlockedSession);
}, { errorMessage: 'Failed to unlock session' }));

// Toggle favorite status for a chat session
router.post('/:id/favorite', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId, chatSession } = req as SessionRequest;

  // Toggle favorite status
  const newFavoriteStatus = !chatSession.favorite;
  const [updatedSession] = await db
    .update(chatSessions)
    .set({ favorite: newFavoriteStatus })
    .where(eq(chatSessions.id, sessionId))
    .returning();

  // Notify subscribers of session update
  sessionListBroadcaster.notifySessionUpdated(authReq.user!.id, updatedSession);

  logger.info(`Session ${sessionId} favorite status toggled to ${newFavoriteStatus}`, {
    component: 'Sessions',
    sessionId,
    favorite: newFavoriteStatus,
  });

  sendSession(res, updatedSession);
}, { errorMessage: 'Failed to toggle favorite status' }));

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

// Abort a running session
router.post('/:id/abort', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;

  // Note: Local AI worker has been removed - sessions are now handled by Claude Remote
  logger.info(`Session ${sessionId} abort requested`, { component: 'Sessions' });

  // Update session status to interrupted
  await db
    .update(chatSessions)
    .set({ status: 'error', completedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  logger.info(`Session ${sessionId} aborted by user`, { component: 'Sessions' });

  sendData(res, {
    message: 'Session aborted',
    sessionId: sessionId
  });
}, { errorMessage: 'Failed to abort session' }));

// Send a follow-up message to an existing session (triggers resume via internal sessions)
router.post('/:id/send', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;
  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    sendBadRequest(res, 'Message content is required');
    return;
  }

  // Verify session exists and belongs to user (with deletedAt check)
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.userId, authReq.user!.id),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  if (!session.remoteSessionId) {
    sendBadRequest(res, 'Session has no remote session ID - cannot send follow-up message');
    return;
  }

  // Get Claude auth for the user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, authReq.user!.id))
    .limit(1);

  if (!user?.claudeAuth) {
    sendUnauthorized(res, 'Claude authentication not configured');
    return;
  }

  // Parse Claude auth
  let claudeAuth: ClaudeAuth;
  try {
    claudeAuth = typeof user.claudeAuth === 'string'
      ? JSON.parse(user.claudeAuth)
      : user.claudeAuth as ClaudeAuth;
  } catch {
    sendUnauthorized(res, 'Invalid Claude authentication data');
    return;
  }

  // Ensure we have a valid token
  const validAuth = await ensureValidToken(claudeAuth);
  if (!validAuth) {
    sendUnauthorized(res, 'Claude token expired and could not be refreshed');
    return;
  }

  // Use transaction to ensure status update and event insert are atomic
  await withTransactionOrThrow(db, async (tx: TransactionContext) => {
    // Update session status to running
    await tx.update(chatSessions)
      .set({ status: 'running' })
      .where(eq(chatSessions.id, sessionId));

    // Store the user message in the database for the stream to pick up
    // The actual resume will happen when the client connects to the SSE stream
    // Use input_preview for consistency with initial execution flow
    const userMessageEvent = {
      type: 'input_preview',
      message: `Request received: ${content.length > 200 ? content.substring(0, 200) + '...' : content}`,
      source: 'user',
      timestamp: new Date().toISOString(),
      data: {
        preview: content,
        truncated: content.length > 200,
        originalLength: content.length,
      },
    };

    await tx.insert(events).values({
      chatSessionId: sessionId,
      uuid: null, // Local input_preview events don't have UUIDs
      eventData: userMessageEvent,
    });
  }, {
    context: { operation: 'sendMessage', sessionId, contentLength: content.length },
  });

  logger.info(`Queued follow-up message for session ${sessionId}`, {
    component: 'Sessions',
    sessionId,
    contentLength: content.length,
  });

  // Return success - the client will connect to the SSE stream which handles the actual resume
  sendSuccess(res, {});
}, { errorMessage: 'Failed to send message' }));

// Bulk delete chat sessions (soft delete with branch cleanup)
router.post('/bulk-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, error: 'Invalid session IDs' });
      return;
    }

    // Verify all sessions exist and belong to the user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id),
          isNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length !== ids.length) {
      res.status(403).json({
        success: false,
        error: 'One or more sessions not found or access denied'
      });
      return;
    }

    const cleanupResults: {
      branches: { sessionId: string; success: boolean; message: string }[];
      remoteSessions: { remoteSessionId: string; success: boolean; message: string }[];
    } = {
      branches: [],
      remoteSessions: []
    };

    // External cleanup operations (branch deletion, remote archiving) are performed BEFORE
    // the database soft-delete. This ordering is intentional:
    // - External API calls cannot be rolled back, so they're not part of the DB transaction
    // - If external cleanup succeeds but DB update fails, branches are cleaned up (good)
    //   and the operation can be retried - the retry will skip already-deleted branches
    // - If we did DB first, a rollback would leave orphaned remote resources

    // Delete GitHub branches for all sessions that have branch info
    if (authReq.user?.githubAccessToken) {
      const branchDeletions = sessions
        .filter((s: ChatSession) => s.branch && s.repositoryOwner && s.repositoryName)
        .map(async (session: ChatSession) => {
          const result = await deleteGitHubBranch(
            authReq.user!.githubAccessToken!,
            session.repositoryOwner!,
            session.repositoryName!,
            session.branch!
          );
          return { sessionId: session.id, ...result };
        });
      cleanupResults.branches = await Promise.all(branchDeletions);
    }

    // Archive Claude Remote sessions if they have a remoteSessionId
    if (authReq.user?.claudeAuth) {
      const remoteSessionArchives = sessions
        .filter((s: ChatSession) => s.remoteSessionId)
        .map(async (session: ChatSession) => {
          const result = await archiveClaudeRemoteSession(
            session.remoteSessionId!,
            authReq.user!.claudeAuth as ClaudeAuth
          );
          return { remoteSessionId: session.remoteSessionId!, ...result };
        });
      cleanupResults.remoteSessions = await Promise.all(remoteSessionArchives);
    }

    // Soft delete all sessions from database within a transaction
    // This ensures atomicity - either all sessions are soft-deleted or none are
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx
        .update(chatSessions)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(chatSessions.id, ids),
            eq(chatSessions.userId, authReq.user!.id)
          )
        );
    }, {
      context: { operation: 'bulkSoftDelete', userId: authReq.user!.id, sessionCount: ids.length },
    });

    logger.info(`Bulk soft-deleted ${ids.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      sessionCount: ids.length,
      branchesDeleted: cleanupResults.branches.filter(b => b.success).length,
      remoteSessionsArchived: cleanupResults.remoteSessions.filter(r => r.success).length,
    });

    res.json({
      success: true,
      data: {
        message: `${ids.length} session${ids.length !== 1 ? 's' : ''} deleted`,
        count: ids.length,
        cleanup: cleanupResults
      }
    });
  } catch (error) {
    logger.error('Bulk delete sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to delete sessions' });
  }
});

// Bulk restore chat sessions
router.post('/bulk-restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, error: 'Invalid session IDs' });
      return;
    }

    // Verify all sessions exist and belong to the user
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length !== ids.length) {
      res.status(403).json({
        success: false,
        error: 'One or more sessions not found or access denied'
      });
      return;
    }

    // Restore all sessions within a transaction
    // This ensures atomicity - either all sessions are restored or none are
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx
        .update(chatSessions)
        .set({ deletedAt: null })
        .where(
          and(
            inArray(chatSessions.id, ids),
            eq(chatSessions.userId, authReq.user!.id)
          )
        );
    }, {
      context: { operation: 'bulkRestore', userId: authReq.user!.id, sessionCount: ids.length },
    });

    logger.info(`Bulk restored ${ids.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      sessionCount: ids.length,
    });

    res.json({
      success: true,
      data: {
        message: `${ids.length} session${ids.length !== 1 ? 's' : ''} restored`,
        count: ids.length,
      }
    });
  } catch (error) {
    logger.error('Bulk restore sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to restore sessions' });
  }
});

// Permanently delete chat sessions
router.post('/bulk-delete-permanent', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, error: 'Invalid session IDs' });
      return;
    }

    // Verify all sessions exist, belong to the user, and are already soft-deleted
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      );

    if (sessions.length !== ids.length) {
      res.status(403).json({
        success: false,
        error: 'One or more sessions not found or access denied'
      });
      return;
    }

    // Archive Claude Remote sessions before permanently deleting from local DB.
    // External archiving is done BEFORE the database delete (same rationale as bulk-delete):
    // external API calls can't be rolled back, so archive first, then delete from DB.
    const archiveResults: { sessionId: string; remoteSessionId: string | null; archived: boolean; message: string }[] = [];

    for (const session of sessions) {
      if (session.remoteSessionId && authReq.user?.claudeAuth) {
        logger.info('Archiving Claude Remote session before permanent delete', {
          component: 'Sessions',
          sessionId: session.id,
          remoteSessionId: session.remoteSessionId,
        });

        const result = await archiveClaudeRemoteSession(
          session.remoteSessionId,
          authReq.user.claudeAuth,
          undefined // environmentId not stored in DB, will use default from config
        );

        archiveResults.push({
          sessionId: session.id,
          remoteSessionId: session.remoteSessionId,
          archived: result.success,
          message: result.message,
        });

        logger.info('Claude Remote archive result', {
          component: 'Sessions',
          sessionId: session.id,
          remoteSessionId: session.remoteSessionId,
          success: result.success,
          message: result.message,
        });
      } else {
        archiveResults.push({
          sessionId: session.id,
          remoteSessionId: session.remoteSessionId,
          archived: false,
          message: session.remoteSessionId
            ? 'No Claude auth available'
            : 'No remote session ID',
        });
      }
    }

    // Permanently delete all sessions from database within a transaction
    // This ensures atomicity - either all sessions are permanently deleted or none are
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx
        .delete(chatSessions)
        .where(
          and(
            inArray(chatSessions.id, ids),
            eq(chatSessions.userId, authReq.user!.id)
          )
        );
    }, {
      context: { operation: 'bulkPermanentDelete', userId: authReq.user!.id, sessionCount: ids.length },
    });

    // Recalculate storage usage after permanent deletion
    // Note: This is done outside the transaction as it's a best-effort update.
    // If it fails, storage will be corrected on the next recalculation.
    try {
      await StorageService.recalculateUsage(authReq.user!.id);
    } catch (storageError) {
      logger.error('Failed to recalculate storage after permanent delete', storageError as Error, {
        component: 'Sessions',
        userId: authReq.user!.id,
        sessionCount: ids.length,
      });
      // Continue - the delete succeeded, storage recalculation can be retried later
    }

    const archivedCount = archiveResults.filter(r => r.archived).length;
    const remoteCount = archiveResults.filter(r => r.remoteSessionId).length;

    logger.info(`Bulk permanently deleted ${ids.length} sessions`, {
      component: 'Sessions',
      userId: authReq.user!.id,
      sessionCount: ids.length,
      remoteArchived: archivedCount,
      remoteTotal: remoteCount,
    });

    res.json({
      success: true,
      data: {
        message: `${ids.length} session${ids.length !== 1 ? 's' : ''} permanently deleted`,
        count: ids.length,
        remoteArchived: archivedCount,
        remoteTotal: remoteCount,
      }
    });
  } catch (error) {
    logger.error('Bulk permanent delete sessions error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to permanently delete sessions' });
  }
});

/**
 * @openapi
 * /sessions/{id}:
 *   delete:
 *     tags:
 *       - Sessions
 *     summary: Delete session
 *     description: Soft deletes a session (moves to trash). Also archives the Claude Remote session and deletes the GitHub branch if applicable.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Session ID (UUID)
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Session deleted
 *                     cleanup:
 *                       type: object
 *                       properties:
 *                         branch:
 *                           type: object
 *                           properties:
 *                             success:
 *                               type: boolean
 *                             message:
 *                               type: string
 *                         remoteSession:
 *                           type: object
 *                           properties:
 *                             success:
 *                               type: boolean
 *                             message:
 *                               type: string
 *       400:
 *         description: Invalid session ID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Delete a chat session (soft delete with branch cleanup)
router.delete('/:id', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  // Verify session ownership (include deletedAt check)
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

  const cleanupResults: {
    branch?: { success: boolean; message: string };
    remoteSession?: { success: boolean; message: string };
  } = {};

  // Log session details for debugging branch deletion
  logger.info('Session deletion - checking cleanup conditions', {
    component: 'Sessions',
    sessionId,
    branch: session.branch || undefined,
    repositoryOwner: session.repositoryOwner || undefined,
    repositoryName: session.repositoryName || undefined,
    provider: session.provider || undefined,
    hasGithubToken: !!authReq.user?.githubAccessToken,
  });

  // Delete GitHub branch if it exists
  if (authReq.user?.githubAccessToken && session.branch && session.repositoryOwner && session.repositoryName) {
    logger.info('Attempting to delete GitHub branch', {
      component: 'Sessions',
      sessionId,
      branch: session.branch,
      owner: session.repositoryOwner,
      repo: session.repositoryName,
    });
    cleanupResults.branch = await deleteGitHubBranch(
      authReq.user.githubAccessToken,
      session.repositoryOwner,
      session.repositoryName,
      session.branch
    );
  } else {
    logger.info('Skipping branch deletion - missing required fields', {
      component: 'Sessions',
      sessionId,
      hasBranch: !!session.branch,
      hasOwner: !!session.repositoryOwner,
      hasRepoName: !!session.repositoryName,
      hasGithubToken: !!authReq.user?.githubAccessToken,
    });
  }

  // Archive Claude Remote session if it exists
  const shouldArchive = !!session.remoteSessionId && !!authReq.user?.claudeAuth;

  logger.info('Session deletion - checking Claude Remote archive conditions', {
    component: 'Sessions',
    sessionId,
    provider: session.provider ?? undefined,
    remoteSessionId: session.remoteSessionId ?? undefined,
    hasClaudeAuth: !!authReq.user?.claudeAuth,
    claudeAuthKeys: authReq.user?.claudeAuth ? Object.keys(authReq.user.claudeAuth as object) : [],
    willArchive: shouldArchive,
  });

  if (shouldArchive) {
    logger.info('Attempting to archive Claude Remote session', {
      component: 'Sessions',
      sessionId,
      remoteSessionId: session.remoteSessionId,
    });
    cleanupResults.remoteSession = await archiveClaudeRemoteSession(
      session.remoteSessionId!,
      authReq.user.claudeAuth as ClaudeAuth
    );
    logger.info('Claude Remote archive result', {
      component: 'Sessions',
      sessionId,
      remoteSessionId: session.remoteSessionId,
      result: cleanupResults.remoteSession,
    });
  } else {
    logger.info('Skipping Claude Remote archive - conditions not met', {
      component: 'Sessions',
      sessionId,
      hasRemoteSessionId: !!session.remoteSessionId,
      hasClaudeAuth: !!authReq.user?.claudeAuth,
    });
  }

  // Soft delete session from database
  await db
    .update(chatSessions)
    .set({ deletedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  // Notify subscribers of session deletion
  sessionListBroadcaster.notifySessionDeleted(authReq.user!.id, sessionId);

  sendData(res, {
    message: 'Session deleted',
    cleanup: cleanupResults
  });
}, { errorMessage: 'Failed to delete session' }));

// Restore a chat session
router.post('/:id/restore', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  // Verify session ownership and that it's deleted
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, sessionId),
        isNotNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found in trash');
    return;
  }

  if (session.userId !== authReq.user!.id) {
    sendForbidden(res);
    return;
  }

  // Restore session
  await db
    .update(chatSessions)
    .set({ deletedAt: null })
    .where(eq(chatSessions.id, sessionId));

  sendData(res, { message: 'Session restored' });
}, { errorMessage: 'Failed to restore session' }));

// Worker callback endpoint
router.post('/:id/worker-status', validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { status, completedAt, workerSecret } = req.body;

  // Validate worker secret
  const expectedSecret = process.env.WORKER_CALLBACK_SECRET;
  if (!expectedSecret || workerSecret !== expectedSecret) {
    logger.warn(`Invalid worker secret for session ${sessionId}`, { component: 'Sessions' });
    sendUnauthorized(res, 'Invalid worker secret');
    return;
  }

  if (!status || !['completed', 'error'].includes(status)) {
    sendBadRequest(res, 'Invalid status. Must be "completed" or "error"');
    return;
  }

  // Verify session exists
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  // Only update if session is still in 'running' or 'pending' state
  if (session.status !== 'running' && session.status !== 'pending') {
    logger.info(`Session ${sessionId} already has status '${session.status}', skipping worker update to '${status}'`, { component: 'Sessions' });
    sendData(res, {
      message: 'Session status already finalized',
      currentStatus: session.status,
      requestedStatus: status
    });
    return;
  }

  // Update session status
  await db
    .update(chatSessions)
    .set({
      status,
      completedAt: completedAt ? new Date(completedAt) : new Date()
    })
    .where(eq(chatSessions.id, sessionId));

  // Notify subscribers of status change (use session's userId)
  sessionListBroadcaster.notifyStatusChanged(session.userId, { id: sessionId, status });

  logger.info(`Worker callback updated session ${sessionId} status to '${status}'`, { component: 'Sessions' });

  sendData(res, {
    message: 'Session status updated',
    sessionId,
    status
  });
}, { errorMessage: 'Failed to update session status' }));

/**
 * Stream events handler for SSE endpoint
 *
 * This provides HYBRID replay + live streaming:
 * 1. Replays ALL stored events from database (wrapped in replay_start/replay_end)
 * 2. If session is running, subscribes to live events
 * 3. Returns completed event when done
 *
 * Flow:
 * - Client connects to this endpoint
 * - First, all stored events are sent (marked with _replayed: true)
 * - If session is still running, live events are streamed until completion
 * - If session is completed/error, sends completed event and closes connection
 */
const streamEventsHandler = asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId, chatSession: session } = req as SessionRequest;

  // Check if the session is currently active in broadcaster (for live events)
  const isActive = sessionEventBroadcaster.isSessionActive(sessionId);

  // Also check DB-backed activity for running sessions (handles server restart case)
  const workerLastActivity = session.workerLastActivity;
  const activityThresholdMs = 2 * 60 * 1000; // 2 minutes
  const isRecentlyActive = session.status === 'running' && workerLastActivity &&
    (Date.now() - new Date(workerLastActivity).getTime() < activityThresholdMs);

  logger.info(`Streaming events for session: ${sessionId}`, {
    component: 'Sessions',
    status: session.status,
    isActive,
    isRecentlyActive
  });

  // Set up SSE headers
  setupSSEHeaders(res);

  // No custom wrapper events - just replay stored events directly

  // PHASE 1: Replay stored events from database
  const storedEvents = await db
    .select()
    .from(events)
    .where(eq(events.chatSessionId, sessionId))
    .orderBy(asc(events.id));

  logger.info(`Replaying ${storedEvents.length} stored events for reconnection`, {
    component: 'Sessions',
    sessionId
  });

  // Replay each stored event (no wrapper markers)
  for (const event of storedEvents) {
    if (res.writableEnded) break;
    const eventData = {
      ...(event.eventData as object),
      _replayed: true,
      _originalTimestamp: event.timestamp
    };
    res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  }

  // PHASE 2: Handle based on session status
  // Subscribe to live events if session is active in broadcaster OR has recent DB activity
  // This handles the case where the broadcaster might not have the session (e.g., server restart)
  // but the worker is still actively streaming events
  if (isActive || isRecentlyActive) {
    // Session is actively streaming - subscribe to live events
    const subscriberId = uuidv4();

    // Subscribe to session events
    const unsubscribe = sessionEventBroadcaster.subscribe(sessionId, subscriberId, (event) => {
      try {
        // Check if response is still writable
        if (res.writableEnded) {
          unsubscribe();
          return;
        }

        // Write the live event in SSE format
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);

        // If this is a completed event, end the connection
        if (event.eventType === 'completed') {
          res.write(`event: completed\n`);
          res.write(`data: ${JSON.stringify({
            websiteSessionId: sessionId,
            completed: true,
            replayed: false
          })}\n\n`);
          res.end();
          unsubscribe();
        }
      } catch (err) {
        logger.error(`Error writing to stream for subscriber ${subscriberId}`, err as Error, { component: 'Sessions' });
        unsubscribe();
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      logger.info(`Client disconnected from session stream: ${sessionId}`, { component: 'Sessions' });
      unsubscribe();
    });

    // Handle errors
    req.on('error', (err) => {
      logger.error(`Stream error for session ${sessionId}`, err, { component: 'Sessions' });
      unsubscribe();
    });
  } else {
    // Session is not actively streaming - check for pending user messages to resume
    // Look for input_preview events from 'user' source (follow-up messages)
    const pendingMessages = storedEvents.filter(e => {
      const data = e.eventData as { type?: string; source?: string };
      return data?.type === 'input_preview' && data?.source === 'user';
    });

    // Re-fetch session status to avoid race condition with /send endpoint
    // The /send endpoint updates status to 'running' and inserts input_preview,
    // but the session object was fetched at the start of this handler
    const [freshSession] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    const currentStatus = freshSession?.status || session.status;

    if (pendingMessages.length > 0 && session.remoteSessionId && currentStatus === 'running') {
      // Found pending message(s) - resume the Claude session
      const pendingMessage = pendingMessages[pendingMessages.length - 1]; // Use the latest
      const messageData = pendingMessage.eventData as { data?: { preview?: string } };
      const prompt = messageData?.data?.preview;

      if (prompt) {
        logger.info(`Found pending message for session ${sessionId}, initiating resume`, {
          component: 'Sessions',
          promptLength: prompt.length,
        });

        // Delete the pending message event (it will be replaced by actual events)
        await db.delete(events).where(eq(events.id, pendingMessage.id));

        // Get Claude auth
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, session.userId))
          .limit(1);

        if (!user?.claudeAuth) {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Claude authentication not configured',
            timestamp: new Date().toISOString()
          })}\n\n`);
          res.end();
          return;
        }

        let claudeAuth: ClaudeAuth;
        try {
          claudeAuth = typeof user.claudeAuth === 'string'
            ? JSON.parse(user.claudeAuth)
            : user.claudeAuth as ClaudeAuth;
        } catch {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Invalid Claude authentication data',
            timestamp: new Date().toISOString()
          })}\n\n`);
          res.end();
          return;
        }

        const validAuth = await ensureValidToken(claudeAuth);
        if (!validAuth) {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'Claude token expired',
            timestamp: new Date().toISOString()
          })}\n\n`);
          res.end();
          return;
        }

        // Get environment ID - from config or auto-detect from user's recent sessions
        let environmentId = CLAUDE_ENVIRONMENT_ID;
        if (!environmentId) {
          logger.info('CLAUDE_ENVIRONMENT_ID not configured, attempting auto-detection for resume', {
            component: 'Sessions',
            sessionId,
          });

          const detectedEnvId = await fetchEnvironmentIdFromSessions(
            validAuth.accessToken,
            CLAUDE_API_BASE_URL
          );

          if (detectedEnvId) {
            environmentId = detectedEnvId;
            logger.info('Auto-detected environment ID from user sessions', {
              component: 'Sessions',
              environmentId: environmentId.slice(0, 10) + '...',
            });
          } else {
            logger.error('Could not detect environment ID for resume', {
              component: 'Sessions',
              sessionId,
            });
            res.write(`data: ${JSON.stringify({
              type: 'error',
              error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first.',
              timestamp: new Date().toISOString()
            })}\n\n`);

            // Reset session status since we couldn't resume
            await db.update(chatSessions)
              .set({ status: 'completed' })
              .where(eq(chatSessions.id, sessionId));

            res.end();
            return;
          }
        }

        // Send input_preview for the follow-up message (same format as initial execution)
        const inputPreviewEvent = {
          type: 'input_preview',
          message: `Request received: ${prompt.length > 200 ? prompt.substring(0, 200) + '...' : prompt}`,
          source: 'user',
          timestamp: new Date().toISOString(),
          data: {
            preview: prompt,
            truncated: prompt.length > 200,
            originalLength: prompt.length,
          },
        };
        await db.insert(events).values({
          chatSessionId: sessionId,
          uuid: null, // Local input_preview events don't have UUIDs
          eventData: inputPreviewEvent,
        });
        logger.info('RESUME: Sending input_preview event', {
          component: 'Sessions',
          sessionId,
        });
        sseWriteSync(res, `data: ${JSON.stringify(inputPreviewEvent)}\n\n`);

        // Create Claude client and resume session
        logger.info('Creating ClaudeRemoteClient for resume', {
          component: 'Sessions',
          sessionId,
          remoteSessionId: session.remoteSessionId,
          environmentId: environmentId.slice(0, 10) + '...',
        });

        const client = getClaudeClient({
          accessToken: validAuth.accessToken,
          environmentId,
          baseUrl: CLAUDE_API_BASE_URL,
        });

        try {
          logger.info('Calling client.resume()', {
            component: 'Sessions',
            sessionId,
            remoteSessionId: session.remoteSessionId,
            promptLength: prompt.length,
          });

          let eventCount = 0;
          // Track stored event UUIDs to prevent duplicates
          const storedEventUuids = new Set<string>();
          const result = await client.resume(
            session.remoteSessionId,
            prompt,
            async (event) => {
              eventCount++;
              const eventType = (event as { type?: string }).type;

              // Filter out context events that contain old conversation data
              // The Claude API returns system/user events for context, but we only want
              // new events that are part of this turn's response
              if (eventType === 'system') {
                // Skip system events during resume - they contain the original system prompt
                logger.info(`Resume: Skipping system event (context)`, {
                  component: 'Sessions',
                  sessionId,
                });
                return;
              }

              if (eventType === 'user') {
                // Check if this user event contains the NEW message we just sent
                const eventData = event as { message?: { content?: string } };
                const messageContent = eventData.message?.content;
                if (messageContent === prompt) {
                  // This is the new user message - we already added it to the stream earlier
                  logger.info(`Resume: Skipping user event (already sent)`, {
                    component: 'Sessions',
                    sessionId,
                  });
                  return;
                } else {
                  // This is an old user message from the original conversation - skip it
                  logger.info(`Resume: Skipping old user event (context)`, {
                    component: 'Sessions',
                    sessionId,
                  });
                  return;
                }
              }

              // Skip env_manager_log events - they're internal
              if (eventType === 'env_manager_log') {
                return;
              }

              logger.info(`Resume event #${eventCount} - WRITING TO SSE STREAM`, {
                component: 'Sessions',
                eventType,
                sessionId,
                writableEnded: res.writableEnded,
                finished: res.finished,
              });

              if (res.writableEnded) {
                logger.warn(`Resume event #${eventCount} - SKIPPED (response ended)`, {
                  component: 'Sessions',
                  eventType,
                  sessionId,
                });
                return;
              }
              const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
              const sseData = `data: ${JSON.stringify(eventWithTimestamp)}\n\n`;
              logger.info(`Resume event #${eventCount} - SSE DATA LENGTH: ${sseData.length}`, {
                component: 'Sessions',
                eventType,
                sessionId,
              });
              // Use sseWrite with flush to ensure data gets through proxy chain
              sseWrite(res, sseData);

              // Store event in database - deduplicate by UUID
              const eventUuid = extractEventUuid(event as Record<string, unknown>);
              if (eventUuid && storedEventUuids.has(eventUuid)) {
                // Skip duplicate event storage
                logger.debug(`Resume event #${eventCount} - SKIPPED (duplicate)`, {
                  component: 'Sessions',
                  eventType,
                  sessionId,
                  eventUuid,
                });
                return;
              }

              await db.insert(events).values({
                chatSessionId: sessionId,
                uuid: eventUuid,
                eventData: eventWithTimestamp,
              });

              // Mark as stored to prevent future duplicates
              if (eventUuid) {
                storedEventUuids.add(eventUuid);
              }

              logger.info(`Resume event #${eventCount} - STORED IN DB`, {
                component: 'Sessions',
                eventType,
                sessionId,
              });
            }
          );

          logger.info('Resume completed', {
            component: 'Sessions',
            sessionId,
            status: result.status,
            eventCount,
            branch: result.branch,
            totalCost: result.totalCost,
          });

          // Update session status
          await db.update(chatSessions)
            .set({
              status: result.status === 'completed' || result.status === 'idle' ? 'completed' : 'error',
              branch: result.branch || session.branch,
              totalCost: result.totalCost?.toString() || session.totalCost,
              completedAt: new Date(),
            })
            .where(eq(chatSessions.id, sessionId));

          // Send completion event with flush
          sseWrite(res, `event: completed\ndata: ${JSON.stringify({
            websiteSessionId: sessionId,
            completed: true,
            status: result.status === 'completed' || result.status === 'idle' ? 'completed' : 'error',
          })}\n\n`);
        } catch (resumeError) {
          const errorMessage = resumeError instanceof Error ? resumeError.message : String(resumeError);
          const errorStack = resumeError instanceof Error ? resumeError.stack : undefined;
          logger.error('Resume error', resumeError as Error, {
            component: 'Sessions',
            sessionId,
            errorMessage,
            errorStack,
          });
          sseWrite(res, `data: ${JSON.stringify({
            type: 'error',
            error: resumeError instanceof Error ? resumeError.message : 'Resume failed',
            timestamp: new Date().toISOString()
          })}\n\n`);

          // Update session status to error
          await db.update(chatSessions)
            .set({ status: 'error', completedAt: new Date() })
            .where(eq(chatSessions.id, sessionId));
        }

        res.end();
        return;
      }
    }

    // No pending messages - session is completed/error, send completion event and close
    res.write(`event: completed\n`);
    res.write(`data: ${JSON.stringify({
      websiteSessionId: sessionId,
      completed: true,
      replayed: true,
      status: session.status
    })}\n\n`);
    res.end();
  }
}, { errorMessage: 'Failed to stream session events' });

// Register the stream events endpoint
// Primary: GET /api/sessions/:id/events/stream (aligns with Claude's /v1/sessions/:id/events pattern)
// Rate limited to prevent aggressive reconnection patterns (10 reconnects/min per session)
router.get('/:id/events/stream', requireAuth, sseRateLimiter, validateSessionId, requireSessionOwnership, streamEventsHandler);

// Backwards compatibility: GET /api/sessions/:id/stream
// DEPRECATED: Use /api/sessions/:id/events/stream instead
router.get('/:id/stream', requireAuth, sseRateLimiter, validateSessionId, requireSessionOwnership, streamEventsHandler);

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
    defaultTtlMs: 30000, // 30 second TTL for sync operations
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
    defaultTtlMs: 30000, // 30 second TTL for sync operations
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
