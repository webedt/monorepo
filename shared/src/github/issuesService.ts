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
}
