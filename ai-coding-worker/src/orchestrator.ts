import * as fs from 'fs';
import * as path from 'path';
import { ExecuteRequest, SSEEvent, UserRequestContent } from './types';
import { ProviderFactory } from './providers/ProviderFactory';
import { Request, Response } from 'express';
import { logger } from './utils/logger';
import { CredentialManager } from './utils/credentialManager';
import { enrichEventWithRelativePaths } from './utils/filePathHelper';
import { getEventEmoji } from './utils/emojiMapper';
import { StorageClient } from './storage/storageClient';

// Local workspace root for downloaded sessions
const WORKSPACE_ROOT = process.env.WORKSPACE_DIR || '/workspace';

/**
 * Orchestrator for executing coding assistant requests
 *
 * This worker handles LLM execution with session sync:
 * - Downloads session from storage (via internal-api-server)
 * - Runs the LLM provider in the extracted workspace
 * - Uploads session back to storage after completion
 * - Streams events back to caller
 */
export class Orchestrator {
  private storageClient: StorageClient;

  constructor() {
    this.storageClient = new StorageClient();
  }

  /**
   * Initialize the orchestrator (no-op, kept for API compatibility)
   */
  async initialize(): Promise<void> {
    // Nothing to initialize - session storage is handled by internal-api-server
    logger.info('Orchestrator initialized (LLM execution only)', {
      component: 'Orchestrator'
    });
  }

  /**
   * Execute an LLM request
   *
   * Flow:
   * 1. Download session from storage (using websiteSessionId)
   * 2. Extract to local workspace
   * 3. Write credentials for the provider
   * 4. Run the LLM provider
   * 5. Upload session back to storage
   * 6. Stream events back to caller
   */
  async execute(request: ExecuteRequest, req: Request, res: Response, abortSignal?: AbortSignal): Promise<void> {
    const startTime = Date.now();

    const websiteSessionId = request.websiteSessionId || 'unknown';
    // Local paths for this session
    const sessionRoot = path.join(WORKSPACE_ROOT, `session-${websiteSessionId}`);
    // workspacePath tells us where the repo is within the session (e.g., /workspace/session-xxx/workspace/hello-world)
    // We need to extract just the relative repo path from it
    const repoRelativePath = this.extractRepoPath(request.workspacePath);
    const localWorkspacePath = repoRelativePath
      ? path.join(sessionRoot, 'workspace', repoRelativePath)
      : path.join(sessionRoot, 'workspace');

    logger.info('Received execute request', {
      component: 'Orchestrator',
      websiteSessionId,
      originalWorkspacePath: request.workspacePath,
      localWorkspacePath,
      repoRelativePath,
      provider: request.codingAssistantProvider
    });

    // Track client connection state
    let clientDisconnected = false;
    let eventsSent = 0;

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

      // Apply emoji prefix to messages based on stage/type/source
      if (event.message && typeof event.message === 'string') {
        const emoji = getEventEmoji(event);
        event.message = `${emoji} ${event.message}`;
      }

      // Write to response stream
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
    };

    try {
      // Step 1: Validate request
      this.validateRequest(request);

      // Step 2: Download session from storage
      sendEvent({
        type: 'message',
        stage: 'downloading',
        message: 'Downloading session from storage...',
        timestamp: new Date().toISOString()
      });

      // Clean up any existing local directory
      if (fs.existsSync(sessionRoot)) {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
      }

      // Download and extract session
      const sessionDownloaded = await this.storageClient.downloadSession(websiteSessionId, sessionRoot);

      if (sessionDownloaded) {
        logger.info('Session downloaded from storage', {
          component: 'Orchestrator',
          websiteSessionId,
          sessionRoot
        });
      } else {
        logger.info('No existing session in storage, created empty workspace', {
          component: 'Orchestrator',
          websiteSessionId,
          sessionRoot
        });
      }

      // Ensure the workspace path exists after download
      if (!fs.existsSync(localWorkspacePath)) {
        // Create workspace directory if it doesn't exist
        fs.mkdirSync(localWorkspacePath, { recursive: true });
        logger.info('Created workspace directory', {
          component: 'Orchestrator',
          websiteSessionId,
          localWorkspacePath
        });
      }

      // Verify workspace is ready with files
      const workspaceFiles = fs.existsSync(localWorkspacePath)
        ? fs.readdirSync(localWorkspacePath)
        : [];
      const hasGitDir = workspaceFiles.includes('.git');

      logger.info('Workspace ready', {
        component: 'Orchestrator',
        websiteSessionId,
        localWorkspacePath,
        workspaceExists: fs.existsSync(localWorkspacePath),
        fileCount: workspaceFiles.length,
        hasGitDir,
        files: workspaceFiles.slice(0, 20) // First 20 files for debugging
      });

      // Send workspace state event to client for debugging
      sendEvent({
        type: 'message',
        stage: 'workspace_ready',
        message: `Workspace ready with ${workspaceFiles.length} files${hasGitDir ? ' (git repo)' : ''}`,
        data: {
          fileCount: workspaceFiles.length,
          hasGitDir,
          path: localWorkspacePath
        },
        timestamp: new Date().toISOString()
      });

      // Step 3: Write credentials for the provider
      CredentialManager.writeClaudeCredentials(request.codingAssistantAuthentication);
      logger.info('Credentials written', {
        component: 'Orchestrator',
        websiteSessionId
      });

      // Step 4: Send connected event
      sendEvent({
        type: 'connected',
        sessionId: websiteSessionId,
        provider: request.codingAssistantProvider,
        timestamp: new Date().toISOString()
      });

      // Step 5: Create provider instance
      sendEvent({
        type: 'message',
        message: `Executing with ${request.codingAssistantProvider}`,
        timestamp: new Date().toISOString()
      });

      const provider = ProviderFactory.createProvider(
        request.codingAssistantProvider,
        request.codingAssistantAuthentication,
        localWorkspacePath,
        request.providerOptions,
        false // resuming flag - internal-api-server handles session state
      );

      // Step 6: Execute provider and stream results
      await provider.execute(
        request.userRequest,
        {
          authentication: request.codingAssistantAuthentication,
          workspace: localWorkspacePath,
          providerOptions: request.providerOptions,
          abortSignal
        },
        (event) => {
          // Enrich events with relative paths for better display on frontend
          const enrichedEvent = enrichEventWithRelativePaths(event, localWorkspacePath);

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

      // Step 7: Upload session back to storage
      sendEvent({
        type: 'message',
        stage: 'uploading',
        message: 'Uploading session to storage...',
        timestamp: new Date().toISOString()
      });

      await this.storageClient.uploadSession(websiteSessionId, sessionRoot);

      logger.info('Session uploaded to storage', {
        component: 'Orchestrator',
        websiteSessionId,
        sessionRoot
      });

      // Step 8: Send completion event
      const duration = Date.now() - startTime;
      sendEvent({
        type: 'completed',
        sessionId: websiteSessionId,
        duration_ms: duration,
        timestamp: new Date().toISOString()
      });

      logger.info('Execution completed successfully', {
        component: 'Orchestrator',
        websiteSessionId,
        provider: request.codingAssistantProvider,
        durationMs: duration
      });

      // Cleanup local session directory
      try {
        if (fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        logger.warn('Failed to cleanup local session directory', {
          component: 'Orchestrator',
          websiteSessionId,
          sessionRoot,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
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

      // Try to upload session even on error (to preserve any partial work)
      try {
        if (fs.existsSync(sessionRoot)) {
          await this.storageClient.uploadSession(websiteSessionId, sessionRoot);
          logger.info('Session uploaded after error', {
            component: 'Orchestrator',
            websiteSessionId
          });
        }
      } catch (uploadError) {
        logger.error('Failed to upload session after error', uploadError, {
          component: 'Orchestrator',
          websiteSessionId
        });
      }

      // Cleanup local session directory
      try {
        if (fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }

      // Send error event
      sendEvent({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        code: this.getErrorCode(error),
        timestamp: new Date().toISOString()
      });

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

    // workspacePath is now required (provided by internal-api-server)
    if (!request.workspacePath) {
      throw new Error('workspacePath is required');
    }
  }

  /**
   * Get error code from error object
   */
  private getErrorCode(error: any): string {
    if (error.message?.includes('Workspace path does not exist')) {
      return 'workspace_not_found';
    }
    if (error.message?.includes('token')) {
      return 'auth_error';
    }
    if (error.message?.includes('workspacePath is required')) {
      return 'invalid_request';
    }
    return 'internal_error';
  }

  /**
   * Extract the repository path from a full workspace path
   * e.g., /workspace/session-xxx/workspace/hello-world -> hello-world
   */
  private extractRepoPath(workspacePath: string): string | null {
    if (!workspacePath) return null;

    // Pattern: /workspace/session-{id}/workspace/{repo-name}
    // We want to extract just the repo-name part
    const match = workspacePath.match(/\/workspace\/session-[^/]+\/workspace\/(.+)$/);
    if (match) {
      return match[1];
    }

    // Alternative: just get the last path component if it looks like a repo name
    const parts = workspacePath.split('/').filter(p => p);
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      // If the last part is 'workspace', there's no repo subdirectory
      if (lastPart === 'workspace') {
        return null;
      }
      return lastPart;
    }

    return null;
  }

  /**
   * Run a one-off LLM query without creating a persistent session
   * Used for generating session titles, branch names, commit messages, etc.
   */
  async runQuery(options: {
    prompt: string;
    provider: string;
    authentication: string;
  }): Promise<string> {
    const { prompt, provider, authentication } = options;

    logger.info('Running one-off LLM query', {
      component: 'Orchestrator',
      provider,
      promptLength: prompt.length
    });

    // Create a temporary directory for the query
    const queryId = `query-${Date.now()}`;
    const queryDir = path.join('/tmp', queryId);
    fs.mkdirSync(queryDir, { recursive: true });

    try {
      // Write credentials for the provider
      const providerLower = provider.toLowerCase();
      if (providerLower === 'claude-code' || providerLower === 'claudeagentsdk') {
        CredentialManager.writeClaudeCredentials(authentication);
      } else if (providerLower === 'codex' || providerLower === 'cursor') {
        CredentialManager.writeCodexCredentials(authentication);
      }

      // Use LLMHelper which already has the query logic
      const { LLMHelper } = await import('./utils/llmHelper');
      const llmHelper = new LLMHelper(queryDir);

      // Run the query
      const result = await llmHelper.runRawQuery(prompt);

      logger.info('LLM query completed', {
        component: 'Orchestrator',
        resultLength: result.length
      });

      return result;

    } finally {
      // Clean up temporary directory
      try {
        fs.rmSync(queryDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn('Failed to clean up query directory', {
          component: 'Orchestrator',
          queryDir,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
    }
  }
}
