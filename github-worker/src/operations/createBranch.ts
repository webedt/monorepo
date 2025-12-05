import * as fs from 'fs';
import * as path from 'path';
import { Response } from 'express';
import { CreateBranchRequest, CreateBranchResult, parseRepoUrl, generateSessionPath } from '../types';
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
 * Create a new branch with LLM-generated name
 */
export async function createBranch(
  request: CreateBranchRequest,
  res: Response,
  tmpDir: string
): Promise<void> {
  const { sessionId, userRequest, baseBranch, repoUrl, claudeCredentials, githubAccessToken } = request;
  const sessionRoot = path.join(tmpDir, `session-${sessionId}`);

  const storageClient = new StorageClient();

  try {
    // Step 1: Write Claude credentials for LLM
    sendEvent(res, {
      type: 'progress',
      stage: 'preparing',
      message: 'Preparing for branch creation...'
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
      throw new Error('Session not found - must clone repository first');
    }

    // Step 3: Get metadata and workspace path
    const metadata = storageClient.getMetadata(sessionRoot);
    if (!metadata?.github?.clonedPath) {
      throw new Error('Session has no cloned repository');
    }

    const workspacePath = path.join(sessionRoot, metadata.github.clonedPath);
    const { owner, repo } = parseRepoUrl(repoUrl);

    // Step 4: Generate session title and branch name using LLM
    sendEvent(res, {
      type: 'progress',
      stage: 'generating_name',
      message: 'Generating session title and branch name...'
    });

    const llmHelper = new LLMHelper(workspacePath);
    let title: string;
    let descriptivePart: string;

    try {
      const result = await llmHelper.generateSessionTitleAndBranch(userRequest, baseBranch);
      title = result.title;
      descriptivePart = result.branchName;

      logger.info('Generated session title and branch name', {
        component: 'CreateBranch',
        sessionId,
        title,
        descriptivePart
      });
    } catch (llmError) {
      logger.warn('LLM naming failed, using fallback', {
        component: 'CreateBranch',
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

    const gitHelper = new GitHelper(workspacePath);
    await gitHelper.createBranch(branchName);

    // Step 6: Push branch to remote
    sendEvent(res, {
      type: 'progress',
      stage: 'pushing',
      message: `Pushing branch ${branchName} to trigger build...`
    });

    try {
      await gitHelper.push();
      sendEvent(res, {
        type: 'progress',
        stage: 'pushed',
        message: 'Branch pushed successfully'
      });
    } catch (pushError) {
      // Non-critical - log but continue
      logger.warn('Early branch push failed (non-critical)', {
        component: 'CreateBranch',
        sessionId,
        branchName,
        error: pushError instanceof Error ? pushError.message : String(pushError)
      });

      sendEvent(res, {
        type: 'progress',
        stage: 'push_warning',
        message: 'Push failed (will retry after commits)'
      });
    }

    // Step 7: Update metadata
    const sessionPath = generateSessionPath(owner, repo, branchName);
    metadata.branch = branchName;
    metadata.sessionPath = sessionPath;
    metadata.sessionTitle = title;
    metadata.repositoryOwner = owner;
    metadata.repositoryName = repo;

    storageClient.saveMetadata(sessionRoot, metadata);

    // Step 8: Upload to storage
    sendEvent(res, {
      type: 'progress',
      stage: 'uploading',
      message: 'Uploading session to storage...'
    });

    await storageClient.uploadSession(sessionId, sessionRoot);

    // Step 9: Send completed event
    const result: CreateBranchResult = {
      branchName,
      sessionTitle: title,
      sessionPath
    };

    sendEvent(res, {
      type: 'completed',
      data: result
    });

    logger.info('Create branch completed', {
      component: 'CreateBranch',
      sessionId,
      branchName,
      sessionTitle: title,
      sessionPath
    });

    // Cleanup
    CredentialManager.cleanup();
    fs.rmSync(sessionRoot, { recursive: true, force: true });
    res.end();

  } catch (error) {
    logger.error('Create branch failed', error, {
      component: 'CreateBranch',
      sessionId
    });

    sendEvent(res, {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'create_branch_failed'
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
