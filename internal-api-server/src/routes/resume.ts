/**
 * Resume Route
 * Allows reconnection to in-progress or completed sessions
 * Replays stored events from database
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, events } from '../db/index.js';
import { eq, and, or, asc } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { activeWorkerSessions } from './execute.js';

const router = Router();

/**
 * GET /resume/:sessionId
 *
 * Reconnect to a session and replay stored events
 *
 * Flow:
 * 1. Load session from database
 * 2. If session is 'running': Check if AI Worker is still active, reconnect or mark as completed
 * 3. Replay stored events from database
 * 4. If session is 'completed' or 'error': Return full event history
 */
router.get('/resume/:sessionId', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { sessionId } = req.params;

  try {
    logger.info('Resume request received', {
      component: 'ResumeRoute',
      sessionId,
      userId: user.id
    });

    // Load session from database - support both UUID and sessionPath lookups
    const existingSessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          or(
            eq(chatSessions.id, sessionId),
            eq(chatSessions.sessionPath, sessionId)
          ),
          eq(chatSessions.userId, user.id)
        )
      )
      .limit(1);

    if (existingSessions.length === 0) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    const session = existingSessions[0];

    logger.info('Session found', {
      component: 'ResumeRoute',
      sessionId: session.id,
      status: session.status
    });

    // Setup SSE response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Handle 'running' sessions
    if (session.status === 'running') {
      // Check if AI Worker is still active
      const activeWorker = activeWorkerSessions.get(session.id);

      if (activeWorker) {
        // Worker is still active - send reconnect info
        res.write(`data: ${JSON.stringify({
          type: 'reconnected',
          sessionId: session.id,
          status: 'running',
          message: 'Reconnected to active session',
          timestamp: new Date().toISOString()
        })}\n\n`);

        // Note: The original SSE stream is still being written to the original client
        // This endpoint can only replay past events, not tap into the live stream
        // For true reconnection, we would need a pub/sub mechanism

        logger.info('Reconnected to active session', {
          component: 'ResumeRoute',
          sessionId: session.id,
          workerContainerId: activeWorker.containerId
        });
      } else {
        // Worker is no longer active but session is marked as running
        // This indicates an orphaned session - mark it as error
        await db
          .update(chatSessions)
          .set({ status: 'error', completedAt: new Date() })
          .where(eq(chatSessions.id, session.id));

        logger.warn('Orphaned running session detected, marking as error', {
          component: 'ResumeRoute',
          sessionId: session.id
        });

        res.write(`data: ${JSON.stringify({
          type: 'reconnected',
          sessionId: session.id,
          status: 'error',
          message: 'Session was interrupted - worker no longer active',
          timestamp: new Date().toISOString()
        })}\n\n`);
      }
    } else {
      // Session is completed or error - send status
      res.write(`data: ${JSON.stringify({
        type: 'reconnected',
        sessionId: session.id,
        status: session.status,
        message: `Session ${session.status}`,
        timestamp: new Date().toISOString()
      })}\n\n`);
    }

    // Replay stored events from database
    const storedEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, session.id))
      .orderBy(asc(events.id));

    logger.info('Replaying stored events', {
      component: 'ResumeRoute',
      sessionId: session.id,
      eventCount: storedEvents.length
    });

    // Send replay start marker
    res.write(`data: ${JSON.stringify({
      type: 'replay_start',
      totalEvents: storedEvents.length,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Replay each event
    for (const event of storedEvents) {
      // Add replay flag to distinguish from live events
      const eventData = {
        ...(event.eventData as object),
        _replayed: true,
        _originalTimestamp: event.timestamp
      };

      res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    }

    // Send replay end marker
    res.write(`data: ${JSON.stringify({
      type: 'replay_end',
      totalEvents: storedEvents.length,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Send session info
    res.write(`data: ${JSON.stringify({
      type: 'session_info',
      sessionId: session.id,
      sessionPath: session.sessionPath,
      status: session.status,
      branch: session.branch,
      baseBranch: session.baseBranch,
      repositoryOwner: session.repositoryOwner,
      repositoryName: session.repositoryName,
      repositoryUrl: session.repositoryUrl,
      userRequest: session.userRequest,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Send completion event
    res.write(`event: completed\n`);
    res.write(`data: ${JSON.stringify({
      websiteSessionId: session.id,
      completed: true,
      replayed: true
    })}\n\n`);

    res.end();

    logger.info('Resume completed', {
      component: 'ResumeRoute',
      sessionId: session.id,
      eventsReplayed: storedEvents.length
    });

  } catch (error) {
    logger.error('Resume failed', error, {
      component: 'ResumeRoute',
      sessionId
    });

    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Resume failed' })}\n\n`);
        res.write(`event: completed\n`);
        res.write(`data: ${JSON.stringify({ completed: true, error: true })}\n\n`);
        res.end();
      }
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

/**
 * GET /sessions/:sessionId/events
 *
 * Get all stored events for a session (non-SSE, JSON response)
 */
router.get('/sessions/:sessionId/events', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { sessionId } = req.params;

  try {
    // Verify session belongs to user
    const session = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          or(
            eq(chatSessions.id, sessionId),
            eq(chatSessions.sessionPath, sessionId)
          ),
          eq(chatSessions.userId, user.id)
        )
      )
      .limit(1);

    if (session.length === 0) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Get all events
    const storedEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, session[0].id))
      .orderBy(asc(events.id));

    res.json({
      success: true,
      sessionId: session[0].id,
      sessionPath: session[0].sessionPath,
      status: session[0].status,
      events: storedEvents.map((e: typeof storedEvents[number]) => ({
        id: e.id,
        eventType: e.eventType,
        eventData: e.eventData,
        timestamp: e.timestamp
      }))
    });

  } catch (error) {
    logger.error('Get events failed', error, {
      component: 'ResumeRoute',
      sessionId
    });

    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
