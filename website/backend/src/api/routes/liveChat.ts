import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, liveChatMessages, eq, and, desc } from '@webedt/shared';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/live-chat/:owner/:repo/:branch/messages
 * Get messages for a branch-based live chat
 */
router.get('/:owner/:repo/:branch/messages', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit as string) || 100;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Decode branch name (may be URL encoded)
    const decodedBranch = decodeURIComponent(branch);

    const messages = await db
      .select()
      .from(liveChatMessages)
      .where(
        and(
          eq(liveChatMessages.owner, owner),
          eq(liveChatMessages.repo, repo),
          eq(liveChatMessages.branch, decodedBranch),
          eq(liveChatMessages.userId, userId)
        )
      )
      .orderBy(desc(liveChatMessages.createdAt))
      .limit(limit);

    // Reverse to get chronological order
    messages.reverse();

    res.json({
      success: true,
      data: {
        messages,
        branch: decodedBranch,
        owner,
        repo,
      },
    });
  } catch (error) {
    logger.error('liveChat', 'Failed to get live chat messages', { error });
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * POST /api/live-chat/:owner/:repo/:branch/messages
 * Add a message to a branch-based live chat
 */
router.post('/:owner/:repo/:branch/messages', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const { role, content, images } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!role || !content) {
      return res.status(400).json({ error: 'Missing required fields: role, content' });
    }

    // Decode branch name
    const decodedBranch = decodeURIComponent(branch);

    const message = {
      id: uuidv4(),
      userId,
      owner,
      repo,
      branch: decodedBranch,
      role,
      content,
      images: images || null,
      createdAt: new Date(),
    };

    await db.insert(liveChatMessages).values(message);

    res.json({
      success: true,
      data: message,
    });
  } catch (error) {
    logger.error('liveChat', 'Failed to add live chat message', { error });
    res.status(500).json({ error: 'Failed to add message' });
  }
});

/**
 * DELETE /api/live-chat/:owner/:repo/:branch/messages
 * Clear all messages for a branch-based live chat
 */
router.delete('/:owner/:repo/:branch/messages', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Decode branch name
    const decodedBranch = decodeURIComponent(branch);

    await db
      .delete(liveChatMessages)
      .where(
        and(
          eq(liveChatMessages.owner, owner),
          eq(liveChatMessages.repo, repo),
          eq(liveChatMessages.branch, decodedBranch),
          eq(liveChatMessages.userId, userId)
        )
      );

    res.json({
      success: true,
      message: 'Messages cleared',
    });
  } catch (error) {
    logger.error('liveChat', 'Failed to clear live chat messages', { error });
    res.status(500).json({ error: 'Failed to clear messages' });
  }
});

/**
 * POST /api/live-chat/:owner/:repo/:branch/execute
 * Execute LLM for live chat (streaming response)
 * This connects to the AI worker for execution
 */
router.post('/:owner/:repo/:branch/execute', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const { message, images } = req.body;
    const userId = req.user?.id;
    const user = req.user;

    if (!userId || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Missing required field: message' });
    }

    // Decode branch name
    const decodedBranch = decodeURIComponent(branch);

    // Save user message first
    const userMessage = {
      id: uuidv4(),
      userId,
      owner,
      repo,
      branch: decodedBranch,
      role: 'user',
      content: message,
      images: images || null,
      createdAt: new Date(),
    };

    await db.insert(liveChatMessages).values(userMessage);

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Get message history for context
    const history = await db
      .select()
      .from(liveChatMessages)
      .where(
        and(
          eq(liveChatMessages.owner, owner),
          eq(liveChatMessages.repo, repo),
          eq(liveChatMessages.branch, decodedBranch),
          eq(liveChatMessages.userId, userId)
        )
      )
      .orderBy(desc(liveChatMessages.createdAt))
      .limit(50);

    history.reverse();

    // For now, send a placeholder response indicating Live Chat is ready
    // Full LLM execution will be implemented in Phase 5b
    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('connected', {
      workspace: { owner, repo, branch: decodedBranch },
      messageCount: history.length,
    });

    // TODO: Connect to AI worker for actual LLM execution
    // For now, send a placeholder assistant message
    const assistantContent = `I'm ready to help you with the codebase at **${owner}/${repo}** on branch **${decodedBranch}**.

Live Chat is now active. I can help you:
- Navigate and understand the code
- Make file changes
- Answer questions about the codebase

What would you like to work on?`;

    const assistantMessage = {
      id: uuidv4(),
      userId,
      owner,
      repo,
      branch: decodedBranch,
      role: 'assistant',
      content: assistantContent,
      images: null,
      createdAt: new Date(),
    };

    await db.insert(liveChatMessages).values(assistantMessage);

    sendSSE('assistant_message', {
      content: assistantContent,
    });

    sendSSE('completed', {
      messageId: assistantMessage.id,
    });

    res.end();
  } catch (error) {
    logger.error('liveChat', 'Failed to execute live chat', { error });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to execute' });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution failed' })}\n\n`);
      res.end();
    }
  }
});

export default router;
