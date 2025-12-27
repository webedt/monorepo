/**
 * GitHub Issues Service
 * Provides operations for creating, listing, and updating GitHub issues
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logging/logger.js';

import type { Issue } from './issuesService.types.js';
import type { CreateIssueOptions } from './issuesService.types.js';
import type { CreateIssueResult } from './issuesService.types.js';
import type { ListIssuesOptions } from './issuesService.types.js';
import type { UpdateIssueOptions } from './issuesService.types.js';
import type { IssueComment } from './issuesService.types.js';
import type { AutoTaskCommentInfo } from './issuesService.types.js';

export class GitHubIssuesService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async createIssue(
    owner: string,
    repo: string,
    options: CreateIssueOptions
  ): Promise<CreateIssueResult> {
    logger.info('Creating issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      title: options.title,
    });

    const { data: issue } = await this.octokit.issues.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      labels: options.labels,
      assignees: options.assignees,
    });

    logger.info('Issue created', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber: issue.number,
    });

    return {
      number: issue.number,
      id: issue.id,
      nodeId: issue.node_id,
      htmlUrl: issue.html_url,
      title: issue.title,
      state: issue.state as 'open' | 'closed',
    };
  }

  async listIssues(
    owner: string,
    repo: string,
    options?: ListIssuesOptions
  ): Promise<Issue[]> {
    logger.debug('Listing issues', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      options,
    });

    const { data: issues } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: options?.state || 'open',
      labels: options?.labels?.join(','),
      per_page: options?.perPage || 100,
    });

    // Filter out pull requests (GitHub API returns them as issues)
    const filteredIssues = issues.filter((issue) => !issue.pull_request);

    return filteredIssues.map((issue) => ({
      number: issue.number,
      id: issue.id,
      nodeId: issue.node_id,
      htmlUrl: issue.html_url,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map((label) =>
        typeof label === 'string' ? label : label.name || ''
      ),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    }));
  }

  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    options: UpdateIssueOptions
  ): Promise<Issue> {
    logger.info('Updating issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber,
      options,
    });

    const { data: issue } = await this.octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: options.state,
      labels: options.labels,
      title: options.title,
      body: options.body,
    });

    logger.info('Issue updated', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber: issue.number,
    });

    return {
      number: issue.number,
      id: issue.id,
      nodeId: issue.node_id,
      htmlUrl: issue.html_url,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map((label) =>
        typeof label === 'string' ? label : label.name || ''
      ),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    };
  }

  async getIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<Issue> {
    logger.debug('Getting issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber,
    });

    const { data: issue } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    return {
      number: issue.number,
      id: issue.id,
      nodeId: issue.node_id,
      htmlUrl: issue.html_url,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state as 'open' | 'closed',
      labels: issue.labels.map((label) =>
        typeof label === 'string' ? label : label.name || ''
      ),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
    };
  }

  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<Issue> {
    return this.updateIssue(owner, repo, issueNumber, { state: 'closed' });
  }

  async addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[]
  ): Promise<void> {
    logger.info('Adding labels to issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber,
      labels,
    });

    await this.octokit.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    });
  }

  async addComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    logger.info('Adding comment to issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber,
    });

    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }

  async listComments(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<IssueComment[]> {
    logger.debug('Listing comments for issue', {
      component: 'GitHubIssuesService',
      owner,
      repo,
      issueNumber,
    });

    const { data: comments } = await this.octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      user: comment.user ? { login: comment.user.login } : undefined,
    }));
  }

  /**
   * Get the latest auto-task session info from issue comments
   * Parses comments looking for session URLs, branch names, and PR numbers.
   * Aggregates info from multiple comments to get the most complete picture.
   */
  async getLatestAutoTaskInfo(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<AutoTaskCommentInfo | undefined> {
    const comments = await this.listComments(owner, repo, issueNumber);

    // Aggregate info from all comments (newest first for type, but collect all session/branch/PR info)
    let result: AutoTaskCommentInfo | undefined;
    let latestSessionId: string | undefined;
    let latestSessionUrl: string | undefined;
    let latestBranchName: string | undefined;
    let latestPrNumber: number | undefined;

    // First pass: get the most recent type and creation date
    for (let i = comments.length - 1; i >= 0; i--) {
      const info = parseAutoTaskComment(comments[i]);
      if (info) {
        if (!result) {
          result = info;
        }
        // Collect session/branch/PR from all comments (prefer most recent non-empty values)
        if (info.sessionId && !latestSessionId) {
          latestSessionId = info.sessionId;
          latestSessionUrl = info.sessionUrl;
        }
        if (info.branchName && !latestBranchName) {
          latestBranchName = info.branchName;
        }
        if (info.prNumber && !latestPrNumber) {
          latestPrNumber = info.prNumber;
        }
      }
    }

    // Merge collected info into result
    if (result) {
      if (latestSessionId) {
        result.sessionId = latestSessionId;
        result.sessionUrl = latestSessionUrl;
      }
      if (latestBranchName) {
        result.branchName = latestBranchName;
      }
      if (latestPrNumber) {
        result.prNumber = latestPrNumber;
      }
    }

    return result;
  }
}

/**
 * Parse an auto-task comment to extract session/branch/PR info
 */
function parseAutoTaskComment(comment: IssueComment): AutoTaskCommentInfo | undefined {
  const body = comment.body;

  // Check if this is an auto-task comment
  if (!body.includes('Auto-Task') && !body.includes('Claude') && !body.includes('Session:')) {
    return undefined;
  }

  const info: AutoTaskCommentInfo = {
    type: 'unknown',
    createdAt: comment.createdAt,
  };

  // Determine comment type based on headers
  if (body.includes('🤖 Auto-Task Started') || body.includes('Claude is working on this issue')) {
    info.type = 'started';
  } else if (body.includes('🔄 Re-work') || body.includes('Addressing code review feedback')) {
    info.type = 'rework';
  } else if (body.includes('✅ Implementation Complete') || body.includes('has finished working')) {
    info.type = 'complete';
  } else if (body.includes('❌ Session Failed') || body.includes('⚠️ Session Issue')) {
    info.type = 'failed';
  } else if (body.includes('🔄 Review Feedback') || body.includes('Code review found')) {
    info.type = 'review';
  } else if (body.includes('🔧 Resolving Merge Conflicts') || body.includes('⚠️ Merge Conflicts')) {
    info.type = 'conflict';
  } else if (body.includes('🎉 Task Complete')) {
    info.type = 'complete';
  }

  // Extract session URL and ID
  // Pattern: [View in Claude](https://claude.ai/code/session_xxx)
  const sessionMatch = body.match(/\[View in Claude\]\((https:\/\/claude\.ai\/code\/(session_[a-zA-Z0-9]+))\)/);
  if (sessionMatch) {
    info.sessionUrl = sessionMatch[1];
    info.sessionId = sessionMatch[2];
  }

  // Extract branch name
  // Pattern: **Branch:** `branch-name`
  const branchMatch = body.match(/\*\*Branch:\*\*\s*`([^`]+)`/);
  if (branchMatch) {
    info.branchName = branchMatch[1];
  }

  // Extract PR number
  // Pattern: **PR:** #123 or PR #123
  const prMatch = body.match(/\*\*PR:\*\*\s*#(\d+)|PR\s*#(\d+)/);
  if (prMatch) {
    info.prNumber = parseInt(prMatch[1] || prMatch[2], 10);
  }

  // Only return if we found something useful
  if (info.sessionId || info.branchName || info.prNumber || info.type !== 'unknown') {
    return info;
  }

  return undefined;
}
