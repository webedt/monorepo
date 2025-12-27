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
import type { ClaudeAuth, ClaudeWebClientConfig, ClaudeSessionEvent } from '@webedt/shared';

// Maximum length for accumulated assistant response (100KB)
const MAX_ASSISTANT_CONTENT_LENGTH = 100 * 1024;

// Execution timeout: 10 minutes with 2 second polls = 300 polls
const MAX_EXECUTION_POLLS = 300;

/**
 * Type guard to check if an event is an assistant event with message content
 */
function isAssistantEvent(event: ClaudeSessionEvent): boolean {
  return event.type === 'assistant' && event.message !== undefined;
}

/**
 * Type guard to check if an event is a tool event
 */
function isToolEvent(event: ClaudeSessionEvent): boolean {
  return event.type === 'tool_use' || event.type === 'tool_result';
}

/**
 * Safely extract text content from an assistant event message
 */
function extractTextFromMessage(message: ClaudeSessionEvent['message']): string {
  if (!message?.content) return '';

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((block): block is { type: string; text?: string } =>
        block !== null &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      )
      .map(block => block.text ?? '')
      .join('');
  }

  return '';
}

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
 * POST /api/live-chat/:owner/:repo/:branch/execute
 * Execute LLM for live chat (streaming response)
 * Uses ClaudeWebClient for actual AI execution with full code context
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
    res.setHeader('X-Accel-Buffering', 'no');

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

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

    // Ensure we have a valid token
    const validAuth = await ensureValidToken(claudeAuth);
    if (!validAuth) {
      sendSSE('error', { error: 'Claude token expired and could not be refreshed' });
      res.end();
      return;
    }

    // Persist refreshed token if it changed
    if (validAuth.accessToken !== claudeAuth.accessToken) {
      // Only persist if we have the required fields for database storage
      if (validAuth.refreshToken && validAuth.expiresAt !== undefined) {
        logger.info('Persisting refreshed Claude token to database', {
          component: 'LiveChat',
          userId,
        });
        try {
          await db
            .update(users)
            .set({
              claudeAuth: {
                accessToken: validAuth.accessToken,
                refreshToken: validAuth.refreshToken,
                expiresAt: validAuth.expiresAt,
                scopes: validAuth.scopes,
                subscriptionType: validAuth.subscriptionType,
                rateLimitTier: validAuth.rateLimitTier,
              },
            })
            .where(eq(users.id, userId));
        } catch (persistError) {
          logger.error('Failed to persist refreshed token', persistError as Error, {
            component: 'LiveChat',
            userId,
          });
          // Continue with execution - token is valid, just not persisted
        }
      } else {
        logger.warn('Cannot persist token: missing refreshToken or expiresAt', {
          component: 'LiveChat',
          hasRefreshToken: !!validAuth.refreshToken,
          hasExpiresAt: validAuth.expiresAt !== undefined,
        });
      }
    }

    // Set up abort controller for client disconnection handling
    const abortController = new AbortController();
    let clientDisconnected = false;

    res.on('close', () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        abortController.abort();
        logger.info('Client disconnected, aborting Claude execution', {
          component: 'LiveChat',
          owner,
          repo,
          branch: decodedBranch,
        });
      }
    });

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
    const prompt = buildPromptWithContext(
      message,
      history.map(m => ({ role: m.role, content: m.content })),
      owner,
      repo,
      decodedBranch
    );

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
    });

    // Collect assistant response text for storage (with size limit)
    let assistantContent = '';
    let contentTruncated = false;

    try {
      // Execute with ClaudeWebClient
      // Use consistent branch prefix based on repo context to avoid orphaned branches
      const sanitizedBranch = decodedBranch.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
      const branchPrefix = `claude/live-chat/${owner}/${repo}/${sanitizedBranch}`;

      const result = await client.execute(
        {
          prompt,
          gitUrl,
          branchPrefix,
          title: `Live Chat: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
        },
        async (event: ClaudeSessionEvent) => {
          // Skip processing if client disconnected
          if (clientDisconnected) return;

          // Extract text content from assistant events using safe type guards
          if (isAssistantEvent(event)) {
            const text = extractTextFromMessage(event.message);
            if (text) {
              // Enforce size limit on accumulated content
              if (!contentTruncated && assistantContent.length < MAX_ASSISTANT_CONTENT_LENGTH) {
                const remainingSpace = MAX_ASSISTANT_CONTENT_LENGTH - assistantContent.length;
                const textToAdd = text.slice(0, remainingSpace);
                assistantContent += textToAdd;
                if (text.length > remainingSpace) {
                  contentTruncated = true;
                  logger.warn('Assistant content truncated due to size limit', {
                    component: 'LiveChat',
                    currentLength: assistantContent.length,
                    maxLength: MAX_ASSISTANT_CONTENT_LENGTH,
                  });
                }
              }
              sendSSE('assistant_message', { content: text, partial: true });
            }
          }

          // Forward relevant tool events to client
          if (isToolEvent(event)) {
            sendSSE('tool_event', event);
          }
        },
        {
          abortSignal: abortController.signal,
          maxPolls: MAX_EXECUTION_POLLS,
        }
      );

      // Don't send completion if client disconnected
      if (clientDisconnected) {
        logger.info('Skipping completion - client already disconnected', {
          component: 'LiveChat',
          owner,
          repo,
          branch: decodedBranch,
        });
        return;
      }

      logger.info('Claude execution completed for live chat', {
        component: 'LiveChat',
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        contentTruncated,
      });

      // Use collected content or a summary from result
      const finalContent = contentTruncated
        ? assistantContent + '\n\n[Response truncated due to length]'
        : assistantContent || result.result || 'Task completed.';

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
        truncated: contentTruncated,
      });

    } catch (execError) {
      // Handle abort (client disconnect) gracefully
      if (clientDisconnected || (execError instanceof Error && execError.name === 'AbortError')) {
        logger.info('Claude execution aborted due to client disconnect', {
          component: 'LiveChat',
          owner,
          repo,
          branch: decodedBranch,
        });
        return;
      }

      const errorMessage = execError instanceof Error ? execError.message : 'Execution failed';
      logger.error('Claude execution failed for live chat', execError as Error, {
        component: 'LiveChat',
        owner,
        repo,
        branch: decodedBranch,
      });

      // Only send error if client is still connected
      if (!clientDisconnected) {
        sendSSE('error', { error: errorMessage });
      }
    }

    if (!clientDisconnected) {
      res.end();
    }
  } catch (error) {
    logger.error('liveChat', 'Failed to execute live chat', { error });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to execute' });
    } else if (!res.writableEnded) {
      // Only try to write if the stream is still writable
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Execution failed' })}\n\n`);
        res.end();
      } catch {
        // Client already disconnected, nothing to do
      }
    }
  }
});

export default router;
