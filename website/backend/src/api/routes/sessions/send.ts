/**
 * Sessions Send Routes
 * Endpoints for sending follow-up messages to sessions
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, events, eq, and, isNull, logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import {
  validateSessionId,
  requireSessionOwnership,
  asyncHandler,
  sendData,
  sendBadRequest,
} from '../../middleware/sessionMiddleware.js';
import type { SessionRequest } from '../../middleware/sessionMiddleware.js';
import { sessionListBroadcaster } from '@webedt/shared';

const router = Router();

/**
 * POST /api/sessions/:id/send
 * Send a follow-up message to a session (queue for resume)
 *
 * This endpoint:
 * 1. Updates session status to 'running'
 * 2. Stores the input_preview event
 * 3. Notifies subscribers
 *
 * The frontend then connects to /events/stream which:
 * - Detects the pending input_preview event
 * - Initiates the Claude resume automatically
 *
 * This pattern allows:
 * - Clean separation of concerns (send vs stream)
 * - Proper SSE lifecycle (client controls when to stream)
 * - Event persistence for reconnection scenarios
 */
router.post('/:id/send', requireAuth, validateSessionId, requireSessionOwnership, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { sessionId, chatSession: session } = req as SessionRequest;
  const { message } = req.body as { message?: string };

  if (!message || typeof message !== 'string' || !message.trim()) {
    sendBadRequest(res, 'Message is required');
    return;
  }

  // Verify session has a remote session ID (required for resume)
  if (!session.remoteSessionId) {
    sendBadRequest(res, 'Session does not have a Claude Remote session to resume');
    return;
  }

  // Update session status to running
  await db
    .update(chatSessions)
    .set({
      status: 'running',
      workerLastActivity: new Date()
    })
    .where(eq(chatSessions.id, sessionId));

  // Store input_preview event (will be picked up by stream endpoint)
  const inputPreviewEvent = {
    type: 'input_preview',
    message: `Request received: ${message.length > 200 ? message.substring(0, 200) + '...' : message}`,
    source: 'user',
    timestamp: new Date().toISOString(),
    data: {
      preview: message,
      truncated: message.length > 200,
      originalLength: message.length,
    },
  };

  await db.insert(events).values({
    chatSessionId: sessionId,
    uuid: null, // Local input_preview events don't have UUIDs
    eventData: inputPreviewEvent,
  });

  // Notify session list subscribers of status change
  sessionListBroadcaster.notifyStatusChanged(authReq.user!.id, { id: sessionId, status: 'running' });

  logger.info(`Queued follow-up message for session ${sessionId}`, {
    component: 'Sessions',
    sessionId,
    messageLength: message.length,
    remoteSessionId: session.remoteSessionId,
  });

  sendData(res, {
    message: 'Message queued for processing',
    sessionId,
    status: 'running',
  });
}, { errorMessage: 'Failed to send message' }));

export default router;
