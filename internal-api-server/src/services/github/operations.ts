/**
 * GitHub Operations Service
 * Consolidated from github-worker operations
 * Handles repository operations: clone, branch, commit, push, pull requests
 */

import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import { GitHubClient } from './githubClient.js';
import { GitHelper } from './gitHelper.js';
import { AIWorkerClient } from '../aiWorker/aiWorkerClient.js';
import { StorageService } from '../storage/storageService.js';
import { logger } from '../../utils/logger.js';
import { generateSessionPath } from '../../utils/sessionPathHelper.js';

// ============================================================================
// Types
// ============================================================================

export interface SessionMetadata {
  sessionId: string;
  sessionPath?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  sessionTitle?: string;
  createdAt: string;
  lastModified: string;
  github?: {
    repoUrl: string;
    baseBranch: string;
    clonedPath: string;
  };
}

export interface InitSessionOptions {
  sessionId: string;
  repoUrl: string;
  branch?: string;
  directory?: string;
  userRequest: string;
  githubAccessToken: string;
  workspaceRoot: string;
  // Coding assistant credentials for LLM-based naming (optional)
  codingAssistantProvider?: string;
  codingAssistantAuthentication?: string | object;
}

export interface InitSessionResult {
  clonedPath: string;
  branch: string;
  wasCloned: boolean;
  branchName: string;
  sessionTitle: string;
  sessionPath: string;
  localPath: string;
}

export interface CommitAndPushOptions {
  sessionId: string;
  workspacePath: string;
  userId?: string;
  // Coding assistant credentials for LLM-based commit messages (optional)
  codingAssistantProvider?: string;
  codingAssistantAuthentication?: string | object;
}

export interface CommitAndPushResult {
  commitHash: string;
  commitMessage: string;
  branch: string;
  pushed: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface CreatePullRequestOptions {
  owner: string;
  repo: string;
  title?: string;
  head: string;
  base: string;
  body?: string;
  githubAccessToken: string;
}

export interface CreatePullRequestResult {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  mergeable: boolean | null;
  merged: boolean;
}

export interface MergePullRequestOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
  githubAccessToken: string;
}

export interface MergePullRequestResult {
  merged: boolean;
  sha: string;
  message: string;
}

export interface AutoPullRequestOptions {
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title?: string;
  body?: string;
  githubAccessToken: string;
}

export type AutoPRStep =
  | 'started'
  | 'checking_pr'
  | 'creating_pr'
  | 'pr_created'
  | 'merging_base'
  | 'base_merged'
  | 'waiting_mergeable'
  | 'merging_pr'
  | 'pr_merged'
  | 'deleting_branch'
  | 'completed';

export interface AutoPullRequestResult {
  step: AutoPRStep;
  progress?: string;
  pr?: { number: number; htmlUrl: string };
  mergeBase?: { sha: string | null; message: string };
  mergePr?: { merged: boolean; sha: string };
}

export type ProgressCallback = (event: {
  type: string;
  stage?: string;
  message: string;
  data?: unknown;
  endpoint?: string;  // e.g., 'internal-api-server/git/clone'
}) => void | Promise<void>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse owner and repo from a GitHub URL
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

// ============================================================================
// GitHub Operations Service
// ============================================================================

export class GitHubOperations {
  private githubClient: GitHubClient;
  private storageService: StorageService;

  constructor(storageService: StorageService) {
    this.githubClient = new GitHubClient();
    this.storageService = storageService;
  }

  /**
   * Initialize a new session: clone repository and create branch
   * This is the main entry point for setting up a new coding session
   */
  async initSession(
    options: InitSessionOptions,
    onProgress?: ProgressCallback
  ): Promise<InitSessionResult> {
    const { sessionId, repoUrl, branch, directory, userRequest, githubAccessToken, workspaceRoot } = options;
    const sessionRoot = path.join(workspaceRoot, `session-${sessionId}`);
    const workspaceDir = path.join(sessionRoot, 'workspace');

    const progress = onProgress || (() => {});
    const endpoint = '/init-session';

    try {
      progress({ type: 'progress', stage: 'preparing', message: 'Preparing session initialization...', endpoint });

      // Check for existing session in storage
      progress({ type: 'progress', stage: 'checking_session', message: 'Checking for existing session...', endpoint });

      // Clean up any existing local directory
      if (fs.existsSync(sessionRoot)) {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
      }

      // Try to download existing session
      let sessionExisted = false;
      try {
        const sessionData = await this.storageService.downloadSessionToBuffer(sessionId);
        if (sessionData) {
          // Extract session to local directory
          fs.mkdirSync(sessionRoot, { recursive: true });
          await this.storageService.extractSessionToPath(sessionData, sessionRoot);
          sessionExisted = true;
          progress({ type: 'progress', stage: 'session_found', message: 'Existing session found', endpoint });
        }
      } catch {
        // Session doesn't exist, create new
      }

      if (!sessionExisted) {
        fs.mkdirSync(workspaceDir, { recursive: true });
        progress({ type: 'progress', stage: 'new_session', message: 'Creating new session', endpoint });
      }

      // Check if repo already exists in session
      let metadata = this.getMetadata(sessionRoot);
      let clonedPath: string;
      let baseBranch: string;

      if (metadata?.github?.clonedPath) {
        const existingRepoPath = path.join(sessionRoot, 'workspace', metadata.github.clonedPath);
        if (fs.existsSync(existingRepoPath)) {
          logger.info('Repository already exists in session', {
            component: 'GitHubOperations',
            sessionId,
            clonedPath: metadata.github.clonedPath
          });

          progress({ type: 'progress', stage: 'repo_exists', message: 'Repository already exists in session', endpoint });

          clonedPath = metadata.github.clonedPath;
          baseBranch = metadata.github.baseBranch;
        } else {
          // Repo path in metadata but doesn't exist - clone it
          const pullResult = await this.cloneRepo(repoUrl, branch, directory, githubAccessToken, workspaceDir, progress, endpoint);
          clonedPath = pullResult.clonedPath;
          baseBranch = pullResult.branch;
          metadata = this.updateMetadataWithClone(sessionRoot, sessionId, repoUrl, pullResult, metadata);
        }
      } else {
        // No repo - clone it
        const pullResult = await this.cloneRepo(repoUrl, branch, directory, githubAccessToken, workspaceDir, progress, endpoint);
        clonedPath = pullResult.clonedPath;
        baseBranch = pullResult.branch;
        metadata = this.updateMetadataWithClone(sessionRoot, sessionId, repoUrl, pullResult, metadata);
      }

      // Generate session title and branch name
      const repoPath = path.join(sessionRoot, 'workspace', clonedPath);
      const { owner, repo } = parseRepoUrl(repoUrl);

      progress({ type: 'progress', stage: 'generating_name', message: 'Generating session title and branch name...', endpoint });

      let title: string;
      let descriptivePart: string;

      // Only use LLM if credentials are provided
      if (options.codingAssistantProvider && options.codingAssistantAuthentication) {
        try {
          const aiWorkerClient = new AIWorkerClient();
          // Serialize authentication if it's an object
          const authString = typeof options.codingAssistantAuthentication === 'object'
            ? JSON.stringify(options.codingAssistantAuthentication)
            : options.codingAssistantAuthentication;
          const result = await aiWorkerClient.generateSessionTitleAndBranch(
            userRequest,
            baseBranch,
            options.codingAssistantProvider,
            authString
          );
          title = result.title;
          descriptivePart = result.branchName;

          logger.info('Generated session title and branch name via AI worker', {
            component: 'GitHubOperations',
            sessionId,
            title,
            descriptivePart
          });
        } catch (llmError) {
          logger.warn('AI worker naming failed, using fallback', {
            component: 'GitHubOperations',
            sessionId,
            error: llmError instanceof Error ? llmError.message : String(llmError)
          });

          title = 'New Session';
          descriptivePart = 'auto-request';

          progress({ type: 'progress', stage: 'fallback', message: 'Using fallback naming (LLM unavailable)', endpoint });
        }
      } else {
        // No credentials provided, use fallback
        logger.info('No coding assistant credentials, using fallback naming', {
          component: 'GitHubOperations',
          sessionId
        });

        title = 'New Session';
        descriptivePart = 'auto-request';
      }

      // Construct full branch name: webedt/{descriptive}-{sessionIdSuffix}
      const sessionIdSuffix = sessionId.slice(-8);
      const branchName = `webedt/${descriptivePart}-${sessionIdSuffix}`;

      progress({ type: 'progress', stage: 'name_generated', message: `Generated: "${title}" → ${branchName}`, endpoint });

      // Create and checkout branch
      progress({ type: 'progress', stage: 'creating_branch', message: `Creating branch: ${branchName}`, endpoint });

      const gitHelper = new GitHelper(repoPath);
      await gitHelper.createBranch(branchName);

      // Push branch to remote
      progress({ type: 'progress', stage: 'pushing', message: `Pushing branch ${branchName} to trigger build...`, endpoint });

      try {
        await gitHelper.push();
      } catch (pushError) {
        logger.warn('Early branch push failed (non-critical)', {
          component: 'GitHubOperations',
          sessionId,
          branchName,
          error: pushError instanceof Error ? pushError.message : String(pushError)
        });
      }

      // Update metadata
      const sessionPath = generateSessionPath(owner, repo, branchName);
      metadata!.branch = branchName;
      metadata!.sessionPath = sessionPath;
      metadata!.sessionTitle = title;
      metadata!.repositoryOwner = owner;
      metadata!.repositoryName = repo;

      this.saveMetadata(sessionRoot, metadata!);

      // Send branch_created and session_name events
      progress({
        type: 'branch_created',
        message: `Branch created: ${branchName}`,
        data: { branchName, baseBranch, sessionPath },
        endpoint
      });

      progress({
        type: 'session_name',
        message: `Session: ${title}`,
        data: { sessionName: title, branchName },
        endpoint
      });

      // Upload to storage
      progress({ type: 'progress', stage: 'uploading', message: 'Uploading session to storage...', endpoint });

      await this.storageService.uploadSessionFromPath(sessionId, sessionRoot);

      logger.info('Init session completed', {
        component: 'GitHubOperations',
        sessionId,
        clonedPath,
        branchName,
        sessionTitle: title,
        sessionPath
      });

      return {
        clonedPath,
        branch: baseBranch,
        wasCloned: !sessionExisted,
        branchName,
        sessionTitle: title,
        sessionPath,
        localPath: repoPath
      };

    } catch (error) {
      logger.error('Init session failed', error, {
        component: 'GitHubOperations',
        sessionId
      });

      // Cleanup on error
      try {
        if (fs.existsSync(sessionRoot)) {
          fs.rmSync(sessionRoot, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  /**
   * Commit changes and push to remote
   */
  async commitAndPush(
    options: CommitAndPushOptions,
    onProgress?: ProgressCallback
  ): Promise<CommitAndPushResult> {
    const { sessionId, workspacePath, userId } = options;
    const progress = onProgress || (() => {});
    const endpoint = '/commit-push';

    try {
      await progress({ type: 'progress', stage: 'analyzing', message: 'Analyzing changes...', endpoint });

      const gitHelper = new GitHelper(workspacePath);

      // Log workspace path details for debugging
      logger.info('Checking git repo status', {
        component: 'GitHubOperations',
        sessionId,
        workspacePath,
        workspaceExists: fs.existsSync(workspacePath),
        gitDirPath: path.join(workspacePath, '.git'),
        gitDirExists: fs.existsSync(path.join(workspacePath, '.git'))
      });

      // Check if it's a git repo
      const isRepo = await gitHelper.isGitRepo();

      logger.info('Git repo check result', {
        component: 'GitHubOperations',
        sessionId,
        workspacePath,
        isRepo
      });

      if (!isRepo) {
        // Log what's in the workspace for debugging
        try {
          const contents = fs.readdirSync(workspacePath);
          const gitDirPath = path.join(workspacePath, '.git');
          let gitContents: string[] = [];
          let gitHeadContent = '';
          let gitConfigContent = '';

          if (fs.existsSync(gitDirPath)) {
            try {
              gitContents = fs.readdirSync(gitDirPath);

              // Check HEAD file
              const headPath = path.join(gitDirPath, 'HEAD');
              if (fs.existsSync(headPath)) {
                gitHeadContent = fs.readFileSync(headPath, 'utf-8').substring(0, 200);
              }

              // Check config file
              const configPath = path.join(gitDirPath, 'config');
              if (fs.existsSync(configPath)) {
                gitConfigContent = fs.readFileSync(configPath, 'utf-8').substring(0, 500);
              }
            } catch (gitReadError) {
              logger.error('Failed to read .git contents', gitReadError, {
                component: 'GitHubOperations',
                sessionId,
                gitDirPath
              });
            }
          }

          logger.warn('Workspace is not a git repo', {
            component: 'GitHubOperations',
            sessionId,
            workspacePath,
            contents,
            gitDirExists: fs.existsSync(gitDirPath),
            gitContents,
            gitHeadContent,
            gitConfigContent
          });
        } catch (e) {
          logger.error('Failed to read workspace contents', e, {
            component: 'GitHubOperations',
            sessionId,
            workspacePath
          });
        }

        // Emit progress event before returning so client knows what happened
        await progress({
          type: 'commit_progress',
          stage: 'completed',
          message: 'Auto-commit skipped: Not a git repository',
          data: { skipped: true, reason: 'Not a git repository' },
          endpoint
        });

        return {
          commitHash: '',
          commitMessage: '',
          branch: '',
          pushed: false,
          skipped: true,
          reason: 'Not a git repository'
        };
      }

      // Check for changes
      const hasChanges = await gitHelper.hasChanges();
      const gitStatus = await gitHelper.getStatus();
      const currentBranch = await gitHelper.getCurrentBranch();

      // Get more detailed git info for debugging
      const gitDiff = await gitHelper.getDiff();

      logger.info('Git status check for auto-commit', {
        component: 'GitHubOperations',
        sessionId,
        workspacePath,
        workspaceExists: fs.existsSync(workspacePath),
        hasChanges,
        currentBranch,
        gitStatus,
        gitDiffLength: gitDiff.length,
        gitDiffPreview: gitDiff.substring(0, 500)
      });

      // Send analysis result to client
      await progress({
        type: 'commit_progress',
        stage: 'analysis_complete',
        message: hasChanges
          ? `Analysis complete: Changes found on branch ${currentBranch}`
          : `Analysis complete: No changes found on branch ${currentBranch}`,
        data: { hasChanges, branch: currentBranch, status: gitStatus },
        endpoint
      });

      if (!hasChanges) {
        await progress({
          type: 'commit_progress',
          stage: 'completed',
          message: 'Auto-commit skipped: No changes to commit',
          data: { branch: currentBranch, skipped: true },
          endpoint
        });

        return {
          commitHash: '',
          commitMessage: '',
          branch: currentBranch,
          pushed: false,
          skipped: true,
          reason: 'No changes to commit'
        };
      }

      // gitDiff already retrieved earlier for debugging

      await progress({
        type: 'commit_progress',
        stage: 'changes_detected',
        message: `Changes detected on branch: ${currentBranch}`,
        data: { status: gitStatus },
        endpoint
      });

      // Generate commit message using AI worker
      await progress({ type: 'progress', stage: 'generating_message', message: 'Generating commit message...', endpoint });

      let commitMessage: string;

      // Only use AI worker if credentials are provided
      if (options.codingAssistantProvider && options.codingAssistantAuthentication) {
        try {
          const aiWorkerClient = new AIWorkerClient();
          // Serialize authentication if it's an object
          const authString = typeof options.codingAssistantAuthentication === 'object'
            ? JSON.stringify(options.codingAssistantAuthentication)
            : options.codingAssistantAuthentication;
          commitMessage = await aiWorkerClient.generateCommitMessage(
            gitStatus,
            gitDiff,
            options.codingAssistantProvider,
            authString
          );

          if (userId) {
            commitMessage = `${commitMessage}\n\nCommitted by: ${userId}`;
          }

          logger.info('Generated commit message via AI worker', {
            component: 'GitHubOperations',
            sessionId,
            commitMessage
          });
        } catch (llmError) {
          logger.warn('AI worker commit message generation failed, using fallback', {
            component: 'GitHubOperations',
            sessionId,
            error: llmError instanceof Error ? llmError.message : String(llmError)
          });

          commitMessage = userId ? `Update files\n\nCommitted by: ${userId}` : 'Update files';

          await progress({ type: 'progress', stage: 'fallback', message: 'Using fallback commit message (AI worker unavailable)', endpoint });
        }
      } else {
        // No credentials provided, use fallback
        logger.info('No coding assistant credentials, using fallback commit message', {
          component: 'GitHubOperations',
          sessionId
        });

        commitMessage = userId ? `Update files\n\nCommitted by: ${userId}` : 'Update files';
      }

      // Commit changes
      await progress({ type: 'progress', stage: 'committing', message: 'Committing changes...', data: { commitMessage }, endpoint });

      const commitHash = await gitHelper.commitAll(commitMessage);

      await progress({ type: 'progress', stage: 'committed', message: 'Changes committed successfully', data: { commitHash }, endpoint });

      // Push to remote
      await progress({ type: 'progress', stage: 'pushing', message: `Pushing to remote branch: ${currentBranch}...`, endpoint });

      let pushed = false;
      try {
        await gitHelper.push();
        pushed = true;

        await progress({ type: 'progress', stage: 'pushed', message: 'Changes pushed successfully', endpoint });

        logger.info('Push completed', {
          component: 'GitHubOperations',
          sessionId,
          commitHash,
          branch: currentBranch
        });
      } catch (pushError) {
        logger.error('Push failed (non-critical)', pushError, {
          component: 'GitHubOperations',
          sessionId,
          branch: currentBranch
        });

        await progress({
          type: 'progress',
          stage: 'push_failed',
          message: 'Push failed (commit saved locally)',
          data: { error: pushError instanceof Error ? pushError.message : String(pushError) },
          endpoint
        });
      }

      await progress({
        type: 'commit_progress',
        stage: 'completed',
        message: pushed ? 'Changes committed and pushed' : 'Changes committed (push pending)',
        data: { branch: currentBranch, commitHash },
        endpoint
      });

      logger.info('Commit and push completed', {
        component: 'GitHubOperations',
        sessionId,
        commitHash,
        branch: currentBranch,
        pushed
      });

      return {
        commitHash,
        commitMessage,
        branch: currentBranch,
        pushed
      };

    } catch (error) {
      logger.error('Commit and push failed', error, {
        component: 'GitHubOperations',
        sessionId
      });
      throw error;
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(options: CreatePullRequestOptions): Promise<CreatePullRequestResult> {
    const { owner, repo, title, head, base, body, githubAccessToken } = options;

    logger.info('Creating pull request', {
      component: 'GitHubOperations',
      owner,
      repo,
      head,
      base
    });

    const octokit = new Octokit({ auth: githubAccessToken });

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: title || `Merge ${head} into ${base}`,
      head,
      base,
      body: body || ''
    });

    logger.info(`Created PR #${pr.number}`, {
      component: 'GitHubOperations',
      owner,
      repo,
      prNumber: pr.number
    });

    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      htmlUrl: pr.html_url,
      head: { ref: pr.head.ref, sha: pr.head.sha },
      base: { ref: pr.base.ref, sha: pr.base.sha },
      mergeable: pr.mergeable,
      merged: pr.merged
    };
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(options: MergePullRequestOptions): Promise<MergePullRequestResult> {
    const { owner, repo, pullNumber, mergeMethod, commitTitle, commitMessage, githubAccessToken } = options;

    logger.info('Merging pull request', {
      component: 'GitHubOperations',
      owner,
      repo,
      pullNumber,
      mergeMethod
    });

    const octokit = new Octokit({ auth: githubAccessToken });

    const { data: result } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: mergeMethod || 'merge',
      commit_title: commitTitle,
      commit_message: commitMessage
    });

    logger.info(`Merged PR #${pullNumber}`, {
      component: 'GitHubOperations',
      owner,
      repo,
      pullNumber,
      sha: result.sha
    });

    return {
      merged: result.merged,
      sha: result.sha,
      message: result.message
    };
  }

  /**
   * Auto PR: Create PR, merge base into feature, wait for mergeable, merge PR, delete branch
   */
  async autoPullRequest(
    options: AutoPullRequestOptions,
    onProgress?: ProgressCallback
  ): Promise<AutoPullRequestResult> {
    const { owner, repo, branch, base, title, body, githubAccessToken } = options;
    const progress = onProgress || (() => {});

    logger.info('Starting Auto PR', {
      component: 'GitHubOperations',
      owner,
      repo,
      branch,
      base
    });

    const octokit = new Octokit({ auth: githubAccessToken });
    const results: AutoPullRequestResult = { step: 'started', progress: 'Starting Auto PR process...' };

    progress({ type: 'progress', stage: 'started', message: 'Starting Auto PR process...' });

    // Step 1: Check if PR already exists
    results.step = 'checking_pr';
    results.progress = 'Checking for existing pull request...';
    progress({ type: 'progress', stage: 'checking_pr', message: results.progress });

    let prNumber: number | null = null;
    let prUrl: string | null = null;

    const { data: existingPulls } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base,
      state: 'open'
    });

    if (existingPulls.length > 0) {
      prNumber = existingPulls[0].number;
      prUrl = existingPulls[0].html_url;
      logger.info(`Found existing PR #${prNumber}`, { component: 'GitHubOperations', owner, repo });
      results.progress = `Found existing PR #${prNumber}`;
      progress({ type: 'progress', stage: 'pr_found', message: results.progress });
    } else {
      // Create new PR
      results.step = 'creating_pr';
      results.progress = 'Creating pull request...';
      progress({ type: 'progress', stage: 'creating_pr', message: results.progress });

      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title: title || `Merge ${branch} into ${base}`,
        head: branch,
        base,
        body: body || ''
      });
      prNumber = pr.number;
      prUrl = pr.html_url;
      logger.info(`Created PR #${prNumber}`, { component: 'GitHubOperations', owner, repo });
      results.progress = `Created PR #${prNumber}`;
      progress({ type: 'progress', stage: 'pr_created', message: results.progress });
    }

    results.step = 'pr_created';
    results.pr = { number: prNumber!, htmlUrl: prUrl! };

    // Step 2: Try to merge base into the feature branch
    results.step = 'merging_base';
    results.progress = `Merging ${base} into ${branch}...`;
    progress({ type: 'progress', stage: 'merging_base', message: results.progress });

    try {
      const { data: mergeResult } = await octokit.repos.merge({
        owner,
        repo,
        base: branch,
        head: base,
        commit_message: `Merge ${base} into ${branch}`
      });
      results.step = 'base_merged';
      results.mergeBase = { sha: mergeResult.sha, message: `Merged ${base} into ${branch}` };
      results.progress = `Successfully merged ${base} into ${branch}`;
      progress({ type: 'progress', stage: 'base_merged', message: results.progress });
      logger.info(`Merged ${base} into ${branch}`, { component: 'GitHubOperations', owner, repo });
    } catch (mergeError: unknown) {
      const mergeErr = mergeError as { status?: number };
      if (mergeErr.status === 204) {
        results.step = 'base_merged';
        results.mergeBase = { sha: null, message: 'Branch already up to date' };
        results.progress = `Branch ${branch} is already up to date with ${base}`;
        progress({ type: 'progress', stage: 'base_already_up_to_date', message: results.progress });
      } else if (mergeErr.status === 409) {
        throw new Error('Merge conflict when updating branch - manual resolution required');
      } else {
        throw mergeError;
      }
    }

    // Step 3: Wait for PR to become mergeable
    results.step = 'waiting_mergeable';
    results.progress = 'Waiting for PR to be ready to merge...';
    progress({ type: 'progress', stage: 'waiting_mergeable', message: results.progress });

    let mergeable: boolean | null = null;
    let pollAttempts = 0;
    const maxPollAttempts = 30;

    while (pollAttempts < maxPollAttempts) {
      const { data: prStatus } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber!
      });

      mergeable = prStatus.mergeable;

      if (mergeable === true) {
        results.progress = 'PR is ready to merge!';
        progress({ type: 'progress', stage: 'pr_mergeable', message: results.progress });
        logger.info(`PR #${prNumber} is mergeable`, { component: 'GitHubOperations', owner, repo });
        break;
      } else if (mergeable === false) {
        throw new Error('PR has merge conflicts or branch protection rules prevent merging');
      }

      pollAttempts++;
      results.progress = `Waiting for PR status... (${pollAttempts}/${maxPollAttempts})`;
      progress({ type: 'progress', stage: 'polling', message: results.progress });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (mergeable !== true) {
      throw new Error('Timeout waiting for PR to become mergeable - please try merging manually');
    }

    // Step 4: Merge the PR
    results.step = 'merging_pr';
    results.progress = `Merging PR #${prNumber}...`;
    progress({ type: 'progress', stage: 'merging_pr', message: results.progress });

    const { data: prMergeResult } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber!,
      merge_method: 'merge'
    });
    results.step = 'pr_merged';
    results.mergePr = { merged: prMergeResult.merged, sha: prMergeResult.sha };
    results.progress = `Successfully merged PR #${prNumber} into ${base}`;
    progress({ type: 'progress', stage: 'pr_merged', message: results.progress });
    logger.info(`Merged PR #${prNumber}`, { component: 'GitHubOperations', owner, repo });

    // Step 5: Delete the feature branch
    results.step = 'deleting_branch';
    results.progress = `Deleting branch ${branch}...`;
    progress({ type: 'progress', stage: 'deleting_branch', message: results.progress });

    try {
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch}`
      });
      logger.info(`Deleted branch ${branch}`, { component: 'GitHubOperations', owner, repo });
      results.progress = `Deleted branch ${branch}`;
      progress({ type: 'progress', stage: 'branch_deleted', message: results.progress });
    } catch (branchDeleteError: unknown) {
      const branchDeleteErr = branchDeleteError as { status?: number };
      if (branchDeleteErr.status === 422 || branchDeleteErr.status === 404) {
        logger.info(`Branch ${branch} already deleted`, { component: 'GitHubOperations', owner, repo });
        results.progress = `Branch ${branch} already deleted`;
        progress({ type: 'progress', stage: 'branch_already_deleted', message: results.progress });
      } else {
        logger.error(`Failed to delete branch ${branch}`, branchDeleteError, {
          component: 'GitHubOperations',
          owner,
          repo
        });
        results.progress = `Branch deletion skipped (non-critical error)`;
        progress({ type: 'progress', stage: 'branch_deletion_skipped', message: results.progress });
      }
    }

    results.step = 'completed';
    results.progress = 'Auto PR completed successfully!';

    return results;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async cloneRepo(
    repoUrl: string,
    branch: string | undefined,
    directory: string | undefined,
    accessToken: string,
    workspaceDir: string,
    progress: ProgressCallback,
    endpoint: string
  ): Promise<{ clonedPath: string; branch: string }> {
    progress({ type: 'progress', stage: 'cloning', message: `Cloning repository: ${repoUrl}`, endpoint });

    const pullResult = await this.githubClient.pullRepository({
      repoUrl,
      branch,
      directory,
      accessToken,
      workspaceRoot: workspaceDir
    });

    const repoName = pullResult.targetPath.replace(workspaceDir + path.sep, '').replace(workspaceDir + '/', '');

    progress({ type: 'progress', stage: 'cloned', message: 'Repository cloned successfully', endpoint });

    return { clonedPath: repoName, branch: pullResult.branch };
  }

  private updateMetadataWithClone(
    sessionRoot: string,
    sessionId: string,
    repoUrl: string,
    pullResult: { clonedPath: string; branch: string },
    existingMetadata: SessionMetadata | null
  ): SessionMetadata {
    const { owner, repo } = parseRepoUrl(repoUrl);

    const metadata: SessionMetadata = {
      sessionId,
      repositoryOwner: owner,
      repositoryName: repo,
      createdAt: existingMetadata?.createdAt || new Date().toISOString(),
      lastModified: new Date().toISOString(),
      github: {
        repoUrl,
        baseBranch: pullResult.branch,
        clonedPath: pullResult.clonedPath
      }
    };

    this.saveMetadata(sessionRoot, metadata);
    return metadata;
  }

  private getMetadata(sessionRoot: string): SessionMetadata | null {
    const metadataPath = path.join(sessionRoot, '.session-metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    }
    return null;
  }

  private saveMetadata(sessionRoot: string, metadata: SessionMetadata): void {
    const metadataPath = path.join(sessionRoot, '.session-metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }
}
