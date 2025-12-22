/**
 * Resume Route
 *
 * DEPRECATED: Use GET /api/sessions/:id/events/stream instead
 * This route is kept for backwards compatibility only.
 *
 * The canonical endpoint for streaming session events is:
 *   GET /api/sessions/:id/events/stream
 *
 * This follows Claude's API pattern of /v1/sessions/:id/events
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, events, eq, and, or, asc } from '@webedt/shared';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { sessionEventBroadcaster } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * GET /resume/:sessionId
 *
 * DEPRECATED: Use GET /api/sessions/:id/events/stream instead
 *
 * This endpoint is kept for backwards compatibility.
 * New implementations should use the canonical endpoint:
 *   GET /api/sessions/:id/events/stream
 *
 * Flow:
 * 1. Load session from database
 * 2. If session is 'running': Check if AI Worker is still active
 * 3. Replay stored events from database
 * 4. Subscribe to live events if session is still running
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

    // Send submission preview event immediately so user sees their request was received
    // userRequest contains the session title (updated when session_name event is received)
    const sessionName = session.userRequest || session.sessionPath || session.id;
    const repoInfo = session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : null;
    const previewText = repoInfo
      ? `Resuming session: ${sessionName} (${repoInfo})`
      : `Resuming session: ${sessionName}`;

    res.write(`data: ${JSON.stringify({
      type: 'submission_preview',
      message: previewText,
      source: 'internal-api-server:/resume',
      timestamp: new Date().toISOString(),
      data: {
        sessionId: session.id,
        sessionName,
        repositoryOwner: session.repositoryOwner,
        repositoryName: session.repositoryName,
        branch: session.branch,
        status: session.status
      }
    })}\n\n`);

    // Handle 'running' sessions
    if (session.status === 'running') {
      // Check if session is still active using DB activity timestamp
      const workerLastActivity = session.workerLastActivity;
      const activityThresholdMs = 2 * 60 * 1000; // 2 minutes
      const isRecentlyActive = workerLastActivity &&
        (Date.now() - new Date(workerLastActivity).getTime() < activityThresholdMs);

      if (isRecentlyActive) {
        // Session is still active - send reconnect info
        res.write(`data: ${JSON.stringify({
          type: 'reconnected',
          sessionId: session.id,
          status: 'running',
          message: 'Reconnected to active session',
          timestamp: new Date().toISOString()
        })}\n\n`);

        logger.info('Reconnected to active session', {
          component: 'ResumeRoute',
          sessionId: session.id,
          workerLastActivity: workerLastActivity
        });
      } else {
        // Worker is no longer active but session is marked as running
        // This indicates an orphaned session - mark it as error
        await db
          .update(chatSessions)
          .set({ status: 'error', completedAt: new Date(), workerLastActivity: null })
          .where(eq(chatSessions.id, session.id));

        logger.warn('Orphaned running session detected, marking as error', {
          component: 'ResumeRoute',
          sessionId: session.id,
          workerLastActivity: workerLastActivity
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

    // For running sessions, subscribe to live events from the broadcaster
    if (session.status === 'running' && sessionEventBroadcaster.isSessionActive(session.id)) {
      const subscriberId = uuidv4();
      let clientDisconnected = false;

      logger.info('Subscribing to live events for running session', {
        component: 'ResumeRoute',
        sessionId: session.id,
        subscriberId
      });

      // Send a marker that we're now receiving live events
      res.write(`data: ${JSON.stringify({
        type: 'live_stream_start',
        message: 'Now receiving live events',
        timestamp: new Date().toISOString()
      })}\n\n`);

      // Subscribe to live events
      const unsubscribe = sessionEventBroadcaster.subscribe(session.id, subscriberId, (event) => {
        if (clientDisconnected) return;

        try {
          // Forward the event to the client
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);

          // If this is a completed event, end the connection
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
          logger.error('Error writing live event to client', err as Error, {
            component: 'ResumeRoute',
            sessionId: session.id,
            subscriberId
          });
        }
      });

      // Handle client disconnect
      req.on('close', () => {
        clientDisconnected = true;
        unsubscribe();
        logger.info('Client disconnected from live stream', {
          component: 'ResumeRoute',
          sessionId: session.id,
          subscriberId
        });
      });

      // Don't end the response - keep it open for live events
      return;
    }

    // For completed/error sessions, send completion and end
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

    // Format response to match what client expects (data.events, data.total)
    // eventData contains the raw event with type field inside
    const formattedEvents = storedEvents.map((e: typeof storedEvents[number]) => ({
      id: e.id,
      chatSessionId: session[0].id,
      eventData: e.eventData,
      timestamp: e.timestamp
    }));

    res.json({
      success: true,
      data: {
        events: formattedEvents,
        total: formattedEvents.length,
        // Include session info for convenience
        sessionId: session[0].id,
        sessionPath: session[0].sessionPath,
        status: session[0].status,
      }
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
