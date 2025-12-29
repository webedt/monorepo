/**
 * Sessions Routes
 * Handles chat session CRUD operations
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, messages, users, events, eq, desc, inArray, and, asc, isNull, isNotNull, StorageService } from '@webedt/shared';
import type { ChatSession, ClaudeAuth } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { getPreviewUrlFromSession, logger, generateSessionPath, fetchEnvironmentIdFromSessions, ServiceProvider, AClaudeWebClient, ASessionCleanupService, AEventStorageService, ASseHelper, ASessionQueryService, ASessionAuthorizationService, ensureValidToken, type ClaudeWebClientConfig } from '@webedt/shared';
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
// SECURITY NOTE: These endpoints should be protected by rate limiting at the
// infrastructure level (e.g., nginx, Traefik, or API gateway) to prevent
// brute-force enumeration of share tokens. UUID v4 tokens provide 122 bits
// of entropy, making guessing impractical, but rate limiting adds defense in depth.
// ============================================================================

/**
 * GET /api/sessions/shared/:token
 * Public endpoint to access a shared session via share token
 * No authentication required - anyone with the link can view
 */
router.get('/shared/:token', async (req: Request, res: Response) => {
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
 */
router.get('/shared/:token/events', async (req: Request, res: Response) => {
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
 */
router.get('/shared/:token/events/stream', async (req: Request, res: Response) => {
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

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
router.get('/updates', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.id;
  const subscriberId = uuidv4();

  logger.info(`Client subscribing to session list updates`, {
    component: 'Sessions',
    userId,
    subscriberId
  });

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

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

// Get specific chat session
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    const queryService = ServiceProvider.get(ASessionQueryService);
    const session = await queryService.getByIdWithPreview(sessionId, authReq.user!.id);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    logger.error('Get session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
  }
});

// Create an event for a session
router.post('/:id/events', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { eventData } = req.body;

    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const validation = authService.validateRequiredFields({ sessionId, eventData }, ['sessionId', 'eventData']);
    if (!validation.valid) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    // Verify session ownership
    const queryService = ServiceProvider.get(ASessionQueryService);
    const session = await queryService.getById(sessionId);
    const authResult = authService.verifyOwnership(session, authReq.user!.id);

    if (!authResult.authorized) {
      res.status(authResult.statusCode!).json({ success: false, error: authResult.error });
      return;
    }

    // Create event
    const [newEvent] = await db
      .insert(events)
      .values({
        chatSessionId: sessionId,
        eventData,
      })
      .returning();

    res.json({ success: true, data: newEvent });
  } catch (error) {
    logger.error('Create event error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

// Create a message for a session
router.post('/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { type, content } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (!type || !content) {
      res.status(400).json({ success: false, error: 'Type and content are required' });
      return;
    }

    // Validate message type
    const validTypes = ['user', 'assistant', 'system', 'error'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid message type' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
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

    res.json({ success: true, data: newMessage });
  } catch (error) {
    logger.error('Create message error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to create message' });
  }
});

// Get messages for a session
router.get('/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Get messages
    const sessionMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.chatSessionId, sessionId))
      .orderBy(messages.timestamp);

    res.json({
      success: true,
      data: {
        messages: sessionMessages,
        total: sessionMessages.length,
      },
    });
  } catch (error) {
    logger.error('Get messages error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// Get events for a session
router.get('/:id/events', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    logger.info('Getting events for session', {
      component: 'Sessions',
      sessionId,
      userId: authReq.user?.id
    });

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      logger.warn('Session not found for events request', {
        component: 'Sessions',
        sessionId
      });
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

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

    res.json({
      success: true,
      data: {
        events: sessionEvents,
        total: sessionEvents.length,
      },
    });
  } catch (error) {
    logger.error('Get events error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

// Update a chat session
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { userRequest, branch } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // At least one field must be provided
    const hasUserRequest = userRequest && typeof userRequest === 'string' && userRequest.trim().length > 0;
    const hasBranch = branch && typeof branch === 'string' && branch.trim().length > 0;

    if (!hasUserRequest && !hasBranch) {
      res.status(400).json({ success: false, error: 'At least one field (userRequest or branch) must be provided' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
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

    res.json({ success: true, data: updatedSession });
  } catch (error) {
    logger.error('Update session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

// Unlock a chat session
router.post('/:id/unlock', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Unlock session
    const [unlockedSession] = await db
      .update(chatSessions)
      .set({ locked: false })
      .where(eq(chatSessions.id, sessionId))
      .returning();

    res.json({ success: true, data: unlockedSession });
  } catch (error) {
    logger.error('Unlock session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to unlock session' });
  }
});

// Toggle favorite status for a chat session
router.post('/:id/favorite', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Toggle favorite status
    const newFavoriteStatus = !session.favorite;
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

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    logger.error('Toggle favorite error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to toggle favorite status' });
  }
});

/**
 * POST /api/sessions/:id/share
 * Generate a share token for a session (public but unlisted - shareable if you know the link)
 * Optional body: { expiresInDays?: number } - defaults to preserving existing expiration or no expiration
 * Max expiration: 365 days
 */
router.post('/:id/share', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { expiresInDays } = req.body as { expiresInDays?: number };

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Validate expiresInDays if provided
    if (expiresInDays !== undefined) {
      if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
        res.status(400).json({ success: false, error: 'expiresInDays must be between 1 and 365' });
        return;
      }
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
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
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

    res.json({
      success: true,
      data: {
        shareToken,
        shareUrl: `/sessions/shared/${shareToken}`,
        expiresAt: shareExpiresAt?.toISOString() || null,
      }
    });
  } catch (error) {
    logger.error('Generate share token error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to generate share token' });
  }
});

/**
 * DELETE /api/sessions/:id/share
 * Revoke the share token for a session (stop sharing)
 */
router.delete('/:id/share', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
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
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    if (!session.shareToken) {
      res.status(400).json({ success: false, error: 'Session is not currently shared' });
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

    res.json({
      success: true,
      message: 'Share link revoked',
    });
  } catch (error) {
    logger.error('Revoke share token error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to revoke share token' });
  }
});

/**
 * GET /api/sessions/:id/share
 * Get the current share status for a session
 */
router.get('/:id/share', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
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
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    const authService = ServiceProvider.get(ASessionAuthorizationService);
    const isValid = session.shareToken ? authService.isShareTokenValid(session) : false;

    res.json({
      success: true,
      data: {
        isShared: !!session.shareToken,
        shareToken: session.shareToken || null,
        shareUrl: session.shareToken ? `/sessions/shared/${session.shareToken}` : null,
        expiresAt: session.shareExpiresAt?.toISOString() || null,
        isExpired: session.shareToken ? !isValid : false,
      }
    });
  } catch (error) {
    logger.error('Get share status error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to get share status' });
  }
});

// Abort a running session
router.post('/:id/abort', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Note: Local AI worker has been removed - sessions are now handled by Claude Remote
    logger.info(`Session ${sessionId} abort requested`, { component: 'Sessions' });

    // Update session status to interrupted
    await db
      .update(chatSessions)
      .set({ status: 'error', completedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    logger.info(`Session ${sessionId} aborted by user`, { component: 'Sessions' });

    res.json({
      success: true,
      data: {
        message: 'Session aborted',
        sessionId: sessionId
      }
    });
  } catch (error) {
    logger.error('Abort session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to abort session' });
  }
});

// Send a follow-up message to an existing session (triggers resume via internal sessions)
router.post('/:id/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { content } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (!content || typeof content !== 'string') {
      res.status(400).json({ success: false, error: 'Message content is required' });
      return;
    }

    // Verify session exists and belongs to user
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
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (!session.remoteSessionId) {
      res.status(400).json({ success: false, error: 'Session has no remote session ID - cannot send follow-up message' });
      return;
    }

    // Get Claude auth for the user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!user?.claudeAuth) {
      res.status(401).json({ success: false, error: 'Claude authentication not configured' });
      return;
    }

    // Parse Claude auth
    let claudeAuth: ClaudeAuth;
    try {
      claudeAuth = typeof user.claudeAuth === 'string'
        ? JSON.parse(user.claudeAuth)
        : user.claudeAuth as ClaudeAuth;
    } catch {
      res.status(401).json({ success: false, error: 'Invalid Claude authentication data' });
      return;
    }

    // Ensure we have a valid token
    const validAuth = await ensureValidToken(claudeAuth);
    if (!validAuth) {
      res.status(401).json({ success: false, error: 'Claude token expired and could not be refreshed' });
      return;
    }

    // Update session status to running
    await db.update(chatSessions)
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

    await db.insert(events).values({
      chatSessionId: sessionId,
      eventData: userMessageEvent,
    });

    logger.info(`Queued follow-up message for session ${sessionId}`, {
      component: 'Sessions',
      sessionId,
      contentLength: content.length,
    });

    // Return success - the client will connect to the SSE stream which handles the actual resume
    res.json({ success: true });
  } catch (error) {
    logger.error('Send message error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
});

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

    // Soft delete all sessions from database
    await db
      .update(chatSessions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id)
        )
      );

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

    // Restore all sessions
    await db
      .update(chatSessions)
      .set({ deletedAt: null })
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id)
        )
      );

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

    // Archive Claude Remote sessions before permanently deleting from local DB
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

    // Permanently delete all sessions from database
    await db
      .delete(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id)
        )
      );

    // Recalculate storage usage after permanent deletion
    await StorageService.recalculateUsage(authReq.user!.id);

    const archivedCount = archiveResults.filter(r => r.archived).length;
    const remoteCount = archiveResults.filter(r => r.remoteSessionId).length;

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

// Delete a chat session (soft delete with branch cleanup)
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
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
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
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

    res.json({
      success: true,
      data: {
        message: 'Session deleted',
        cleanup: cleanupResults
      }
    });
  } catch (error) {
    logger.error('Delete session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to delete session' });
  }
});

// Restore a chat session
router.post('/:id/restore', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

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
      res.status(404).json({ success: false, error: 'Session not found in trash' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Restore session
    await db
      .update(chatSessions)
      .set({ deletedAt: null })
      .where(eq(chatSessions.id, sessionId));

    res.json({
      success: true,
      data: {
        message: 'Session restored'
      }
    });
  } catch (error) {
    logger.error('Restore session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to restore session' });
  }
});

// Worker callback endpoint
router.post('/:id/worker-status', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const { status, completedAt, workerSecret } = req.body;

    // Validate worker secret
    const expectedSecret = process.env.WORKER_CALLBACK_SECRET;
    if (!expectedSecret || workerSecret !== expectedSecret) {
      logger.warn(`Invalid worker secret for session ${sessionId}`, { component: 'Sessions' });
      res.status(401).json({ success: false, error: 'Invalid worker secret' });
      return;
    }

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (!status || !['completed', 'error'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status. Must be "completed" or "error"' });
      return;
    }

    // Verify session exists
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Only update if session is still in 'running' or 'pending' state
    if (session.status !== 'running' && session.status !== 'pending') {
      logger.info(`Session ${sessionId} already has status '${session.status}', skipping worker update to '${status}'`, { component: 'Sessions' });
      res.json({
        success: true,
        data: {
          message: 'Session status already finalized',
          currentStatus: session.status,
          requestedStatus: status
        }
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

    res.json({
      success: true,
      data: {
        message: 'Session status updated',
        sessionId,
        status
      }
    });
  } catch (error) {
    logger.error('Worker status callback error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to update session status' });
  }
});

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
const streamEventsHandler = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    // Flush headers immediately to establish SSE connection through proxies
    res.flushHeaders();

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
            let foundNewUserMessage = false;
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
                    foundNewUserMessage = true;
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
                const eventUuid = (event as { uuid?: string }).uuid;
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

  } catch (error) {
    logger.error('Session stream error', error as Error, { component: 'Sessions' });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to stream session events' });
    }
  }
};

// Register the stream events endpoint
// Primary: GET /api/sessions/:id/events/stream (aligns with Claude's /v1/sessions/:id/events pattern)
router.get('/:id/events/stream', requireAuth, streamEventsHandler);

// Backwards compatibility: GET /api/sessions/:id/stream
// DEPRECATED: Use /api/sessions/:id/events/stream instead
router.get('/:id/stream', requireAuth, streamEventsHandler);

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
router.post('/sync', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  // Parse query params for backward compatibility (logged for debugging)
  const activeOnly = req.query.activeOnly !== 'false';
  const shouldStream = req.query.stream === 'true';
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  logger.info('Starting session sync using shared syncUserSessions', {
    component: 'SessionSync',
    userId,
    // Log query params for debugging, even though shared sync may not use them all
    queryParams: { activeOnly, shouldStream, limit },
  });

  try {
    // Get user's Claude auth
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.claudeAuth) {
      return res.status(400).json({
        success: false,
        error: 'Claude authentication not configured. Please connect your Claude account in settings.'
      });
    }

    // Use syncUserSessions from shared package
    // This provides sophisticated duplicate prevention and session linking logic
    const result = await syncUserSessions(userId, user.claudeAuth);

    logger.info('Session sync completed using shared syncUserSessions', {
      component: 'SessionSync',
      userId,
      imported: result.imported,
      updated: result.updated,
      errors: result.errors,
      skipped: result.skipped,
    });

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
      }
    });

  } catch (error) {
    logger.error('Session sync failed', error as Error, { component: 'SessionSync' });
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
router.post('/:id/sync-events', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  const sessionId = req.params.id;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
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
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (!session.remoteSessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session is not a Claude Remote session'
      });
    }

    // Get user's Claude auth
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.claudeAuth) {
      return res.status(400).json({
        success: false,
        error: 'Claude authentication not configured'
      });
    }

    // Count existing events before sync for backward-compatible response
    const existingEventsBefore = await db
      .select({ eventData: events.eventData })
      .from(events)
      .where(eq(events.chatSessionId, sessionId));
    const existingEventsCount = existingEventsBefore.length;

    // Use SessionService.sync() from shared package via ServiceProvider
    // This provides proper event deduplication, transaction safety, and status mapping
    const sessionService = ServiceProvider.get(ASession);
    const syncResult = await sessionService.sync(sessionId, {
      claudeAuth: user.claudeAuth,
      environmentId: CLAUDE_ENVIRONMENT_ID,
    });

    // Count events after sync to calculate new events imported
    const eventsAfter = await db
      .select({ eventData: events.eventData })
      .from(events)
      .where(eq(events.chatSessionId, sessionId));
    const totalEventsCount = eventsAfter.length;
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

    // Return response with both new fields and backward-compatible structure
    return res.json({
      success: true,
      data: {
        sessionId: syncResult.id,
        remoteSessionId: syncResult.remoteSessionId,
        // Backward-compatible fields
        existingEvents: existingEventsCount,
        newEventsImported,
        totalEvents: totalEventsCount,
        remoteStatus,
        localStatus: syncResult.status,
        // New fields from sync result
        status: syncResult.status,
        totalCost: syncResult.totalCost,
        branch: syncResult.branch,
        completedAt: syncResult.completedAt,
      }
    });

  } catch (error) {
    logger.error('Event sync failed', error as Error, {
      component: 'SessionSync',
      sessionId
    });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sync events'
    });
  }
});

export default router;
