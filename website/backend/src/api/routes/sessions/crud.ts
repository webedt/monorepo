/**
 * Sessions CRUD Routes
 * Basic create, read, update, delete operations for sessions
 *
 * Uses constructor injection pattern for better testability.
 * Services are injected via factory function instead of ServiceProvider.get().
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, chatSessions, messages, events, eq, and, asc, isNull, isNotNull, logger, generateSessionPath, validateRequest, CommonSchemas, sessionSoftDeleteService } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';

import type { AuthRequest } from '../../middleware/auth.js';

import {
  validateSessionId,
  requireSessionOwnership,
  createRequireSessionOwnership,
  asyncHandler,
  sendData,
  sendSession,
  sendNotFound,
  sendBadRequest,
  sendForbidden,
} from '../../middleware/sessionMiddleware.js';

import type { SessionRequest } from '../../middleware/sessionMiddleware.js';

import { sessionListBroadcaster, createLazyServiceContainer } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';
import { extractEventUuid } from '@webedt/shared';

import type { SessionCrudServices, SessionMiddlewareServices } from '@webedt/shared';

// =============================================================================
// Validation Schemas
// =============================================================================

const createEventSchema = {
  body: z.object({
    eventData: z.record(z.string(), z.unknown()).refine(
      (obj) => Object.keys(obj).length > 0,
      { message: 'Event data cannot be empty' }
    ),
  }),
};

const createMessageSchema = {
  body: z.object({
    type: z.enum(['user', 'assistant', 'system', 'error']),
    content: z.string().trim().min(1, 'Content is required'),
  }),
};

const updateSessionSchema = {
  body: z.object({
    userRequest: z.string().trim().min(1, 'User request cannot be empty').optional(),
    branch: z.string().trim().min(1, 'Branch cannot be empty').optional(),
  }).refine(
    (data) => data.userRequest || data.branch,
    { message: 'At least one field (userRequest or branch) must be provided' }
  ),
};

// =============================================================================
// Route Factory (Recommended Pattern)
// =============================================================================

/**
 * Create session CRUD routes with injected services.
 *
 * This factory function enables proper unit testing by accepting
 * services as parameters instead of using ServiceProvider.get().
 *
 * @param services - Session CRUD services container
 * @param middlewareServices - Optional middleware services (for ownership checks)
 * @returns Express Router with session CRUD routes
 *
 * @example
 * ```typescript
 * // In production
 * const container = createServiceContainer();
 * app.use('/api/sessions', createCrudRoutes(container));
 *
 * // In tests
 * const mockContainer = createMockServiceContainer({
 *   sessionQueryService: mockQueryService,
 *   logger: mockLogger,
 * });
 * const router = createCrudRoutes(mockContainer);
 * ```
 */
export function createCrudRoutes(
  services: SessionCrudServices,
  middlewareServices?: SessionMiddlewareServices
): Router {
  const router = Router();

  // Use injected middleware services or fall back to default
  const sessionOwnershipMiddleware = middlewareServices
    ? createRequireSessionOwnership(middlewareServices)
    : requireSessionOwnership;

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
 *               repositoryName:
 *                 type: string
 *               baseBranch:
 *                 type: string
 *               branch:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session created successfully
 *       400:
 *         description: Missing required fields
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Use injected service instead of ServiceProvider.get()
    const sessions = await services.sessionQueryService.listActive(authReq.user!.id);

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
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, error]
 *       - name: favorite
 *         in: query
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Search query is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

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

    // Use injected service instead of ServiceProvider.get()
    const result = await services.sessionQueryService.search(authReq.user!.id, {
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

// Get all deleted chat sessions for user (with pagination)
router.get('/deleted', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Parse pagination params
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 per request
    const offset = parseInt(req.query.offset as string) || 0;

    // Use injected service instead of ServiceProvider.get()
    const result = await services.sessionQueryService.listDeleted(authReq.user!.id, { limit, offset });

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
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Session retrieved successfully
 *       400:
 *         description: Invalid session ID
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id', requireAuth, validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  // Use injected service instead of ServiceProvider.get()
  const session = await services.sessionQueryService.getByIdWithPreview(sessionId, authReq.user!.id);

  if (!session) {
    sendNotFound(res, 'Session not found');
    return;
  }

  sendSession(res, session);
}, { errorMessage: 'Failed to fetch session' }));

// Create an event for a session
router.post('/:id/events', requireAuth, validateSessionId, sessionOwnershipMiddleware, validateRequest(createEventSchema), asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { eventData } = req.body;

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
router.post('/:id/messages', requireAuth, validateSessionId, sessionOwnershipMiddleware, validateRequest(createMessageSchema), asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { type, content } = req.body;

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
router.get('/:id/messages', requireAuth, validateSessionId, sessionOwnershipMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;

  // Get non-deleted messages
  const sessionMessages = await db
    .select()
    .from(messages)
    .where(and(
      eq(messages.chatSessionId, sessionId),
      isNull(messages.deletedAt)
    ))
    .orderBy(messages.timestamp);

  sendData(res, {
    messages: sessionMessages,
    total: sessionMessages.length,
  });
}, { errorMessage: 'Failed to fetch messages' }));

// Get events for a session
router.get('/:id/events', requireAuth, validateSessionId, sessionOwnershipMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId } = req as SessionRequest;

  logger.info('Getting events for session', {
    component: 'Sessions',
    sessionId,
    userId: authReq.user?.id
  });

  // Get non-deleted events ordered by timestamp (ascending for replay order)
  const sessionEvents = await db
    .select()
    .from(events)
    .where(and(
      eq(events.chatSessionId, sessionId),
      isNull(events.deletedAt)
    ))
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
router.patch('/:id', requireAuth, validateSessionId, sessionOwnershipMiddleware, validateRequest(updateSessionSchema), asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { userRequest, branch } = req.body;

  // Build update object with only provided fields (already validated and trimmed by Zod)
  const updateData: { userRequest?: string; branch?: string } = {};
  if (userRequest) {
    updateData.userRequest = userRequest;
  }
  if (branch) {
    updateData.branch = branch;
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
router.post('/:id/unlock', requireAuth, validateSessionId, sessionOwnershipMiddleware, asyncHandler(async (req: Request, res: Response) => {
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
router.post('/:id/favorite', requireAuth, validateSessionId, sessionOwnershipMiddleware, asyncHandler(async (req: Request, res: Response) => {
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

// Abort a running session
router.post('/:id/abort', requireAuth, validateSessionId, sessionOwnershipMiddleware, asyncHandler(async (req: Request, res: Response) => {
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

  // Restore session with cascading to messages and events
  const restoreResult = await sessionSoftDeleteService.restoreSession(sessionId);

  if (!restoreResult.success) {
    res.status(500).json({ success: false, error: restoreResult.error });
    return;
  }

  sendData(res, {
    message: 'Session restored',
    messagesRestored: restoreResult.messagesRestored,
    eventsRestored: restoreResult.eventsRestored,
  });
}, { errorMessage: 'Failed to restore session' }));

// Worker callback endpoint
router.post('/:id/worker-status', validateSessionId, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req as SessionRequest;
  const { status, completedAt, workerSecret } = req.body;

  // Validate worker secret
  const expectedSecret = process.env.WORKER_CALLBACK_SECRET;
  if (!expectedSecret || workerSecret !== expectedSecret) {
    logger.warn(`Invalid worker secret for session ${sessionId}`, { component: 'Sessions' });
    res.status(401).json({ success: false, error: 'Invalid worker secret' });
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

  return router;
}

// =============================================================================
// Default Export (Backward Compatibility)
// =============================================================================

/**
 * Default router using lazy service container.
 *
 * Services are accessed at request time (not at module load time)
 * via lazy getters, allowing the router to be created before
 * ServiceProvider is initialized.
 *
 * For new code, prefer using createCrudRoutes() with explicit
 * service injection for better testability.
 *
 * @deprecated Use createCrudRoutes() for new code
 */
const router = createCrudRoutes(createLazyServiceContainer());

export default router;
