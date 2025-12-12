import { GitHubClient } from './client.js';
import { logger } from '../utils/logger.js';

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  htmlUrl: string;
  createdAt: string;
  assignee: string | null;
}

export interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueManager {
  listOpenIssues(label?: string): Promise<Issue[]>;
  getIssue(number: number): Promise<Issue | null>;
  createIssue(options: CreateIssueOptions): Promise<Issue>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  closeIssue(issueNumber: number, comment?: string): Promise<void>;
  addComment(issueNumber: number, body: string): Promise<void>;
}

export function createIssueManager(client: GitHubClient): IssueManager {
  const octokit = client.client;
  const { owner, repo } = client;

  return {
    async listOpenIssues(label?: string): Promise<Issue[]> {
      try {
        const params: {
          owner: string;
          repo: string;
          state: 'open';
          per_page: number;
          labels?: string;
        } = {
          owner,
          repo,
          state: 'open',
          per_page: 100,
        };

        if (label) {
          params.labels = label;
        }

        const { data } = await octokit.issues.listForRepo(params);

        // Filter out pull requests (GitHub API returns PRs as issues)
        const issues = data.filter((item) => !item.pull_request);

        return issues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          state: issue.state as 'open' | 'closed',
          labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
          htmlUrl: issue.html_url,
          createdAt: issue.created_at,
          assignee: issue.assignee?.login || null,
        }));
      } catch (error) {
        logger.error('Failed to list issues', { error });
        throw error;
      }
    },

    async getIssue(number: number): Promise<Issue | null> {
      try {
        const { data } = await octokit.issues.get({
          owner,
          repo,
          issue_number: number,
        });

        return {
          number: data.number,
          title: data.title,
          body: data.body ?? null,
          state: data.state as 'open' | 'closed',
          labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
          htmlUrl: data.html_url,
          createdAt: data.created_at,
          assignee: data.assignee?.login || null,
        };
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async createIssue(options: CreateIssueOptions): Promise<Issue> {
      try {
        const { data } = await octokit.issues.create({
          owner,
          repo,
          title: options.title,
          body: options.body,
          labels: options.labels,
        });

        logger.info(`Created issue #${data.number}: ${data.title}`);

        return {
          number: data.number,
          title: data.title,
          body: data.body ?? null,
          state: data.state as 'open' | 'closed',
          labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
          htmlUrl: data.html_url,
          createdAt: data.created_at,
          assignee: data.assignee?.login || null,
        };
      } catch (error) {
        logger.error('Failed to create issue', { error, title: options.title });
        throw error;
      }
    },

    async addLabels(issueNumber: number, labels: string[]): Promise<void> {
      try {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels,
        });
        logger.debug(`Added labels to issue #${issueNumber}`, { labels });
      } catch (error) {
        logger.error('Failed to add labels', { error, issueNumber, labels });
        throw error;
      }
    },

    async removeLabel(issueNumber: number, label: string): Promise<void> {
      try {
        await octokit.issues.removeLabel({
          owner,
          repo,
          issue_number: issueNumber,
          name: label,
        });
        logger.debug(`Removed label '${label}' from issue #${issueNumber}`);
      } catch (error: any) {
        // Ignore if label doesn't exist
        if (error.status !== 404) {
          throw error;
        }
      }
    },

    async closeIssue(issueNumber: number, comment?: string): Promise<void> {
      try {
        if (comment) {
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: comment,
          });
        }

        await octokit.issues.update({
          owner,
          repo,
          issue_number: issueNumber,
          state: 'closed',
        });

        logger.info(`Closed issue #${issueNumber}`);
      } catch (error) {
        logger.error('Failed to close issue', { error, issueNumber });
        throw error;
      }
    },

    async addComment(issueNumber: number, body: string): Promise<void> {
      try {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: issueNumber,
          body,
        });
        logger.debug(`Added comment to issue #${issueNumber}`);
      } catch (error) {
        logger.error('Failed to add comment', { error, issueNumber });
        throw error;
      }
    },
  };
}
