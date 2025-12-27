import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, liveChatMessages, users, eq, and, desc } from '@webedt/shared';
import { requireAuth } from '../middleware/auth.js';
import { logger, ensureValidToken, fetchEnvironmentIdFromSessions, getExecutionProvider } from '@webedt/shared';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import type { ExecutionEvent } from '@webedt/shared';

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
 * This connects to Claude Remote Sessions for execution
 */
router.post('/:owner/:repo/:branch/execute', async (req: Request, res: Response) => {
  let clientDisconnected = false;

  // Track client disconnect
  req.on('close', () => {
    clientDisconnected = true;
  });

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

    // Get user's Claude auth
    const [userData] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userData?.claudeAuth) {
      return res.status(400).json({
        error: 'Claude authentication not configured. Please connect your Claude account in settings.'
      });
    }

    // Refresh token if needed
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
      logger.error('Failed to refresh Claude token', { component: 'liveChat', error });
      return res.status(401).json({ error: 'Claude token expired. Please reconnect your Claude account.' });
    }

    // Get environment ID - from config or auto-detect
    let environmentId = CLAUDE_ENVIRONMENT_ID;
    if (!environmentId) {
      logger.info('CLAUDE_ENVIRONMENT_ID not configured, attempting auto-detection', { component: 'liveChat' });
      const detectedEnvId = await fetchEnvironmentIdFromSessions(
        claudeAuth.accessToken,
        CLAUDE_API_BASE_URL
      );

      if (detectedEnvId) {
        environmentId = detectedEnvId;
        logger.info('Auto-detected environment ID', {
          component: 'liveChat',
          environmentId: environmentId.slice(0, 10) + '...',
        });
      } else {
        return res.status(500).json({
          error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first.'
        });
      }
    }

    // Build git URL from owner/repo
    const gitUrl = `https://github.com/${owner}/${repo}`;

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
    res.setHeader('X-Accel-Buffering', 'no');

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

    // Helper to send SSE events
    const sendSSE = (event: string, data: unknown) => {
      if (clientDisconnected) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        logger.warn('Failed to write SSE event', { component: 'liveChat', error });
      }
    };

    sendSSE('connected', {
      workspace: { owner, repo, branch: decodedBranch },
      messageCount: history.length,
    });

    // Set up heartbeat to prevent proxy timeouts
    const heartbeatInterval = setInterval(() => {
      if (!clientDisconnected) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeatInterval);
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    // Get execution provider
    const provider = getExecutionProvider();
    const chatSessionId = uuidv4(); // Generate a unique ID for this execution

    // Collect assistant content from events
    let assistantContent = '';

    // Event handler to stream events to client
    const handleEvent = async (event: ExecutionEvent) => {
      if (clientDisconnected) return;

      // Stream the event to the client
      sendSSE(event.type, event);

      // Collect assistant message content
      if (event.type === 'assistant' && event.message) {
        const msg = event.message as { content?: string | Array<{ type: string; text?: string }> };
        if (typeof msg.content === 'string') {
          assistantContent += msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              assistantContent += block.text;
            }
          }
        }
      }
    };

    try {
      // Execute using the provider
      const result = await provider.execute(
        {
          userId,
          chatSessionId,
          prompt: message,
          gitUrl,
          claudeAuth,
          environmentId,
        },
        handleEvent
      );

      // Save assistant response to live chat messages
      if (assistantContent) {
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
      }

      sendSSE('completed', {
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        remoteSessionId: result.remoteSessionId,
        remoteWebUrl: result.remoteWebUrl,
      });

      logger.info('Execution completed', {
        component: 'liveChat',
        owner,
        repo,
        branch: decodedBranch,
        status: result.status,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Execution failed', { component: 'liveChat', error: errorMessage });

      sendSSE('error', {
        error: errorMessage,
      });
    } finally {
      clearInterval(heartbeatInterval);
    }

    if (!clientDisconnected) {
      res.end();
    }
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
