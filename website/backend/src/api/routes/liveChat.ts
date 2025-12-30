import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, liveChatMessages, users, eq, and, desc, StorageService, ServiceProvider, ASseHelper, SSEWriter } from '@webedt/shared';
import { requireAuth } from '../middleware/auth.js';
import {
  requireStorageQuota,
  calculateLiveChatMessageSize,
  trackStorageUsage,
} from '../middleware/storageQuota.js';
import {
  logger,
  AClaudeWebClient,
  ensureValidToken,
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  fetchEnvironmentIdFromSessions,
  sendSuccess,
  sendError,
  sendUnauthorized,
  sendInternalError,
  ApiErrorCode,
  requestDeduplicatorRegistry,
  generateRequestKey,
  simpleHash,
  LIMITS,
} from '@webedt/shared';
import type { ClaudeAuth, ClaudeWebClientConfig } from '@webedt/shared';

/**
 * Create an SSEWriter for a response with automatic heartbeat management.
 */
function createSSEWriter(res: Response): SSEWriter {
  const sseHelper = ServiceProvider.get(ASseHelper);
  return SSEWriter.create(res, sseHelper);
}

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: LiveChat
 *     description: Real-time AI chat on code branches
 */

/**
 * @openapi
 * /live-chat/{owner}/{repo}/{branch}/messages:
 *   get:
 *     tags:
 *       - LiveChat
 *     summary: Get chat messages
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: branch
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Messages retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *   post:
 *     tags:
 *       - LiveChat
 *     summary: Add message
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: branch
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *               - content
 *             properties:
 *               role:
 *                 type: string
 *               content:
 *                 type: string
 *               images:
 *                 type: array
 *     responses:
 *       200:
 *         description: Message added
 *       400:
 *         description: Missing fields
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *   delete:
 *     tags:
 *       - LiveChat
 *     summary: Clear messages
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: branch
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Messages cleared
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */

/**
 * @openapi
 * /live-chat/{owner}/{repo}/{branch}/execute:
 *   post:
 *     tags:
 *       - LiveChat
 *     summary: Execute AI chat
 *     description: Executes AI with conversation context. Returns SSE stream.
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: branch
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *               images:
 *                 type: array
 *     responses:
 *       200:
 *         description: SSE stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */

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
  const contextMessages = history.slice(-LIMITS.LIVE_CHAT.CONTEXT_MESSAGES);

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
    const limit = parseInt(req.query.limit as string) || LIMITS.LIVE_CHAT.MESSAGES_DEFAULT;

    if (!userId) {
      sendUnauthorized(res);
      return;
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

    sendSuccess(res, {
      messages,
      branch: decodedBranch,
      owner,
      repo,
    });
  } catch (error) {
    logger.error('liveChat', 'Failed to get live chat messages', { error });
    sendInternalError(res, 'Failed to get messages');
  }
});

/**
 * POST /api/live-chat/:owner/:repo/:branch/messages
 * Add a message to a branch-based live chat
 *
 * Uses request deduplication to prevent duplicate messages from rapid button clicks
 */
router.post(
  '/:owner/:repo/:branch/messages',
  requireStorageQuota({ calculateSize: calculateLiveChatMessageSize }),
  trackStorageUsage(),
  async (req: Request, res: Response) => {
    try {
      const { owner, repo, branch } = req.params;
      const { role, content, images } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        sendUnauthorized(res);
        return;
      }

      if (!role || !content) {
        sendError(res, 'Missing required fields: role, content', 400, ApiErrorCode.VALIDATION_ERROR);
        return;
      }

      // Use request deduplicator to prevent duplicate message posting from rapid clicks
      const deduplicator = requestDeduplicatorRegistry.get('live-chat-messages', {
        defaultTtlMs: 5000, // 5 second TTL for message posting (short window)
      });

      // Key includes content hash to detect identical messages
      const contentHash = simpleHash(content);
      const requestKey = generateRequestKey(userId, owner, repo, branch, role, contentHash);

      const { data: message, wasDeduplicated } = await deduplicator.deduplicate(
        requestKey,
        async () => {
          // Decode branch name
          const decodedBranch = decodeURIComponent(branch);

          const newMessage = {
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

          await db.insert(liveChatMessages).values(newMessage);

          return newMessage;
        }
      );

      if (wasDeduplicated) {
        logger.info('Live chat message was deduplicated (duplicate request detected)', {
          component: 'LiveChat',
          userId,
          owner,
          repo,
          branch,
        });
      }

      sendSuccess(res, { ...message, wasDeduplicated });
    } catch (error) {
      logger.error('liveChat', 'Failed to add live chat message', { error });
      sendInternalError(res, 'Failed to add message');
    }
  }
);

/**
 * DELETE /api/live-chat/:owner/:repo/:branch/messages
 * Clear all messages for a branch-based live chat
 */
router.delete('/:owner/:repo/:branch/messages', async (req: Request, res: Response) => {
  try {
    const { owner, repo, branch } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      sendUnauthorized(res);
      return;
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

    // Recalculate storage after deletion to ensure accuracy
    await StorageService.recalculateUsage(userId);

    sendSuccess(res, { message: 'Messages cleared' });
  } catch (error) {
    logger.error('liveChat', 'Failed to clear live chat messages', { error });
    sendInternalError(res, 'Failed to clear messages');
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
      sendUnauthorized(res);
      return;
    }

    if (!message) {
      sendError(res, 'Missing required field: message', 400, ApiErrorCode.VALIDATION_ERROR);
      return;
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

    // Set up SSE response with automatic heartbeats
    const writer = createSSEWriter(res);
    writer.setup();

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
      .limit(LIMITS.LIVE_CHAT.HISTORY);

    history.reverse();

    writer.writeNamedEvent('connected', {
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
      writer.writeNamedEvent('error', { error: 'Claude authentication not configured. Please connect your Claude account in settings.' });
      writer.end();
      return;
    }

    // Parse Claude auth
    let claudeAuth: ClaudeAuth;
    try {
      claudeAuth = typeof dbUser.claudeAuth === 'string'
        ? JSON.parse(dbUser.claudeAuth)
        : dbUser.claudeAuth as ClaudeAuth;
    } catch {
      writer.writeNamedEvent('error', { error: 'Invalid Claude authentication data' });
      writer.end();
      return;
    }

    // Ensure we have a valid token
    const validAuth = await ensureValidToken(claudeAuth);
    if (!validAuth) {
      writer.writeNamedEvent('error', { error: 'Claude token expired and could not be refreshed' });
      writer.end();
      return;
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
        writer.writeNamedEvent('error', { error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first.' });
        writer.end();
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

    // Collect assistant response text for storage
    let assistantContent = '';

    try {
      // Execute with ClaudeWebClient
      const result = await client.execute(
        {
          prompt,
          gitUrl,
          branchPrefix: `claude/chat-${Date.now()}`,
          title: `Live Chat: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
        },
        async (event) => {
          // Extract text content from assistant events
          const eventType = (event as { type?: string }).type;

          if (eventType === 'assistant') {
            const eventMessage = (event as { message?: { content?: unknown } }).message;
            if (eventMessage?.content) {
              // Content could be string or array of content blocks
              if (typeof eventMessage.content === 'string') {
                assistantContent += eventMessage.content;
                writer.writeNamedEvent('assistant_message', { content: eventMessage.content, partial: true });
              } else if (Array.isArray(eventMessage.content)) {
                for (const block of eventMessage.content) {
                  if (block && typeof block === 'object' && 'type' in block && block.type === 'text' && 'text' in block) {
                    assistantContent += block.text;
                    writer.writeNamedEvent('assistant_message', { content: block.text, partial: true });
                  }
                }
              }
            }
          }

          // Forward relevant events to client
          if (eventType === 'tool_use' || eventType === 'tool_result') {
            writer.writeNamedEvent('tool_event', event as Record<string, unknown>);
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

      writer.writeNamedEvent('completed', {
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

      writer.writeNamedEvent('error', { error: errorMessage });
    }

    writer.end();
  } catch (error) {
    logger.error('liveChat', 'Failed to execute live chat', { error });
    if (!res.headersSent) {
      sendInternalError(res, 'Failed to execute');
    } else {
      // SSE already started - send error in event format
      const sseHelper = ServiceProvider.get(ASseHelper);
      sseHelper.writeNamedEvent(res, 'error', { error: 'Execution failed' });
      res.end();
    }
  }
});

export default router;
