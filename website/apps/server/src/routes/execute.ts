import { Router } from 'express';
import { db } from '../db/index';
import { chatSessions, messages, users } from '../db/index';
import { eq, and } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { ensureValidToken } from '../lib/claudeAuth';
import type { ClaudeAuth } from '@webedt/shared';
import { generateSessionTitle } from '../lib/titleGenerator';
import { parseRepoUrl } from '../utils/sessionPathHelper';

const router = Router();

// Helper function to sanitize sensitive data for logging
const sanitizeForLogging = (data: any): any => {
  if (!data || typeof data !== 'object') return data;

  const sanitized = JSON.parse(JSON.stringify(data));

  // Remove sensitive authentication data
  if (sanitized.codingAssistantAuthentication) {
    sanitized.codingAssistantAuthentication = {
      sessionKey: sanitized.codingAssistantAuthentication.sessionKey ? '[REDACTED]' : undefined,
      accessToken: sanitized.codingAssistantAuthentication.accessToken ? '[REDACTED]' : undefined,
      refreshToken: sanitized.codingAssistantAuthentication.refreshToken ? '[REDACTED]' : undefined,
      expiresAt: sanitized.codingAssistantAuthentication.expiresAt,
    };
  }

  // Remove GitHub access token
  if (sanitized.github?.accessToken) {
    sanitized.github.accessToken = '[REDACTED]';
  }

  return sanitized;
};

// Helper function to truncate long content for logging
const truncateContent = (content: any, maxLength: number = 500): string => {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + `... (truncated, total length: ${str.length})`;
};

// Execute AI coding task with SSE - supports both GET and POST
const executeHandler = async (req: any, res: any) => {
  const authReq = req as AuthRequest;
  let chatSession: any;
  let resumeSessionId: string | undefined;

  try {
    // Support both GET (query) and POST (body) parameters
    const params = req.method === 'POST' ? req.body : req.query;
    const { userRequest, repositoryUrl, baseBranch, chatSessionId } = params;
    resumeSessionId = params.resumeSessionId;

    // Auto-commit is now always enabled
    const autoCommit = true;

    // Debug: Log incoming parameters
    console.log('[Execute] ========== INCOMING REQUEST PARAMETERS ==========');
    console.log('[Execute] Request method:', req.method);
    console.log('[Execute] All params:', JSON.stringify(params, null, 2));
    console.log('[Execute] Extracted values:', {
      userRequest: typeof userRequest === 'string' ? userRequest.substring(0, 50) : userRequest,
      repositoryUrl,
      baseBranch,
      autoCommit,
      chatSessionId,
      resumeSessionId,
    });
    console.log('[Execute] ========================================================');

    if (!userRequest && !resumeSessionId) {
      res.status(400).json({ success: false, error: 'userRequest or resumeSessionId is required' });
      return;
    }

    // Validate that both github params and resumeSessionId are not provided together
    // When resuming a session, the repository is already available in the session workspace
    if (resumeSessionId && repositoryUrl) {
      res.status(400).json({
        success: false,
        error: 'Cannot provide both "github" and "resumeSessionId". When resuming a session, the repository is already available in the session workspace.',
      });
      return;
    }

    if (!authReq.user?.claudeAuth) {
      res.status(400).json({
        success: false,
        error: 'Claude authentication not configured. Please add your Claude credentials.',
      });
      return;
    }

    // Check if we're continuing an existing session or creating a new one
    if (chatSessionId) {
      // Load existing session
      const existingSessions = await db
        .select()
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.id, Number(chatSessionId)),
            eq(chatSessions.userId, authReq.user.id)
          )
        )
        .limit(1);

      if (existingSessions.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Chat session not found',
        });
        return;
      }

      chatSession = existingSessions[0];
      console.log(`[Execute] Resuming existing chatSession: ${chatSession.id}`);

      // Update session status to running
      await db
        .update(chatSessions)
        .set({ status: 'running' })
        .where(eq(chatSessions.id, chatSession.id));
    } else {
      // Check if there's already a locked session for this repo/branch combination
      if (repositoryUrl && baseBranch) {
        const existingLockedSession = await db
          .select()
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.userId, authReq.user.id),
              eq(chatSessions.repositoryUrl, repositoryUrl as string),
              eq(chatSessions.branch, baseBranch as string),
              eq(chatSessions.locked, true)
            )
          )
          .limit(1);

        if (existingLockedSession.length > 0) {
          res.status(400).json({
            success: false,
            error: `Repository ${repositoryUrl} on branch ${baseBranch} is locked by an existing session. Please complete or delete the existing session first.`,
          });
          return;
        }
      }

      // Parse repository URL to extract owner and repo name
      let repositoryOwner: string | null = null;
      let repositoryName: string | null = null;

      if (repositoryUrl) {
        try {
          const parsed = parseRepoUrl(repositoryUrl as string);
          repositoryOwner = parsed.owner;
          repositoryName = parsed.repo;
        } catch (error) {
          console.error('[Execute] Failed to parse repository URL:', error);
          // Continue anyway - owner/name are optional
        }
      }

      // Create new chat session in database
      chatSession = (await db
        .insert(chatSessions)
        .values({
          userId: authReq.user.id,
          userRequest: (userRequest as string) || 'New session',
          status: 'pending',
          repositoryUrl: (repositoryUrl as string) || null,
          repositoryOwner,
          repositoryName,
          baseBranch: (baseBranch as string) || 'main', // Default to main if not provided
          branch: null, // Will be populated when branch is created by the worker
          sessionPath: null, // Will be populated when AI worker returns session path
          locked: false, // Will be locked after first message
        })
        .returning())[0];

      console.log(`[Execute] Created new chatSession: ${chatSession.id}`);
    }

    // Store user message and lock the session
    if (userRequest) {
      // Store the raw userRequest (which could be JSON or string)
      // For display purposes, if it's a content block array, show a summary
      let displayContent: string;
      let imageAttachments: any[] = [];

      // Check if userRequest is already an array (POST) or needs parsing (GET)
      if (Array.isArray(userRequest)) {
        // Already parsed by Express (POST request with content blocks)
        const textBlocks = userRequest.filter((block: any) => block.type === 'text');
        const imageBlocks = userRequest.filter((block: any) => block.type === 'image');
        displayContent = textBlocks.map((block: any) => block.text).join('\n');
        if (imageBlocks.length > 0) {
          displayContent += `\n[${imageBlocks.length} image${imageBlocks.length > 1 ? 's' : ''} attached]`;
          // Extract image data for storage
          imageAttachments = imageBlocks.map((block: any, index: number) => ({
            id: `img-${Date.now()}-${index}`,
            data: block.source?.data || '',
            mediaType: block.source?.media_type || 'image/png',
            fileName: `image-${index + 1}.png`,
          }));
        }
      } else if (typeof userRequest === 'string') {
        try {
          // Try to parse as JSON string (GET with content blocks)
          const parsed = JSON.parse(userRequest);
          if (Array.isArray(parsed)) {
            const textBlocks = parsed.filter((block: any) => block.type === 'text');
            const imageBlocks = parsed.filter((block: any) => block.type === 'image');
            displayContent = textBlocks.map((block: any) => block.text).join('\n');
            if (imageBlocks.length > 0) {
              displayContent += `\n[${imageBlocks.length} image${imageBlocks.length > 1 ? 's' : ''} attached]`;
              // Extract image data for storage
              imageAttachments = imageBlocks.map((block: any, index: number) => ({
                id: `img-${Date.now()}-${index}`,
                data: block.source?.data || '',
                mediaType: block.source?.media_type || 'image/png',
                fileName: `image-${index + 1}.png`,
              }));
            }
          } else {
            displayContent = userRequest;
          }
        } catch {
          // Plain string
          displayContent = userRequest;
        }
      } else {
        displayContent = 'New session';
      }

      await db.insert(messages).values({
        chatSessionId: chatSession.id,
        type: 'user',
        content: displayContent,
        images: imageAttachments.length > 0 ? imageAttachments : null,
      });

      // Lock the session after first message to prevent changing settings
      await db
        .update(chatSessions)
        .set({ locked: true })
        .where(eq(chatSessions.id, chatSession.id));
    }

    // Ensure Claude token is valid, refresh if needed
    let claudeAuth: ClaudeAuth = authReq.user.claudeAuth;
    let tokenWasRefreshed = false;

    try {
      const refreshedAuth = await ensureValidToken(claudeAuth);
      if (refreshedAuth !== claudeAuth) {
        claudeAuth = refreshedAuth;
        tokenWasRefreshed = true;

        // Save refreshed token to database
        await db
          .update(users)
          .set({ claudeAuth: refreshedAuth })
          .where(eq(users.id, authReq.user.id));

        console.log(`[Execute] Refreshed and saved Claude token for user ${authReq.user.id}`);
      }
    } catch (error) {
      console.error('[Execute] Failed to refresh Claude token:', error);
      res.status(401).json({
        success: false,
        error: 'Failed to refresh Claude authentication. Please re-authenticate with Claude.',
      });
      return;
    }

    // Setup SSE manually
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send session-created event only if this is a new session (not resuming existing chatSession)
    if (!chatSessionId) {
      res.write(`event: session-created\n`);
      res.write(`data: ${JSON.stringify({ chatSessionId: chatSession.id })}\n\n`);
      console.log(`[Execute] Sent session-created event for new chatSession: ${chatSession.id}`);
      // Note: session_name event will be sent by background title generation when ready
    } else {
      console.log(`[Execute] Resuming chatSession ${chatSession.id}, not sending session-created event`);
    }

    // Generate session title for new sessions (not resuming) - run in background AFTER main request starts
    if (!chatSessionId && userRequest) {
      // Fire and forget - delay 2 seconds to let main request establish connection first
      (async () => {
        try {
          console.log('[Execute] Will generate session title in 2 seconds (after main request starts)...');
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

          console.log('[Execute] Generating session title for new session (background)...');
          const aiWorkerUrl = process.env.AI_WORKER_URL || 'http://localhost:5001';
          const generatedTitle = await generateSessionTitle(userRequest, claudeAuth, aiWorkerUrl);
          console.log('[Execute] Generated title:', generatedTitle);

          // Update database with generated title
          await db
            .update(chatSessions)
            .set({ userRequest: generatedTitle })
            .where(eq(chatSessions.id, chatSession.id));

          console.log('[Execute] Updated session title in database');

          // Send session_name event to client if response is still writable
          if (!res.writableEnded) {
            res.write(`event: session_name\n`);
            res.write(`data: ${JSON.stringify({ type: 'session_name', sessionName: generatedTitle, timestamp: new Date().toISOString() })}\n\n`);
            console.log(`[Execute] Sent session_name event: ${generatedTitle}`);
          }
        } catch (error) {
          console.error('[Execute] Failed to generate session title (background):', error);
          // Continue anyway - not critical
        }
      })();
    }

    // Prepare request to ai-coding-worker
    // userRequest can be:
    // - Already an array (from POST JSON body - Express already parsed it)
    // - A JSON string (from GET query params)
    // - A plain string
    let parsedUserRequest: string | any[];

    if (Array.isArray(userRequest)) {
      // Already parsed by Express JSON middleware (POST request)
      parsedUserRequest = userRequest;
    } else if (typeof userRequest === 'string') {
      try {
        // Try to parse as JSON string (from GET query params)
        parsedUserRequest = JSON.parse(userRequest);
      } catch {
        // If parsing fails, it's a plain string
        parsedUserRequest = userRequest || 'Resume previous session';
      }
    } else {
      parsedUserRequest = 'Resume previous session';
    }

    const executePayload: any = {
      userRequest: parsedUserRequest,
      codingAssistantProvider: 'ClaudeAgentSDK',
      codingAssistantAuthentication: claudeAuth,
      // Always use the autoCommit setting from the session (persisted in DB)
      // This ensures resumed sessions respect the initial setting
      autoCommit: chatSession.autoCommit,
    };

    console.log(`[Execute] Session resumption debug:
      - resumeSessionId from query: ${resumeSessionId || 'N/A'}
      - chatSession.id: ${chatSession.id}
      - chatSession.sessionPath: ${chatSession.sessionPath || 'N/A'}
    `);

    if (resumeSessionId) {
      executePayload.resumeSessionId = resumeSessionId;
      console.log(`[Execute] Added resumeSessionId to payload: ${resumeSessionId}`);
    } else {
      console.log(`[Execute] No resumeSessionId provided, starting new session`);
    }

    if (repositoryUrl && authReq.user.githubAccessToken) {
      // New session - use parameters from request
      executePayload.github = {
        repoUrl: repositoryUrl as string,
        // Checkout the base branch and let the worker create/manage the working branch
        branch: (baseBranch as string) || 'main',
        accessToken: authReq.user.githubAccessToken,
      };

      // Auto-commit is now always enabled
      executePayload.autoCommit = true;
    }

    // Log outbound request to AI worker
    const aiWorkerUrl = process.env.AI_WORKER_URL || 'http://localhost:5001';
    const sanitizedPayload = sanitizeForLogging(executePayload);
    console.log(`[Execute] ========== OUTBOUND **MAIN** REQUEST TO AI WORKER ==========`);
    console.log(`[Execute] Request type: MAIN user request (separate from title generation)`);
    console.log(`[Execute] Destination: ${aiWorkerUrl}/execute`);
    console.log(`[Execute] Chat Session ID: ${chatSession.id}`);
    console.log(`[Execute] Resume Session ID: ${resumeSessionId || 'N/A'}`);
    console.log(`[Execute] User Request: ${truncateContent(executePayload.userRequest)}`);
    console.log(`[Execute] Repository: ${executePayload.github?.repoUrl || 'N/A'}`);
    console.log(`[Execute] Branch: ${executePayload.github?.branch || 'N/A'}`);
    console.log(`[Execute] Auto Commit: ${executePayload.autoCommit ?? 'N/A'}`);
    console.log(`[Execute] Auto Commit Source: ${repositoryUrl ? 'request parameter' : resumeSessionId && chatSession.repositoryUrl ? 'database (resumed session)' : 'none'}`);
    console.log(`[Execute] Full Payload (sanitized): ${JSON.stringify(sanitizedPayload, null, 2)}`);
    console.log(`[Execute] ==================================================================`);

    // Forward to ai-coding-worker with increased timeout and retry logic
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 minutes timeout

    let response: Response | null = null;
    let lastError: Error | null = null;
    const maxRetries = 3;

    try {
      // Retry connection failures with exponential backoff
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Execute] Attempt ${attempt}/${maxRetries} to connect to AI worker...`);

          response = await fetch(`${aiWorkerUrl}/execute`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify(executePayload),
            signal: controller.signal,
          });

          const containerId = response.headers.get('X-Container-ID') || 'unknown';
          console.log(`[Execute] Successfully connected to AI worker on attempt ${attempt}`);
          console.log(`[Execute] Worker Container ID: ${containerId}`);
          clearTimeout(timeout);
          break; // Success!

        } catch (err) {
          lastError = err as Error;

          // Debug: log the error details
          console.log(`[Execute] Caught error on attempt ${attempt}:`);
          console.log(`[Execute] Error type: ${err instanceof Error ? 'Error' : typeof err}`);
          console.log(`[Execute] Error name: ${err instanceof Error ? err.name : 'N/A'}`);
          console.log(`[Execute] Error message: ${err instanceof Error ? err.message : String(err)}`);
          console.log(`[Execute] Has cause: ${(err as any).cause ? 'yes' : 'no'}`);
          if ((err as any).cause) {
            console.log(`[Execute] Cause message: ${(err as any).cause.message}`);
            console.log(`[Execute] Cause code: ${(err as any).cause.code}`);
          }

          const isConnectionTimeout = err instanceof Error &&
            (err.message.includes('Connect Timeout') ||
             err.message.includes('ETIMEDOUT') ||
             err.message.includes('fetch failed') ||
             (err as any).cause?.code === 'UND_ERR_CONNECT_TIMEOUT');

          console.log(`[Execute] Is connection timeout: ${isConnectionTimeout}`);
          console.log(`[Execute] Attempt: ${attempt}, Max retries: ${maxRetries}, Will retry: ${isConnectionTimeout && attempt < maxRetries}`);

          if (isConnectionTimeout && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5s delay
            console.log(`[Execute] Connection timeout on attempt ${attempt}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          console.log(`[Execute] Not retrying - throwing error`);
          throw err; // Not a connection timeout or last attempt - rethrow
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to connect after retries');
      }

      if (!response.ok) {
      const errorContainerId = response.headers.get('X-Container-ID') || 'unknown';
      const errorText = await response.text();
      console.error('[Execute] ========== AI WORKER ERROR RESPONSE ==========');
      console.error('[Execute] HTTP Status:', response.status, response.statusText);
      console.error('[Execute] Worker Container ID:', errorContainerId);
      console.error('[Execute] Chat Session ID:', chatSession.id);
      console.error('[Execute] Error Response:', truncateContent(errorText, 2000));
      console.error('[Execute] ===================================================');

      await db
        .update(chatSessions)
        .set({ status: 'error', completedAt: new Date() })
        .where(eq(chatSessions.id, chatSession.id));

      await db.insert(messages).values({
        chatSessionId: chatSession.id,
        type: 'error',
        content: errorText || 'AI worker request failed',
      });

      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: errorText })}\n\n`);
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
      res.end();
      return;
    }

    if (!response.body) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: 'No response body' })}\n\n`);
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
      res.end();
      return;
    }

    // Update session status
    await db
      .update(chatSessions)
      .set({ status: 'running' })
      .where(eq(chatSessions.id, chatSession.id));

    // Stream events from ai-coding-worker to client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventCounter = 0;

    console.log(`[Execute] ========== STARTING SSE STREAM FROM AI WORKER ==========`);

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`[Execute] SSE stream ended (done=true)`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse SSE format
          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
            // Don't write yet - wait for the data line
            continue;
          }

          if (line.startsWith('data:')) {
            const data = line.substring(5).trim();
            eventCounter++;

            try {
              const eventData = JSON.parse(data);

              // Log each event received from AI worker
              console.log(`[Execute] <<<< INBOUND EVENT #${eventCounter} FROM AI WORKER <<<<`);
              console.log(`[Execute] Event Type: ${currentEvent || eventData.type || 'unknown'}`);
              console.log(`[Execute] Session ID in event: ${eventData.sessionId || 'N/A'}`);
              console.log(`[Execute] Event Data (truncated): ${truncateContent(eventData, 1000)}`);

              // Log specific important fields if present
              if (eventData.type === 'assistant_message' && eventData.data?.message?.content) {
                const textContent = eventData.data.message.content
                  .filter((block: any) => block.type === 'text')
                  .map((block: any) => block.text)
                  .join('\n');
                if (textContent) {
                  console.log(`[Execute] Assistant Message Text: ${truncateContent(textContent, 300)}`);
                }
              }

              if (eventData.type === 'session_name' && eventData.sessionName) {
                console.log(`[Execute] Session Name: ${eventData.sessionName}`);
              }

              // Update branch name if received from worker
              if (eventData.type === 'branch_created' && eventData.branchName) {
                console.log(`[Execute] Branch created: ${eventData.branchName}`);
                await db
                  .update(chatSessions)
                  .set({ branch: eventData.branchName })
                  .where(eq(chatSessions.id, chatSession.id));

                // Update local session object
                chatSession.branch = eventData.branchName;
              }

              if (eventData.type === 'session_name' && eventData.branchName) {
                 // Also update branch if provided in session_name event
                 console.log(`[Execute] Branch name from session metadata: ${eventData.branchName}`);
                 await db
                  .update(chatSessions)
                  .set({ branch: eventData.branchName })
                  .where(eq(chatSessions.id, chatSession.id));

                 chatSession.branch = eventData.branchName;
              }

              if (eventData.error) {
                console.log(`[Execute] ERROR in event: ${eventData.error}`);
              }

              // If no event type was set from event: line, check data.type
              if (!currentEvent && eventData.type) {
                currentEvent = eventData.type;
              }

              // Store AI worker session path
              if (eventData.sessionId) {
                console.log(`[Execute] Received sessionPath from AI worker: ${eventData.sessionId}, current sessionPath: ${chatSession.sessionPath || 'N/A'}`);

                if (!chatSession.sessionPath) {
                  await db
                    .update(chatSessions)
                    .set({ sessionPath: eventData.sessionId })
                    .where(eq(chatSessions.id, chatSession.id));

                  // Update local chatSession object
                  chatSession.sessionPath = eventData.sessionId;
                  console.log(`[Execute] Stored sessionPath: ${eventData.sessionId} for chatSession: ${chatSession.id}`);
                } else {
                  console.log(`[Execute] sessionPath already set, skipping update`);
                }
              } else {
                console.log(`[Execute] No sessionId in event data:`, JSON.stringify(eventData).substring(0, 200));
              }

              // Store assistant messages (extract content from various event structures)
              let messageContent: string | null = null;

              // Extract content from different event types
              if (eventData.type === 'message' && eventData.message) {
                messageContent = eventData.message;
              } else if (eventData.type === 'session_name' && eventData.sessionName) {
                messageContent = `Session: ${eventData.sessionName}`;
              } else if (eventData.type === 'assistant_message' && eventData.data) {
                const msgData = eventData.data;

                // Handle assistant message with Claude response
                if (msgData.type === 'assistant' && msgData.message?.content) {
                  const contentBlocks = msgData.message.content;
                  if (Array.isArray(contentBlocks)) {
                    const textParts = contentBlocks
                      .filter((block: any) => block.type === 'text' && block.text)
                      .map((block: any) => block.text);
                    if (textParts.length > 0) {
                      messageContent = textParts.join('\n');
                    }
                  }
                }
                // Skip result type - content already saved from assistant message
                // (result contains duplicate content that was already in the assistant message)
                else if (msgData.type === 'result') {
                  // Don't save result messages to prevent duplicates
                  messageContent = null;
                }
              }
              // Fallback to direct fields
              else if (eventData.message) {
                messageContent = eventData.message;
              } else if (eventData.content) {
                messageContent = typeof eventData.content === 'string' ? eventData.content : JSON.stringify(eventData.content);
              } else if (eventData.text) {
                messageContent = eventData.text;
              }

              // Save to database if we extracted content
              if (messageContent) {
                await db.insert(messages).values({
                  chatSessionId: chatSession.id,
                  type: 'assistant',
                  content: messageContent,
                });
              }

              // Don't forward the AI worker's 'completed' event - we'll send our own with chatSessionId
              if (currentEvent === 'completed' || eventData.type === 'completed') {
                console.log(`[Execute] Skipping forwarding of AI worker's completed event - will send our own`);
              } else {
                // Forward to client - write event and data together as a single SSE message
                if (currentEvent) {
                  res.write(`event: ${currentEvent}\n`);
                }
                res.write(`data: ${data}\n\n`);
              }
            } catch (e) {
              // Forward non-JSON data as-is (non-JSON event)
              console.log(`[Execute] <<<< INBOUND EVENT #${eventCounter} FROM AI WORKER (non-JSON) <<<<`);
              console.log(`[Execute] Event Type: ${currentEvent || 'unknown'}`);
              console.log(`[Execute] Raw Data: ${truncateContent(data, 500)}`);

              if (currentEvent) {
                res.write(`event: ${currentEvent}\n`);
              }
              res.write(`data: ${data}\n\n`);
            }

            currentEvent = ''; // Reset event type
          }
        }
      }

      // Log completion summary
      console.log(`[Execute] ========== SSE STREAM COMPLETED ==========`);
      console.log(`[Execute] Total events received: ${eventCounter}`);
      console.log(`[Execute] Chat Session ID: ${chatSession.id}`);
      console.log(`[Execute] Session Path: ${chatSession.sessionPath || 'N/A'}`);
      console.log(`[Execute] ==================================================`);

      // Mark as completed
      try {
        await db
          .update(chatSessions)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(chatSessions.id, chatSession.id));
        console.log(`[Execute] Updated session ${chatSession.id} status to 'completed'`);
      } catch (dbError) {
        console.error('[Execute] Failed to update session status to completed:', dbError);
        // Continue anyway to send completion event to client
      }

      // Check if response is still writable before writing
      if (!res.writableEnded) {
        res.write(`event: completed\n`);
        res.write(`data: ${JSON.stringify({ chatSessionId: chatSession.id, completed: true })}\n\n`);
        res.end();
      }
    } catch (streamError) {
      console.error('[Execute] ========== SSE STREAM ERROR ==========');
      console.error('[Execute] Streaming error:', streamError);
      console.error('[Execute] Error stack:', streamError instanceof Error ? streamError.stack : 'No stack trace');
      console.error('[Execute] Total events received before error:', eventCounter);
      console.error('[Execute] ===========================================');

      // Try to update session status, but don't fail if it doesn't work
      try {
        await db
          .update(chatSessions)
          .set({ status: 'error', completedAt: new Date() })
          .where(eq(chatSessions.id, chatSession.id));
      } catch (dbError) {
        console.error('Failed to update session status to error:', dbError);
        // Continue anyway to send error event to client
      }

      // Check if response is still writable before writing
      if (!res.writableEnded) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Streaming failed' })}\n\n`);
        res.write(`event: completed\n`);
        res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
        res.end();
      }
    }
    } catch (fetchError) {
      clearTimeout(timeout);
      console.error('[Execute] ========== AI WORKER FETCH ERROR ==========');
      console.error('[Execute] Fetch error:', fetchError);
      console.error('[Execute] Error name:', fetchError instanceof Error ? fetchError.name : 'Unknown');
      console.error('[Execute] ===================================================');

      await db
        .update(chatSessions)
        .set({ status: 'error', completedAt: new Date() })
        .where(eq(chatSessions.id, chatSession.id));

      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: 'Failed to connect to AI worker. Please try again.' })}\n\n`);
      res.write(`event: completed\n`);
      res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
      res.end();
      return;
    }
  } catch (error) {
    console.error('[Execute] ========== EXECUTE HANDLER ERROR ==========');
    console.error('[Execute] Error:', error);
    console.error('[Execute] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('[Execute] Chat Session ID:', chatSession?.id || 'N/A');
    console.error('[Execute] User ID:', authReq?.user?.id || 'N/A');
    console.error('[Execute] Resume Session ID:', resumeSessionId || 'N/A');
    console.error('[Execute] ===================================================');

    // Try to update session status if session was created, but don't fail if it doesn't work
    if (chatSession?.id) {
      try {
        await db
          .update(chatSessions)
          .set({ status: 'error', completedAt: new Date() })
          .where(eq(chatSessions.id, chatSession.id));
      } catch (dbError) {
        console.error('Failed to update session status in error handler:', dbError);
      }
    }

    // Check if headers were already sent (SSE stream started)
    if (res.headersSent) {
      // Send error through SSE stream only if response is still writable
      if (!res.writableEnded) {
        try {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
          res.write(`event: completed\n`);
          res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
          res.end();
        } catch (writeError) {
          console.error('Failed to write error to SSE stream:', writeError);
          // Connection is likely already closed, nothing more we can do
        }
      }
    } else {
      // Send JSON error response
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
};

// Register both GET and POST routes
router.get('/execute', requireAuth, executeHandler);
router.post('/execute', requireAuth, executeHandler);

export default router;
