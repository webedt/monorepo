/**
 * Sessions Routes
 * Handles chat session CRUD operations
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { db, chatSessions, messages, users, events } from '../../logic/db/index.js';
import type { ChatSession } from '../../logic/db/schema.js';
import { eq, desc, inArray, and, asc, isNull, isNotNull } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { getPreviewUrl, logger, generateSessionPath, ClaudeRemoteClient } from '@webedt/shared';
import { sessionEventBroadcaster } from '../../logic/sessions/sessionEventBroadcaster.js';
import { sessionListBroadcaster } from '../../logic/sessions/sessionListBroadcaster.js';
import { v4 as uuidv4 } from 'uuid';
import { ensureValidToken, type ClaudeAuth } from '../../logic/auth/claudeAuth.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '../../logic/config/env.js';

// Helper function to delete a GitHub branch
async function deleteGitHubBranch(
  githubAccessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ success: boolean; message: string }> {
  try {
    const octokit = new Octokit({ auth: githubAccessToken });
    await octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    logger.info(`Deleted GitHub branch ${owner}/${repo}/${branch}`, { component: 'Sessions' });
    return { success: true, message: 'Branch deleted' };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // 422 or 404 means the branch doesn't exist (already deleted or never existed)
    if (err.status === 422 || err.status === 404) {
      logger.info(`GitHub branch ${owner}/${repo}/${branch} not found (already deleted)`, { component: 'Sessions' });
      return { success: true, message: 'Branch already deleted or does not exist' };
    }
    logger.error(`Failed to delete GitHub branch ${owner}/${repo}/${branch}`, error as Error, { component: 'Sessions' });
    return { success: false, message: 'Failed to delete branch' };
  }
}

// Helper function to archive Claude Remote session
async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  logger.info('archiveClaudeRemoteSession called', {
    component: 'Sessions',
    remoteSessionId,
    hasAccessToken: !!claudeAuth.accessToken,
    hasRefreshToken: !!claudeAuth.refreshToken,
    environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
    baseUrl: CLAUDE_API_BASE_URL,
  });

  try {
    // Refresh token if needed
    logger.info('Refreshing Claude auth token if needed', { component: 'Sessions', remoteSessionId });
    const refreshedAuth = await ensureValidToken(claudeAuth);
    logger.info('Token refresh complete', {
      component: 'Sessions',
      remoteSessionId,
      tokenRefreshed: refreshedAuth !== claudeAuth,
    });

    const client = new ClaudeRemoteClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    logger.info('Calling ClaudeRemoteClient.archiveSession', { component: 'Sessions', remoteSessionId });
    await client.archiveSession(remoteSessionId);
    logger.info(`Successfully archived Claude Remote session ${remoteSessionId}`, { component: 'Sessions' });
    return { success: true, message: 'Remote session archived' };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('archiveClaudeRemoteSession error', error as Error, {
      component: 'Sessions',
      remoteSessionId,
      errorStatus: err.status,
      errorMessage: err.message,
    });
    // 404 means session doesn't exist (already archived or never existed)
    if (err.status === 404) {
      logger.info(`Claude Remote session ${remoteSessionId} not found (already archived)`, { component: 'Sessions' });
      return { success: true, message: 'Remote session already archived or does not exist' };
    }
    return { success: false, message: `Failed to archive remote session: ${err.message || 'Unknown error'}` };
  }
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

    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, authReq.user!.id),
          isNull(chatSessions.deletedAt)
        )
      )
      .orderBy(desc(chatSessions.createdAt));

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

    // Parse pagination params
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100 per request
    const offset = parseInt(req.query.offset as string) || 0;

    // Get total count
    const totalResult = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      );

    const total = totalResult.length;

    // Get paginated sessions
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, authReq.user!.id),
          isNotNull(chatSessions.deletedAt)
        )
      )
      .orderBy(desc(chatSessions.deletedAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: {
        sessions,
        total,
        limit,
        offset,
        hasMore: offset + sessions.length < total,
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

    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Check ownership
    if (session.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Add preview URL if repository info is available
    let previewUrl: string | null = null;
    if (session.repositoryOwner && session.repositoryName && session.branch) {
      previewUrl = await getPreviewUrl(
        undefined,
        session.repositoryOwner,
        session.repositoryName,
        session.branch
      );
    }

    res.json({
      success: true,
      session: {
        ...session,
        previewUrl
      }
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

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (eventData === undefined) {
      res.status(400).json({ success: false, error: 'eventData is required' });
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

    // Archive Claude Remote sessions
    // Check for both 'claude-remote' and 'claude' providers since sessions may have
    // remoteSessionId even with 'claude' provider (from sync or direct creation)
    if (authReq.user?.claudeAuth) {
      const remoteSessionArchives = sessions
        .filter((s: ChatSession) => (s.provider === 'claude-remote' || s.provider === 'claude') && s.remoteSessionId)
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

    // Permanently delete all sessions from database
    await db
      .delete(chatSessions)
      .where(
        and(
          inArray(chatSessions.id, ids),
          eq(chatSessions.userId, authReq.user!.id)
        )
      );

    res.json({
      success: true,
      data: {
        message: `${ids.length} session${ids.length !== 1 ? 's' : ''} permanently deleted`,
        count: ids.length
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
    // Check for both 'claude-remote' and 'claude' providers since sessions may have
    // remoteSessionId even with 'claude' provider (from sync or direct creation)
    const isClaudeProvider = session.provider === 'claude-remote' || session.provider === 'claude';
    const shouldArchive = isClaudeProvider && !!session.remoteSessionId && !!authReq.user?.claudeAuth;

    logger.info('Session deletion - checking Claude Remote archive conditions', {
      component: 'Sessions',
      sessionId,
      provider: session.provider ?? undefined,
      remoteSessionId: session.remoteSessionId ?? undefined,
      hasClaudeAuth: !!authReq.user?.claudeAuth,
      claudeAuthKeys: authReq.user?.claudeAuth ? Object.keys(authReq.user.claudeAuth as object) : [],
      isClaudeProvider,
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
        isClaudeProvider,
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

    // Send submission preview event immediately so user sees their request was received
    // userRequest contains the session title (updated when session_name event is received)
    const sessionName = session.userRequest || session.sessionPath || sessionId;
    const repoInfo = session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : null;
    const previewText = repoInfo
      ? `Resuming session: ${sessionName} (${repoInfo})`
      : `Resuming session: ${sessionName}`;

    res.write(`data: ${JSON.stringify({
      type: 'submission_preview',
      message: previewText,
      source: 'internal-api-server:/sessions/events/stream',
      timestamp: new Date().toISOString(),
      data: {
        sessionId,
        sessionName,
        repositoryOwner: session.repositoryOwner,
        repositoryName: session.repositoryName,
        branch: session.branch,
        status: session.status
      }
    })}\n\n`);

    // Send a connected event with session info
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({
      sessionId,
      status: session.status,
      isLive: isActive || isRecentlyActive,
      sessionPath: session.sessionPath,
      branch: session.branch,
      baseBranch: session.baseBranch,
      repositoryOwner: session.repositoryOwner,
      repositoryName: session.repositoryName,
      userRequest: session.userRequest,
      createdAt: session.createdAt,
      completedAt: session.completedAt
    })}\n\n`);

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

    // Send replay start marker
    res.write(`data: ${JSON.stringify({
      type: 'replay_start',
      totalEvents: storedEvents.length,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Replay each stored event
    for (const event of storedEvents) {
      if (res.writableEnded) break;
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

    // PHASE 2: Handle based on session status
    // Subscribe to live events if session is active in broadcaster OR has recent DB activity
    // This handles the case where the broadcaster might not have the session (e.g., server restart)
    // but the worker is still actively streaming events
    if (isActive || isRecentlyActive) {
      // Session is actively streaming - subscribe to live events
      const subscriberId = uuidv4();

      res.write(`data: ${JSON.stringify({
        type: 'live_stream_start',
        message: 'Now receiving live events',
        timestamp: new Date().toISOString()
      })}\n\n`);

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
      // Session is not actively streaming (completed, error, or orphaned)
      // Send completion event and close connection
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
 * This endpoint:
 * 1. Lists all active sessions from Anthropic API
 * 2. Finds sessions that don't exist in our database
 * 3. Imports missing sessions with their events
 * 4. Optionally starts streaming for active sessions
 *
 * Query params:
 * - activeOnly: boolean (default: true) - Only sync non-archived sessions
 * - stream: boolean (default: false) - Start streaming for active sessions
 * - limit: number (default: 50) - Max sessions to fetch from Anthropic
 */
router.post('/sync', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  const activeOnly = req.query.activeOnly !== 'false';
  const shouldStream = req.query.stream === 'true';
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  logger.info('Starting session sync from Anthropic API', {
    component: 'SessionSync',
    userId,
    activeOnly,
    shouldStream,
    limit
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

    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(user.claudeAuth);

    // Update token in database if it was refreshed
    if (refreshedAuth.accessToken !== user.claudeAuth.accessToken) {
      await db
        .update(users)
        .set({ claudeAuth: refreshedAuth })
        .where(eq(users.id, userId));
    }

    // Create Claude client
    const client = new ClaudeRemoteClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    // Fetch sessions from Anthropic
    const remoteSessions = await client.listSessions(limit);
    logger.info(`Fetched ${remoteSessions.data.length} sessions from Anthropic`, {
      component: 'SessionSync',
      hasMore: remoteSessions.has_more
    });

    // Get existing remote session IDs from our database
    const existingSessions = await db
      .select({ remoteSessionId: chatSessions.remoteSessionId })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, userId),
          isNotNull(chatSessions.remoteSessionId)
        )
      );

    const existingRemoteIds = new Set(
      existingSessions.map(s => s.remoteSessionId).filter(Boolean)
    );

    // Find sessions that need to be imported
    const sessionsToImport = remoteSessions.data.filter(session => {
      // Skip if already in database
      if (existingRemoteIds.has(session.id)) {
        return false;
      }
      // Filter by status if activeOnly
      if (activeOnly && session.session_status === 'archived') {
        return false;
      }
      return true;
    });

    logger.info(`Found ${sessionsToImport.length} sessions to import`, {
      component: 'SessionSync',
      total: remoteSessions.data.length,
      existing: existingRemoteIds.size
    });

    const imported: Array<{
      id: string;
      remoteSessionId: string;
      title: string;
      status: string;
      eventsImported: number;
    }> = [];

    const errors: Array<{
      remoteSessionId: string;
      error: string;
    }> = [];

    // Import each missing session
    for (const remoteSession of sessionsToImport) {
      try {
        // Fetch events for this session
        const eventsResponse = await client.getEvents(remoteSession.id);
        const sessionEvents = eventsResponse.data || [];

        // Extract repository info from session context
        const gitSource = remoteSession.session_context?.sources?.find(s => s.type === 'git_repository');
        const gitOutcome = remoteSession.session_context?.outcomes?.find(o => o.type === 'git_repository');

        let repositoryUrl: string | undefined;
        let repositoryOwner: string | undefined;
        let repositoryName: string | undefined;
        let branch: string | undefined;

        if (gitSource?.url) {
          repositoryUrl = gitSource.url;
          const match = gitSource.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            repositoryOwner = match[1];
            repositoryName = match[2].replace(/\.git$/, '');
          }
        }

        if (gitOutcome?.git_info?.branches?.[0]) {
          branch = gitOutcome.git_info.branches[0];
        }

        // Map Anthropic status to our status
        const statusMap: Record<string, string> = {
          'idle': 'completed',
          'running': 'running',
          'completed': 'completed',
          'failed': 'error',
          'archived': 'completed'
        };
        const status = statusMap[remoteSession.session_status] || 'pending';

        // Create chat session in database
        const sessionId = uuidv4();
        const sessionPath = repositoryOwner && repositoryName && branch
          ? generateSessionPath(repositoryOwner, repositoryName, branch)
          : undefined;

        // Extract user request from first user event
        let userRequest = remoteSession.title || 'Imported session';
        const firstUserEvent = sessionEvents.find(e => e.type === 'user' && (e.message as any)?.content);
        const firstUserMessage = firstUserEvent?.message as { content?: unknown } | undefined;
        if (firstUserMessage?.content) {
          const content = firstUserMessage.content;
          userRequest = typeof content === 'string'
            ? content.slice(0, 500)
            : JSON.stringify(content).slice(0, 500);
        }

        // Extract total cost from result event
        let totalCost: string | undefined;
        const resultEvent = sessionEvents.find(e => e.type === 'result' && e.total_cost_usd);
        if (resultEvent?.total_cost_usd) {
          totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
        }

        await db.insert(chatSessions).values({
          id: sessionId,
          userId,
          userRequest,
          status,
          provider: 'claude-remote',
          remoteSessionId: remoteSession.id,
          remoteWebUrl: `https://claude.ai/code/${remoteSession.id}`,
          totalCost,
          repositoryUrl,
          repositoryOwner,
          repositoryName,
          branch,
          sessionPath,
          createdAt: new Date(remoteSession.created_at),
          completedAt: status === 'completed' || status === 'error'
            ? new Date(remoteSession.updated_at)
            : undefined,
        });

        // Import events
        let eventsImported = 0;
        for (const event of sessionEvents) {
          await db.insert(events).values({
            chatSessionId: sessionId,
            eventData: event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          });
          eventsImported++;
        }

        imported.push({
          id: sessionId,
          remoteSessionId: remoteSession.id,
          title: remoteSession.title,
          status,
          eventsImported
        });

        logger.info(`Imported session ${remoteSession.id}`, {
          component: 'SessionSync',
          sessionId,
          eventsImported,
          status
        });

        // If session is active and streaming requested, start polling
        if (shouldStream && remoteSession.session_status === 'running') {
          // Note: Full streaming implementation would require spawning a background
          // polling task. For now, we just mark it as running and the user can
          // use the /events/stream endpoint to start receiving events.
          logger.info(`Session ${remoteSession.id} is running - use /api/sessions/${sessionId}/events/stream to receive events`, {
            component: 'SessionSync'
          });
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          remoteSessionId: remoteSession.id,
          error: errorMessage
        });
        logger.error(`Failed to import session ${remoteSession.id}`, error as Error, {
          component: 'SessionSync'
        });
      }
    }

    // Find sessions that exist but might have new events (running sessions)
    const runningSessions = remoteSessions.data.filter(
      session => session.session_status === 'running' && existingRemoteIds.has(session.id)
    );

    return res.json({
      success: true,
      data: {
        totalFromApi: remoteSessions.data.length,
        alreadyExists: existingRemoteIds.size,
        imported: imported.length,
        errors: errors.length,
        runningSessions: runningSessions.length,
        hasMore: remoteSessions.has_more,
        details: {
          imported,
          errors,
          running: runningSessions.map(s => ({
            remoteSessionId: s.id,
            title: s.title,
            status: s.session_status
          }))
        }
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
 */
router.post('/:id/sync-events', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  const sessionId = req.params.id;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  try {
    // Get the session
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

    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(user.claudeAuth);

    // Create Claude client
    const client = new ClaudeRemoteClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    // Get remote session status
    const remoteSession = await client.getSession(session.remoteSessionId);

    // Get existing event UUIDs
    const existingEvents = await db
      .select({ eventData: events.eventData })
      .from(events)
      .where(eq(events.chatSessionId, sessionId));

    const existingUuids = new Set(
      existingEvents
        .map(e => (e.eventData as { uuid?: string })?.uuid)
        .filter(Boolean)
    );

    // Fetch all events from Anthropic
    const eventsResponse = await client.getEvents(session.remoteSessionId);
    const remoteEvents = eventsResponse.data || [];

    // Find new events
    const newEvents = remoteEvents.filter(e => !existingUuids.has(e.uuid));

    // Import new events
    let imported = 0;
    for (const event of newEvents) {
      await db.insert(events).values({
        chatSessionId: sessionId,
        eventData: event,
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      });
      imported++;
    }

    // Update session status if changed
    const statusMap: Record<string, string> = {
      'idle': 'completed',
      'running': 'running',
      'completed': 'completed',
      'failed': 'error',
      'archived': 'completed'
    };
    const newStatus = statusMap[remoteSession.session_status] || session.status;

    // Extract total cost from result event if present
    let totalCost = session.totalCost;
    const resultEvent = remoteEvents.find(e => e.type === 'result' && e.total_cost_usd);
    if (resultEvent?.total_cost_usd) {
      totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
    }

    if (newStatus !== session.status || totalCost !== session.totalCost) {
      await db
        .update(chatSessions)
        .set({
          status: newStatus,
          totalCost,
          completedAt: (newStatus === 'completed' || newStatus === 'error') && !session.completedAt
            ? new Date()
            : session.completedAt,
        })
        .where(eq(chatSessions.id, sessionId));
    }

    logger.info(`Synced events for session ${sessionId}`, {
      component: 'SessionSync',
      remoteSessionId: session.remoteSessionId,
      existingEvents: existingUuids.size,
      newEvents: imported,
      remoteStatus: remoteSession.session_status
    });

    return res.json({
      success: true,
      data: {
        sessionId,
        remoteSessionId: session.remoteSessionId,
        existingEvents: existingUuids.size,
        newEventsImported: imported,
        totalEvents: existingUuids.size + imported,
        remoteStatus: remoteSession.session_status,
        localStatus: newStatus
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
