import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, workspacePresence, workspaceEvents, users, eq, and, gt, desc } from '@webedt/shared';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendInternalError,
} from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Offline threshold: 30 seconds
const OFFLINE_THRESHOLD_MS = 30 * 1000;

/**
 * PUT /api/workspace/presence
 * Update presence for the current user on a branch
 */
router.put('/presence', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { owner, repo, branch, page, cursorX, cursorY, selection } = req.body;

    if (!userId) {
      return sendError(res, 'Unauthorized', 401);
    }

    if (!owner || !repo || !branch) {
      return sendError(res, 'Missing required fields: owner, repo, branch', 400);
    }

    // Create composite ID for upsert
    const id = `${userId}_${owner}_${repo}_${branch}`;
    const now = new Date();

    // Upsert presence
    await db
      .insert(workspacePresence)
      .values({
        id,
        userId,
        owner,
        repo,
        branch,
        page: page || null,
        cursorX: cursorX ?? null,
        cursorY: cursorY ?? null,
        selection: selection || null,
        heartbeatAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workspacePresence.id,
        set: {
          page: page || null,
          cursorX: cursorX ?? null,
          cursorY: cursorY ?? null,
          selection: selection || null,
          heartbeatAt: now,
          updatedAt: now,
        },
      });

    sendSuccess(res, null);
  } catch (error) {
    logger.error('workspace', 'Failed to update presence', { error });
    sendInternalError(res, 'Failed to update presence');
  }
});

/**
 * GET /api/workspace/presence/:owner/:repo/:branch
 * Get active users on a branch
 */
router.get('/presence/:owner/:repo/:branch', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 'Unauthorized', 401);
    }

    const decodedBranch = decodeURIComponent(branch);
    const offlineThreshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

    // Get active users on this branch
    const activeUsers = await db
      .select({
        userId: workspacePresence.userId,
        page: workspacePresence.page,
        cursorX: workspacePresence.cursorX,
        cursorY: workspacePresence.cursorY,
        selection: workspacePresence.selection,
        heartbeatAt: workspacePresence.heartbeatAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(workspacePresence)
      .leftJoin(users, eq(workspacePresence.userId, users.id))
      .where(
        and(
          eq(workspacePresence.owner, owner),
          eq(workspacePresence.repo, repo),
          eq(workspacePresence.branch, decodedBranch),
          gt(workspacePresence.heartbeatAt, offlineThreshold)
        )
      );

    sendSuccess(res, {
      users: activeUsers.map((u) => ({
        userId: u.userId,
        displayName: u.displayName || u.email?.split('@')[0] || 'Anonymous',
        page: u.page,
        cursorX: u.cursorX,
        cursorY: u.cursorY,
        selection: u.selection,
        isCurrentUser: u.userId === userId,
      })),
      branch: decodedBranch,
      owner,
      repo,
    });
  } catch (error) {
    logger.error('workspace', 'Failed to get presence', { error });
    sendInternalError(res, 'Failed to get presence');
  }
});

/**
 * DELETE /api/workspace/presence/:owner/:repo/:branch
 * Remove presence (user leaving the workspace)
 */
router.delete('/presence/:owner/:repo/:branch', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 'Unauthorized', 401);
    }

    const decodedBranch = decodeURIComponent(branch);
    const id = `${userId}_${owner}_${repo}_${decodedBranch}`;

    await db.delete(workspacePresence).where(eq(workspacePresence.id, id));

    sendSuccess(res, null);
  } catch (error) {
    logger.error('workspace', 'Failed to delete presence', { error });
    sendInternalError(res, 'Failed to delete presence');
  }
});

/**
 * POST /api/workspace/events
 * Log a workspace event
 */
router.post('/events', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { owner, repo, branch, eventType, page, path, payload } = req.body;

    if (!userId) {
      return sendError(res, 'Unauthorized', 401);
    }

    if (!owner || !repo || !branch || !eventType) {
      return sendError(res, 'Missing required fields: owner, repo, branch, eventType', 400);
    }

    const event = {
      id: uuidv4(),
      userId,
      owner,
      repo,
      branch,
      eventType,
      page: page || null,
      path: path || null,
      payload: payload || null,
      createdAt: new Date(),
    };

    await db.insert(workspaceEvents).values(event);

    sendSuccess(res, event);
  } catch (error) {
    logger.error('workspace', 'Failed to log event', { error });
    sendInternalError(res, 'Failed to log event');
  }
});

/**
 * GET /api/workspace/events/:owner/:repo/:branch
 * Get recent events for a branch
 */
router.get('/events/:owner/:repo/:branch', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since ? new Date(req.query.since as string) : null;

    if (!userId) {
      return sendError(res, 'Unauthorized', 401);
    }

    const decodedBranch = decodeURIComponent(branch);

    let query = db
      .select({
        id: workspaceEvents.id,
        userId: workspaceEvents.userId,
        eventType: workspaceEvents.eventType,
        page: workspaceEvents.page,
        path: workspaceEvents.path,
        payload: workspaceEvents.payload,
        createdAt: workspaceEvents.createdAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(workspaceEvents)
      .leftJoin(users, eq(workspaceEvents.userId, users.id))
      .where(
        and(
          eq(workspaceEvents.owner, owner),
          eq(workspaceEvents.repo, repo),
          eq(workspaceEvents.branch, decodedBranch),
          since ? gt(workspaceEvents.createdAt, since) : undefined
        )
      )
      .orderBy(desc(workspaceEvents.createdAt))
      .limit(limit);

    const events = await query;

    // Reverse for chronological order
    events.reverse();

    sendSuccess(res, {
      events: events.map((e) => ({
        ...e,
        userName: e.displayName || e.email?.split('@')[0] || 'Anonymous',
      })),
      branch: decodedBranch,
      owner,
      repo,
    });
  } catch (error) {
    logger.error('workspace', 'Failed to get events', { error });
    sendInternalError(res, 'Failed to get events');
  }
});

/**
 * GET /api/workspace/events/:owner/:repo/:branch/stream
 * SSE stream for workspace events (real-time updates)
 */
router.get('/events/:owner/:repo/:branch/stream', async (req: Request, res: Response) => {
  const { owner, repo, branch } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return sendError(res, 'Unauthorized', 401);
  }

  const decodedBranch = decodeURIComponent(branch);

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ branch: decodedBranch, owner, repo })}\n\n`);

  // Poll for new events every 2 seconds
  // In production, this would use PostgreSQL LISTEN/NOTIFY
  let lastEventTime = new Date();
  const pollInterval = setInterval(async () => {
    try {
      const newEvents = await db
        .select({
          id: workspaceEvents.id,
          userId: workspaceEvents.userId,
          eventType: workspaceEvents.eventType,
          page: workspaceEvents.page,
          path: workspaceEvents.path,
          payload: workspaceEvents.payload,
          createdAt: workspaceEvents.createdAt,
          displayName: users.displayName,
          email: users.email,
        })
        .from(workspaceEvents)
        .leftJoin(users, eq(workspaceEvents.userId, users.id))
        .where(
          and(
            eq(workspaceEvents.owner, owner),
            eq(workspaceEvents.repo, repo),
            eq(workspaceEvents.branch, decodedBranch),
            gt(workspaceEvents.createdAt, lastEventTime)
          )
        )
        .orderBy(workspaceEvents.createdAt);

      for (const event of newEvents) {
        res.write(`event: workspace_event\ndata: ${JSON.stringify({
          ...event,
          userName: event.displayName || event.email?.split('@')[0] || 'Anonymous',
        })}\n\n`);
        lastEventTime = event.createdAt;
      }

      // Get updated presence
      const offlineThreshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
      const activeUsers = await db
        .select({
          userId: workspacePresence.userId,
          page: workspacePresence.page,
          cursorX: workspacePresence.cursorX,
          cursorY: workspacePresence.cursorY,
          selection: workspacePresence.selection,
          displayName: users.displayName,
          email: users.email,
        })
        .from(workspacePresence)
        .leftJoin(users, eq(workspacePresence.userId, users.id))
        .where(
          and(
            eq(workspacePresence.owner, owner),
            eq(workspacePresence.repo, repo),
            eq(workspacePresence.branch, decodedBranch),
            gt(workspacePresence.heartbeatAt, offlineThreshold)
          )
        );

      res.write(`event: presence_update\ndata: ${JSON.stringify({
        users: activeUsers.map((u) => ({
          userId: u.userId,
          displayName: u.displayName || u.email?.split('@')[0] || 'Anonymous',
          page: u.page,
          cursorX: u.cursorX,
          cursorY: u.cursorY,
          selection: u.selection,
          isCurrentUser: u.userId === userId,
        })),
      })}\n\n`);
    } catch (error) {
      logger.error('workspace', 'Error in event stream', { error });
    }
  }, 2000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(pollInterval);
  });
});

export default router;
