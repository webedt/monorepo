import { Router } from 'express';
import { Octokit } from '@octokit/rest';
import { db } from '../db/index';
import { chatSessions, messages, users, events } from '../db/index';
import type { ChatSession } from '../db/schema';
import { eq, desc, inArray, and, asc } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

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

// Get all chat sessions for user
router.get('/', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;

    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, authReq.user!.id))
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

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
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

// Bulk delete chat sessions
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
          eq(chatSessions.userId, authReq.user!.id)
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

    // Delete all sessions from database (cascade will delete messages)
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

// Delete a chat session
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

    const cleanupResults: { branch?: { success: boolean; message: string }; storage?: { success: boolean; message: string } } = {};

    // Delete GitHub branch if branch info exists
    if (session.branch && session.repositoryOwner && session.repositoryName && authReq.user?.githubAccessToken) {
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

    // Delete session from database (cascade will delete messages)
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

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

export default router;
