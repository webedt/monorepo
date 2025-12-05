import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { CloneRepositoryRequest, CloneRepositoryResult, SessionMetadata, parseRepoUrl } from '../types';
import { GitHubClient } from '../clients/githubClient';
import { StorageClient } from '../storage/storageClient';
import { logger } from '../utils/logger';

/**
 * Send SSE event to client
 */
function sendEvent(res: Response, event: any): void {
  res.write(`data: ${JSON.stringify({ ...event, source: 'github-worker', timestamp: new Date().toISOString() })}\n\n`);
}

/**
 * Clone a GitHub repository into a session
 */
export async function cloneRepository(
  request: CloneRepositoryRequest,
  res: Response,
  tmpDir: string
): Promise<void> {
  const { sessionId, repoUrl, branch, directory, accessToken } = request;
  const sessionRoot = path.join(tmpDir, `session-${sessionId}`);
  const workspacePath = path.join(sessionRoot, 'workspace');

  const storageClient = new StorageClient();
  const githubClient = new GitHubClient();

  try {
    // Step 1: Download existing session (if any)
    sendEvent(res, {
      type: 'progress',
      stage: 'downloading_session',
      message: 'Checking for existing session...'
    });

    // Clean up any existing session directory
    if (fs.existsSync(sessionRoot)) {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }

    const sessionExisted = await storageClient.downloadSession(sessionId, sessionRoot);

    if (sessionExisted) {
      sendEvent(res, {
        type: 'progress',
        stage: 'session_found',
        message: 'Existing session found'
      });
    } else {
      fs.mkdirSync(workspacePath, { recursive: true });
      sendEvent(res, {
        type: 'progress',
        stage: 'new_session',
        message: 'Creating new session'
      });
    }

    // Step 2: Check if repo already exists in session
    const metadata = storageClient.getMetadata(sessionRoot);
    if (metadata?.github?.clonedPath) {
      const existingRepoPath = path.join(sessionRoot, metadata.github.clonedPath);
      if (fs.existsSync(existingRepoPath)) {
        logger.info('Repository already exists in session', {
          component: 'CloneRepository',
          sessionId,
          clonedPath: metadata.github.clonedPath
        });

        sendEvent(res, {
          type: 'progress',
          stage: 'repo_exists',
          message: 'Repository already exists in session'
        });

        // Upload session back to storage (in case there were changes)
        sendEvent(res, {
          type: 'progress',
          stage: 'uploading',
          message: 'Uploading session to storage...'
        });
        await storageClient.uploadSession(sessionId, sessionRoot);

        // Send completed event
        const result: CloneRepositoryResult = {
          clonedPath: metadata.github.clonedPath,
          branch: metadata.github.baseBranch,
          wasCloned: false
        };

        sendEvent(res, {
          type: 'completed',
          data: result
        });

        // Cleanup and exit
        fs.rmSync(sessionRoot, { recursive: true, force: true });
        res.end();
        return;
      }
    }

    // Step 3: Clone the repository
    sendEvent(res, {
      type: 'progress',
      stage: 'cloning',
      message: `Cloning repository: ${repoUrl}`
    });

    const pullResult = await githubClient.pullRepository({
      repoUrl,
      branch,
      directory,
      accessToken,
      workspaceRoot: workspacePath
    });

    // Extract relative path for metadata
    const repoName = pullResult.targetPath.replace(workspacePath + '/', '');
    const { owner, repo } = parseRepoUrl(repoUrl);

    sendEvent(res, {
      type: 'progress',
      stage: 'cloned',
      message: pullResult.wasCloned ? '⬇️ Repository cloned successfully' : '⬇️ Repository updated successfully'
    });

    // Step 4: Update metadata
    const newMetadata: SessionMetadata = {
      sessionId,
      repositoryOwner: owner,
      repositoryName: repo,
      createdAt: metadata?.createdAt || new Date().toISOString(),
      lastModified: new Date().toISOString(),
      github: {
        repoUrl,
        baseBranch: pullResult.branch,
        clonedPath: repoName
      }
    };

    storageClient.saveMetadata(sessionRoot, newMetadata);

    // Step 5: Upload to storage
    sendEvent(res, {
      type: 'progress',
      stage: 'uploading',
      message: 'Uploading session to storage...'
    });

    await storageClient.uploadSession(sessionId, sessionRoot);

    // Step 6: Send completed event
    const result: CloneRepositoryResult = {
      clonedPath: repoName,
      branch: pullResult.branch,
      wasCloned: pullResult.wasCloned
    };

    sendEvent(res, {
      type: 'completed',
      data: result
    });

    logger.info('Clone repository completed', {
      component: 'CloneRepository',
      sessionId,
      clonedPath: repoName,
      branch: pullResult.branch
    });

    // Cleanup local workspace
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    res.end();

  } catch (error) {
    logger.error('Clone repository failed', error, {
      component: 'CloneRepository',
      sessionId
    });

    sendEvent(res, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'clone_failed'
    });

    // Cleanup on error
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
