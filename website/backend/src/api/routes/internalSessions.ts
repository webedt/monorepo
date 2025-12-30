/**
 * Internal Sessions Route
 *
 * Provides endpoints for managing Claude Remote Sessions.
 * Acts as a proxy between WebServer and Anthropic API while maintaining
 * local database state for caching and replay functionality.
 *
 * Endpoints:
 * - GET    /sessions                 - List sessions from Anthropic
 * - POST   /sessions                 - Create new session (SSE stream)
 * - GET    /sessions/:id/status      - Get session status from DB
 * - GET    /sessions/:id/events      - Get session events from DB
 * - GET    /sessions/:id             - Stream/reconnect to session
 * - GET    /sessions/:id/stream      - Alias for stream
 * - POST   /sessions/:id             - Resume session with new prompt (SSE stream)
 * - PATCH  /sessions/:id             - Rename session
 * - POST   /sessions/:id/archive     - Archive session
 * - DELETE /sessions/:id             - Delete session from DB
 * - POST   /sessions/:id/interrupt   - Interrupt running session
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, chatSessions, events, users, eq, desc, asc, and, isNull } from '@webedt/shared';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '@webedt/shared';
import {
  logger,
  ServiceProvider,
  AClaudeWebClient,
  type ClaudeWebClientConfig,
  generateTitle,
  type ClaudeSessionEvent as SessionEvent,
  type TitleGenerationEvent,
  sendSuccess,
  sendError,
  sendNotFound,
  sendForbidden,
  sendUnauthorized,
  sendInternalError,
} from '@webedt/shared';
import {
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_ORG_UUID,
  CLAUDE_COOKIES,
  OPENROUTER_API_KEY,
} from '@webedt/shared';
import {
  registerActiveStream,
  unregisterActiveStream,
  abortActiveStream,
  hasActiveStream,
} from '../activeStreamManager.js';

const router = Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get ClaudeAuth for a user and refresh if needed
 */
async function getClaudeAuth(userId: string): Promise<ClaudeAuth | null> {
  const [userData] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userData?.claudeAuth) {
    return null;
  }

  let claudeAuth = userData.claudeAuth as ClaudeAuth;

  try {
    const refreshedAuth = await ensureValidToken(claudeAuth);
    if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
      // Token was refreshed, save it
      await db.update(users)
        .set({ claudeAuth: refreshedAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
        .where(eq(users.id, userId));
      claudeAuth = refreshedAuth;
    }
  } catch (error) {
    logger.error('Failed to refresh Claude token', error, { component: 'InternalSessions' });
    return null;
  }

  return claudeAuth;
}

/**
 * Get and configure a ClaudeWebClient for a user
 */
function getClaudeClient(claudeAuth: ClaudeAuth, environmentId?: string): AClaudeWebClient {
  const client = ServiceProvider.get(AClaudeWebClient);
  client.configure({
    accessToken: claudeAuth.accessToken,
    environmentId: environmentId || CLAUDE_ENVIRONMENT_ID || '',
    baseUrl: CLAUDE_API_BASE_URL,
    model: CLAUDE_DEFAULT_MODEL,
  });
  return client;
}

/**
 * Set up SSE response headers
 */
function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

/**
 * Send SSE event to client
 */
function sendSSE(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Store event in database
 */
async function storeEvent(chatSessionId: string, eventData: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(events).values({
      chatSessionId,
      eventData,
    });
  } catch (error) {
    logger.warn('Failed to store event', { component: 'InternalSessions', error, chatSessionId, eventType: (eventData as any).type });
  }
}

// ============================================================================
// LIST - GET /sessions
// List sessions from Anthropic API
// ============================================================================

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;

  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const before = req.query.before as string | undefined;

    const claudeAuth = await getClaudeAuth(user.id);
    if (!claudeAuth) {
      sendUnauthorized(res, 'Claude authentication not configured');
      return;
    }

    const client = getClaudeClient(claudeAuth);
    const response = await client.listSessions(limit, before);

    sendSuccess(res, {
      sessions: response.data.map(session => ({
        sessionId: session.id,
        status: session.session_status,
        title: session.title,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        model: session.session_context?.model,
      })),
      hasMore: response.has_more,
      lastId: response.last_id,
    });
  } catch (error) {
    logger.error('Failed to list sessions', error, { component: 'InternalSessions' });
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to list sessions');
  }
});

// ============================================================================
// CREATE - POST /sessions
// Create new session with prompt (SSE stream)
// ============================================================================

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  let chatSessionId: string | null = null;
  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
    if (chatSessionId) {
      unregisterActiveStream(chatSessionId);
    }
  });

  try {
    const { prompt, gitUrl, model } = req.body;

    if (!prompt) {
      sendError(res, 'prompt is required', 400);
      return;
    }

    if (!gitUrl) {
      sendError(res, 'gitUrl is required', 400);
      return;
    }

    const claudeAuth = await getClaudeAuth(user.id);
    if (!claudeAuth) {
      sendUnauthorized(res, 'Claude authentication not configured');
      return;
    }

    // Create local session record
    chatSessionId = uuidv4();
    const [chatSession] = await db.insert(chatSessions).values({
      id: chatSessionId,
      userId: user.id,
      userRequest: prompt,
      status: 'running',
      provider: 'claude',
      repositoryUrl: gitUrl,
    }).returning();

    // Register active stream for interrupt support
    const abortController = registerActiveStream(chatSessionId);

    // Set up SSE response
    setupSSE(res);

    // Send session created event
    const sessionCreatedEvent = { type: 'session_created', chatSessionId, timestamp: new Date().toISOString() };
    sendSSE(res, sessionCreatedEvent);
    await storeEvent(chatSessionId, sessionCreatedEvent);

    // Generate title
    const titleInfo = await generateTitle(
      prompt,
      {
        claudeCookies: CLAUDE_COOKIES || undefined,
        orgUuid: CLAUDE_ORG_UUID || undefined,
        openRouterApiKey: OPENROUTER_API_KEY || undefined,
        accessToken: claudeAuth.accessToken,
        environmentId: CLAUDE_ENVIRONMENT_ID || undefined,
      },
      async (event: TitleGenerationEvent) => {
        if (clientDisconnected) return;
        const titleEvent = { ...event, timestamp: new Date().toISOString() };
        sendSSE(res, titleEvent);
        await storeEvent(chatSessionId!, titleEvent);
      }
    );

    // Create client and session
    const client = getClaudeClient(claudeAuth);
    const { sessionId: remoteSessionId, webUrl, title } = await client.createSession({
      prompt,
      gitUrl,
      model: model || CLAUDE_DEFAULT_MODEL,
      title: titleInfo.title,
      branchPrefix: titleInfo.branch_name,
    });

    // Update local session with remote info
    await db.update(chatSessions)
      .set({
        remoteSessionId,
        remoteWebUrl: webUrl,
        branch: titleInfo.branch_name,
      })
      .where(eq(chatSessions.id, chatSessionId));

    // Send remote session created event
    const remoteCreatedEvent = {
      type: 'remote_session_created',
      remoteSessionId,
      remoteWebUrl: webUrl,
      title,
      branch: titleInfo.branch_name,
      timestamp: new Date().toISOString(),
    };
    sendSSE(res, remoteCreatedEvent);
    await storeEvent(chatSessionId, remoteCreatedEvent);

    // Poll for events
    try {
      const result = await client.pollSession(
        remoteSessionId,
        async (event: SessionEvent) => {
          if (clientDisconnected) return;
          const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
          sendSSE(res, eventWithTimestamp);
          await storeEvent(chatSessionId!, eventWithTimestamp);
        },
        { abortSignal: abortController.signal }
      );

      // Update session with result
      await db.update(chatSessions)
        .set({
          status: result.status === 'completed' ? 'completed' : 'error',
          branch: result.branch || titleInfo.branch_name,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, chatSessionId));

      // Send completion event
      const completedEvent = {
        type: 'completed',
        chatSessionId,
        remoteSessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
      };
      sendSSE(res, completedEvent);
      await storeEvent(chatSessionId, completedEvent);

    } catch (pollError) {
      if (abortController.signal.aborted) {
        // Session was interrupted
        const interruptedEvent = {
          type: 'interrupted',
          chatSessionId,
          remoteSessionId,
          timestamp: new Date().toISOString(),
        };
        sendSSE(res, interruptedEvent);
        await storeEvent(chatSessionId, interruptedEvent);
      } else {
        throw pollError;
      }
    }

    // Cleanup
    unregisterActiveStream(chatSessionId);
    if (!clientDisconnected) {
      res.end();
    }

  } catch (error) {
    logger.error('Failed to create session', error, { component: 'InternalSessions' });

    if (chatSessionId) {
      await db.update(chatSessions)
        .set({ status: 'error' })
        .where(eq(chatSessions.id, chatSessionId));

      const errorEvent = {
        type: 'error',
        chatSessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      if (!res.headersSent) {
        sendInternalError(res, errorEvent.error);
      } else {
        sendSSE(res, errorEvent);
        await storeEvent(chatSessionId, errorEvent);
        res.end();
      }

      unregisterActiveStream(chatSessionId);
    } else if (!res.headersSent) {
      sendInternalError(res, error instanceof Error ? error.message : 'Unknown error');
    }
  }
});

// ============================================================================
// STATUS - GET /sessions/:id/status
// Get session status from DB
// ============================================================================

router.get('/:id/status', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    sendSuccess(res, {
      sessionId: session.id,
      remoteSessionId: session.remoteSessionId,
      remoteWebUrl: session.remoteWebUrl,
      status: session.status,
      title: session.userRequest?.slice(0, 50),
      branch: session.branch,
      totalCost: session.totalCost,
      provider: session.provider,
      repositoryUrl: session.repositoryUrl,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
    });
  } catch (error) {
    logger.error('Failed to get session status', error, { component: 'InternalSessions' });
    sendInternalError(res, 'Failed to get session status');
  }
});

// ============================================================================
// EVENTS - GET /sessions/:id/events
// Get session events from DB
// ============================================================================

router.get('/:id/events', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Get all events for this session
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, id))
      .orderBy(asc(events.id));

    // eventData contains the raw event with type field inside
    sendSuccess(res, sessionEvents.map(e => ({
      id: e.id,
      eventData: e.eventData,
      timestamp: e.timestamp,
    })));
  } catch (error) {
    logger.error('Failed to get session events', error, { component: 'InternalSessions' });
    sendInternalError(res, 'Failed to get session events');
  }
});

// ============================================================================
// STREAM - GET /sessions/:id and GET /sessions/:id/stream
// Reconnect to session stream (replay from DB + live if still running)
// ============================================================================

const streamHandler = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;
  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
  });

  try {
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Set up SSE
    setupSSE(res);

    // Send replay start marker
    sendSSE(res, { type: 'replay_start', sessionId: id, timestamp: new Date().toISOString() });

    // Get all stored events and replay them
    const storedEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, id))
      .orderBy(asc(events.id));

    for (const event of storedEvents) {
      if (clientDisconnected) break;
      sendSSE(res, {
        ...event.eventData as Record<string, unknown>,
        _replayed: true,
        _originalTimestamp: event.timestamp,
      });
    }

    // Send replay end marker
    sendSSE(res, { type: 'replay_end', totalEvents: storedEvents.length, timestamp: new Date().toISOString() });

    // Check if session is still running and we should subscribe to live events
    const isActive = hasActiveStream(id);
    const isRunning = session.status === 'running';

    if (isActive || isRunning) {
      // Session is still running - keep connection open for live events
      // The active stream will send events through the broadcaster
      sendSSE(res, { type: 'live_stream_start', timestamp: new Date().toISOString() });

      // For now, we'll poll Anthropic if we have a remote session
      if (session.remoteSessionId) {
        const claudeAuth = await getClaudeAuth(user.id);
        if (claudeAuth) {
          const client = getClaudeClient(claudeAuth);

          // Get current event count to skip already-seen events
          const seenEventIds = new Set(storedEvents.map(e => {
            const data = e.eventData as Record<string, unknown>;
            return data.uuid as string;
          }).filter(Boolean));

          try {
            await client.pollSession(
              session.remoteSessionId,
              async (event: SessionEvent) => {
                if (clientDisconnected) return;
                if (seenEventIds.has(event.uuid)) return; // Skip already seen

                seenEventIds.add(event.uuid);
                const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
                sendSSE(res, eventWithTimestamp);
                await storeEvent(id, eventWithTimestamp);
              },
              { skipExistingEvents: true }
            );
          } catch (pollError) {
            // Polling ended (completed, failed, or aborted)
            logger.info('Poll session ended', { component: 'InternalSessions', sessionId: id });
          }
        }
      }
    }

    // Send final status
    const [finalSession] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .limit(1);

    sendSSE(res, {
      type: 'stream_end',
      status: finalSession?.status || session.status,
      timestamp: new Date().toISOString(),
    });

    if (!clientDisconnected) {
      res.end();
    }

  } catch (error) {
    logger.error('Failed to stream session', error, { component: 'InternalSessions' });
    if (!res.headersSent) {
      sendInternalError(res, 'Failed to stream session');
    } else {
      sendSSE(res, { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      res.end();
    }
  }
};

router.get('/:id', requireAuth, streamHandler);
router.get('/:id/stream', requireAuth, streamHandler);

// ============================================================================
// RESUME - POST /sessions/:id
// Resume session with new prompt (SSE stream)
// ============================================================================

router.post('/:id', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;
  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
    unregisterActiveStream(id);
  });

  try {
    const { prompt } = req.body;

    if (!prompt) {
      sendError(res, 'prompt is required', 400);
      return;
    }

    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    if (!session.remoteSessionId) {
      sendError(res, 'Session has no remote session ID', 400);
      return;
    }

    const claudeAuth = await getClaudeAuth(user.id);
    if (!claudeAuth) {
      sendUnauthorized(res, 'Claude authentication not configured');
      return;
    }

    // Update session status only - don't overwrite the session title (userRequest)
    // The title should remain as the initial generated title until user renames it
    await db.update(chatSessions)
      .set({ status: 'running' })
      .where(eq(chatSessions.id, id));

    // Register active stream
    const abortController = registerActiveStream(id);

    // Set up SSE
    setupSSE(res);

    // Send resuming event
    const resumingEvent = { type: 'resuming', sessionId: id, timestamp: new Date().toISOString() };
    sendSSE(res, resumingEvent);
    await storeEvent(id, resumingEvent);

    // Store user message event
    const userMessageEvent = {
      type: 'user_message',
      content: prompt,
      timestamp: new Date().toISOString(),
    };
    sendSSE(res, userMessageEvent);
    await storeEvent(id, userMessageEvent);

    // Create client and resume session
    const client = getClaudeClient(claudeAuth);

    try {
      const result = await client.resume(
        session.remoteSessionId,
        prompt,
        async (event: SessionEvent) => {
          if (clientDisconnected) return;
          const eventWithTimestamp = { ...event, timestamp: new Date().toISOString() };
          sendSSE(res, eventWithTimestamp);
          await storeEvent(id, eventWithTimestamp);
        },
        { abortSignal: abortController.signal }
      );

      // Update session
      await db.update(chatSessions)
        .set({
          status: result.status === 'completed' || result.status === 'idle' ? 'completed' : 'error',
          branch: result.branch || session.branch,
          totalCost: result.totalCost?.toString() || session.totalCost,
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, id));

      // Send completion event
      const completedEvent = {
        type: 'completed',
        sessionId: id,
        remoteSessionId: session.remoteSessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        timestamp: new Date().toISOString(),
      };
      sendSSE(res, completedEvent);
      await storeEvent(id, completedEvent);

    } catch (resumeError) {
      if (abortController.signal.aborted) {
        const interruptedEvent = {
          type: 'interrupted',
          sessionId: id,
          timestamp: new Date().toISOString(),
        };
        sendSSE(res, interruptedEvent);
        await storeEvent(id, interruptedEvent);
      } else {
        throw resumeError;
      }
    }

    // Cleanup
    unregisterActiveStream(id);
    if (!clientDisconnected) {
      res.end();
    }

  } catch (error) {
    logger.error('Failed to resume session', error, { component: 'InternalSessions' });

    await db.update(chatSessions)
      .set({ status: 'error' })
      .where(eq(chatSessions.id, id));

    const errorEvent = {
      type: 'error',
      sessionId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    };

    if (!res.headersSent) {
      sendInternalError(res, errorEvent.error);
    } else {
      sendSSE(res, errorEvent);
      await storeEvent(id, errorEvent);
      res.end();
    }

    unregisterActiveStream(id);
  }
});

// ============================================================================
// RENAME - PATCH /sessions/:id
// Rename session (call Anthropic + update DB)
// ============================================================================

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    const { title } = req.body;

    if (!title) {
      sendError(res, 'title is required', 400);
      return;
    }

    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Call Anthropic to rename if we have a remote session
    if (session.remoteSessionId) {
      const claudeAuth = await getClaudeAuth(user.id);
      if (claudeAuth) {
        const client = getClaudeClient(claudeAuth);
        await client.renameSession(session.remoteSessionId, title);
      }
    }

    // Update local DB
    await db.update(chatSessions)
      .set({ userRequest: title })
      .where(eq(chatSessions.id, id));

    sendSuccess(res, {
      sessionId: id,
      title,
    });
  } catch (error) {
    logger.error('Failed to rename session', error, { component: 'InternalSessions' });
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to rename session');
  }
});

// ============================================================================
// ARCHIVE - POST /sessions/:id/archive
// Archive session (call Anthropic + update DB status)
// ============================================================================

router.post('/:id/archive', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Call Anthropic to archive if we have a remote session
    if (session.remoteSessionId) {
      const claudeAuth = await getClaudeAuth(user.id);
      if (claudeAuth) {
        const client = getClaudeClient(claudeAuth);
        await client.archiveSession(session.remoteSessionId);
      }
    }

    // Update local DB status to archived (using 'completed' since schema doesn't have 'archived')
    await db.update(chatSessions)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(chatSessions.id, id));

    sendSuccess(res, {
      sessionId: id,
      status: 'archived',
    });
  } catch (error) {
    logger.error('Failed to archive session', error, { component: 'InternalSessions' });
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to archive session');
  }
});

// ============================================================================
// DELETE - DELETE /sessions/:id
// Delete session from DB (soft delete)
// ============================================================================

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Soft delete - set deletedAt timestamp
    await db.update(chatSessions)
      .set({ deletedAt: new Date() })
      .where(eq(chatSessions.id, id));

    sendSuccess(res, {
      sessionId: id,
      deleted: true,
    });
  } catch (error) {
    logger.error('Failed to delete session', error, { component: 'InternalSessions' });
    sendInternalError(res, 'Failed to delete session');
  }
});

// ============================================================================
// INTERRUPT - POST /sessions/:id/interrupt
// Interrupt running session (call Anthropic + disconnect stream)
// ============================================================================

router.post('/:id/interrupt', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  const { id } = req.params;

  try {
    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(
        eq(chatSessions.id, id),
        eq(chatSessions.userId, user.id),
        isNull(chatSessions.deletedAt)
      ))
      .limit(1);

    if (!session) {
      sendNotFound(res, 'Session not found');
      return;
    }

    // Abort local active stream
    const wasActive = abortActiveStream(id);

    // Call Anthropic to interrupt if we have a remote session
    if (session.remoteSessionId) {
      const claudeAuth = await getClaudeAuth(user.id);
      if (claudeAuth) {
        try {
          const client = getClaudeClient(claudeAuth);
          await client.interruptSession(session.remoteSessionId);
        } catch (interruptError) {
          // Log but don't fail - session may already be idle
          logger.warn('Failed to interrupt remote session', {
            component: 'InternalSessions',
            error: interruptError,
            remoteSessionId: session.remoteSessionId
          });
        }
      }
    }

    // Update local DB status
    await db.update(chatSessions)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(chatSessions.id, id));

    // Store interrupt event
    await storeEvent(id, {
      type: 'interrupted',
      sessionId: id,
      wasActive,
      timestamp: new Date().toISOString(),
    });

    sendSuccess(res, {
      sessionId: id,
      interrupted: true,
      wasActive,
    });
  } catch (error) {
    logger.error('Failed to interrupt session', error, { component: 'InternalSessions' });
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to interrupt session');
  }
});

export default router;
