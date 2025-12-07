/**
 * Execute Route
 * Main /execute endpoint that orchestrates the complete workflow
 *
 * Architecture:
 * - Internal API Server handles orchestration
 * - Uses integrated storage and GitHub services
 * - Spawns AI worker only for LLM execution
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { db, chatSessions, messages, users, events } from '../db/index.js';
import { eq, and, or } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '../lib/claudeAuth.js';
import { ensureValidCodexToken, isValidCodexAuth, CodexAuth } from '../lib/codexAuth.js';
import { StorageService } from '../services/storage/storageService.js';
import { GitHubOperations, parseRepoUrl } from '../services/github/operations.js';
import { logger } from '../utils/logger.js';
import { generateSessionPath } from '../utils/sessionPathHelper.js';
import { getEventEmoji } from '../utils/emojiMapper.js';
import { WORKSPACE_DIR, AI_WORKER_URL } from '../config/env.js';
import { sessionEventBroadcaster } from '../lib/sessionEventBroadcaster.js';

// Define types locally (were previously in @webedt/shared)
export type AIProvider = 'claude' | 'codex';
export type ProviderAuth = ClaudeAuth | CodexAuth;

const router = Router();

// Initialize services
const storageService = new StorageService();
const githubOperations = new GitHubOperations(storageService);

// Track active sessions for abort routing
export const activeWorkerSessions = new Map<string, { workerUrl: string; containerId: string }>();

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

export interface SSEEvent {
  type: string;
  message?: string;
  stage?: string;
  data?: unknown;
  error?: string;
  code?: string;
  source?: string;
  endpoint?: string;  // e.g., '/execute', '/init-session', '/commit-push'
  timestamp?: string;
  sessionId?: string;
  branchName?: string;
  baseBranch?: string;
  sessionPath?: string;
  sessionName?: string;
  branch?: string;
  commitHash?: string;
  duration_ms?: number;
  resuming?: boolean;
  resumedFrom?: string;
  provider?: string;
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
 * Truncate content for logging
 */
function truncateContent(content: unknown, maxLength: number = 500): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + `... (truncated, total length: ${str.length})`;
}

// ============================================================================
// Execute Handler
// ============================================================================

const executeHandler = async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;
  let chatSession: any;
  let sessionRoot: string | undefined;
  let workspacePath: string | undefined;

  try {
    // Parse parameters (support both GET and POST)
    const params = req.method === 'POST' ? req.body : req.query;
    let { userRequest, websiteSessionId, github } = params;

    // Parse github if string (from GET)
    if (typeof github === 'string') {
      try {
        github = JSON.parse(github);
      } catch {
        github = undefined;
      }
    }

    const repoUrl = github?.repoUrl;
    const branch = github?.branch || 'main';

    logger.info('Execute request received', {
      component: 'ExecuteRoute',
      method: req.method,
      hasUserRequest: !!userRequest,
      hasWebsiteSessionId: !!websiteSessionId,
      hasGithub: !!github
    });

    if (!userRequest && !websiteSessionId) {
      res.status(400).json({ success: false, error: 'userRequest or websiteSessionId is required' });
      return;
    }

    // Determine provider
    const requestedProvider = params.provider as AIProvider | undefined;
    const userPreferredProvider = (user.preferredProvider as AIProvider) || 'claude';
    const selectedProvider: AIProvider = requestedProvider || userPreferredProvider;

    // Validate authentication
    if (selectedProvider === 'codex') {
      if (!isValidCodexAuth(user.codexAuth)) {
        res.status(400).json({
          success: false,
          error: 'OpenAI Codex authentication not configured. Please add your OpenAI credentials in Settings.'
        });
        return;
      }
    } else {
      if (!user.claudeAuth) {
        res.status(400).json({
          success: false,
          error: 'Claude authentication not configured. Please add your Claude credentials.'
        });
        return;
      }
    }

    // Load or create session
    if (websiteSessionId) {
      // Load existing session
      const existingSessions = await db
        .select()
        .from(chatSessions)
        .where(
          and(
            or(
              eq(chatSessions.id, websiteSessionId as string),
              eq(chatSessions.sessionPath, websiteSessionId as string)
            ),
            eq(chatSessions.userId, user.id)
          )
        )
        .limit(1);

      if (existingSessions.length === 0) {
        res.status(404).json({ success: false, error: 'Session not found' });
        return;
      }

      chatSession = existingSessions[0];

      await db
        .update(chatSessions)
        .set({ status: 'running' })
        .where(eq(chatSessions.id, chatSession.id));

      logger.info('Resuming existing session', {
        component: 'ExecuteRoute',
        sessionId: chatSession.id
      });
    } else {
      // Create new session
      let repositoryOwner: string | null = null;
      let repositoryName: string | null = null;

      if (repoUrl) {
        try {
          const parsed = parseRepoUrl(repoUrl);
          repositoryOwner = parsed.owner;
          repositoryName = parsed.repo;
        } catch {
          // Continue - optional fields
        }
      }

      const sessionUuid = uuidv4();

      chatSession = (await db
        .insert(chatSessions)
        .values({
          id: sessionUuid,
          userId: user.id,
          userRequest: serializeUserRequest(userRequest),
          status: 'pending',
          repositoryUrl: repoUrl || null,
          repositoryOwner,
          repositoryName,
          baseBranch: branch,
          branch: null,
          sessionPath: null,
          autoCommit: true,
          locked: false
        })
        .returning())[0];

      logger.info('Created new session', {
        component: 'ExecuteRoute',
        sessionId: chatSession.id
      });
    }

    // Store user message
    if (userRequest) {
      let displayContent: string;
      let imageAttachments: any[] = [];

      if (Array.isArray(userRequest)) {
        const textBlocks = userRequest.filter((b: any) => b.type === 'text');
        const imageBlocks = userRequest.filter((b: any) => b.type === 'image');
        displayContent = textBlocks.map((b: any) => b.text).join('\n');
        if (imageBlocks.length > 0) {
          displayContent += `\n[${imageBlocks.length} image${imageBlocks.length > 1 ? 's' : ''} attached]`;
          imageAttachments = imageBlocks.map((block: any, index: number) => ({
            id: `img-${Date.now()}-${index}`,
            data: block.source?.data || '',
            mediaType: block.source?.media_type || 'image/png',
            fileName: `image-${index + 1}.png`
          }));
        }
      } else {
        displayContent = userRequest;
      }

      await db.insert(messages).values({
        chatSessionId: chatSession.id,
        type: 'user',
        content: displayContent,
        images: imageAttachments.length > 0 ? imageAttachments : null
      });

      await db
        .update(chatSessions)
        .set({ locked: true })
        .where(eq(chatSessions.id, chatSession.id));
    }

    // Ensure provider token is valid
    let providerAuth: ProviderAuth;
    let providerName: string;

    if (selectedProvider === 'codex') {
      let codexAuth: CodexAuth = user.codexAuth!;
      providerName = 'Codex';

      const refreshedAuth = await ensureValidCodexToken(codexAuth);
      if (refreshedAuth !== codexAuth) {
        await db
          .update(users)
          .set({ codexAuth: refreshedAuth })
          .where(eq(users.id, user.id));
      }
      providerAuth = refreshedAuth;
    } else {
      let claudeAuth: ClaudeAuth = user.claudeAuth!;
      providerName = 'ClaudeAgentSDK';

      const refreshedAuth = await ensureValidToken(claudeAuth);
      if (refreshedAuth !== claudeAuth) {
        await db
          .update(users)
          .set({ claudeAuth: refreshedAuth })
          .where(eq(users.id, user.id));
      }
      providerAuth = refreshedAuth;
    }

    // Setup SSE response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // Send session-created event for new sessions
    if (!websiteSessionId) {
      res.write(`event: session-created\n`);
      res.write(`data: ${JSON.stringify({ websiteSessionId: chatSession.id })}\n\n`);
    }

    // Track client connection
    let clientDisconnected = false;
    let eventsSent = 0;

    res.on('close', () => {
      logger.warn('Client disconnected', {
        component: 'ExecuteRoute',
        sessionId: chatSession.id,
        eventsSent
      });
      clientDisconnected = true;
    });

    // Track last activity update time to throttle DB updates
    let lastActivityUpdate = 0;
    const ACTIVITY_UPDATE_INTERVAL = 10000; // Update DB every 10 seconds max

    // Helper to send SSE events
    const sendEvent = async (event: SSEEvent) => {
      if (clientDisconnected) return;

      if (!event.source) {
        event.source = 'internal-api-server';
      }

      if (!event.timestamp) {
        event.timestamp = new Date().toISOString();
      }

      // Format source to include endpoint for debugging (e.g., "internal-api-server:/execute")
      if (event.endpoint && event.source) {
        event.source = `${event.source}:${event.endpoint}`;
      }

      // Apply emoji
      if (event.message && typeof event.message === 'string') {
        const emoji = getEventEmoji(event);
        event.message = `${emoji} ${event.message}`;
      }

      // Store event to database BEFORE sending to client (prevents data loss)
      if (event.type !== 'completed' && event.type !== 'error') {
        try {
          await db.insert(events).values({
            chatSessionId: chatSession.id,
            eventType: event.type,
            eventData: event
          });
        } catch (err) {
          logger.error('Failed to store event', err as Error, {
            component: 'ExecuteRoute',
            sessionId: chatSession.id,
            eventType: event.type
          });
        }
      }

      // Update workerLastActivity (throttled to reduce DB load)
      const now = Date.now();
      if (now - lastActivityUpdate > ACTIVITY_UPDATE_INTERVAL) {
        lastActivityUpdate = now;
        db.update(chatSessions)
          .set({ workerLastActivity: new Date() })
          .where(eq(chatSessions.id, chatSession.id))
          .catch((err: Error) => {
            logger.error('Failed to update worker activity', err, {
              component: 'ExecuteRoute',
              sessionId: chatSession.id
            });
          });
      }

      // Broadcast event to any reconnecting clients
      sessionEventBroadcaster.broadcast(chatSession.id, event.type, event);

      res.write(`data: ${JSON.stringify(event)}\n\n`);
      eventsSent++;
    };

    const startTime = Date.now();
    sessionRoot = path.join(WORKSPACE_DIR, `session-${chatSession.id}`);
    const isResuming = !!websiteSessionId;

    // Start session in broadcaster (allows reconnecting clients to subscribe)
    sessionEventBroadcaster.startSession(chatSession.id);

    // Setup heartbeat interval (keeps connection alive and signals activity)
    const heartbeatInterval = setInterval(() => {
      if (!clientDisconnected && !res.writableEnded) {
        res.write(`event: heartbeat\ndata: {}\n\n`);
      }
    }, 30000); // Send heartbeat every 30 seconds

    try {
      // ========================================================================
      // PHASE 1: Session Initialization (previously in ai-coding-worker)
      // ========================================================================

      await sendEvent({
        type: 'connected',
        sessionId: chatSession.id,
        resuming: isResuming,
        provider: providerName,
        message: 'Connected to Internal API Server',
        endpoint: '/execute'
      });

      // Check for existing session in storage
      await sendEvent({
        type: 'progress',
        stage: 'checking_session',
        message: 'Checking for existing session...',
        endpoint: '/execute'
      });

      // Clean up local directory if exists
      if (fs.existsSync(sessionRoot)) {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
      }

      let sessionExisted = false;
      try {
        const sessionData = await storageService.downloadSessionToBuffer(chatSession.id);
        if (sessionData) {
          fs.mkdirSync(sessionRoot, { recursive: true });
          await storageService.extractSessionToPath(sessionData, sessionRoot);
          sessionExisted = true;
          await sendEvent({
            type: 'message',
            stage: 'session_found',
            message: 'Existing session found in storage',
            endpoint: '/execute'
          });
        }
      } catch {
        // Session doesn't exist
      }

      // ========================================================================
      // PHASE 2: GitHub Setup (if needed)
      // ========================================================================

      const effectiveRepoUrl = repoUrl || chatSession.repositoryUrl;
      const effectiveBranch = repoUrl ? branch : (chatSession.baseBranch || 'main');

      if (effectiveRepoUrl && user.githubAccessToken) {
        // Check if we need to initialize a new session
        const shouldInitialize = !isResuming && !chatSession.branch && !chatSession.sessionPath;

        if (shouldInitialize) {
          await sendEvent({
            type: 'message',
            stage: 'initializing',
            message: `Initializing session for ${effectiveRepoUrl}`,
            endpoint: '/execute'
          });

          // Use integrated GitHub operations
          const initResult = await githubOperations.initSession(
            {
              sessionId: chatSession.id,
              repoUrl: effectiveRepoUrl,
              branch: effectiveBranch,
              userRequest: serializeUserRequest(userRequest),
              githubAccessToken: user.githubAccessToken,
              workspaceRoot: WORKSPACE_DIR,
              codingAssistantProvider: providerName,
              codingAssistantAuthentication: providerAuth
            },
            (event) => {
              // Forward progress events with endpoint context
              const eventType = event.type === 'progress' ? 'message' : event.type;
              sendEvent({
                type: eventType,
                message: event.message,
                stage: event.stage,
                data: event.data,
                endpoint: event.endpoint,
                source: 'internal-api-server'
              });
            }
          );

          // Update database with branch info
          const sessionPath = generateSessionPath(
            chatSession.repositoryOwner || parseRepoUrl(effectiveRepoUrl).owner,
            chatSession.repositoryName || parseRepoUrl(effectiveRepoUrl).repo,
            initResult.branchName
          );

          await db
            .update(chatSessions)
            .set({
              branch: initResult.branchName,
              sessionPath: sessionPath,
              userRequest: initResult.sessionTitle
            })
            .where(eq(chatSessions.id, chatSession.id));

          chatSession.branch = initResult.branchName;
          chatSession.sessionPath = sessionPath;
          workspacePath = initResult.localPath;

          // Note: branch_created and session_name events are already sent by initSession()
          // via the progress callback - no need to send them again here

        } else if (sessionExisted) {
          // Use existing workspace from downloaded session
          const metadataPath = path.join(sessionRoot, '.session-metadata.json');
          if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            if (metadata.github?.clonedPath) {
              workspacePath = path.join(sessionRoot, 'workspace', metadata.github.clonedPath);
            }
          }
        }
      }

      // Default workspace path if not set
      if (!workspacePath) {
        workspacePath = path.join(sessionRoot, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });
      }

      // ========================================================================
      // PHASE 3: AI Worker Execution
      // ========================================================================

      await sendEvent({
        type: 'message',
        message: `Executing with ${providerName}`,
        stage: 'starting_ai',
        endpoint: '/execute'
      });

      // Prepare payload for AI worker (now LLM-only)
      const aiWorkerPayload = {
        userRequest: Array.isArray(userRequest) ? userRequest : userRequest,
        codingAssistantProvider: providerName,
        codingAssistantAuthentication: providerAuth,
        workspacePath: workspacePath,
        websiteSessionId: chatSession.id,
        providerOptions: user.preferredModel ? { model: user.preferredModel } : undefined
      };

      // Forward to AI worker
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600000); // 10 minutes

      logger.info('Calling AI worker for LLM execution', {
        component: 'ExecuteRoute',
        sessionId: chatSession.id,
        aiWorkerUrl: `${AI_WORKER_URL}/execute`,
        workspacePath: aiWorkerPayload.workspacePath,
        provider: providerName,
        payloadSize: JSON.stringify(aiWorkerPayload).length
      });

      try {
        const aiResponse = await fetch(`${AI_WORKER_URL}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify(aiWorkerPayload),
          signal: controller.signal
        });

        clearTimeout(timeout);

        logger.info('AI worker response received', {
          component: 'ExecuteRoute',
          sessionId: chatSession.id,
          status: aiResponse.status,
          ok: aiResponse.ok,
          hasBody: !!aiResponse.body
        });

        const workerContainerId = aiResponse.headers.get('X-Container-ID') || 'unknown';
        activeWorkerSessions.set(chatSession.id, {
          workerUrl: AI_WORKER_URL,
          containerId: workerContainerId
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          throw new Error(`AI worker error: ${aiResponse.status} - ${errorText}`);
        }

        if (!aiResponse.body) {
          throw new Error('No response body from AI worker');
        }

        // Stream AI worker events to client
        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let eventCount = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logger.info('AI worker stream ended', {
              component: 'ExecuteRoute',
              sessionId: chatSession.id,
              eventsReceived: eventCount
            });
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            if (line.startsWith('data:')) {
              eventCount++;
              const data = line.substring(5).trim();

              logger.info('Received SSE event from AI worker', {
                component: 'ExecuteRoute',
                sessionId: chatSession.id,
                eventCount,
                dataLength: data.length,
                dataPreview: data.substring(0, 100)
              });

              try {
                const eventData = JSON.parse(data);

                logger.info('Parsed SSE event', {
                  component: 'ExecuteRoute',
                  sessionId: chatSession.id,
                  eventType: eventData.type,
                  eventCount
                });

                // Forward event with appropriate source
                const providerSource = providerName === 'ClaudeAgentSDK'
                  ? 'claude-agent-sdk'
                  : providerName === 'Codex'
                    ? 'codex-sdk'
                    : 'ai-worker';

                // Don't forward the worker's completed event - we'll send our own
                if (eventData.type !== 'completed') {
                  res.write(`data: ${JSON.stringify({
                    ...eventData,
                    source: providerSource,
                    timestamp: new Date().toISOString()
                  })}\n\n`);
                  eventsSent++;

                  // Store to database
                  try {
                    await db.insert(events).values({
                      chatSessionId: chatSession.id,
                      eventType: eventData.type,
                      eventData: eventData
                    });
                    logger.debug('Event stored to database', {
                      component: 'ExecuteRoute',
                      sessionId: chatSession.id,
                      eventType: eventData.type,
                      eventCount
                    });
                  } catch (dbError) {
                    logger.error('Failed to store event to database', dbError, {
                      component: 'ExecuteRoute',
                      sessionId: chatSession.id,
                      eventType: eventData.type
                    });
                  }
                }
              } catch (parseError) {
                // Forward non-JSON data as-is
                logger.warn('Failed to parse SSE event data', {
                  component: 'ExecuteRoute',
                  sessionId: chatSession.id,
                  data: data.substring(0, 200)
                });
                res.write(`data: ${data}\n\n`);
              }
            }
          }
        }

      } catch (aiError) {
        clearTimeout(timeout);
        throw aiError;
      } finally {
        activeWorkerSessions.delete(chatSession.id);
      }

      // ========================================================================
      // PHASE 4: Post-Execution (Commit & Upload)
      // ========================================================================

      // Auto-commit if GitHub session
      if (effectiveRepoUrl && user.githubAccessToken && workspacePath) {
        await sendEvent({
          type: 'commit_progress',
          stage: 'starting',
          message: 'Auto-committing changes...',
          endpoint: '/execute'
        });

        try {
          const commitResult = await githubOperations.commitAndPush(
            {
              sessionId: chatSession.id,
              workspacePath: workspacePath,
              userId: user.id
            },
            (event) => {
              // Note: callback is sync, sendEvent returns Promise but we don't await here
              sendEvent({
                type: 'commit_progress',
                message: event.message,
                stage: event.stage,
                data: event.data,
                endpoint: event.endpoint,
                source: 'internal-api-server'
              });
            }
          );

          if (commitResult.skipped) {
            logger.info('No changes to commit', {
              component: 'ExecuteRoute',
              sessionId: chatSession.id,
              reason: commitResult.reason
            });
          } else {
            logger.info('Changes committed', {
              component: 'ExecuteRoute',
              sessionId: chatSession.id,
              commitHash: commitResult.commitHash,
              pushed: commitResult.pushed
            });
          }
        } catch (commitError) {
          logger.error('Auto-commit failed', commitError, {
            component: 'ExecuteRoute',
            sessionId: chatSession.id
          });

          await sendEvent({
            type: 'commit_progress',
            stage: 'error',
            message: `Auto-commit failed: ${commitError instanceof Error ? commitError.message : String(commitError)}`,
            endpoint: '/execute'
          });
        }
      }

      // Upload session to storage
      await sendEvent({
        type: 'message',
        stage: 'uploading',
        message: 'Saving session to storage...',
        endpoint: '/execute'
      });

      await storageService.uploadSessionFromPath(chatSession.id, sessionRoot);

      await sendEvent({
        type: 'message',
        stage: 'uploaded',
        message: 'Session saved to storage',
        source: 'storage-worker',
        endpoint: '/execute'
      });

      // ========================================================================
      // PHASE 5: Completion
      // ========================================================================

      // Clear heartbeat interval
      clearInterval(heartbeatInterval);

      // End session in broadcaster
      sessionEventBroadcaster.endSession(chatSession.id);

      const duration = Date.now() - startTime;

      await db
        .update(chatSessions)
        .set({ status: 'completed', completedAt: new Date(), workerLastActivity: null })
        .where(eq(chatSessions.id, chatSession.id));

      await sendEvent({
        type: 'completed',
        sessionId: chatSession.id,
        duration_ms: duration,
        message: 'Session completed',
        endpoint: '/execute'
      });

      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({ websiteSessionId: chatSession.id, completed: true })}\n\n`);
      res.end();

      // Cleanup local workspace
      try {
        if (sessionRoot && fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch {
        // Non-critical
      }

      logger.info('Session completed successfully', {
        component: 'ExecuteRoute',
        sessionId: chatSession.id,
        durationMs: duration,
        eventsSent
      });

    } catch (error) {
      // Clear heartbeat interval on error
      clearInterval(heartbeatInterval);

      // End session in broadcaster
      sessionEventBroadcaster.endSession(chatSession.id);

      logger.error('Execution failed', error, {
        component: 'ExecuteRoute',
        sessionId: chatSession.id
      });

      // Try to upload session state even on error
      try {
        if (sessionRoot && fs.existsSync(sessionRoot)) {
          await storageService.uploadSessionFromPath(chatSession.id, sessionRoot);
        }
      } catch {
        // Non-critical
      }

      // Cleanup
      try {
        if (sessionRoot && fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch {
        // Non-critical
      }

      await db
        .update(chatSessions)
        .set({ status: 'error', completedAt: new Date(), workerLastActivity: null })
        .where(eq(chatSessions.id, chatSession.id));

      await sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'execution_error',
        endpoint: '/execute'
      });

      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({ websiteSessionId: chatSession.id, completed: true, error: true })}\n\n`);
      res.end();
    }

  } catch (error) {
    logger.error('Execute handler error', error, {
      component: 'ExecuteRoute',
      userId: user?.id
    });

    if (chatSession?.id) {
      await db
        .update(chatSessions)
        .set({ status: 'error', completedAt: new Date() })
        .where(eq(chatSessions.id, chatSession.id));
    }

    if (res.headersSent) {
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
        res.write(`event: completed\n`);
        res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
        res.end();
      }
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
};

// Register routes
router.get('/execute', requireAuth, executeHandler);
router.post('/execute', requireAuth, executeHandler);

export default router;
