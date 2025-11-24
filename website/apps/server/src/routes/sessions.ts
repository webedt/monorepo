import { Router } from 'express';
import { db } from '../db/index';
import { chatSessions, messages } from '../db/index';
import { eq, desc, inArray, and } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

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

    // Delete all sessions (cascade will delete messages)
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
        count: ids.length
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

    // Delete session (cascade will delete messages)
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    res.json({ success: true, data: { message: 'Session deleted' } });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete session' });
  }
});

export default router;
