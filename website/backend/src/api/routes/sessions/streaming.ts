/**
 * Sessions Streaming Routes
 * SSE endpoints for real-time session updates and event streaming
 */

import { Router, Request, Response } from 'express';
import { db, chatSessions, users, events, eq, asc, logger, ensureValidToken, fetchEnvironmentIdFromSessions, CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL, extractEventUuid, SSEWriter } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import {
  validateSessionId,
  requireSessionOwnership,
  asyncHandler,
} from '../../middleware/sessionMiddleware.js';
import type { SessionRequest } from '../../middleware/sessionMiddleware.js';
import { sseRateLimiter } from '../../middleware/rateLimit.js';
import { sessionEventBroadcaster, sessionListBroadcaster } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';
import { createSSEWriter, getClaudeClient } from './helpers.js';

const router = Router();

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

  // Create SSEWriter with automatic heartbeat management
  const writer = createSSEWriter(res);
  writer.setup();

  // Send initial connected event
  writer.writeNamedEvent('connected', {
    subscriberId,
    userId,
    timestamp: new Date().toISOString()
  });

  // Subscribe to session list updates for this user
  const unsubscribe = sessionListBroadcaster.subscribe(userId, subscriberId, (event) => {
    try {
      // Check if response is still writable
      if (!writer.isWritable()) {
        unsubscribe();
        return;
      }

      // Write the event in SSE format
      writer.writeNamedEvent(event.type, {
        type: event.type,
        session: event.session,
        timestamp: event.timestamp.toISOString()
      });
    } catch (err) {
      logger.error(`Error writing to session list stream for subscriber ${subscriberId}`, err as Error, {
        component: 'Sessions'
      });
      unsubscribe();
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    logger.info(`Client disconnected from session list updates`, {
      component: 'Sessions',
      userId,
      subscriberId
    });
    writer.end();
    unsubscribe();
  });

  // Handle errors
  req.on('error', (err) => {
    logger.error(`Session list stream error for subscriber ${subscriberId}`, err, {
      component: 'Sessions'
    });
    writer.end();
    unsubscribe();
  });
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
const streamEventsHandler = asyncHandler(async (req: Request, res: Response) => {
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

  // Create SSEWriter with automatic heartbeat management
  const writer = createSSEWriter(res);
  writer.setup();

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
    if (!writer.isWritable()) break;
    const eventData = {
      ...(event.eventData as object),
      _replayed: true,
      _originalTimestamp: event.timestamp
    };
    writer.writeEvent(eventData);
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
        if (!writer.isWritable()) {
          unsubscribe();
          return;
        }

        // Write the live event in SSE format
        writer.writeEvent(event.data as Record<string, unknown>);

        // If this is a completed event, end the connection
        if (event.eventType === 'completed') {
          writer.writeNamedEvent('completed', {
            websiteSessionId: sessionId,
            completed: true,
            replayed: false
          });
          writer.end();
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
      writer.end();
      unsubscribe();
    });

    // Handle errors
    req.on('error', (err) => {
      logger.error(`Stream error for session ${sessionId}`, err, { component: 'Sessions' });
      writer.end();
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
          writer.writeEvent({
            type: 'error',
            error: 'Claude authentication not configured',
            timestamp: new Date().toISOString()
          });
          writer.end();
          return;
        }

        let claudeAuth: ClaudeAuth;
        try {
          claudeAuth = typeof user.claudeAuth === 'string'
            ? JSON.parse(user.claudeAuth)
            : user.claudeAuth as ClaudeAuth;
        } catch {
          writer.writeEvent({
            type: 'error',
            error: 'Invalid Claude authentication data',
            timestamp: new Date().toISOString()
          });
          writer.end();
          return;
        }

        const validAuth = await ensureValidToken(claudeAuth);
        if (!validAuth) {
          writer.writeEvent({
            type: 'error',
            error: 'Claude token expired',
            timestamp: new Date().toISOString()
          });
          writer.end();
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
            writer.writeEvent({
              type: 'error',
              error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first.',
              timestamp: new Date().toISOString()
            });

            // Reset session status since we couldn't resume
            await db.update(chatSessions)
              .set({ status: 'completed' })
              .where(eq(chatSessions.id, sessionId));

            writer.end();
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
        writer.writeEvent(inputPreviewEvent);

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
                isWritable: writer.isWritable(),
              });

              if (!writer.isWritable()) {
                logger.warn(`Resume event #${eventCount} - SKIPPED (response ended)`, {
                  component: 'Sessions',
                  eventType,
                  sessionId,
                });
                return;
              }
              const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
              logger.info(`Resume event #${eventCount} - SSE DATA`, {
                component: 'Sessions',
                eventType,
                sessionId,
              });
              // Use SSEWriter to ensure data gets through proxy chain
              writer.writeEvent(eventWithTimestamp as Record<string, unknown>);

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

          // Send completion event
          writer.writeNamedEvent('completed', {
            websiteSessionId: sessionId,
            completed: true,
            status: result.status === 'completed' || result.status === 'idle' ? 'completed' : 'error',
          });
        } catch (resumeError) {
          const errorMessage = resumeError instanceof Error ? resumeError.message : String(resumeError);
          const errorStack = resumeError instanceof Error ? resumeError.stack : undefined;
          logger.error('Resume error', resumeError as Error, {
            component: 'Sessions',
            sessionId,
            errorMessage,
            errorStack,
          });
          writer.writeEvent({
            type: 'error',
            error: resumeError instanceof Error ? resumeError.message : 'Resume failed',
            timestamp: new Date().toISOString()
          });

          // Update session status to error
          await db.update(chatSessions)
            .set({ status: 'error', completedAt: new Date() })
            .where(eq(chatSessions.id, sessionId));
        }

        writer.end();
        return;
      }
    }

    // No pending messages - session is completed/error, send completion event and close
    writer.writeNamedEvent('completed', {
      websiteSessionId: sessionId,
      completed: true,
      replayed: true,
      status: session.status
    });
    writer.end();
  }
}, { errorMessage: 'Failed to stream session events' });

// Register the stream events endpoint
// Primary: GET /api/sessions/:id/events/stream (aligns with Claude's /v1/sessions/:id/events pattern)
// Rate limited to prevent aggressive reconnection patterns (10 reconnects/min per session)
router.get('/:id/events/stream', requireAuth, sseRateLimiter, validateSessionId, requireSessionOwnership, streamEventsHandler);

// Backwards compatibility: GET /api/sessions/:id/stream
// DEPRECATED: Use /api/sessions/:id/events/stream instead
router.get('/:id/stream', requireAuth, sseRateLimiter, validateSessionId, requireSessionOwnership, streamEventsHandler);

export default router;
