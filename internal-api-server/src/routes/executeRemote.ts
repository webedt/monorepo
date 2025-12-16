/**
 * Execute Remote Route
 * Uses Anthropic's Remote Sessions API for AI execution
 *
 * This is a simplified alternative to execute.ts that delegates
 * all execution to Anthropic's infrastructure.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, chatSessions, messages, users, events } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '../lib/claudeAuth.js';
import { logger, getEventEmoji, fetchEnvironmentIdFromSessions } from '@webedt/shared';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '../config/env.js';
import { sessionEventBroadcaster } from '../lib/sessionEventBroadcaster.js';
import {
  getExecutionProvider,
  type ExecutionEvent,
} from '../services/executionProviders/index.js';

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

    let repoUrl = github?.repoUrl;

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
          .set({ claudeAuth: refreshedAuth })
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
    const prompt = extractPrompt(userRequest);
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
      // Create new session
      const [newSession] = await db.insert(chatSessions).values({
        id: chatSessionId,
        userId: user.id,
        userRequest: serializedRequest,
        status: 'running',
        provider: 'claude-remote',
        repositoryUrl: repoUrl,
      }).returning();
      chatSession = newSession;
    } else {
      // Update existing session
      await db.update(chatSessions)
        .set({ status: 'running', userRequest: serializedRequest })
        .where(eq(chatSessions.id, chatSessionId));
    }

    // Store user message
    await db.insert(messages).values({
      chatSessionId,
      type: 'user',
      content: serializedRequest,
    });

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Helper to send SSE events
    const sendEvent = async (event: ExecutionEvent) => {
      if (clientDisconnected) return;

      // Apply emoji decoration
      const decoratedEvent = {
        ...event,
        message: event.message ? `${getEventEmoji(event)} ${event.message}` : undefined,
      };

      const eventData = `data: ${JSON.stringify(decoratedEvent)}\n\n`;

      try {
        res.write(eventData);
      } catch (error) {
        logger.warn('Failed to write SSE event', { component: 'ExecuteRemoteRoute', error });
      }

      // Store event in database
      try {
        await db.insert(events).values({
          chatSessionId,
          eventType: event.type,
          eventData: event,
        });
      } catch (error) {
        logger.warn('Failed to store event', { component: 'ExecuteRemoteRoute', error });
      }

      // Broadcast to other listeners
      sessionEventBroadcaster.broadcast(chatSessionId, event.type, decoratedEvent);
    };

    // Set up heartbeat
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
    }, 30000);

    // Get execution provider
    const provider = getExecutionProvider();

    try {
      let result;

      if (chatSession.remoteSessionId) {
        // Resume existing session
        result = await provider.resume(
          {
            userId: user.id,
            chatSessionId,
            remoteSessionId: chatSession.remoteSessionId,
            prompt,
            claudeAuth,
            environmentId,
          },
          sendEvent
        );
      } else {
        // Execute new session
        result = await provider.execute(
          {
            userId: user.id,
            chatSessionId,
            prompt,
            gitUrl: repoUrl,
            claudeAuth,
            environmentId,
          },
          sendEvent
        );
      }

      // Update session with result
      await db.update(chatSessions)
        .set({
          status: result.status === 'completed' ? 'completed' : 'error',
          branch: result.branch,
          remoteSessionId: result.remoteSessionId,
          remoteWebUrl: result.remoteWebUrl,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, chatSessionId));

      logger.info('Execute Remote completed', {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('Execute Remote failed', error, {
        component: 'ExecuteRemoteRoute',
        chatSessionId,
      });

      // Update session status
      await db.update(chatSessions)
        .set({ status: 'error' })
        .where(eq(chatSessions.id, chatSessionId));

      // Send error event
      await sendEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });
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
