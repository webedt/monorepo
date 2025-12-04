import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { db } from '../db/index';
import { chatSessions, messages, users, events } from '../db/index';
import type { ChatSession } from '../db/schema';
import { eq, desc, inArray, and, asc, isNull, isNotNull } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { getPreviewUrl } from '../utils/previewUrlHelper';
import { activeWorkerSessions } from './execute';
import { sessionEventBroadcaster } from '../lib/sessionEventBroadcaster';
import { v4 as uuidv4 } from 'uuid';

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
    console.log(`[Sessions] Deleted GitHub branch ${owner}/${repo}/${branch}`);
    return { success: true, message: 'Branch deleted' };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // 422 or 404 means the branch doesn't exist (already deleted or never existed)
    if (err.status === 422 || err.status === 404) {
      console.log(`[Sessions] GitHub branch ${owner}/${repo}/${branch} not found (already deleted)`);
      return { success: true, message: 'Branch already deleted or does not exist' };
    }
    console.error(`[Sessions] Failed to delete GitHub branch ${owner}/${repo}/${branch}:`, error);
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
        console.log(`[Sessions] Storage session ${sessionPath} not found (already deleted)`);
        return { success: true, message: 'Session not found in storage' };
      }
      const error = await response.text();
      console.error(`[Sessions] Failed to delete storage session ${sessionPath}:`, error);
      return { success: false, message: 'Failed to delete from storage' };
    }

    console.log(`[Sessions] Deleted storage session ${sessionPath}`);
    return { success: true, message: 'Storage session deleted' };
  } catch (error) {
    console.error(`[Sessions] Error deleting storage session ${sessionPath}:`, error);
    return { success: false, message: 'Error deleting from storage' };
  }
}

const router = Router();

// Get all chat sessions for user (excluding deleted ones)
router.get('/', requireAuth, async (req, res) => {
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
    console.error('Get sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
  }
});

// Get all deleted chat sessions for user (with pagination)
router.get('/deleted', requireAuth, async (req, res) => {
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
    console.error('Get deleted sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch deleted sessions' });
  }
});

// Create a code-only session (no AI execution, just for tracking file operations)
// Creates a chat session exactly like starting a regular chat, so all actions appear as chat messages
router.post('/create-code-session', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { title, repositoryUrl, repositoryOwner, repositoryName, baseBranch, branch } = req.body;

    if (!repositoryOwner || !repositoryName || !branch) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: repositoryOwner, repositoryName, branch'
      });
      return;
    }

    // Generate UUID for the session
    const sessionId = crypto.randomUUID();
    const sessionPath = `${repositoryOwner}/${repositoryName}/${branch}`;

    // Create the session with 'completed' status - code sessions don't have active AI processing
    // This avoids showing the "Processing" spinner in the Chat view
    const [chatSession] = await db
      .insert(chatSessions)
      .values({
        id: sessionId,
        userId: authReq.user!.id,
        userRequest: title || 'Code editing session',
        status: 'completed', // No AI processing, just manual code editing
        repositoryUrl: repositoryUrl || `https://github.com/${repositoryOwner}/${repositoryName}.git`,
        repositoryOwner,
        repositoryName,
        baseBranch: baseBranch || 'main',
        branch,
        sessionPath,
        autoCommit: false,
        locked: true, // Prevent repo/branch changes
      })
      .returning();

    // Create an initial user message to mark the session start (like chat sessions have)
    await db
      .insert(messages)
      .values({
        chatSessionId: sessionId,
        type: 'user',
        content: `Started code editing session on repository ${repositoryOwner}/${repositoryName}`,
      });

    console.log(`[Sessions] Created code session ${sessionId} for ${sessionPath}`);

    res.json({
      success: true,
      data: {
        sessionId: chatSession.id,
        sessionPath: chatSession.sessionPath,
      },
    });
  } catch (error) {
    console.error('Create code session error:', error);
    res.status(500).json({ success: false, error: 'Failed to create code session' });
  }
});

// Get specific chat session
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id; // Support both UUID and sessionPath

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
        undefined, // workspace path not available in server context
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
    console.error('Get session error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
  }
});

// Create an event for a session (for streaming-style logs)
router.post('/:id/events', requireAuth, async (req, res) => {
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
    console.error('Create event error:', error);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

// Create a message for a session
router.post('/:id/messages', requireAuth, async (req, res) => {
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
    console.error('Create message error:', error);
    res.status(500).json({ success: false, error: 'Failed to create message' });
  }
});

// Get messages for a session
router.get('/:id/messages', requireAuth, async (req, res) => {
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

    // Debug: Log first message to verify images field is present
    if (sessionMessages.length > 0) {
      console.log('[Sessions] Sample message structure:', {
        id: sessionMessages[0].id,
        type: sessionMessages[0].type,
        hasImages: !!sessionMessages[0].images,
        imagesCount: sessionMessages[0].images?.length || 0,
      });
    }

    res.json({
      success: true,
      data: {
        messages: sessionMessages,
        total: sessionMessages.length,
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// Get events for a session (raw SSE events for replay)
router.get('/:id/events', requireAuth, async (req, res) => {
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

    // Get events ordered by timestamp (ascending for replay order)
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.chatSessionId, sessionId))
      .orderBy(asc(events.timestamp));

    res.json({
      success: true,
      data: {
        events: sessionEvents,
        total: sessionEvents.length,
      },
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch events' });
  }
});

// Update a chat session
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const sessionId = req.params.id;
    const { userRequest } = req.body;

    if (!sessionId) {
      res.status(400).json({ success: false, error: 'Invalid session ID' });
      return;
    }

    if (!userRequest || typeof userRequest !== 'string' || userRequest.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Invalid title' });
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

    // Update session
    const [updatedSession] = await db
      .update(chatSessions)
      .set({ userRequest: userRequest.trim() })
      .where(eq(chatSessions.id, sessionId))
      .returning();

    res.json({ success: true, data: updatedSession });
  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

// Unlock a chat session (allows creating new sessions for same repo/branch)
router.post('/:id/unlock', requireAuth, async (req, res) => {
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
    console.error('Unlock session error:', error);
    res.status(500).json({ success: false, error: 'Failed to unlock session' });
  }
});

// Abort a running session
router.post('/:id/abort', requireAuth, async (req, res) => {
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
      console.log(`[Sessions] Found active worker for session ${sessionId}: ${workerInfo.containerId}`);

      try {
        const abortResponse = await fetch(`${workerInfo.workerUrl}/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        if (abortResponse.ok) {
          const abortResult = await abortResponse.json();
          console.log(`[Sessions] Worker abort response:`, abortResult);
          workerAborted = true;
        } else {
          console.log(`[Sessions] Worker abort failed with status: ${abortResponse.status}`);
        }
      } catch (workerError) {
        console.error(`[Sessions] Failed to signal worker abort:`, workerError);
        // Continue - we'll still update the database
      }

      // Clean up the session mapping
      activeWorkerSessions.delete(sessionId);
    } else {
      console.log(`[Sessions] No active worker found for session ${sessionId} - may have already completed`);
    }

    // Update session status to interrupted
    await db
      .update(chatSessions)
      .set({ status: 'error', completedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    console.log(`[Sessions] Session ${sessionId} aborted by user (worker signaled: ${workerAborted})`);

    res.json({
      success: true,
      data: {
        message: workerAborted ? 'Session aborted and worker signaled' : 'Session aborted (worker may have already completed)',
        sessionId: sessionId,
        workerAborted
      }
    });
  } catch (error) {
    console.error('Abort session error:', error);
    res.status(500).json({ success: false, error: 'Failed to abort session' });
  }
});

// Bulk delete chat sessions (soft delete with branch cleanup)
router.post('/bulk-delete', requireAuth, async (req, res) => {
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
    } = {
      branches: [],
      storage: []
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
    console.error('Bulk delete sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete sessions' });
  }
});

// Bulk restore chat sessions
router.post('/bulk-restore', requireAuth, async (req, res) => {
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
    console.error('Bulk restore sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to restore sessions' });
  }
});

// Permanently delete chat sessions
// Note: GitHub branches and storage are already deleted during soft delete,
// so this only removes the database records permanently
router.post('/bulk-delete-permanent', requireAuth, async (req, res) => {
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

    // Permanently delete all sessions from database (cascade will delete messages)
    // Note: Branches and storage were already cleaned up during soft delete
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
    console.error('Bulk permanent delete sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to permanently delete sessions' });
  }
});

// Delete a chat session (soft delete with branch cleanup)
router.delete('/:id', requireAuth, async (req, res) => {
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
    console.error('Delete session error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete session' });
  }
});

// Restore a chat session
router.post('/:id/restore', requireAuth, async (req, res) => {
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
    console.error('Restore session error:', error);
    res.status(500).json({ success: false, error: 'Failed to restore session' });
  }
});

// Worker callback endpoint - allows ai-coding-worker to update session status
// This is called by the worker after it completes (even if the SSE connection was lost)
// Uses a shared secret for authentication since this is a server-to-server call
router.post('/:id/worker-status', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { status, completedAt, workerSecret } = req.body;

    // Validate worker secret (server-to-server auth)
    const expectedSecret = process.env.WORKER_CALLBACK_SECRET;
    if (!expectedSecret || workerSecret !== expectedSecret) {
      console.warn(`[Sessions] Invalid worker secret for session ${sessionId}`);
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
    // This prevents overwriting a status that was already set by another mechanism
    if (session.status !== 'running' && session.status !== 'pending') {
      console.log(`[Sessions] Session ${sessionId} already has status '${session.status}', skipping worker update to '${status}'`);
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

    console.log(`[Sessions] Worker callback updated session ${sessionId} status to '${status}'`);

    res.json({
      success: true,
      data: {
        message: 'Session status updated',
        sessionId,
        status
      }
    });
  } catch (error) {
    console.error('Worker status callback error:', error);
    res.status(500).json({ success: false, error: 'Failed to update session status' });
  }
});

// Stream events for a running session (SSE endpoint for reconnection)
// This allows clients to reconnect to an already-running session and receive live events
router.get('/:id/stream', requireAuth, async (req, res) => {
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

    // Check if the session is currently active (streaming from AI worker)
    if (!sessionEventBroadcaster.isSessionActive(sessionId)) {
      // Session is not currently streaming - return 204 No Content
      // The client should fall back to polling the events endpoint
      console.log(`[Sessions] Stream request for inactive session ${sessionId}`);
      res.status(204).end();
      return;
    }

    console.log(`[Sessions] Client reconnecting to active session stream: ${sessionId}`);

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send a connected event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ reconnected: true, sessionId })}\n\n`);

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

        // Write the event in SSE format
        res.write(`event: ${event.eventType}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      } catch (err) {
        console.error(`[Sessions] Error writing to stream for subscriber ${subscriberId}:`, err);
        unsubscribe();
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      console.log(`[Sessions] Client disconnected from session stream: ${sessionId}`);
      unsubscribe();
    });

    // Handle errors
    req.on('error', (err) => {
      console.error(`[Sessions] Stream error for session ${sessionId}:`, err);
      unsubscribe();
    });

  } catch (error) {
    console.error('Session stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to stream session events' });
    }
  }
});

export default router;
