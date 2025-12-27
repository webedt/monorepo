import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, liveChatMessages, users, eq, and, desc } from '@webedt/shared';
import { requireAuth } from '../middleware/auth.js';
import {
  logger,
  ServiceProvider,
  AClaudeWebClient,
  ensureValidToken,
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  fetchEnvironmentIdFromSessions,
} from '@webedt/shared';
import type { ClaudeAuth, ClaudeWebClientConfig, SessionEvent } from '@webedt/shared';

const router = Router();

/**
 * Get and configure the Claude Web Client with the given credentials.
 */
function getClaudeClient(config: ClaudeWebClientConfig): AClaudeWebClient {
  const client = ServiceProvider.get(AClaudeWebClient);
  client.configure(config);
  return client;
}

/**
 * Build a prompt with conversation context for the Claude session.
 * Includes recent messages as context so Claude understands the conversation.
 */
function buildPromptWithContext(
  currentMessage: string,
  history: Array<{ role: string; content: string }>,
  owner: string,
  repo: string,
  branch: string
): string {
  const contextMessages = history.slice(-10); // Last 10 messages for context

  let prompt = `You are helping with the codebase at https://github.com/${owner}/${repo} on branch "${branch}".

`;

  if (contextMessages.length > 1) {
    prompt += `## Previous Conversation Context
`;
    for (const msg of contextMessages.slice(0, -1)) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}\n\n`;
    }
    prompt += `---

`;
  }

  prompt += `## Current Request
${currentMessage}`;

  return prompt;
}

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
 * Build prompt content with optional images.
 * Returns content blocks compatible with Claude API.
 */
function buildPromptContent(
  prompt: string,
  images?: Array<{ data: string; mediaType: string }>
): string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> {
  if (!images || images.length === 0) {
    return prompt;
  }

  // Build content blocks with text and images
  const contentBlocks: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [
    { type: 'text', text: prompt }
  ];

  for (const img of images) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }

  return contentBlocks;
}

/**
 * POST /api/live-chat/:owner/:repo/:branch/execute
 * Execute LLM for live chat (streaming response)
 * Uses ClaudeWebClient for actual AI execution with full code context
 */
router.post('/:owner/:repo/:branch/execute', async (req: Request, res: Response) => {
  let clientDisconnected = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Track client disconnect
  req.on('close', () => {
    clientDisconnected = true;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
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

    // Helper to send SSE events, respecting client disconnect
    const sendSSE = (event: string, data: unknown) => {
      if (clientDisconnected) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        logger.warn('Failed to write SSE event', { component: 'LiveChat', error: err });
      }
    };

    // Set up heartbeat to prevent proxy timeouts (15 second interval)
    heartbeatInterval = setInterval(() => {
      if (!clientDisconnected) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
        }
      } else if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }, 15000);

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

    sendSSE('connected', {
      workspace: { owner, repo, branch: decodedBranch },
      messageCount: history.length,
    });

    // Get Claude auth for the user
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!dbUser?.claudeAuth) {
      sendSSE('error', { error: 'Claude authentication not configured. Please connect your Claude account in settings.' });
      res.end();
      return;
    }

    // Parse Claude auth
    let claudeAuth: ClaudeAuth;
    try {
      claudeAuth = typeof dbUser.claudeAuth === 'string'
        ? JSON.parse(dbUser.claudeAuth)
        : dbUser.claudeAuth as ClaudeAuth;
    } catch {
      sendSSE('error', { error: 'Invalid Claude authentication data' });
      res.end();
      return;
    }

    // Ensure we have a valid token and save if refreshed
    const validAuth = await ensureValidToken(claudeAuth);
    if (!validAuth) {
      sendSSE('error', { error: 'Claude token expired and could not be refreshed' });
      res.end();
      return;
    }

    // Save refreshed token back to database if it changed
    if (validAuth.accessToken !== claudeAuth.accessToken) {
      try {
        await db.update(users)
          .set({ claudeAuth: validAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
          .where(eq(users.id, userId));
        logger.info('Refreshed Claude token saved to database', { component: 'LiveChat', userId });
      } catch (err) {
        logger.warn('Failed to save refreshed token', { component: 'LiveChat', error: err });
      }
    }

    // Get environment ID - from config or auto-detect
    let environmentId = CLAUDE_ENVIRONMENT_ID;
    if (!environmentId) {
      const detectedEnvId = await fetchEnvironmentIdFromSessions(
        validAuth.accessToken,
        CLAUDE_API_BASE_URL
      );
      if (detectedEnvId) {
        environmentId = detectedEnvId;
      } else {
        sendSSE('error', { error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first.' });
        res.end();
        return;
      }
    }

    // Build prompt with conversation context
    const textPrompt = buildPromptWithContext(
      message,
      history.map(m => ({ role: m.role, content: m.content })),
      owner,
      repo,
      decodedBranch
    );

    // Build prompt content with optional images
    const promptContent = buildPromptContent(textPrompt, images);

    // Build git URL for the repository
    const gitUrl = `https://github.com/${owner}/${repo}`;

    // Create Claude client
    const client = getClaudeClient({
      accessToken: validAuth.accessToken,
      environmentId,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    logger.info('Starting Claude execution for live chat', {
      component: 'LiveChat',
      owner,
      repo,
      branch: decodedBranch,
      messageLength: message.length,
      hasImages: images && images.length > 0,
    });

    // Collect assistant response text for storage
    let assistantContent = '';

    try {
      // Execute with ClaudeWebClient
      const result = await client.execute(
        {
          prompt: promptContent,
          gitUrl,
          branchPrefix: `claude/chat-${Date.now()}`,
          title: `Live Chat: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
        },
        async (event: SessionEvent) => {
          if (clientDisconnected) return;

          // Extract text content from assistant events
          if (event.type === 'assistant' && event.message?.content) {
            const content = event.message.content;
            // Content could be string or array of content blocks
            if (typeof content === 'string') {
              assistantContent += content;
              sendSSE('assistant_message', { content, partial: true });
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  assistantContent += block.text;
                  sendSSE('assistant_message', { content: block.text, partial: true });
                }
              }
            }
          }

          // Forward relevant events to client
          if (event.type === 'tool_use' || event.type === 'tool_result') {
            sendSSE('tool_event', event);
          }

          // Forward env_manager_log events as status updates
          if (event.type === 'env_manager_log' && event.data?.message) {
            sendSSE('status', { message: event.data.message });
          }
        }
      );

      logger.info('Claude execution completed for live chat', {
        component: 'LiveChat',
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
      });

      // Use collected content or a summary from result
      const finalContent = assistantContent || result.result || 'Task completed.';

      // Save assistant message
      const assistantMessage = {
        id: uuidv4(),
        userId,
        owner,
        repo,
        branch: decodedBranch,
        role: 'assistant',
        content: finalContent,
        images: null,
        createdAt: new Date(),
      };

      await db.insert(liveChatMessages).values(assistantMessage);

      sendSSE('completed', {
        messageId: assistantMessage.id,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
      });

    } catch (execError) {
      const errorMessage = execError instanceof Error ? execError.message : 'Execution failed';
      logger.error('Claude execution failed for live chat', execError as Error, {
        component: 'LiveChat',
        owner,
        repo,
        branch: decodedBranch,
      });

      sendSSE('error', { error: errorMessage });
    }

    // Clean up heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }

    if (!clientDisconnected) {
      res.end();
    }
  } catch (error) {
    logger.error('liveChat', 'Failed to execute live chat', { error });
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to execute' });
    } else if (!clientDisconnected) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution failed' })}\n\n`);
      res.end();
    }
  }
});

export default router;
