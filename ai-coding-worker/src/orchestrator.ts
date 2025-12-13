import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { ExecuteRequest, SSEEvent, UserRequestContent } from './types';
import { ProviderFactory } from './providers/ProviderFactory';
import { Request, Response } from 'express';
import { logger, getEventEmoji } from '@webedt/shared';
import { CredentialManager } from './utils/credentialManager';
import { SecureCredentialManager } from './utils/secureCredentialManager';
import { enrichEventWithRelativePaths } from './utils/filePathHelper';
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
    // Create secure session directory with restricted permissions (700)
    // Use cryptographically random suffix to prevent predictable paths
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const sessionRoot = path.join(WORKSPACE_ROOT, `session-${websiteSessionId}-${randomSuffix}`);

    // Create session-specific credential directory for isolation
    const credentialSessionDir = SecureCredentialManager.createSecureSessionDir(websiteSessionId);
    CredentialManager.setSessionHome(credentialSessionDir);
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

      // Clean up any existing local directory and create new one with secure permissions
      if (fs.existsSync(sessionRoot)) {
        // Securely delete existing session directory
        SecureCredentialManager.secureDeleteDirectory(sessionRoot);
      }
      // Create session directory with restricted permissions (700)
      fs.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
      fs.chmodSync(sessionRoot, 0o700);

      // Download and extract session with progress callbacks
      const sessionDownloaded = await this.storageClient.downloadSession(
        websiteSessionId,
        sessionRoot,
        (stage, message, data) => {
          // Send progress events to client for visibility into download/extract process
          sendEvent({
            type: 'message',
            stage: `download_${stage}`,
            message,
            data,
            timestamp: new Date().toISOString()
          });
        }
      );

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

      // Also check what's in sessionRoot and sessionRoot/workspace for debugging
      const sessionRootFiles = fs.existsSync(sessionRoot)
        ? fs.readdirSync(sessionRoot)
        : [];
      const sessionWorkspaceDir = path.join(sessionRoot, 'workspace');
      const sessionWorkspaceFiles = fs.existsSync(sessionWorkspaceDir)
        ? fs.readdirSync(sessionWorkspaceDir)
        : [];

      logger.info('Workspace ready', {
        component: 'Orchestrator',
        websiteSessionId,
        sessionRoot,
        sessionRootFiles,
        sessionWorkspaceDir,
        sessionWorkspaceFiles,
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
          path: localWorkspacePath,
          sessionRoot,
          sessionRootFiles,
          sessionWorkspaceFiles
        },
        timestamp: new Date().toISOString()
      });

      // Git isolation: Backup and remove .git directory to prevent AI from committing/pushing
      // The .git directory will be restored after execution so the session maintains git history
      const gitDirPath = path.join(localWorkspacePath, '.git');
      const gitBackupPreExecPath = path.join(sessionRoot, '.git-backup-pre-execution');

      if (hasGitDir) {
        try {
          // Backup the original .git directory before AI execution
          await this.copyDirectory(gitDirPath, gitBackupPreExecPath);
          logger.info('Backed up .git directory before AI execution', {
            component: 'Orchestrator',
            websiteSessionId,
            gitDirPath,
            gitBackupPreExecPath
          });

          // Remove .git directory to prevent AI from committing/pushing
          fs.rmSync(gitDirPath, { recursive: true, force: true });
          logger.info('Removed .git directory to prevent AI git operations', {
            component: 'Orchestrator',
            websiteSessionId,
            localWorkspacePath
          });

          sendEvent({
            type: 'message',
            stage: 'git_isolated',
            message: 'Git directory backed up and removed for AI isolation',
            data: {
              gitBackupPath: gitBackupPreExecPath
            },
            timestamp: new Date().toISOString()
          });
        } catch (gitBackupError) {
          logger.error('Failed to backup/remove .git directory', gitBackupError, {
            component: 'Orchestrator',
            websiteSessionId,
            localWorkspacePath
          });
          // Continue anyway - AI might still be able to use git but at least we tried
        }
      }

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

      // Final verification right before execution - check files are still there
      const preExecFiles = fs.existsSync(localWorkspacePath)
        ? fs.readdirSync(localWorkspacePath)
        : [];
      logger.info('Pre-execution workspace verification', {
        component: 'Orchestrator',
        websiteSessionId,
        localWorkspacePath,
        fileCount: preExecFiles.length,
        files: preExecFiles,
        workspaceExists: fs.existsSync(localWorkspacePath),
        sessionRootExists: fs.existsSync(sessionRoot)
      });

      if (preExecFiles.length === 0) {
        logger.error('CRITICAL: Workspace is empty right before provider execution!', {
          component: 'Orchestrator',
          websiteSessionId,
          localWorkspacePath,
          sessionRoot
        });
      }

      // Step 6: Execute provider and stream results
      // Extract resumeSessionId from providerOptions for Claude SDK resume functionality
      const resumeSessionId = request.providerOptions?.resumeSessionId;
      if (resumeSessionId) {
        logger.info('Resuming with provider session ID', {
          component: 'Orchestrator',
          websiteSessionId,
          resumeSessionId
        });
      }

      await provider.execute(
        request.userRequest,
        {
          authentication: request.codingAssistantAuthentication,
          workspace: localWorkspacePath,
          resumeSessionId, // Pass at top level for Claude SDK
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

      // Step 7: Post-execution git handling
      // Restore the original .git directory for session continuity
      if (fs.existsSync(localWorkspacePath)) {
        try {
          // Force filesystem sync to ensure all writes are flushed to disk
          execSync('sync', { stdio: 'pipe' });

          const postExecGitDir = path.join(localWorkspacePath, '.git');

          // Restore the original .git directory from backup
          if (fs.existsSync(gitBackupPreExecPath)) {
            // Remove any .git that might exist (e.g., if AI created one)
            if (fs.existsSync(postExecGitDir)) {
              fs.rmSync(postExecGitDir, { recursive: true, force: true });
            }

            await this.copyDirectory(gitBackupPreExecPath, postExecGitDir);
            logger.info('Restored original .git directory after AI execution', {
              component: 'Orchestrator',
              websiteSessionId,
              gitBackupPreExecPath,
              restoredTo: postExecGitDir
            });

            // Add to safe.directory to avoid ownership issues
            try {
              execSync(`git config --global --add safe.directory "${localWorkspacePath}"`, { stdio: 'pipe' });
            } catch {
              // Ignore - may already be added
            }

            // Check git status after restoration
            const gitStatus = execSync('git status --porcelain', {
              cwd: localWorkspacePath,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe']
            });
            const gitDiffStat = execSync('git diff --stat', {
              cwd: localWorkspacePath,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe']
            });

            const changedFiles = gitStatus.trim().split('\n').filter(line => line.trim());

            logger.info('Pre-upload git status check (after .git restoration)', {
              component: 'Orchestrator',
              websiteSessionId,
              localWorkspacePath,
              hasChanges: changedFiles.length > 0,
              changedFileCount: changedFiles.length,
              changedFiles: changedFiles.slice(0, 20), // First 20 for logging
              gitDiffStat: gitDiffStat.substring(0, 500)
            });

            // Send git status to client for visibility
            sendEvent({
              type: 'message',
              stage: 'pre_upload_git_check',
              message: changedFiles.length > 0
                ? `Git status: ${changedFiles.length} changed file(s) detected`
                : 'Git status: No uncommitted changes detected',
              data: {
                changedFileCount: changedFiles.length,
                changedFiles: changedFiles.slice(0, 10),
                gitRestored: true
              },
              timestamp: new Date().toISOString()
            });
          }
        } catch (gitRestoreError) {
          logger.warn('Post-execution git handling failed (non-critical)', {
            component: 'Orchestrator',
            websiteSessionId,
            error: gitRestoreError instanceof Error ? gitRestoreError.message : String(gitRestoreError)
          });
        }
      }

      sendEvent({
        type: 'message',
        stage: 'uploading',
        message: 'Uploading session to storage...',
        timestamp: new Date().toISOString()
      });

      await this.storageClient.uploadSession(
        websiteSessionId,
        sessionRoot,
        (stage, message, data) => {
          // Send progress events to client for visibility into upload process
          sendEvent({
            type: 'message',
            stage: `upload_${stage}`,
            message,
            data,
            timestamp: new Date().toISOString()
          });
        }
      );

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

      // Cleanup local session directory and credentials
      try {
        if (fs.existsSync(sessionRoot)) {
          // Securely delete session directory
          SecureCredentialManager.secureDeleteDirectory(sessionRoot);
        }
        // Cleanup session-specific credentials
        CredentialManager.cleanupSessionCredentials();
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

      // Cleanup local session directory and credentials
      try {
        if (fs.existsSync(sessionRoot)) {
          SecureCredentialManager.secureDeleteDirectory(sessionRoot);
        }
        CredentialManager.cleanupSessionCredentials();
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

    // Create a secure temporary directory for the query
    const queryDir = SecureCredentialManager.createSecureTempDir('query-');

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
      // Securely clean up temporary directory
      try {
        SecureCredentialManager.secureDeleteDirectory(queryDir);
      } catch (cleanupError) {
        logger.warn('Failed to clean up query directory', {
          component: 'Orchestrator',
          queryDir: SecureCredentialManager.redactPath(queryDir),
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
    }
  }

  /**
   * Recursively copy a directory
   * Used for backing up and restoring .git directories
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        // Remove existing destination file first to avoid permission issues
        try {
          await fs.promises.unlink(destPath);
        } catch {
          // File doesn't exist, that's fine
        }

        // Try copyFile first, fall back to read/write if permission denied
        // (handles git pack files with restrictive permissions)
        try {
          await fs.promises.copyFile(srcPath, destPath);
        } catch (err: any) {
          if (err.code === 'EACCES') {
            // Permission denied - read file contents and write to destination
            const content = await fs.promises.readFile(srcPath);
            await fs.promises.writeFile(destPath, content);
          } else {
            throw err;
          }
        }
      }
    }
  }
}
