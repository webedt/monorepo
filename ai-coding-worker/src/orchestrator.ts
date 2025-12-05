import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteRequest, SSEEvent, SessionMetadata, UserRequestContent } from './types';
import { GitHubWorkerClient } from './clients/githubWorkerClient';
import { DBClient } from './clients/dbClient';
import { StorageClient } from './storage/storageClient';
import { ProviderFactory } from './providers/ProviderFactory';
import { Request, Response } from 'express';
import { logger } from './utils/logger';
import { GitHelper } from './utils/gitHelper'; // Used in fallback branch creation
import { CredentialManager } from './utils/credentialManager';
import { parseRepoUrl, generateSessionPath, sessionPathToDir } from './utils/sessionPathHelper';
import { enrichEventWithRelativePaths } from './utils/filePathHelper';

// Website API URL for callbacks (worker -> website server)
const WEBSITE_API_URL = process.env.WEBSITE_API_URL || 'http://localhost:3000';
const WORKER_CALLBACK_SECRET = process.env.WORKER_CALLBACK_SECRET;

/**
 * Main orchestrator for executing coding assistant requests
 * Uses storage-worker for session storage - downloads session at start, uploads at end
 */
export class Orchestrator {
  private githubWorkerClient: GitHubWorkerClient;
  private dbClient: DBClient;
  private sessionStorage: StorageClient;
  private tmpDir: string;

  constructor(tmpDir: string, dbBaseUrl?: string) {
    this.tmpDir = tmpDir || '/tmp';
    this.githubWorkerClient = new GitHubWorkerClient();
    this.dbClient = new DBClient(dbBaseUrl);
    this.sessionStorage = new StorageClient();
  }

  /**
   * Notify the website server of session completion status
   * This ensures the session status is updated even if the SSE connection was lost
   * (e.g., due to a server restart during job execution)
   */
  private async notifyWebsiteOfCompletion(
    websiteSessionId: string,
    status: 'completed' | 'error'
  ): Promise<void> {
    if (!WORKER_CALLBACK_SECRET) {
      logger.warn('WORKER_CALLBACK_SECRET not configured, skipping completion callback', {
        component: 'Orchestrator',
        websiteSessionId
      });
      return;
    }

    try {
      const callbackUrl = `${WEBSITE_API_URL}/api/sessions/${websiteSessionId}/worker-status`;

      logger.info('Notifying website of session completion', {
        component: 'Orchestrator',
        websiteSessionId,
        status,
        callbackUrl
      });

      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          completedAt: new Date().toISOString(),
          workerSecret: WORKER_CALLBACK_SECRET
        })
      });

      if (response.ok) {
        const result = await response.json();
        logger.info('Website notified of session completion', {
          component: 'Orchestrator',
          websiteSessionId,
          status,
          response: result
        });
      } else {
        const errorText = await response.text();
        logger.warn('Failed to notify website of completion', {
          component: 'Orchestrator',
          websiteSessionId,
          status,
          httpStatus: response.status,
          error: errorText
        });
      }
    } catch (err) {
      // Non-critical - the orphan cleanup will eventually handle it
      logger.warn('Error notifying website of completion (non-critical)', {
        component: 'Orchestrator',
        websiteSessionId,
        status,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Serialize userRequest for storage
   * Converts structured content to a summary string for database storage
   */
  private serializeUserRequest(userRequest: UserRequestContent): string {
    if (typeof userRequest === 'string') {
      return userRequest;
    }

    // For structured content, create a summary
    const textBlocks = userRequest
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join(' ');

    const imageCount = userRequest.filter(b => b.type === 'image').length;

    return imageCount > 0
      ? `${textBlocks} [${imageCount} image${imageCount > 1 ? 's' : ''}]`
      : textBlocks;
  }

  /**
   * Initialize the orchestrator (call once on startup)
   */
  async initialize(): Promise<void> {
    await this.sessionStorage.initialize();
  }

  /**
   * Initialize a repository for a session without running AI
   * Delegates to GitHub Worker for cloning and storage upload
   */
  async initializeRepository(options: {
    websiteSessionId: string;
    github: {
      repoUrl: string;
      branch: string;
      accessToken: string;
    };
  }): Promise<{
    clonedPath: string;
    branch: string;
    wasCloned: boolean;
  }> {
    const { websiteSessionId, github } = options;

    logger.info('Initializing repository for session via GitHub Worker', {
      component: 'Orchestrator',
      websiteSessionId,
      repoUrl: github.repoUrl,
      branch: github.branch
    });

    // Delegate to GitHub Worker
    const result = await this.githubWorkerClient.cloneRepository(
      {
        sessionId: websiteSessionId,
        repoUrl: github.repoUrl,
        branch: github.branch,
        accessToken: github.accessToken
      },
      (event) => {
        logger.info('GitHub Worker event', {
          component: 'Orchestrator',
          websiteSessionId,
          event: event.type,
          stage: event.stage,
          message: event.message
        });
      }
    );

    logger.info('Repository initialized successfully via GitHub Worker', {
      component: 'Orchestrator',
      websiteSessionId,
      clonedPath: result.clonedPath,
      branch: result.branch
    });

    return {
      clonedPath: result.clonedPath,
      branch: result.branch,
      wasCloned: result.wasCloned
    };
  }

  /**
   * Execute a complete workflow request
   */
  async execute(request: ExecuteRequest, req: Request, res: Response, abortSignal?: AbortSignal): Promise<void> {
    const startTime = Date.now();
    let chunkIndex = 0;
    let providerSessionId: string | undefined;
    let workspacePath: string | undefined;

    // Debug: Log incoming websiteSessionId
    logger.info('Received execute request', {
      component: 'Orchestrator',
      websiteSessionId: request.websiteSessionId,
      hasWebsiteSessionId: !!request.websiteSessionId,
      websiteSessionIdType: typeof request.websiteSessionId,
      hasDatabaseConfig: !!request.database,
      hasGithubConfig: !!request.github
    });

    // websiteSessionId is required and always provided by the website
    if (!request.websiteSessionId) {
      throw new Error('websiteSessionId is required');
    }

    const websiteSessionId: string = request.websiteSessionId;
    let repositoryOwner: string | undefined;
    let repositoryName: string | undefined;
    let branchName: string | undefined;

    // Parse repository info if provided (for metadata and branch creation)
    if (request.github) {
      const { owner, repo } = parseRepoUrl(request.github.repoUrl);
      repositoryOwner = owner;
      repositoryName = repo;
    }

    // Session root path (uses UUID for filesystem safety)
    const sessionRoot = path.join(this.tmpDir, `session-${websiteSessionId}`);

    // Local workspace path (ephemeral - in /tmp, may change to repo directory)
    workspacePath = sessionRoot;

    // Track client connection state
    let clientDisconnected = false;
    let eventsSent = 0;

    // IMPORTANT: Use res.on('close') instead of req.on('close')
    // For POST requests, req.on('close') fires when the request body is fully received,
    // NOT when the client actually disconnects. The client sends a JSON body and then
    // waits for SSE events - req.on('close') fires immediately after the body is received.
    // res.on('close') correctly fires when the response stream is closed (client disconnects).
    res.on('close', () => {
      logger.warn('Client disconnected - stopping event emission', {
        component: 'Orchestrator',
        websiteSessionId,
        eventsSent
      });
      clientDisconnected = true;
    });

    res.on('error', (err) => {
      logger.error('Response stream error - client may have disconnected', err, {
        component: 'Orchestrator',
        websiteSessionId,
        eventsSent
      });
      clientDisconnected = true;
    });

    // Helper to send SSE events
    const sendEvent = (event: SSEEvent) => {
      // Check if client is still connected
      if (clientDisconnected) {
        logger.warn('Skipping event - client disconnected', {
          component: 'Orchestrator',
          websiteSessionId,
          eventType: event.type,
          eventsSent
        });
        return;
      }

      // Add source if not already present
      if (!event.source) {
        event.source = 'ai-coding-worker';
      }

      // Write to response stream and check backpressure
      const canWrite = res.write(`data: ${JSON.stringify(event)}\n\n`);
      eventsSent++;

      if (!canWrite) {
        logger.warn('Write buffer full - backpressure detected', {
          component: 'Orchestrator',
          websiteSessionId,
          eventType: event.type,
          eventsSent
        });
      }

      // Persist to session root (not repo directory) - will be uploaded to MinIO at end
      try {
        this.sessionStorage.appendStreamEvent(websiteSessionId, sessionRoot, event);
      } catch (err) {
        logger.error('Failed to persist event', err, {
          component: 'Orchestrator',
          websiteSessionId
        });
      }

      // Persist to DB if configured
      if (request.database) {
        this.dbClient.appendChunk(
          {
            sessionId: websiteSessionId,
            accessToken: request.database.accessToken
          },
          {
            sessionId: websiteSessionId,
            chunkIndex: chunkIndex++,
            type: event.type,
            content: event,
            timestamp: event.timestamp
          }
        ).catch(err => {
          logger.error('Failed to persist chunk to DB', err, {
            component: 'Orchestrator',
            websiteSessionId
          });
        });
      }
    };

    try {
      // Step 1: Validate request
      this.validateRequest(request);

      // Step 1.5: Write credentials early so GitHub Worker's LLM can use them
      // This ensures the same credentials used by the provider are available for LLM-based naming
      CredentialManager.writeClaudeCredentials(request.codingAssistantAuthentication);
      logger.info('Credentials written for LLM naming', {
        component: 'Orchestrator',
        websiteSessionId
      });

      // Step 2: Download session from storage (determines if this is a new or resuming session)
      logger.info('Downloading session from storage', {
        component: 'Orchestrator',
        websiteSessionId,
        provider: request.codingAssistantProvider
      });

      const sessionExisted = await this.sessionStorage.downloadSession(websiteSessionId, workspacePath);
      const isResuming = sessionExisted; // Determined by storage, not request params

      // Load metadata if session exists
      let metadata: SessionMetadata | null = null;
      if (sessionExisted) {
        metadata = await this.sessionStorage.getMetadata(websiteSessionId, sessionRoot);

        if (metadata) {
          providerSessionId = metadata.providerSessionId;
          // Extract session info from metadata
          repositoryOwner = metadata.repositoryOwner;
          repositoryName = metadata.repositoryName;
          branchName = metadata.branch;

          logger.info('Loaded session metadata', {
            component: 'Orchestrator',
            websiteSessionId,
            providerSessionId,
            isResuming: true
          });
        }
      }

      // Create metadata if new session
      if (!metadata) {
        metadata = {
          sessionId: websiteSessionId,
          sessionPath: undefined, // Will be populated after branch creation
          repositoryOwner,
          repositoryName,
          branch: branchName,
          provider: request.codingAssistantProvider,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.sessionStorage.saveMetadata(websiteSessionId, sessionRoot, metadata);

        logger.info('Created new session metadata', {
          component: 'Orchestrator',
          websiteSessionId,
          isResuming: false
        });
      }

      // Step 3: Send connection event
      sendEvent({
        type: 'connected',
        sessionId: websiteSessionId,
        resuming: isResuming,
        resumedFrom: isResuming ? websiteSessionId : undefined,
        provider: request.codingAssistantProvider,
        timestamp: new Date().toISOString()
      });

      // Step 4: Setup GitHub repository if provided
      if (request.github) {
        // Check if repo already exists in session (resuming session)
        const repoAlreadyExists = metadata.github?.clonedPath &&
          fs.existsSync(path.join(sessionRoot, 'workspace', metadata.github.clonedPath));

        if (repoAlreadyExists) {
          // Repo exists - use it from metadata
          workspacePath = path.join(sessionRoot, 'workspace', metadata.github!.clonedPath);
          logger.info('Using existing cloned repo from session', {
            component: 'Orchestrator',
            websiteSessionId,
            clonedPath: metadata.github!.clonedPath,
            workspacePath,
            branch: metadata.branch
          });
        } else {
          // New session - use init-session to clone AND create branch in one call
          // This avoids the 429 busy issue from two sequential github-worker calls
          const shouldInitializeSession =
            !isResuming &&
            !metadata.branch &&
            !metadata.sessionTitle;

          if (shouldInitializeSession) {
            logger.info('Initializing new session via GitHub Worker /init-session', {
              component: 'Orchestrator',
              websiteSessionId,
              repoUrl: request.github.repoUrl,
              branch: request.github.branch
            });

            sendEvent({
              type: 'message',
              message: `Initializing session: ${request.github.repoUrl}`,
              timestamp: new Date().toISOString()
            });

            try {
              // Call GitHub Worker to clone repository AND create branch in one operation
              const userRequestText = this.serializeUserRequest(request.userRequest);

              const initResult = await this.githubWorkerClient.initSession(
                {
                  sessionId: websiteSessionId,
                  repoUrl: request.github.repoUrl,
                  branch: request.github.branch,
                  directory: request.github.directory,
                  userRequest: userRequestText,
                  claudeCredentials: request.codingAssistantAuthentication,
                  githubAccessToken: request.github.accessToken!
                },
                (event) => {
                  // Forward events from github-worker with original source preserved
                  // Map 'progress' to 'message', but keep special types like branch_created, session_name
                  const eventType = event.type === 'progress' ? 'message' : event.type;
                  sendEvent({
                    type: eventType,
                    message: event.message,
                    stage: event.stage,
                    data: event.data,
                    error: event.error,
                    code: event.code,
                    source: 'github-worker',
                    timestamp: event.timestamp,
                    // Pass through additional fields for branch_created and session_name events
                    ...(event.branchName && { branchName: event.branchName }),
                    ...(event.baseBranch && { baseBranch: event.baseBranch }),
                    ...(event.sessionPath && { sessionPath: event.sessionPath }),
                    ...(event.sessionName && { sessionName: event.sessionName })
                  } as SSEEvent);
                }
              );

              // Extract results from github-worker
              branchName = initResult.branchName;
              const sessionTitle = initResult.sessionTitle;
              const sessionPath = initResult.sessionPath;

              logger.info('GitHub Worker init-session completed successfully', {
                component: 'Orchestrator',
                websiteSessionId,
                clonedPath: initResult.clonedPath,
                baseBranch: initResult.branch,
                branchName,
                sessionTitle,
                sessionPath
              });

              // Download updated session from storage (github-worker uploaded it)
              await this.sessionStorage.downloadSession(websiteSessionId, sessionRoot);

              // Reload metadata after download
              const updatedMetadata = await this.sessionStorage.getMetadata(websiteSessionId, sessionRoot);
              if (updatedMetadata) {
                Object.assign(metadata, updatedMetadata);
              }

              // Update workspace path to cloned repo
              workspacePath = path.join(sessionRoot, 'workspace', initResult.clonedPath);

              // Update local metadata with results
              metadata.branch = branchName;
              metadata.sessionPath = sessionPath;
              metadata.repositoryOwner = repositoryOwner;
              metadata.repositoryName = repositoryName;
              metadata.sessionTitle = sessionTitle;
              this.sessionStorage.saveMetadata(websiteSessionId, sessionRoot, metadata);

            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);

              logger.error('Failed to initialize session via GitHub Worker', error, {
                component: 'Orchestrator',
                websiteSessionId
              });

              // Send error info
              sendEvent({
                type: 'debug',
                message: `GitHub Worker init-session failed: ${errorMessage}`,
                error: errorMessage,
                timestamp: new Date().toISOString()
              });

              // Fallback: clone and create branch locally if github-worker fails
              try {
                // First, try to clone via simpler clone-repository endpoint
                sendEvent({
                  type: 'message',
                  message: `Fallback: Cloning repository...`,
                  timestamp: new Date().toISOString()
                });

                const cloneResult = await this.githubWorkerClient.cloneRepository(
                  {
                    sessionId: websiteSessionId,
                    repoUrl: request.github.repoUrl,
                    branch: request.github.branch,
                    directory: request.github.directory,
                    accessToken: request.github.accessToken!
                  },
                  (event) => {
                    if (event.type === 'progress') {
                      sendEvent({
                        type: 'message',
                        message: event.message,
                        source: 'github-worker',
                        timestamp: event.timestamp
                      });
                    }
                  }
                );

                // Download the session from storage
                await this.sessionStorage.downloadSession(websiteSessionId, sessionRoot);

                // Update workspace path
                workspacePath = path.join(sessionRoot, 'workspace', cloneResult.clonedPath);

                // Now create branch locally
                const title = 'New Session';
                const descriptivePart = 'auto-request';
                const sessionIdSuffix = websiteSessionId.slice(-8);
                branchName = `webedt/${descriptivePart}-${sessionIdSuffix}`;

                sendEvent({
                  type: 'debug',
                  message: `Using local fallback: title="${title}", branch="${branchName}"`,
                  source: 'ai-coding-worker',
                  timestamp: new Date().toISOString()
                });

                const gitHelper = new GitHelper(workspacePath);
                await gitHelper.createBranch(branchName);

                try {
                  await gitHelper.push();
                  sendEvent({
                    type: 'message',
                    message: `Branch ${branchName} pushed - build starting`,
                    source: 'ai-coding-worker',
                    timestamp: new Date().toISOString()
                  });
                } catch (pushError) {
                  logger.warn('Fallback branch push failed (non-critical)', {
                    component: 'Orchestrator',
                    websiteSessionId,
                    branchName,
                    error: pushError instanceof Error ? pushError.message : String(pushError)
                  });
                }

                const sessionPath = generateSessionPath(repositoryOwner!, repositoryName!, branchName);
                metadata.branch = branchName;
                metadata.sessionPath = sessionPath;
                metadata.repositoryOwner = repositoryOwner;
                metadata.repositoryName = repositoryName;
                metadata.sessionTitle = title;
                this.sessionStorage.saveMetadata(websiteSessionId, sessionRoot, metadata);

                sendEvent({
                  type: 'branch_created',
                  branchName: branchName,
                  baseBranch: cloneResult.branch,
                  sessionPath: sessionPath,
                  message: `Created and checked out branch: ${branchName}`,
                  timestamp: new Date().toISOString()
                });

                sendEvent({
                  type: 'session_name',
                  sessionName: title,
                  branchName: branchName,
                  timestamp: new Date().toISOString()
                });
              } catch (fallbackError) {
                sendEvent({
                  type: 'message',
                  message: `Warning: Failed to initialize session - ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } else {
            // Not a new session but repo doesn't exist - just clone it
            sendEvent({
              type: 'message',
              message: `Cloning repository: ${request.github.repoUrl}`,
              timestamp: new Date().toISOString()
            });

            const cloneResult = await this.githubWorkerClient.cloneRepository(
              {
                sessionId: websiteSessionId,
                repoUrl: request.github.repoUrl,
                branch: request.github.branch,
                directory: request.github.directory,
                accessToken: request.github.accessToken!
              },
              (event) => {
                if (event.type === 'progress') {
                  sendEvent({
                    type: 'message',
                    message: event.message,
                    source: 'github-worker',
                    timestamp: event.timestamp
                  });
                }
              }
            );

            // Download the session from storage
            await this.sessionStorage.downloadSession(websiteSessionId, sessionRoot);

            // Update workspace path
            workspacePath = path.join(sessionRoot, 'workspace', cloneResult.clonedPath);

            logger.info('Repository cloned via GitHub Worker', {
              component: 'Orchestrator',
              websiteSessionId,
              clonedPath: cloneResult.clonedPath,
              branch: cloneResult.branch
            });
          }
        }
      }

      // Update DB with session metadata
      if (request.database) {
        await this.dbClient.updateSession(
          {
            sessionId: websiteSessionId,
            accessToken: request.database.accessToken
          },
          {
            userRequest: this.serializeUserRequest(request.userRequest),
            provider: request.codingAssistantProvider,
            status: 'active',
            startTime
          }
        );
      }

      // Step 5: Create provider instance
      sendEvent({
        type: 'message',
        message: `Executing with ${request.codingAssistantProvider}`,
        timestamp: new Date().toISOString()
      });

      const provider = ProviderFactory.createProvider(
        request.codingAssistantProvider,
        request.codingAssistantAuthentication,
        workspacePath,
        request.providerOptions,
        isResuming // Pass resuming flag to provider
      );

      // Step 6: Execute provider and stream results
      await provider.execute(
        request.userRequest,
        {
          authentication: request.codingAssistantAuthentication,
          workspace: workspacePath,
          resumeSessionId: providerSessionId, // Use provider's internal session ID
          providerOptions: request.providerOptions,
          abortSignal // Pass abort signal to provider
        },
        (event) => {
          // Extract provider session ID from init message
          if (event.type === 'assistant_message' &&
              event.data?.type === 'system' &&
              event.data?.subtype === 'init' &&
              event.data?.session_id) {
            const newProviderSessionId = event.data.session_id;
            logger.info('Provider session initialized', {
              component: 'Orchestrator',
              websiteSessionId,
              providerSessionId: newProviderSessionId
            });

            // Update metadata with provider session ID
            metadata!.providerSessionId = newProviderSessionId;
            this.sessionStorage.saveMetadata(
              websiteSessionId,
              sessionRoot,
              metadata!
            );
          }

          // Forward provider events to SSE stream
          // Enrich events with relative paths for better display on frontend
          const enrichedEvent = enrichEventWithRelativePaths(event, workspacePath!);

          // Determine source based on provider
          const providerSource = request.codingAssistantProvider === 'ClaudeAgentSDK'
            ? 'claude-agent-sdk'
            : request.codingAssistantProvider === 'Codex'
              ? 'codex-sdk'
              : 'ai-coding-worker';

          sendEvent({
            ...enrichedEvent,
            source: providerSource as any,
            timestamp: new Date().toISOString()
          });
        }
      );

      // Step 6.5: Auto-commit changes via GitHub Worker (always enabled for GitHub sessions)
      const shouldAutoCommit = !!metadata.github;

      if (shouldAutoCommit) {
        try {
          // Upload session to storage first so github-worker can download it
          await this.sessionStorage.uploadSession(websiteSessionId, sessionRoot);

          logger.info('Calling GitHub Worker for auto-commit', {
            component: 'Orchestrator',
            websiteSessionId
          });

          // Call GitHub Worker to commit and push changes
          // GitHub Worker handles: change detection, LLM commit message, commit, push, storage upload
          const commitResult = await this.githubWorkerClient.commitAndPush(
            {
              sessionId: websiteSessionId,
              claudeCredentials: request.codingAssistantAuthentication,
              githubAccessToken: request.github!.accessToken!
            },
            (event) => {
              // Forward events from github-worker with original source preserved
              // Map progress events to commit_progress, but keep commit_progress as-is
              const eventType = event.type === 'progress' ? 'commit_progress' : event.type;
              sendEvent({
                type: eventType,
                message: event.message,
                stage: event.stage,
                data: event.data,
                error: event.error,
                code: event.code,
                source: 'github-worker',
                timestamp: event.timestamp,
                // Pass through additional fields
                ...(event.branch && { branch: event.branch }),
                ...(event.commitHash && { commitHash: event.commitHash })
              } as SSEEvent);
            }
          );

          if (commitResult.skipped) {
            logger.info('No changes to auto-commit', {
              component: 'Orchestrator',
              websiteSessionId,
              reason: commitResult.reason
            });
          } else {
            logger.info('Auto-commit completed via GitHub Worker', {
              component: 'Orchestrator',
              websiteSessionId,
              commitHash: commitResult.commitHash,
              branch: commitResult.branch,
              pushed: commitResult.pushed
            });

            // Download updated session from storage (github-worker uploaded it)
            await this.sessionStorage.downloadSession(websiteSessionId, sessionRoot);
          }

          // Note: commit completion events are sent by github-worker
          // and forwarded via the event callback above - no need to duplicate here
        } catch (error) {
          logger.error('Failed to auto-commit via GitHub Worker', error, {
            component: 'Orchestrator',
            websiteSessionId
          });
          // Continue without auto-commit - not critical
          sendEvent({
            type: 'commit_progress',
            stage: 'completed',
            message: 'Auto-commit failed (non-critical)',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      }

      // Step 7: Upload session to MinIO
      logger.info('Uploading session to storage', {
        component: 'Orchestrator',
        websiteSessionId
      });

      await this.sessionStorage.uploadSession(websiteSessionId, sessionRoot);

      // Step 8: Send completion event
      const duration = Date.now() - startTime;
      sendEvent({
        type: 'completed',
        sessionId: websiteSessionId,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      });

      // Update DB with completion
      if (request.database) {
        await this.dbClient.updateSession(
          {
            sessionId: websiteSessionId,
            accessToken: request.database.accessToken
          },
          {
            userRequest: this.serializeUserRequest(request.userRequest),
            provider: request.codingAssistantProvider,
            status: 'completed',
            endTime: Date.now()
          }
        );
      }

      logger.info('Session completed successfully', {
        component: 'Orchestrator',
        websiteSessionId,
        provider: request.codingAssistantProvider,
        durationMs: duration
      });

      // Step 8.5: Notify website server of completion (handles SSE connection loss)
      // This is a safety net - if the website server restarted during execution,
      // the SSE connection was lost and the status won't be updated. This callback
      // ensures the session status is always updated.
      await this.notifyWebsiteOfCompletion(websiteSessionId, 'completed');

      // Step 9: Cleanup local workspace
      try {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
        logger.info('Local workspace cleaned up', {
          component: 'Orchestrator',
          websiteSessionId
        });
      } catch (err) {
        logger.error('Failed to cleanup local workspace', err, {
          component: 'Orchestrator',
          websiteSessionId
        });
      }

      logger.info('Closing SSE stream - all events sent', {
        component: 'Orchestrator',
        websiteSessionId,
        totalEventsSent: eventsSent,
        clientDisconnected
      });
      res.end();
    } catch (error) {
      logger.error('Error during execution', error, {
        component: 'Orchestrator',
        websiteSessionId,
        provider: request.codingAssistantProvider
      });

      // Send error event
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        code: this.getErrorCode(error),
        timestamp: new Date().toISOString()
      });

      // Try to upload session even on error (preserve state)
      try {
        if (workspacePath && fs.existsSync(sessionRoot)) {
          await this.sessionStorage.uploadSession(websiteSessionId, sessionRoot);
        }
      } catch (uploadErr) {
        logger.error('Failed to upload session after error', uploadErr, {
          component: 'Orchestrator',
          websiteSessionId
        });
      }

      // Cleanup local workspace
      try {
        if (fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
        logger.error('Failed to cleanup local workspace after error', cleanupErr, {
          component: 'Orchestrator',
          websiteSessionId
        });
      }

      // Update DB with error
      if (request.database) {
        await this.dbClient.updateSession(
          {
            sessionId: websiteSessionId,
            accessToken: request.database.accessToken
          },
          {
            userRequest: this.serializeUserRequest(request.userRequest),
            provider: request.codingAssistantProvider,
            status: 'error',
            endTime: Date.now()
          }
        ).catch(err => logger.error('Failed to update error status in DB', err, {
          component: 'Orchestrator',
          websiteSessionId
        }));
      }

      // Notify website server of error (handles SSE connection loss)
      await this.notifyWebsiteOfCompletion(websiteSessionId, 'error');

      logger.info('Closing SSE stream after error', {
        component: 'Orchestrator',
        websiteSessionId,
        totalEventsSent: eventsSent,
        clientDisconnected
      });
      res.end();
      throw error; // Re-throw to trigger worker exit
    }
  }

  /**
   * Validate request payload
   */
  private validateRequest(request: ExecuteRequest): void {
    // Validate userRequest (can be string or structured content)
    if (!request.userRequest) {
      throw new Error('userRequest is required');
    }

    if (typeof request.userRequest === 'string' && request.userRequest.trim() === '') {
      throw new Error('userRequest cannot be empty');
    }

    if (Array.isArray(request.userRequest) && request.userRequest.length === 0) {
      throw new Error('userRequest cannot be empty');
    }

    if (!request.codingAssistantProvider || request.codingAssistantProvider.trim() === '') {
      throw new Error('codingAssistantProvider is required');
    }

    if (!request.codingAssistantAuthentication || request.codingAssistantAuthentication.trim() === '') {
      throw new Error('codingAssistantAuthentication is required');
    }

    if (!ProviderFactory.isProviderSupported(request.codingAssistantProvider)) {
      throw new Error(
        `Unsupported provider: ${request.codingAssistantProvider}. ` +
        `Supported providers: ${ProviderFactory.getSupportedProviders().join(', ')}`
      );
    }

    if (request.github) {
      if (!request.github.repoUrl || request.github.repoUrl.trim() === '') {
        throw new Error('github.repoUrl is required when github integration is enabled');
      }
    }

    if (!request.websiteSessionId || request.websiteSessionId.trim() === '') {
      throw new Error('websiteSessionId is required');
    }

    if (request.database) {
      if (!request.database.accessToken || request.database.accessToken.trim() === '') {
        throw new Error('database.accessToken is required when database persistence is enabled');
      }
    }
  }

  /**
   * Get error code from error object
   */
  private getErrorCode(error: any): string {
    if (error.message?.includes('Session not found')) {
      return 'session_not_found';
    }
    if (error.message?.includes('token')) {
      return 'auth_error';
    }
    if (error.message?.includes('repository') || error.message?.includes('not found')) {
      return 'repo_not_found';
    }
    if (error.message?.includes('Cannot provide both')) {
      return 'invalid_request';
    }
    return 'internal_error';
  }

  /**
   * List all sessions (from MinIO)
   */
  async listSessions(): Promise<string[]> {
    return await this.sessionStorage.listSessions();
  }

  /**
   * Delete a session (from MinIO)
   */
  async deleteSession(sessionPath: string): Promise<void> {
    await this.sessionStorage.deleteSession(sessionPath);
  }
}
