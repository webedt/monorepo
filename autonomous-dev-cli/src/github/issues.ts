import { GitHubClient, type ServiceHealth } from './client.js';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
} from '../utils/errors.js';

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

/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
  value: T;
  degraded: boolean;
}

export interface IssueManager {
  listOpenIssues(label?: string): Promise<Issue[]>;
  listOpenIssuesWithFallback(label?: string, fallback?: Issue[]): Promise<DegradedResult<Issue[]>>;
  getIssue(number: number): Promise<Issue | null>;
  createIssue(options: CreateIssueOptions): Promise<Issue>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  addLabelsWithFallback(issueNumber: number, labels: string[]): Promise<DegradedResult<void>>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  closeIssue(issueNumber: number, comment?: string): Promise<void>;
  addComment(issueNumber: number, body: string): Promise<void>;
  addCommentWithFallback(issueNumber: number, body: string): Promise<DegradedResult<void>>;
  getServiceHealth(): ServiceHealth;
  isAvailable(): boolean;
}

export function createIssueManager(client: GitHubClient): IssueManager {
  const octokit = client.client;
  const { owner, repo } = client;

  /**
   * Helper function to map GitHub API issue response to Issue type
   */
  const mapIssue = (issue: any): Issue => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? null,
    state: issue.state as 'open' | 'closed',
    labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name || '')),
    htmlUrl: issue.html_url,
    createdAt: issue.created_at,
    assignee: issue.assignee?.login || null,
  });

  /**
   * Wrap error with structured error handling
   */
  const handleError = (error: any, operation: string, context?: Record<string, unknown>): never => {
    const structuredError = createGitHubErrorFromResponse(error, operation, {
      owner,
      repo,
      ...context,
    });
    logger.error(`Failed to ${operation}`, { error: structuredError.message, ...context });
    throw structuredError;
  };

  return {
    getServiceHealth(): ServiceHealth {
      return client.getServiceHealth();
    },

    isAvailable(): boolean {
      return client.isAvailable();
    },

    async listOpenIssues(label?: string): Promise<Issue[]> {
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

      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.issues.listForRepo(params);
            // Filter out pull requests (GitHub API returns PRs as issues)
            const issues = data.filter((item) => !item.pull_request);
            return issues.map(mapIssue);
          },
          `GET /repos/${owner}/${repo}/issues`,
          { operation: 'listOpenIssues', label }
        );
      } catch (error) {
        return handleError(error, 'list issues', { label });
      }
    },

    async listOpenIssuesWithFallback(label?: string, fallback: Issue[] = []): Promise<DegradedResult<Issue[]>> {
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

      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.issues.listForRepo(params);
          const issues = data.filter((item) => !item.pull_request);
          return issues.map(mapIssue);
        },
        fallback,
        `GET /repos/${owner}/${repo}/issues`,
        { operation: 'listOpenIssues', label }
      );

      if (result.degraded) {
        logger.warn('Issue list fetch degraded - using fallback', {
          label,
          fallbackCount: fallback.length,
        });
      }

      return result;
    },

    async getIssue(number: number): Promise<Issue | null> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.issues.get({
              owner,
              repo,
              issue_number: number,
            });
            return mapIssue(data);
          },
          `GET /repos/${owner}/${repo}/issues/${number}`,
          { operation: 'getIssue', issueNumber: number }
        );
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        return handleError(error, 'get issue', { issueNumber: number });
      }
    },

    async createIssue(options: CreateIssueOptions): Promise<Issue> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.issues.create({
              owner,
              repo,
              title: options.title,
              body: options.body,
              labels: options.labels,
            });

            logger.info(`Created issue #${data.number}: ${data.title}`);
            return mapIssue(data);
          },
          `POST /repos/${owner}/${repo}/issues`,
          { operation: 'createIssue', title: options.title }
        );
      } catch (error) {
        return handleError(error, 'create issue', { title: options.title });
      }
    },

    async addLabels(issueNumber: number, labels: string[]): Promise<void> {
      try {
        await client.execute(
          async () => {
            await octokit.issues.addLabels({
              owner,
              repo,
              issue_number: issueNumber,
              labels,
            });
            logger.debug(`Added labels to issue #${issueNumber}`, { labels });
          },
          `POST /repos/${owner}/${repo}/issues/${issueNumber}/labels`,
          { operation: 'addLabels', issueNumber, labels }
        );
      } catch (error) {
        handleError(error, 'add labels', { issueNumber, labels });
      }
    },

    async addLabelsWithFallback(issueNumber: number, labels: string[]): Promise<DegradedResult<void>> {
      const result = await client.executeWithFallback(
        async () => {
          await octokit.issues.addLabels({
            owner,
            repo,
            issue_number: issueNumber,
            labels,
          });
          logger.debug(`Added labels to issue #${issueNumber}`, { labels });
        },
        undefined,
        `POST /repos/${owner}/${repo}/issues/${issueNumber}/labels`,
        { operation: 'addLabels', issueNumber, labels }
      );

      if (result.degraded) {
        logger.warn('Add labels degraded - operation skipped', { issueNumber, labels });
      }

      return result;
    },

    async removeLabel(issueNumber: number, label: string): Promise<void> {
      try {
        await client.execute(
          async () => {
            await octokit.issues.removeLabel({
              owner,
              repo,
              issue_number: issueNumber,
              name: label,
            });
            logger.debug(`Removed label '${label}' from issue #${issueNumber}`);
          },
          `DELETE /repos/${owner}/${repo}/issues/${issueNumber}/labels/${label}`,
          { operation: 'removeLabel', issueNumber, label }
        );
      } catch (error: any) {
        // Ignore if label doesn't exist
        if (error.status !== 404) {
          handleError(error, 'remove label', { issueNumber, label });
        }
      }
    },

    async closeIssue(issueNumber: number, comment?: string): Promise<void> {
      try {
        await client.execute(
          async () => {
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
          },
          `PATCH /repos/${owner}/${repo}/issues/${issueNumber}`,
          { operation: 'closeIssue', issueNumber }
        );
      } catch (error) {
        handleError(error, 'close issue', { issueNumber });
      }
    },

    async addComment(issueNumber: number, body: string): Promise<void> {
      try {
        await client.execute(
          async () => {
            await octokit.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body,
            });
            logger.debug(`Added comment to issue #${issueNumber}`);
          },
          `POST /repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          { operation: 'addComment', issueNumber }
        );
      } catch (error) {
        handleError(error, 'add comment', { issueNumber });
      }
    },

    async addCommentWithFallback(issueNumber: number, body: string): Promise<DegradedResult<void>> {
      const result = await client.executeWithFallback(
        async () => {
          await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body,
          });
          logger.debug(`Added comment to issue #${issueNumber}`);
        },
        undefined,
        `POST /repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        { operation: 'addComment', issueNumber }
      );

      if (result.degraded) {
        logger.warn('Add comment degraded - operation skipped', { issueNumber });
      }

      return result;
    },
  };
}
