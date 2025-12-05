import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { CommitAndPushRequest, CommitAndPushResult } from '../types';
import { StorageClient } from '../storage/storageClient';
import { GitHelper } from '../utils/gitHelper';
import { LLMHelper } from '../utils/llmHelper';
import { CredentialManager } from '../utils/credentialManager';
import { logger } from '../utils/logger';

/**
 * Send SSE event to client
 */
function sendEvent(res: Response, event: any): void {
  res.write(`data: ${JSON.stringify({ ...event, source: 'github-worker', timestamp: new Date().toISOString() })}\n\n`);
}

/**
 * Commit changes and push to remote
 */
export async function commitAndPush(
  request: CommitAndPushRequest,
  res: Response,
  tmpDir: string
): Promise<void> {
  const { sessionId, claudeCredentials, githubAccessToken, userId } = request;
  const sessionRoot = path.join(tmpDir, `session-${sessionId}`);

  const storageClient = new StorageClient();

  try {
    // Step 1: Write Claude credentials for LLM
    sendEvent(res, {
      type: 'progress',
      stage: 'preparing',
      message: 'Preparing for commit...'
    });

    CredentialManager.writeClaudeCredentials(claudeCredentials);

    // Step 2: Download session
    sendEvent(res, {
      type: 'progress',
      stage: 'downloading_session',
      message: 'Downloading session...'
    });

    // Clean up any existing session directory
    if (fs.existsSync(sessionRoot)) {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }

    const sessionExisted = await storageClient.downloadSession(sessionId, sessionRoot);
    if (!sessionExisted) {
      throw new Error('Session not found');
    }

    // Step 3: Get metadata and workspace path
    const metadata = storageClient.getMetadata(sessionRoot);
    if (!metadata?.github?.clonedPath) {
      throw new Error('Session has no cloned repository');
    }

    const workspacePath = path.join(sessionRoot, metadata.github.clonedPath);
    const gitHelper = new GitHelper(workspacePath);

    // Step 4: Check if it's a git repo
    const isRepo = await gitHelper.isGitRepo();
    if (!isRepo) {
      sendEvent(res, {
        type: 'completed',
        data: {
          commitHash: '',
          commitMessage: '',
          branch: '',
          pushed: false,
          skipped: true,
          reason: 'Not a git repository'
        }
      });

      // Cleanup
      CredentialManager.cleanup();
      fs.rmSync(sessionRoot, { recursive: true, force: true });
      res.end();
      return;
    }

    // Step 5: Check for changes
    sendEvent(res, {
      type: 'progress',
      stage: 'analyzing',
      message: 'Analyzing changes...'
    });

    const hasChanges = await gitHelper.hasChanges();
    if (!hasChanges) {
      const currentBranch = await gitHelper.getCurrentBranch();

      // Send user-visible skip message
      sendEvent(res, {
        type: 'commit_progress',
        stage: 'completed',
        message: '📤 Auto-commit skipped: No changes to commit',
        branch: currentBranch
      });

      sendEvent(res, {
        type: 'completed',
        data: {
          commitHash: '',
          commitMessage: '',
          branch: currentBranch,
          pushed: false,
          skipped: true,
          reason: 'No changes to commit'
        }
      });

      // Cleanup
      CredentialManager.cleanup();
      fs.rmSync(sessionRoot, { recursive: true, force: true });
      res.end();
      return;
    }

    // Step 6: Get git status and diff
    const gitStatus = await gitHelper.getStatus();
    const gitDiff = await gitHelper.getDiff();
    const currentBranch = await gitHelper.getCurrentBranch();

    sendEvent(res, {
      type: 'progress',
      stage: 'changes_detected',
      message: `Changes detected on branch: ${currentBranch}`,
      status: gitStatus
    });

    // Step 7: Generate commit message using LLM
    sendEvent(res, {
      type: 'progress',
      stage: 'generating_message',
      message: 'Generating commit message...'
    });

    const llmHelper = new LLMHelper(workspacePath);
    let commitMessage: string;

    try {
      commitMessage = await llmHelper.generateCommitMessage(gitStatus, gitDiff);

      // Add user attribution if provided
      if (userId) {
        commitMessage = `${commitMessage}\n\nCommitted by: ${userId}`;
      }

      logger.info('Generated commit message', {
        component: 'CommitAndPush',
        sessionId,
        commitMessage
      });
    } catch (llmError) {
      logger.warn('LLM commit message generation failed, using fallback', {
        component: 'CommitAndPush',
        sessionId,
        error: llmError instanceof Error ? llmError.message : String(llmError)
      });

      commitMessage = userId ? `Update files\n\nCommitted by: ${userId}` : 'Update files';

      sendEvent(res, {
        type: 'progress',
        stage: 'fallback',
        message: 'Using fallback commit message (LLM unavailable)'
      });
    }

    // Step 8: Commit changes
    sendEvent(res, {
      type: 'progress',
      stage: 'committing',
      message: 'Committing changes...',
      commitMessage
    });

    const commitHash = await gitHelper.commitAll(commitMessage);

    sendEvent(res, {
      type: 'progress',
      stage: 'committed',
      message: 'Changes committed successfully',
      commitHash
    });

    // Step 9: Push to remote
    sendEvent(res, {
      type: 'progress',
      stage: 'pushing',
      message: `Pushing to remote branch: ${currentBranch}...`
    });

    let pushed = false;
    try {
      await gitHelper.push();
      pushed = true;

      sendEvent(res, {
        type: 'progress',
        stage: 'pushed',
        message: 'Changes pushed successfully'
      });

      logger.info('Push completed', {
        component: 'CommitAndPush',
        sessionId,
        commitHash,
        branch: currentBranch
      });
    } catch (pushError) {
      // Push failure is non-critical
      logger.error('Push failed (non-critical)', pushError, {
        component: 'CommitAndPush',
        sessionId,
        branch: currentBranch
      });

      sendEvent(res, {
        type: 'progress',
        stage: 'push_failed',
        message: 'Push failed (commit saved locally)',
        error: pushError instanceof Error ? pushError.message : String(pushError)
      });
    }

    // Step 10: Upload session back to storage
    await storageClient.uploadSession(sessionId, sessionRoot);

    // Send user-visible completion message
    sendEvent(res, {
      type: 'commit_progress',
      stage: 'completed',
      message: pushed ? `📤 Changes committed and pushed` : `📤 Changes committed (push pending)`,
      branch: currentBranch,
      commitHash
    });

    // Step 11: Send completed event
    const result: CommitAndPushResult = {
      commitHash,
      commitMessage,
      branch: currentBranch,
      pushed
    };

    sendEvent(res, {
      type: 'completed',
      data: result
    });

    logger.info('Commit and push completed', {
      component: 'CommitAndPush',
      sessionId,
      commitHash,
      branch: currentBranch,
      pushed
    });

    // Cleanup
    CredentialManager.cleanup();
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    res.end();

  } catch (error) {
    logger.error('Commit and push failed', error, {
      component: 'CommitAndPush',
      sessionId
    });

    sendEvent(res, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'commit_push_failed'
    });

    // Cleanup on error
    CredentialManager.cleanup();
    try {
      if (fs.existsSync(sessionRoot)) {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    res.end();
    throw error;
  }
}
