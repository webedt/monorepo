import { Response } from 'express';
import { Octokit } from '@octokit/rest';
import {
  CreatePullRequestRequest,
  CreatePullRequestResult,
  MergePullRequestRequest,
  MergePullRequestResult,
  AutoPullRequestRequest,
  AutoPullRequestResult,
  AutoPRStep,
} from '../types';
import { logger } from '../utils/logger';

/**
 * Send SSE event
 */
function sendSSE(res: Response, type: string, data: Record<string, unknown>): void {
  const event = {
    type,
    ...data,
    source: 'github-worker',
    timestamp: new Date().toISOString(),
  };
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Send progress event
 */
function sendProgress(res: Response, stage: string, message: string): void {
  sendSSE(res, 'progress', { stage, message });
}

/**
 * Send completed event
 */
function sendCompleted<T>(res: Response, data: T): void {
  sendSSE(res, 'completed', { data });
}

/**
 * Send error event
 */
function sendError(res: Response, error: string, code: string): void {
  sendSSE(res, 'error', { error, code });
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  request: CreatePullRequestRequest,
  res: Response
): Promise<void> {
  const { owner, repo, title, head, base, body, githubAccessToken } = request;

  logger.info('Creating pull request', {
    component: 'PullRequest',
    owner,
    repo,
    head,
    base,
  });

  sendProgress(res, 'creating_pr', `Creating pull request: ${head} → ${base}`);

  try {
    const octokit = new Octokit({ auth: githubAccessToken });

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: title || `Merge ${head} into ${base}`,
      head,
      base,
      body: body || '',
    });

    logger.info(`Created PR #${pr.number}`, {
      component: 'PullRequest',
      owner,
      repo,
      prNumber: pr.number,
    });

    const result: CreatePullRequestResult = {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      htmlUrl: pr.html_url,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
        sha: pr.base.sha,
      },
      mergeable: pr.mergeable,
      merged: pr.merged,
    };

    sendCompleted(res, result);
    res.end();
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      message?: string;
      response?: { data?: { errors?: Array<{ message?: string }>; message?: string } };
    };

    logger.error('Failed to create pull request', error, {
      component: 'PullRequest',
      owner,
      repo,
    });

    // Handle case where PR already exists
    if (
      err.status === 422 &&
      err.response?.data?.errors?.some((e) => e.message?.includes('already exists'))
    ) {
      sendError(res, 'A pull request already exists for this branch', 'PR_EXISTS');
      res.end();
      return;
    }

    // Extract detailed error message
    let errorMessage = 'Failed to create pull request';
    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;
    } else if (err.response?.data?.errors && err.response.data.errors.length > 0) {
      const errorMessages = err.response.data.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ');
      if (errorMessages) {
        errorMessage = errorMessages;
      }
    } else if (err.message) {
      errorMessage = err.message;
    }

    sendError(res, errorMessage, 'CREATE_PR_FAILED');
    res.end();
  }
}

/**
 * Merge a pull request
 */
export async function mergePullRequest(
  request: MergePullRequestRequest,
  res: Response
): Promise<void> {
  const { owner, repo, pullNumber, mergeMethod, commitTitle, commitMessage, githubAccessToken } =
    request;

  logger.info('Merging pull request', {
    component: 'PullRequest',
    owner,
    repo,
    pullNumber,
    mergeMethod,
  });

  sendProgress(res, 'merging_pr', `Merging PR #${pullNumber}`);

  try {
    const octokit = new Octokit({ auth: githubAccessToken });

    const { data: result } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: mergeMethod || 'merge',
      commit_title: commitTitle,
      commit_message: commitMessage,
    });

    logger.info(`Merged PR #${pullNumber}`, {
      component: 'PullRequest',
      owner,
      repo,
      pullNumber,
      sha: result.sha,
    });

    const mergeResult: MergePullRequestResult = {
      merged: result.merged,
      sha: result.sha,
      message: result.message,
    };

    sendCompleted(res, mergeResult);
    res.end();
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };

    logger.error('Failed to merge pull request', error, {
      component: 'PullRequest',
      owner,
      repo,
      pullNumber,
    });

    if (err.status === 405) {
      sendError(res, 'PR is not mergeable - check branch protection rules', 'PR_NOT_MERGEABLE');
      res.end();
      return;
    }

    if (err.status === 409) {
      sendError(res, 'Merge conflict when merging PR', 'MERGE_CONFLICT');
      res.end();
      return;
    }

    sendError(res, err.message || 'Failed to merge pull request', 'MERGE_FAILED');
    res.end();
  }
}

/**
 * Auto PR: Create PR, merge base into feature, wait for mergeable, merge PR, delete branch
 */
export async function autoPullRequest(
  request: AutoPullRequestRequest,
  res: Response
): Promise<void> {
  const { owner, repo, branch, base, title, body, githubAccessToken } = request;

  logger.info('Starting Auto PR', {
    component: 'PullRequest',
    owner,
    repo,
    branch,
    base,
  });

  const octokit = new Octokit({ auth: githubAccessToken });
  const results: AutoPullRequestResult = { step: 'started', progress: 'Starting Auto PR process...' };

  sendProgress(res, 'started', 'Starting Auto PR process...');

  try {
    // Step 1: Check if PR already exists
    results.step = 'checking_pr';
    results.progress = 'Checking for existing pull request...';
    sendProgress(res, 'checking_pr', results.progress);

    let prNumber: number | null = null;
    let prUrl: string | null = null;

    const { data: existingPulls } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base,
      state: 'open',
    });

    if (existingPulls.length > 0) {
      prNumber = existingPulls[0].number;
      prUrl = existingPulls[0].html_url;
      logger.info(`Found existing PR #${prNumber}`, { component: 'PullRequest', owner, repo });
      results.progress = `Found existing PR #${prNumber}`;
      sendProgress(res, 'pr_found', results.progress);
    } else {
      // Create new PR
      results.step = 'creating_pr';
      results.progress = 'Creating pull request...';
      sendProgress(res, 'creating_pr', results.progress);

      try {
        const { data: pr } = await octokit.pulls.create({
          owner,
          repo,
          title: title || `Merge ${branch} into ${base}`,
          head: branch,
          base,
          body: body || '',
        });
        prNumber = pr.number;
        prUrl = pr.html_url;
        logger.info(`Created PR #${prNumber}`, { component: 'PullRequest', owner, repo });
        results.progress = `Created PR #${prNumber}`;
        sendProgress(res, 'pr_created', results.progress);
      } catch (createError: unknown) {
        const createErr = createError as { status?: number };
        if (createErr.status === 422) {
          sendError(res, 'No commits between branches - nothing to merge', 'NO_COMMITS');
          res.end();
          return;
        }
        throw createError;
      }
    }

    results.step = 'pr_created';
    results.pr = { number: prNumber!, htmlUrl: prUrl! };

    // Step 2: Try to merge base into the feature branch (update branch)
    results.step = 'merging_base';
    results.progress = `Merging ${base} into ${branch}...`;
    sendProgress(res, 'merging_base', results.progress);

    try {
      const { data: mergeResult } = await octokit.repos.merge({
        owner,
        repo,
        base: branch,
        head: base,
        commit_message: `Merge ${base} into ${branch}`,
      });
      results.step = 'base_merged';
      results.mergeBase = { sha: mergeResult.sha, message: `Merged ${base} into ${branch}` };
      results.progress = `Successfully merged ${base} into ${branch}`;
      sendProgress(res, 'base_merged', results.progress);
      logger.info(`Merged ${base} into ${branch}`, { component: 'PullRequest', owner, repo });
    } catch (mergeError: unknown) {
      const mergeErr = mergeError as { status?: number };
      if (mergeErr.status === 204) {
        results.step = 'base_merged';
        results.mergeBase = { sha: null, message: 'Branch already up to date' };
        results.progress = `Branch ${branch} is already up to date with ${base}`;
        sendProgress(res, 'base_already_up_to_date', results.progress);
      } else if (mergeErr.status === 409) {
        sendError(
          res,
          'Merge conflict when updating branch - manual resolution required',
          'MERGE_CONFLICT'
        );
        res.end();
        return;
      } else {
        throw mergeError;
      }
    }

    // Step 3: Wait for PR to become mergeable
    results.step = 'waiting_mergeable';
    results.progress = 'Waiting for PR to be ready to merge...';
    sendProgress(res, 'waiting_mergeable', results.progress);

    let mergeable: boolean | null = null;
    let pollAttempts = 0;
    const maxPollAttempts = 30;

    while (pollAttempts < maxPollAttempts) {
      const { data: prStatus } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber!,
      });

      mergeable = prStatus.mergeable;

      if (mergeable === true) {
        results.progress = 'PR is ready to merge!';
        sendProgress(res, 'pr_mergeable', results.progress);
        logger.info(`PR #${prNumber} is mergeable`, { component: 'PullRequest', owner, repo });
        break;
      } else if (mergeable === false) {
        sendError(
          res,
          'PR has merge conflicts or branch protection rules prevent merging',
          'PR_NOT_MERGEABLE'
        );
        res.end();
        return;
      }

      pollAttempts++;
      results.progress = `Waiting for PR status... (${pollAttempts}/${maxPollAttempts})`;
      sendProgress(res, 'polling', results.progress);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (mergeable !== true) {
      sendError(
        res,
        'Timeout waiting for PR to become mergeable - please try merging manually',
        'TIMEOUT'
      );
      res.end();
      return;
    }

    // Step 4: Merge the PR
    results.step = 'merging_pr';
    results.progress = `Merging PR #${prNumber}...`;
    sendProgress(res, 'merging_pr', results.progress);

    try {
      const { data: prMergeResult } = await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber!,
        merge_method: 'merge',
      });
      results.step = 'pr_merged';
      results.mergePr = { merged: prMergeResult.merged, sha: prMergeResult.sha };
      results.progress = `Successfully merged PR #${prNumber} into ${base}`;
      sendProgress(res, 'pr_merged', results.progress);
      logger.info(`Merged PR #${prNumber}`, { component: 'PullRequest', owner, repo });
    } catch (prMergeError: unknown) {
      const prMergeErr = prMergeError as { status?: number };
      if (prMergeErr.status === 405) {
        sendError(res, 'PR is not mergeable - check branch protection rules', 'PR_NOT_MERGEABLE');
        res.end();
        return;
      }
      if (prMergeErr.status === 409) {
        sendError(res, 'Merge conflict when merging PR', 'MERGE_CONFLICT');
        res.end();
        return;
      }
      throw prMergeError;
    }

    // Step 5: Delete the feature branch
    results.step = 'deleting_branch';
    results.progress = `Deleting branch ${branch}...`;
    sendProgress(res, 'deleting_branch', results.progress);

    try {
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      logger.info(`Deleted branch ${branch}`, { component: 'PullRequest', owner, repo });
      results.progress = `Deleted branch ${branch}`;
      sendProgress(res, 'branch_deleted', results.progress);
    } catch (branchDeleteError: unknown) {
      const branchDeleteErr = branchDeleteError as { status?: number };
      if (branchDeleteErr.status === 422 || branchDeleteErr.status === 404) {
        logger.info(`Branch ${branch} already deleted`, { component: 'PullRequest', owner, repo });
        results.progress = `Branch ${branch} already deleted`;
        sendProgress(res, 'branch_already_deleted', results.progress);
      } else {
        logger.error(`Failed to delete branch ${branch}`, branchDeleteError, {
          component: 'PullRequest',
          owner,
          repo,
        });
        results.progress = `Branch deletion skipped (non-critical error)`;
        sendProgress(res, 'branch_deletion_skipped', results.progress);
      }
    }

    results.step = 'completed';
    results.progress = 'Auto PR completed successfully!';
    sendCompleted(res, results);
    res.end();
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      message?: string;
      response?: { data?: { errors?: Array<{ message?: string }>; message?: string } };
    };

    logger.error('Auto PR failed', error, {
      component: 'PullRequest',
      owner,
      repo,
      branch,
    });

    let errorMessage = 'Failed to complete auto PR';
    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;
    } else if (err.response?.data?.errors && err.response.data.errors.length > 0) {
      const errorMessages = err.response.data.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ');
      if (errorMessages) {
        errorMessage = errorMessages;
      }
    } else if (err.message) {
      errorMessage = err.message;
    }

    sendError(res, errorMessage, 'AUTO_PR_FAILED');
    res.end();
  }
}
