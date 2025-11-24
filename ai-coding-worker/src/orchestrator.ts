import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ExecuteRequest, SSEEvent, SessionMetadata, UserRequestContent } from './types';
import { GitHubClient } from './clients/githubClient';
import { DBClient } from './clients/dbClient';
import { StorageClient } from './storage/storageClient';
import { ProviderFactory } from './providers/ProviderFactory';
import { Response } from 'express';
import { logger } from './utils/logger';
import { LLMHelper } from './utils/llmHelper';
import { GitHelper } from './utils/gitHelper';
import { parseRepoUrl, generateSessionPath, sessionPathToDir } from './utils/sessionPathHelper';

/**
 * Main orchestrator for executing coding assistant requests
 * Uses storage-worker for session storage - downloads session at start, uploads at end
 */
export class Orchestrator {
  private githubClient: GitHubClient;
  private dbClient: DBClient;
  private sessionStorage: StorageClient;
  private tmpDir: string;

  constructor(tmpDir: string, dbBaseUrl?: string) {
    this.tmpDir = tmpDir || '/tmp';
    this.githubClient = new GitHubClient();
    this.dbClient = new DBClient(dbBaseUrl);
    this.sessionStorage = new StorageClient();
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
   * Execute a complete workflow request
   */
  async execute(request: ExecuteRequest, res: Response): Promise<void> {
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

    // Determine website session identifier (resume existing or create new)
    // This is separate from the provider's internal session ID (stored in metadata)
    const isResuming = !!request.websiteSessionId;
    const websiteSessionId: string = isResuming ? request.websiteSessionId! : uuidv4();
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

    // Helper to send SSE events
    const sendEvent = (event: SSEEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);

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

      // Step 2: Download session from MinIO (or create new)
      logger.info('Downloading session from storage', {
        component: 'Orchestrator',
        websiteSessionId,
        isResuming,
        provider: request.codingAssistantProvider
      });

      const sessionExisted = await this.sessionStorage.downloadSession(websiteSessionId, workspacePath);

      // Validate that github params aren't provided when resuming an existing session
      if (sessionExisted && request.github) {
        throw new Error(
          'Cannot provide "github" when resuming an existing session. ' +
          'The repository is already available in the session workspace.'
        );
      }

      // Load metadata if session exists
      let metadata: SessionMetadata | null = null;
      if (sessionExisted) {
        metadata = await this.sessionStorage.getMetadata(websiteSessionId, sessionRoot);

        if (metadata) {
          providerSessionId = metadata.providerSessionId;
          // Extract session info from metadata if resuming
          if (isResuming) {
            repositoryOwner = metadata.repositoryOwner;
            repositoryName = metadata.repositoryName;
            branchName = metadata.branch;
          }
          logger.info('Loaded session metadata', {
            component: 'Orchestrator',
            websiteSessionId,
            providerSessionId
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

      // Step 4: Pull GitHub repository (only for new sessions with GitHub config)
      if (request.github && !isResuming) {
        sendEvent({
          type: 'message',
          message: `Pulling repository: ${request.github.repoUrl}`,
          timestamp: new Date().toISOString()
        });

        const pullResult = await this.githubClient.pullRepository({
          repoUrl: request.github.repoUrl,
          branch: request.github.branch,
          directory: request.github.directory,
          accessToken: request.github.accessToken,
          workspaceRoot: workspacePath
        });

        // Extract relative path for metadata
        const repoName = pullResult.targetPath.replace(workspacePath + '/', '');

        // Update metadata with GitHub info
        metadata.github = {
          repoUrl: request.github.repoUrl,
          baseBranch: pullResult.branch,
          clonedPath: repoName
        };

        // Update workspace path to cloned repo
        workspacePath = pullResult.targetPath;

        // Save updated metadata
        this.sessionStorage.saveMetadata(websiteSessionId, sessionRoot, metadata);

        sendEvent({
          type: 'github_pull_progress',
          data: {
            type: 'completed',
            message: pullResult.wasCloned ? 'Repository cloned successfully' : 'Repository updated successfully',
            targetPath: pullResult.targetPath
          },
          timestamp: new Date().toISOString()
        });

        logger.info('Repository cloned', {
          component: 'Orchestrator',
          websiteSessionId,
          repoUrl: request.github.repoUrl,
          branch: pullResult.branch
        });

        // Step 4.5: Generate session title and branch name, then create the branch
        try {
          sendEvent({
            type: 'message',
            message: 'Generating session title and branch name...',
            timestamp: new Date().toISOString()
          });

          // Extract API key for LLM helper
          const apiKey = this.extractApiKey(request.codingAssistantAuthentication);
          if (!apiKey) {
            throw new Error('Cannot generate session title and branch name: API key not available');
          }

          const llmHelper = new LLMHelper(apiKey);
          const userRequestText = this.serializeUserRequest(request.userRequest);
          const { title, branchName: descriptivePart } = await llmHelper.generateSessionTitleAndBranch(
            userRequestText,
            pullResult.branch
          );

          // Extract last 8 characters of session ID for suffix
          const sessionIdSuffix = websiteSessionId.slice(-8);

          // Construct full branch name: claude/{descriptive}-{sessionIdSuffix}
          branchName = `claude/${descriptivePart}-${sessionIdSuffix}`;

          logger.info('Generated session title and branch name', {
            component: 'Orchestrator',
            websiteSessionId,
            sessionTitle: title,
            branchName,
            baseBranch: pullResult.branch
          });

          sendEvent({
            type: 'message',
            message: `Creating branch: ${branchName}`,
            timestamp: new Date().toISOString()
          });

          const gitHelper = new GitHelper(workspacePath);

          // Create and checkout the new branch
          await gitHelper.createBranch(branchName);

          // Generate sessionPath now that we have the branch name
          const sessionPath = generateSessionPath(repositoryOwner!, repositoryName!, branchName);

          // Update metadata with branch name, sessionPath, and title
          metadata.branch = branchName;
          metadata.sessionPath = sessionPath;
          metadata.repositoryOwner = repositoryOwner;
          metadata.repositoryName = repositoryName;
          metadata.sessionTitle = title;
          this.sessionStorage.saveMetadata(websiteSessionId, sessionRoot, metadata);

          sendEvent({
            type: 'branch_created',
            branchName: branchName,
            baseBranch: pullResult.branch,
            sessionPath: sessionPath,
            message: `Created and checked out branch: ${branchName}`,
            timestamp: new Date().toISOString()
          });

          // Send session_name event with the generated title
          sendEvent({
            type: 'session_name',
            sessionName: title,
            branchName: branchName,
            timestamp: new Date().toISOString()
          });

          logger.info('Branch created and session title generated', {
            component: 'Orchestrator',
            websiteSessionId,
            sessionPath,
            sessionTitle: title,
            branchName,
            baseBranch: pullResult.branch
          });
        } catch (error) {
          logger.error('Failed to create branch and generate title', error, {
            component: 'Orchestrator',
            websiteSessionId
          });
          // Branch creation failure is non-critical - session can still work without GitHub integration
          sendEvent({
            type: 'message',
            message: `Warning: Failed to create branch - ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString()
          });
        }
      } else if (metadata.github && isResuming) {
        // Resuming session with GitHub - workspace path should be repo directory
        workspacePath = path.join(sessionRoot, metadata.github.clonedPath);
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
        request.providerOptions
      );

      // Step 6: Execute provider and stream results
      await provider.execute(
        request.userRequest,
        {
          authentication: request.codingAssistantAuthentication,
          workspace: workspacePath,
          resumeSessionId: providerSessionId, // Use provider's internal session ID
          providerOptions: request.providerOptions
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
          sendEvent({
            ...event,
            timestamp: new Date().toISOString()
          });
        }
      );

      // Step 6.5: Auto-commit changes (always enabled for GitHub sessions)
      const shouldAutoCommit = !!metadata.github;

      if (shouldAutoCommit) {
        try {
          const repoPath = path.join(sessionRoot, metadata.github!.clonedPath);
          const gitHelper = new GitHelper(repoPath);

          // Get current branch name
          const currentBranch = await gitHelper.getCurrentBranch();

          // Check if there are changes to commit
          const hasChanges = await gitHelper.hasChanges();

          if (hasChanges) {
            sendEvent({
              type: 'commit_progress',
              stage: 'analyzing',
              message: 'Analyzing changes for auto-commit...',
              branch: currentBranch,
              timestamp: new Date().toISOString()
            });

            const apiKey = this.extractApiKey(request.codingAssistantAuthentication);

            if (apiKey) {
              const llmHelper = new LLMHelper(apiKey);

              // Use the current branch (which is the pre-created branch if branch creation happened)
              const targetBranch = currentBranch;

              // Get git status and diff for commit message generation
              const gitStatus = await gitHelper.getStatus();
              const gitDiff = await gitHelper.getDiff();

              sendEvent({
                type: 'commit_progress',
                stage: 'generating_message',
                message: 'Generating commit message...',
                branch: targetBranch,
                timestamp: new Date().toISOString()
              });

              // Generate commit message
              const commitMessage = await llmHelper.generateCommitMessage(gitStatus, gitDiff);

              sendEvent({
                type: 'commit_progress',
                stage: 'committing',
                message: `Attempting to commit changes to branch: ${targetBranch}`,
                branch: targetBranch,
                commitMessage,
                timestamp: new Date().toISOString()
              });

              // Create commit
              const commitHash = await gitHelper.commitAll(commitMessage);

              sendEvent({
                type: 'commit_progress',
                stage: 'committed',
                message: 'Changes committed successfully',
                branch: targetBranch,
                commitMessage,
                commitHash,
                timestamp: new Date().toISOString()
              });

              logger.info('Auto-commit completed', {
                component: 'Orchestrator',
                websiteSessionId,
                commitHash,
                commitMessage,
                branch: targetBranch
              });

              // Push to remote
              sendEvent({
                type: 'commit_progress',
                stage: 'pushing',
                message: `Attempting to push branch ${targetBranch} to remote...`,
                branch: targetBranch,
                commitHash,
                timestamp: new Date().toISOString()
              });

              try {
                await gitHelper.push();

                sendEvent({
                  type: 'commit_progress',
                  stage: 'pushed',
                  message: `Successfully pushed branch ${targetBranch} to remote`,
                  branch: targetBranch,
                  commitHash,
                  timestamp: new Date().toISOString()
                });

                logger.info('Push completed', {
                  component: 'Orchestrator',
                  websiteSessionId,
                  commitHash,
                  branch: targetBranch
                });
              } catch (pushError) {
                // Push failure is non-critical - commit is still saved locally
                logger.error('Failed to push to remote (non-critical)', pushError, {
                  component: 'Orchestrator',
                  websiteSessionId,
                  branch: targetBranch
                });

                sendEvent({
                  type: 'commit_progress',
                  stage: 'push_failed',
                  message: `Failed to push branch ${targetBranch} to remote (commit saved locally)`,
                  branch: targetBranch,
                  error: pushError instanceof Error ? pushError.message : String(pushError),
                  timestamp: new Date().toISOString()
                });
              }

              // Send final completion event
              sendEvent({
                type: 'commit_progress',
                stage: 'completed',
                message: 'Auto-commit process completed',
                branch: targetBranch,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            logger.info('No changes to auto-commit', {
              component: 'Orchestrator',
              websiteSessionId,
              branch: currentBranch
            });
          }
        } catch (error) {
          logger.error('Failed to auto-commit changes', error, {
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

      res.end();
      throw error; // Re-throw to trigger worker exit
    }
  }

  /**
   * Extract API key from authentication string
   * Handles both OAuth JSON format and plain API keys
   */
  private extractApiKey(authentication: string): string | null {
    try {
      const parsed = JSON.parse(authentication);

      // OAuth format: { claudeAiOauth: { accessToken: "..." } }
      if (parsed.claudeAiOauth?.accessToken) {
        return parsed.claudeAiOauth.accessToken;
      }

      // Unwrapped OAuth format: { accessToken: "...", refreshToken: "..." }
      if (parsed.accessToken) {
        return parsed.accessToken;
      }

      // Plain API key in object: { apiKey: "..." }
      if (parsed.apiKey) {
        return parsed.apiKey;
      }

      return null;
    } catch {
      // If not JSON, might be plain API key
      if (authentication.startsWith('sk-ant-')) {
        return authentication;
      }
      return null;
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

    if (request.database) {
      if (!request.database.accessToken || request.database.accessToken.trim() === '') {
        throw new Error('database.accessToken is required when database persistence is enabled');
      }
      if (!request.websiteSessionId || request.websiteSessionId.trim() === '') {
        throw new Error('websiteSessionId is required when database persistence is enabled');
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
