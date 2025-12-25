/**
 * Execute Remote Route
 * Uses Anthropic's Remote Sessions API for AI execution
 *
 * This is a simplified alternative to execute.ts that delegates
 * all execution to Anthropic's infrastructure.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, chatSessions, messages, users, events, eq } from '@webedt/shared';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '@webedt/shared';
import { logger, fetchEnvironmentIdFromSessions, normalizeRepoUrl, generateSessionPath } from '@webedt/shared';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '@webedt/shared';
import { sessionEventBroadcaster } from '@webedt/shared';
import { sessionListBroadcaster } from '@webedt/shared';
import { cleanupRedundantSessions } from '@webedt/shared';
import {
  getExecutionProvider,
  type ExecutionEvent,
} from '@webedt/shared';
import {
  registerActiveStream,
  unregisterActiveStream,
} from '../activeStreamManager.js';

const router = Router();

// ============================================================================
// Types
// ============================================================================

export interface UserRequestContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract repository owner from GitHub URL
 * Supports: https://github.com/owner/repo or https://github.com/owner/repo.git
 */
function extractRepoOwner(repoUrl: string): string | null {
  const match = repoUrl.match(/github\.com\/([^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Extract repository name from GitHub URL
 * Supports: https://github.com/owner/repo or https://github.com/owner/repo.git
 */
function extractRepoName(repoUrl: string): string | null {
  const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
  return match ? match[1] : null;
}

/**
 * Serialize userRequest for storage
 */
function serializeUserRequest(userRequest: string | UserRequestContent[]): string {
  if (typeof userRequest === 'string') {
    return userRequest;
  }

  const textBlocks = userRequest
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join(' ');

  const imageCount = userRequest.filter(b => b.type === 'image').length;

  return imageCount > 0
    ? `${textBlocks} [${imageCount} image${imageCount > 1 ? 's' : ''}]`
    : textBlocks;
}

/**
 * Truncate content for preview display
 */
function truncateContent(content: unknown, maxLength: number = 500): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + `... (truncated, total length: ${str.length})`;
}

/**
 * Extract text from userRequest
 */
function extractPrompt(userRequest: string | UserRequestContent[]): string {
  if (typeof userRequest === 'string') {
    return userRequest;
  }

  return userRequest
    .filter(b => b.type === 'text')
    .map(b => b.text || '')
    .join('\n');
}

/**
 * Extract image attachments from userRequest for storage
 */
function extractImageAttachments(userRequest: string | UserRequestContent[]): Array<{
  id: string;
  data: string;
  mediaType: string;
  fileName: string;
}> {
  if (typeof userRequest === 'string') {
    return [];
  }

  const imageBlocks = userRequest.filter(b => b.type === 'image');
  return imageBlocks.map((block, index) => ({
    id: `img-${Date.now()}-${index}`,
    data: block.source?.data || '',
    mediaType: block.source?.media_type || 'image/png',
    fileName: `image-${index + 1}.png`
  }));
}

// ============================================================================
// Execute Remote Handler
// ============================================================================

const executeRemoteHandler = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  let chatSession: typeof chatSessions.$inferSelect | null = null;
  let clientDisconnected = false;

  // Track client disconnect
  req.on('close', () => {
    clientDisconnected = true;
  });

  try {
    // Parse parameters
    const params = req.method === 'POST' ? req.body : req.query;
    let { userRequest, websiteSessionId, github } = params;

    // Parse github if string
    if (typeof github === 'string') {
      try {
        github = JSON.parse(github);
      } catch {
        github = undefined;
      }
    }

    // Normalize repo URL to prevent duplicates (remove .git suffix)
    let repoUrl = github?.repoUrl ? normalizeRepoUrl(github.repoUrl) : undefined;
    // Base branch is always 'main' - we no longer support custom base branches
    // (Anthropic Remote Sessions API doesn't support specifying a base branch anyway)
    const baseBranch = 'main';

    // Extract owner and repo name from URL (for PR functionality)
    let repositoryOwner: string | null = null;
    let repositoryName: string | null = null;
    if (repoUrl) {
      repositoryOwner = extractRepoOwner(repoUrl);
      repositoryName = extractRepoName(repoUrl);
    }

    logger.info('Execute Remote request received', {
      component: 'ExecuteRemoteRoute',
      method: req.method,
      hasUserRequest: !!userRequest,
      hasWebsiteSessionId: !!websiteSessionId,
      hasGithub: !!github,
    });

    // Validate request
    if (!userRequest && !websiteSessionId) {
      res.status(400).json({ success: false, error: 'userRequest or websiteSessionId is required' });
      return;
    }

    // For resume requests, we may not have github.repoUrl - will get it from existing session
    // Only validate repoUrl for new sessions (no websiteSessionId)
    if (!repoUrl && !websiteSessionId) {
      res.status(400).json({ success: false, error: 'github.repoUrl is required for new sessions' });
      return;
    }

    // Get user's Claude auth first (needed for auto-detecting environment ID)
    const [userData] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!userData?.claudeAuth) {
      res.status(400).json({ success: false, error: 'Claude authentication not configured. Please connect your Claude account in settings.' });
      return;
    }

    // Refresh token if needed
    let claudeAuth = userData.claudeAuth as ClaudeAuth;
    try {
      const refreshedAuth = await ensureValidToken(claudeAuth);
      if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
        // Token was refreshed, save it
        await db.update(users)
          .set({ claudeAuth: refreshedAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
          .where(eq(users.id, user.id));
        claudeAuth = refreshedAuth;
      }
    } catch (error) {
      logger.error('Failed to refresh Claude token', error, { component: 'ExecuteRemoteRoute' });
      res.status(401).json({ success: false, error: 'Claude token expired. Please reconnect your Claude account.' });
      return;
    }

    // Get environment ID - from config or auto-detect from user's recent sessions
    let environmentId = CLAUDE_ENVIRONMENT_ID;
    if (!environmentId) {
      logger.info('CLAUDE_ENVIRONMENT_ID not configured, attempting auto-detection from user sessions', {
        component: 'ExecuteRemoteRoute',
      });

      const detectedEnvId = await fetchEnvironmentIdFromSessions(
        claudeAuth.accessToken,
        CLAUDE_API_BASE_URL
      );

      if (detectedEnvId) {
        environmentId = detectedEnvId;
        logger.info('Auto-detected environment ID from user sessions', {
          component: 'ExecuteRemoteRoute',
          environmentId: environmentId.slice(0, 10) + '...',
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Could not detect Claude environment ID. Please create a session at claude.ai/code first, or ask an admin to configure CLAUDE_ENVIRONMENT_ID.'
        });
        return;
      }
    }

    // Create or load chat session
    const chatSessionId = websiteSessionId || uuidv4();
    // Keep original userRequest (string or content blocks) for API calls
    // Only extract text-only version for title generation and storage
    const textPrompt = extractPrompt(userRequest);
    const serializedRequest = serializeUserRequest(userRequest);

    if (websiteSessionId) {
      // Load existing session
      const [existingSession] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, websiteSessionId))
        .limit(1);

      if (existingSession) {
        chatSession = existingSession;

        // Get repoUrl from existing session if not provided in request
        if (!repoUrl && existingSession.repositoryUrl) {
          repoUrl = existingSession.repositoryUrl;
          logger.info('Using repositoryUrl from existing session', {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
            repositoryUrl: repoUrl,
          });

          // Also extract owner/name if not already set (backward compatibility)
          if (!repositoryOwner && repoUrl) {
            repositoryOwner = extractRepoOwner(repoUrl);
          }
          if (!repositoryName && repoUrl) {
            repositoryName = extractRepoName(repoUrl);
          }
        }

        // Check if we're resuming
        if (existingSession.remoteSessionId) {
          logger.info('Resuming existing remote session', {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
            remoteSessionId: existingSession.remoteSessionId,
          });
        }
      }
    }

    // Final validation - ensure we have repoUrl (either from request or existing session)
    if (!repoUrl) {
      res.status(400).json({ success: false, error: 'github.repoUrl is required' });
      return;
    }

    if (!chatSession) {
      // Create new session with repository info for PR functionality
      const [newSession] = await db.insert(chatSessions).values({
        id: chatSessionId,
        userId: user.id,
        userRequest: serializedRequest,
        status: 'running',
        provider: 'claude',
        repositoryUrl: repoUrl,
        repositoryOwner: repositoryOwner,
        repositoryName: repositoryName,
        baseBranch: baseBranch,
      }).returning();
      chatSession = newSession;

      // Notify subscribers about new session
      sessionListBroadcaster.notifySessionCreated(user.id, chatSession);
    } else {
      // Update existing session status only - don't overwrite the session title (userRequest)
      // The title should remain as the initial generated title until user renames it
      await db.update(chatSessions)
        .set({ status: 'running' })
        .where(eq(chatSessions.id, chatSessionId));

      // Notify subscribers about status change
      sessionListBroadcaster.notifyStatusChanged(user.id, { id: chatSessionId, status: 'running' });
    }

    // Store user message with extracted images
    const imageAttachments = extractImageAttachments(userRequest);
    await db.insert(messages).values({
      chatSessionId,
      type: 'user',
      content: serializedRequest,
      images: imageAttachments.length > 0 ? imageAttachments : null,
    });

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Track event UUIDs to prevent duplicate storage
    // This is critical because the Claude API may send the same event multiple times
    // (e.g., during polling or reconnection), and we need to ensure each event is stored only once
    const storedEventUuids = new Set<string>();

    // Helper to send SSE events
    // Pass events through directly without modification - frontend handles all formatting
    // Use named SSE events so frontend can listen with addEventListener(eventType)
    const sendEvent = async (event: ExecutionEvent) => {
      if (clientDisconnected) return;

      // Send as named SSE event: "event: <type>\ndata: <json>\n\n"
      const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

      // Log SSE event for debugging
      logger.info('SSE event', {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
        eventType: event.type,
        eventData: JSON.stringify(event),
      });

      try {
        res.write(eventData);
      } catch (error) {
        logger.warn('Failed to write SSE event', { component: 'ExecuteRemoteRoute', error });
      }

      // Store event in database - deduplicate by UUID
      const eventUuid = (event as any).uuid;
      if (eventUuid && storedEventUuids.has(eventUuid)) {
        // Skip duplicate event
        logger.debug('Skipping duplicate event', {
          component: 'ExecuteRemoteRoute',
          chatSessionId,
          eventUuid,
          eventType: event.type,
        });
        return;
      }

      try {
        await db.insert(events).values({
          chatSessionId,
          eventData: event,
        });
        // Mark as stored to prevent future duplicates
        if (eventUuid) {
          storedEventUuids.add(eventUuid);
        }
      } catch (error) {
        logger.warn('Failed to store event', { component: 'ExecuteRemoteRoute', error });
      }

      // Save title and branch to database immediately when generated
      // This ensures they're saved even if user disconnects
      // Only save title for NEW sessions (not on resume/subsequent messages)
      if (!websiteSessionId && event.type === 'session_name' && (event as any).sessionName) {
        try {
          await db.update(chatSessions)
            .set({ userRequest: (event as any).sessionName })
            .where(eq(chatSessions.id, chatSessionId));
          logger.info('Session title saved to database', {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
            title: (event as any).sessionName,
          });
        } catch (err) {
          logger.error('Failed to save session title', err, {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
          });
        }
      }

      // Also capture title from title_generation events (success status)
      // Update title for any session that receives a title_generation event
      if (event.type === 'title_generation' && (event as any).status === 'success' && (event as any).title) {
        const newTitle = (event as any).title;
        const newBranch = (event as any).branch_name;

        // Generate sessionPath when we have all the info needed
        // This prevents duplicate sessions by establishing the unique sessionPath early
        let newSessionPath: string | undefined;
        if (newBranch && repositoryOwner && repositoryName) {
          newSessionPath = generateSessionPath(repositoryOwner, repositoryName, newBranch);
        }

        try {
          await db.update(chatSessions)
            .set({
              userRequest: newTitle,
              ...(newBranch ? { branch: newBranch } : {}),
              ...(newSessionPath ? { sessionPath: newSessionPath } : {})
            })
            .where(eq(chatSessions.id, chatSessionId));
          logger.info('Session title saved to database from title_generation', {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
            title: newTitle,
            branch: newBranch,
            sessionPath: newSessionPath,
          });

          // Notify session list subscribers about the title update
          sessionListBroadcaster.notifySessionUpdated(user.id, {
            id: chatSessionId,
            userRequest: newTitle,
            ...(newBranch ? { branch: newBranch } : {})
          });
        } catch (err) {
          logger.error('Failed to save session title from title_generation', err, {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
          });
        }
      }

      // CRITICAL: Save remoteSessionId immediately when session_created event is received
      // This prevents race conditions with background sync that could create duplicates
      if (event.type === 'session_created' && (event as any).remoteSessionId) {
        try {
          await db.update(chatSessions)
            .set({
              remoteSessionId: (event as any).remoteSessionId,
              remoteWebUrl: (event as any).remoteWebUrl,
            })
            .where(eq(chatSessions.id, chatSessionId));
          logger.info('Remote session ID saved to database immediately', {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
            remoteSessionId: (event as any).remoteSessionId,
          });

          // Clean up any redundant pending sessions created around the same time
          // This handles cases where user submitted a request but it failed early,
          // leaving orphaned pending sessions
          const cleanedUp = await cleanupRedundantSessions(
            user.id,
            chatSessionId,
            chatSession?.createdAt || new Date(),
            repositoryOwner,
            repositoryName
          );
          if (cleanedUp > 0) {
            logger.info(`Cleaned up ${cleanedUp} redundant session(s) after linking`, {
              component: 'ExecuteRemoteRoute',
              chatSessionId,
            });
          }
        } catch (err) {
          logger.error('Failed to save remote session ID', err, {
            component: 'ExecuteRemoteRoute',
            chatSessionId,
          });
        }
      }

      // Broadcast to other listeners
      sessionEventBroadcaster.broadcast(chatSessionId, event.type, event);
    };

    // Set up heartbeat - use 15 second interval to prevent proxy timeouts
    // Traefik and other proxies often have 30-60 second idle timeouts
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

    // Send input preview event immediately so user sees their request was received
    if (userRequest) {
      const requestText = serializeUserRequest(userRequest);
      const previewText = truncateContent(requestText, 200);
      await sendEvent({
        type: 'input_preview',
        message: `Request received: ${previewText}`,
        source: 'claude',
        timestamp: new Date().toISOString(),
        data: {
          preview: previewText,
          originalLength: requestText.length,
          truncated: requestText.length > 200
        }
      } as ExecutionEvent);
    }

    // Send session-created event for new sessions (client needs this to track session ID)
    if (!websiteSessionId) {
      const sessionCreatedData = { websiteSessionId: chatSessionId };
      logger.info('SSE event: session-created', {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
        eventData: JSON.stringify(sessionCreatedData),
      });
      res.write(`event: session-created\n`);
      res.write(`data: ${JSON.stringify(sessionCreatedData)}\n\n`);
    }

    // Get execution provider
    const provider = getExecutionProvider();

    // Register this stream so interrupt requests can abort it
    const abortController = registerActiveStream(chatSessionId);

    try {
      let result;

      if (chatSession.remoteSessionId) {
        // Resume existing session
        // Pass full userRequest (may include images as content blocks)
        result = await provider.resume(
          {
            userId: user.id,
            chatSessionId,
            remoteSessionId: chatSession.remoteSessionId,
            prompt: userRequest,
            claudeAuth,
            environmentId,
            abortSignal: abortController.signal,
          },
          sendEvent
        );
      } else {
        // Execute new session
        // Pass full userRequest (may include images as content blocks)
        result = await provider.execute(
          {
            userId: user.id,
            chatSessionId,
            prompt: userRequest,
            gitUrl: repoUrl,
            claudeAuth,
            environmentId,
            abortSignal: abortController.signal,
          },
          sendEvent
        );
      }

      // Update session with result
      const finalStatus = result.status === 'completed' ? 'completed' : 'error';

      // Generate sessionPath if we have all the info and don't have it yet
      // This is a fallback in case title_generation event didn't fire
      let finalSessionPath: string | undefined;
      if (result.branch && repositoryOwner && repositoryName) {
        finalSessionPath = generateSessionPath(repositoryOwner, repositoryName, result.branch);
      }

      await db.update(chatSessions)
        .set({
          status: finalStatus,
          branch: result.branch,
          remoteSessionId: result.remoteSessionId,
          remoteWebUrl: result.remoteWebUrl,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
          ...(finalSessionPath ? { sessionPath: finalSessionPath } : {}),
        })
        .where(eq(chatSessions.id, chatSessionId));

      // Notify subscribers about completion
      sessionListBroadcaster.notifyStatusChanged(user.id, {
        id: chatSessionId,
        status: finalStatus,
        branch: result.branch,
        remoteSessionId: result.remoteSessionId,
        remoteWebUrl: result.remoteWebUrl,
        totalCost: result.totalCost?.toString(),
      });

      logger.info('Execute Remote completed', {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
      });

      // Send final completion event with websiteSessionId (client needs this to track session)
      const completedData = {
        websiteSessionId: chatSessionId,
        completed: true,
        branch: result.branch,
        totalCost: result.totalCost,
        remoteSessionId: result.remoteSessionId,
        remoteWebUrl: result.remoteWebUrl,
      };
      logger.info('SSE event: completed', {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
        eventData: JSON.stringify(completedData),
      });
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify(completedData)}\n\n`);

    } catch (error) {
      // Check if this was an abort (user interrupt)
      // AbortError is standard, but ClaudeRemoteError with "aborted by signal" message is also used
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isAbort = error instanceof Error && (
        error.name === 'AbortError' ||
        errorMessage.includes('aborted by signal') ||
        errorMessage.includes('aborted')
      );

      if (isAbort) {
        logger.info('Execute Remote aborted by user', {
          component: 'ExecuteRemoteRoute',
          chatSessionId,
        });

        // Update session status to completed (interrupted = successful stop)
        await db.update(chatSessions)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(chatSessions.id, chatSessionId));

        // Notify subscribers about status change
        sessionListBroadcaster.notifyStatusChanged(user.id, { id: chatSessionId, status: 'completed' });

        // Send interrupted event
        await sendEvent({
          type: 'interrupted',
          timestamp: new Date().toISOString(),
          source: 'user',
          message: 'Request interrupted by user',
        });
      } else {
        logger.error('Execute Remote failed', error, {
          component: 'ExecuteRemoteRoute',
          chatSessionId,
        });

        // Update session status
        await db.update(chatSessions)
          .set({ status: 'error' })
          .where(eq(chatSessions.id, chatSessionId));

        // Notify subscribers about error status
        sessionListBroadcaster.notifyStatusChanged(user.id, { id: chatSessionId, status: 'error' });

        // Send error event
        await sendEvent({
          type: 'error',
          timestamp: new Date().toISOString(),
          error: errorMessage,
        });
      }
    } finally {
      // Always unregister the stream when execution ends
      unregisterActiveStream(chatSessionId);
    }

    // Clean up
    clearInterval(heartbeatInterval);

    // End response
    if (!clientDisconnected) {
      res.end();
    }

  } catch (error) {
    logger.error('Execute Remote handler error', error, { component: 'ExecuteRemoteRoute' });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }
  }
};

// ============================================================================
// Routes
// ============================================================================

// Main execute endpoint (POST for new requests, GET for SSE reconnect)
router.post('/', requireAuth, executeRemoteHandler);
router.get('/', requireAuth, executeRemoteHandler);

export default router;
