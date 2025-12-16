/**
 * Sessions Routes
 * Handles chat session CRUD operations
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import * as os from 'os';
import * as path from 'path';
import { db, chatSessions, messages, users, events } from '../db/index.js';
import type { ChatSession } from '../db/schema.js';
import { eq, desc, inArray, and, asc, isNull, isNotNull } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { getPreviewUrl, logger, generateSessionPath, ClaudeRemoteClient } from '@webedt/shared';
import { activeWorkerSessions } from './execute.js';
import { sessionEventBroadcaster } from '../lib/sessionEventBroadcaster.js';
import { v4 as uuidv4 } from 'uuid';
import { GitHubOperations } from '../services/github/operations.js';
import { storageService } from '../services/storage/storageService.js';
import { ensureValidToken, type ClaudeAuth } from '../lib/claudeAuth.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '../config/env.js';

const STORAGE_WORKER_URL = process.env.STORAGE_WORKER_URL || 'http://storage-worker:3000';

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

// Helper function to delete session from storage worker
async function deleteFromStorageWorker(sessionPath: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // 404 means session doesn't exist in storage (never uploaded or already deleted)
      if (response.status === 404) {
        logger.info(`Storage session ${sessionPath} not found (already deleted)`, { component: 'Sessions' });
        return { success: true, message: 'Session not found in storage' };
      }
      const error = await response.text();
      logger.error(`Failed to delete storage session ${sessionPath}: ${error}`, undefined, { component: 'Sessions' });
      return { success: false, message: 'Failed to delete from storage' };
    }

    logger.info(`Deleted storage session ${sessionPath}`, { component: 'Sessions' });
    return { success: true, message: 'Storage session deleted' };
  } catch (error) {
    logger.error(`Error deleting storage session ${sessionPath}`, error as Error, { component: 'Sessions' });
    return { success: false, message: 'Error deleting from storage' };
  }
}

// Helper function to archive Claude Remote session
async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(claudeAuth);

    const client = new ClaudeRemoteClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    await client.archiveSession(remoteSessionId);
    logger.info(`Archived Claude Remote session ${remoteSessionId}`, { component: 'Sessions' });
    return { success: true, message: 'Remote session archived' };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // 404 means session doesn't exist (already archived or never existed)
    if (err.status === 404) {
      logger.info(`Claude Remote session ${remoteSessionId} not found (already archived)`, { component: 'Sessions' });
      return { success: true, message: 'Remote session already archived or does not exist' };
    }
    logger.error(`Failed to archive Claude Remote session ${remoteSessionId}`, error as Error, { component: 'Sessions' });
    return { success: false, message: 'Failed to archive remote session' };
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

// Create a code-only session (no AI execution, just for tracking file operations)
// This endpoint clones the repository and uploads files to storage
router.post('/create-code-session', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { title, repositoryUrl, repositoryOwner, repositoryName, baseBranch } = req.body;

    if (!repositoryOwner || !repositoryName) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: repositoryOwner, repositoryName'
      });
      return;
    }

    // Require GitHub access token for cloning
    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({
        success: false,
        error: 'GitHub access token required. Please connect your GitHub account.'
      });
      return;
    }

    // Generate UUID for the session
    const sessionId = crypto.randomUUID();
    const repoUrl = repositoryUrl || `https://github.com/${repositoryOwner}/${repositoryName}.git`;
    const effectiveBaseBranch = baseBranch || 'main';

    logger.info(`Creating code session ${sessionId} for ${repositoryOwner}/${repositoryName}`, {
      component: 'Sessions',
      sessionId,
      repoUrl,
      baseBranch: effectiveBaseBranch
    });

    // Initialize storage service
    await storageService.initialize();

    // Create GitHubOperations instance
    const githubOperations = new GitHubOperations(storageService);

    // Define workspace root (temporary directory for cloning)
    const workspaceRoot = path.join(os.tmpdir(), 'code-sessions');

    // Call initSession to clone the repo and upload to storage
    // This generates a branch name and session title
    const initResult = await githubOperations.initSession(
      {
        sessionId,
        repoUrl,
        branch: effectiveBaseBranch,
        userRequest: title || 'Code editing session',
        githubAccessToken: authReq.user.githubAccessToken,
        workspaceRoot,
        // No coding assistant for code-only sessions
        codingAssistantProvider: undefined,
        codingAssistantAuthentication: undefined
      },
      (event) => {
        logger.info(`Init session progress: ${event.message}`, {
          component: 'Sessions',
          sessionId,
          stage: event.stage
        });
      }
    );

    // Generate session path using the branch name from initResult
    const sessionPath = generateSessionPath(repositoryOwner, repositoryName, initResult.branchName);

    // Create the session with 'completed' status - code sessions don't have active AI processing
    const [chatSession] = await db
      .insert(chatSessions)
      .values({
        id: sessionId,
        userId: authReq.user!.id,
        userRequest: initResult.sessionTitle || title || 'Code editing session',
        status: 'completed',
        repositoryUrl: repoUrl,
        repositoryOwner,
        repositoryName,
        baseBranch: effectiveBaseBranch,
        branch: initResult.branchName,
        sessionPath,
        autoCommit: false,
        locked: true,
      })
      .returning();

    // Create an initial user message
    await db
      .insert(messages)
      .values({
        chatSessionId: sessionId,
        type: 'user',
        content: `Started code editing session on repository ${repositoryOwner}/${repositoryName}`,
      });

    logger.info(`Created code session ${sessionId} with branch ${initResult.branchName}`, {
      component: 'Sessions',
      sessionId,
      sessionPath,
      branchName: initResult.branchName,
      sessionTitle: initResult.sessionTitle
    });

    res.json({
      success: true,
      data: {
        sessionId: chatSession.id,
        sessionPath: chatSession.sessionPath,
        branchName: initResult.branchName,
        sessionTitle: initResult.sessionTitle
      },
    });
  } catch (error) {
    logger.error('Create code session error', error as Error, { component: 'Sessions' });
    res.status(500).json({ success: false, error: 'Failed to create code session' });
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
      data: {
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
    const { eventType, eventData } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (!eventType || eventData === undefined) {
      res.status(400).json({ success: false, error: 'eventType and eventData are required' });
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
        eventType,
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

    // Try to signal the AI worker to abort
    let workerAborted = false;
    const workerInfo = activeWorkerSessions.get(sessionId);

    if (workerInfo) {
      logger.info(`Found active worker for session ${sessionId}: ${workerInfo.containerId}`, { component: 'Sessions' });

      try {
        const abortResponse = await fetch(`${workerInfo.workerUrl}/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        if (abortResponse.ok) {
          const abortResult = await abortResponse.json();
          logger.info(`Worker abort response: ${JSON.stringify(abortResult)}`, { component: 'Sessions' });
          workerAborted = true;
        } else {
          logger.warn(`Worker abort failed with status: ${abortResponse.status}`, { component: 'Sessions' });
        }
      } catch (workerError) {
        logger.error('Failed to signal worker abort', workerError as Error, { component: 'Sessions' });
      }

      // Clean up the session mapping
      activeWorkerSessions.delete(sessionId);
    } else {
      logger.info(`No active worker found for session ${sessionId} - may have already completed`, { component: 'Sessions' });
    }

    // Update session status to interrupted
    await db
      .update(chatSessions)
      .set({ status: 'error', completedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    logger.info(`Session ${sessionId} aborted by user (worker signaled: ${workerAborted})`, { component: 'Sessions' });

    res.json({
      success: true,
      data: {
        message: workerAborted ? 'Session aborted and worker signaled' : 'Session aborted (worker may have already completed)',
        sessionId: sessionId,
        workerAborted
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
      storage: { sessionPath: string; success: boolean; message: string }[];
      remoteSessions: { remoteSessionId: string; success: boolean; message: string }[];
    } = {
      branches: [],
      storage: [],
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

    // Delete from storage worker for all sessions that have sessionPath
    const storageDeletions = sessions
      .filter((s: ChatSession) => s.sessionPath)
      .map(async (session: ChatSession) => {
        const result = await deleteFromStorageWorker(session.sessionPath!);
        return { sessionPath: session.sessionPath!, ...result };
      });
    cleanupResults.storage = await Promise.all(storageDeletions);

    // Archive Claude Remote sessions
    if (authReq.user?.claudeAuth) {
      const remoteSessionArchives = sessions
        .filter((s: ChatSession) => s.provider === 'claude-remote' && s.remoteSessionId)
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
      storage?: { success: boolean; message: string };
      remoteSession?: { success: boolean; message: string };
    } = {};

    // Delete GitHub branch if it exists
    if (authReq.user?.githubAccessToken && session.branch && session.repositoryOwner && session.repositoryName) {
      cleanupResults.branch = await deleteGitHubBranch(
        authReq.user.githubAccessToken,
        session.repositoryOwner,
        session.repositoryName,
        session.branch
      );
    }

    // Delete from storage worker if sessionPath exists
    if (session.sessionPath) {
      cleanupResults.storage = await deleteFromStorageWorker(session.sessionPath);
    }

    // Archive Claude Remote session if it exists
    if (session.provider === 'claude-remote' && session.remoteSessionId && authReq.user?.claudeAuth) {
      cleanupResults.remoteSession = await archiveClaudeRemoteSession(
        session.remoteSessionId,
        authReq.user.claudeAuth as ClaudeAuth
      );
    }

    // Soft delete session from database
    await db
      .update(chatSessions)
      .set({ deletedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

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

// Stream events for a running session (SSE endpoint for reconnection)
// This provides HYBRID replay + live: first sends stored events, then subscribes to live
router.get('/:id/stream', requireAuth, async (req: Request, res: Response) => {
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

    // Check if the session is currently active in broadcaster
    const isActive = sessionEventBroadcaster.isSessionActive(sessionId);

    // Also check DB-backed activity for running sessions (handles server restart case)
    const workerLastActivity = session.workerLastActivity;
    const activityThresholdMs = 2 * 60 * 1000; // 2 minutes
    const isRecentlyActive = session.status === 'running' && workerLastActivity &&
      (Date.now() - new Date(workerLastActivity).getTime() < activityThresholdMs);

    // If session is not active and not recently active, return 204 (no content)
    if (!isActive && !isRecentlyActive) {
      logger.info(`Stream request for inactive session ${sessionId}`, { component: 'Sessions' });
      res.status(204).end();
      return;
    }

    logger.info(`Client reconnecting to session stream: ${sessionId}`, {
      component: 'Sessions',
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

    // Send a connected event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ reconnected: true, sessionId })}\n\n`);

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

    // PHASE 2: Subscribe to live events (only if session is still active)
    if (isActive) {
      // Generate a unique subscriber ID
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
      // Session is not in active broadcaster but was recently active
      // Send completion event since we can't subscribe to live stream
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({
        websiteSessionId: sessionId,
        completed: true,
        replayed: true,
        note: 'Live stream not available, events replayed from database'
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Session stream error', error as Error, { component: 'Sessions' });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to stream session events' });
    }
  }
});

export default router;
