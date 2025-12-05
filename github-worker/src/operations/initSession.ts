import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { InitSessionRequest, InitSessionResult, SessionMetadata, parseRepoUrl, generateSessionPath } from '../types';
import { GitHubClient } from '../clients/githubClient';
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
 * Initialize a new session: clone repository and create branch
 * Combines clone-repository and create-branch into a single operation
 */
export async function initSession(
  request: InitSessionRequest,
  res: Response,
  tmpDir: string
): Promise<void> {
  const { sessionId, repoUrl, branch, directory, userRequest, claudeCredentials, githubAccessToken } = request;
  const sessionRoot = path.join(tmpDir, `session-${sessionId}`);
  const workspaceDir = path.join(sessionRoot, 'workspace');

  const storageClient = new StorageClient();
  const githubClient = new GitHubClient();

  try {
    // Step 1: Write Claude credentials for LLM
    sendEvent(res, {
      type: 'progress',
      stage: 'preparing',
      message: 'Preparing session initialization...'
    });

    CredentialManager.writeClaudeCredentials(claudeCredentials);

    // Step 2: Check for existing session
    sendEvent(res, {
      type: 'progress',
      stage: 'checking_session',
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
      fs.mkdirSync(workspaceDir, { recursive: true });
      sendEvent(res, {
        type: 'progress',
        stage: 'new_session',
        message: 'Creating new session'
      });
    }

    // Step 3: Check if repo already exists in session
    let metadata = storageClient.getMetadata(sessionRoot);
    let clonedPath: string;
    let baseBranch: string;

    if (metadata?.github?.clonedPath) {
      const existingRepoPath = path.join(sessionRoot, 'workspace', metadata.github.clonedPath);
      if (fs.existsSync(existingRepoPath)) {
        logger.info('Repository already exists in session', {
          component: 'InitSession',
          sessionId,
          clonedPath: metadata.github.clonedPath
        });

        sendEvent(res, {
          type: 'progress',
          stage: 'repo_exists',
          message: 'Repository already exists in session'
        });

        clonedPath = metadata.github.clonedPath;
        baseBranch = metadata.github.baseBranch;
      } else {
        // Repo path in metadata but doesn't exist - clone it
        const pullResult = await cloneRepo();
        clonedPath = pullResult.clonedPath;
        baseBranch = pullResult.branch;
      }
    } else {
      // No repo - clone it
      const pullResult = await cloneRepo();
      clonedPath = pullResult.clonedPath;
      baseBranch = pullResult.branch;
    }

    // Helper function to clone repo
    async function cloneRepo() {
      sendEvent(res, {
        type: 'progress',
        stage: 'cloning',
        message: `Cloning repository: ${repoUrl}`
      });

      const pullResult = await githubClient.pullRepository({
        repoUrl,
        branch,
        directory,
        accessToken: githubAccessToken,
        workspaceRoot: workspaceDir
      });

      const repoName = pullResult.targetPath.replace(workspaceDir + '/', '');
      const { owner, repo } = parseRepoUrl(repoUrl);

      sendEvent(res, {
        type: 'progress',
        stage: 'cloned',
        message: '⬇️ Repository cloned successfully'
      });

      // Create/update metadata
      metadata = {
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

      storageClient.saveMetadata(sessionRoot, metadata);

      return { clonedPath: repoName, branch: pullResult.branch };
    }

    // Step 4: Generate session title and branch name using LLM
    const repoPath = path.join(sessionRoot, 'workspace', clonedPath);
    const { owner, repo } = parseRepoUrl(repoUrl);

    sendEvent(res, {
      type: 'progress',
      stage: 'generating_name',
      message: 'Generating session title and branch name...'
    });

    const llmHelper = new LLMHelper(repoPath);
    let title: string;
    let descriptivePart: string;

    try {
      const result = await llmHelper.generateSessionTitleAndBranch(userRequest, baseBranch);
      title = result.title;
      descriptivePart = result.branchName;

      logger.info('Generated session title and branch name', {
        component: 'InitSession',
        sessionId,
        title,
        descriptivePart
      });
    } catch (llmError) {
      logger.warn('LLM naming failed, using fallback', {
        component: 'InitSession',
        sessionId,
        error: llmError instanceof Error ? llmError.message : String(llmError)
      });

      // Fallback
      title = 'New Session';
      descriptivePart = 'auto-request';

      sendEvent(res, {
        type: 'progress',
        stage: 'fallback',
        message: 'Using fallback naming (LLM unavailable)'
      });
    }

    // Construct full branch name: webedt/{descriptive}-{sessionIdSuffix}
    const sessionIdSuffix = sessionId.slice(-8);
    const branchName = `webedt/${descriptivePart}-${sessionIdSuffix}`;

    sendEvent(res, {
      type: 'progress',
      stage: 'name_generated',
      message: `Generated: "${title}" → ${branchName}`
    });

    // Step 5: Create and checkout branch
    sendEvent(res, {
      type: 'progress',
      stage: 'creating_branch',
      message: `Creating branch: ${branchName}`
    });

    const gitHelper = new GitHelper(repoPath);
    await gitHelper.createBranch(branchName);

    // Step 6: Push branch to remote
    sendEvent(res, {
      type: 'progress',
      stage: 'pushing',
      message: `Pushing branch ${branchName} to trigger build...`
    });

    try {
      await gitHelper.push();
    } catch (pushError) {
      // Non-critical - log but continue
      logger.warn('Early branch push failed (non-critical)', {
        component: 'InitSession',
        sessionId,
        branchName,
        error: pushError instanceof Error ? pushError.message : String(pushError)
      });
    }

    // Step 7: Update metadata
    const sessionPath = generateSessionPath(owner, repo, branchName);
    metadata!.branch = branchName;
    metadata!.sessionPath = sessionPath;
    metadata!.sessionTitle = title;
    metadata!.repositoryOwner = owner;
    metadata!.repositoryName = repo;

    storageClient.saveMetadata(sessionRoot, metadata!);

    // Send branch_created event (forwarded by ai-coding-worker to website)
    sendEvent(res, {
      type: 'branch_created',
      branchName: branchName,
      baseBranch: baseBranch,
      sessionPath: sessionPath,
      message: `🌿 Branch created: ${branchName}`
    });

    // Send session_name event (forwarded by ai-coding-worker to website)
    sendEvent(res, {
      type: 'session_name',
      sessionName: title,
      branchName: branchName,
      message: `📝 Session: ${title}`
    });

    // Step 8: Upload to storage
    sendEvent(res, {
      type: 'progress',
      stage: 'uploading',
      message: 'Uploading session to storage...'
    });

    await storageClient.uploadSession(sessionId, sessionRoot);

    // Step 9: Send completed event
    const result: InitSessionResult = {
      clonedPath,
      branch: baseBranch,
      wasCloned: !sessionExisted,
      branchName,
      sessionTitle: title,
      sessionPath
    };

    sendEvent(res, {
      type: 'completed',
      data: result
    });

    logger.info('Init session completed', {
      component: 'InitSession',
      sessionId,
      clonedPath,
      branchName,
      sessionTitle: title,
      sessionPath
    });

    // Cleanup
    CredentialManager.cleanup();
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    res.end();

  } catch (error) {
    logger.error('Init session failed', error, {
      component: 'InitSession',
      sessionId
    });

    sendEvent(res, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'init_session_failed'
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
