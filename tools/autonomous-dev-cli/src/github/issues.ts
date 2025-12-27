import { GitHubClient, type ServiceHealth } from './client.js';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
} from '../utils/errors.js';
import type { CacheKeyType } from '../utils/githubCache.js';

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

export interface Comment {
  id: number;
  body: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  user: string | null;
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
  /** Get multiple issues in a batch (reduces API calls) */
  getIssuesBatch(numbers: number[]): Promise<Map<number, Issue | null>>;
  createIssue(options: CreateIssueOptions): Promise<Issue>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  addLabelsWithFallback(issueNumber: number, labels: string[]): Promise<DegradedResult<void>>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
  closeIssue(issueNumber: number, comment?: string): Promise<void>;
  addComment(issueNumber: number, body: string): Promise<Comment>;
  addCommentWithFallback(issueNumber: number, body: string): Promise<DegradedResult<Comment | undefined>>;
  /** List all comments on an issue */
  listComments(issueNumber: number): Promise<Comment[]>;
  listCommentsWithFallback(issueNumber: number, fallback?: Comment[]): Promise<DegradedResult<Comment[]>>;
  /** Get a specific comment by ID */
  getComment(commentId: number): Promise<Comment | null>;
  /** Update an existing comment */
  updateComment(commentId: number, body: string): Promise<Comment>;
  updateCommentWithFallback(commentId: number, body: string): Promise<DegradedResult<Comment | undefined>>;
  /** Delete a comment */
  deleteComment(commentId: number): Promise<void>;
  deleteCommentWithFallback(commentId: number): Promise<DegradedResult<void>>;
  getServiceHealth(): ServiceHealth;
  isAvailable(): boolean;
  /** Invalidate cached issue data */
  invalidateCache(): void;
  /** Invalidate a specific issue from cache */
  invalidateIssue(number: number): void;
  /** Invalidate comments cache for a specific issue */
  invalidateComments(issueNumber: number): void;
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
   * Helper function to map GitHub API comment response to Comment type
   */
  const mapComment = (comment: any): Comment => ({
    id: comment.id,
    body: comment.body ?? '',
    htmlUrl: comment.html_url,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    user: comment.user?.login || null,
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
      const cacheKey = `list-open-${label ?? 'all'}`;

      return client.getCachedOrFetch('issue-list', cacheKey, async () => {
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
      });
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
      const cacheKey = `issue-${number}`;

      try {
        return await client.getCachedOrFetch('issue', cacheKey, async () => {
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
        });
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        return handleError(error, 'get issue', { issueNumber: number });
      }
    },

    async getIssuesBatch(numbers: number[]): Promise<Map<number, Issue | null>> {
      const results = new Map<number, Issue | null>();
      const uncached: number[] = [];
      const cache = client.getCache();

      // Check cache first
      for (const num of numbers) {
        const cacheKey = cache.generateKey('issue', owner, repo, `issue-${num}`);
        const cached = cache.get<Issue>(cacheKey, 'issue');
        if (cached !== undefined) {
          results.set(num, cached);
        } else {
          uncached.push(num);
        }
      }

      // Fetch uncached issues in parallel (batched)
      if (uncached.length > 0) {
        const batchSize = 10; // Process in batches of 10
        for (let i = 0; i < uncached.length; i += batchSize) {
          const batch = uncached.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (num) => {
              try {
                const issue = await this.getIssue(num);
                return { num, issue };
              } catch (error) {
                logger.warn(`Failed to fetch issue #${num}`, { error: (error as Error).message });
                return { num, issue: null };
              }
            })
          );

          for (const { num, issue } of batchResults) {
            results.set(num, issue);
          }
        }
      }

      logger.debug('Batch fetched issues', {
        requested: numbers.length,
        cached: numbers.length - uncached.length,
        fetched: uncached.length,
      });

      return results;
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

    async addComment(issueNumber: number, body: string): Promise<Comment> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.issues.createComment({
              owner,
              repo,
              issue_number: issueNumber,
              body,
            });
            logger.debug(`Added comment to issue #${issueNumber}`);
            return mapComment(data);
          },
          `POST /repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          { operation: 'addComment', issueNumber }
        );
      } catch (error) {
        return handleError(error, 'add comment', { issueNumber });
      }
    },

    async addCommentWithFallback(issueNumber: number, body: string): Promise<DegradedResult<Comment | undefined>> {
      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body,
          });
          logger.debug(`Added comment to issue #${issueNumber}`);
          return mapComment(data);
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

    async listComments(issueNumber: number): Promise<Comment[]> {
      const cacheKey = `comments-${issueNumber}`;

      return client.getCachedOrFetch('comment-list', cacheKey, async () => {
        try {
          return await client.execute(
            async () => {
              const { data } = await octokit.issues.listComments({
                owner,
                repo,
                issue_number: issueNumber,
                per_page: 100,
              });
              return data.map(mapComment);
            },
            `GET /repos/${owner}/${repo}/issues/${issueNumber}/comments`,
            { operation: 'listComments', issueNumber }
          );
        } catch (error) {
          return handleError(error, 'list comments', { issueNumber });
        }
      });
    },

    async listCommentsWithFallback(issueNumber: number, fallback: Comment[] = []): Promise<DegradedResult<Comment[]>> {
      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber,
            per_page: 100,
          });
          return data.map(mapComment);
        },
        fallback,
        `GET /repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        { operation: 'listComments', issueNumber }
      );

      if (result.degraded) {
        logger.warn('List comments degraded - using fallback', {
          issueNumber,
          fallbackCount: fallback.length,
        });
      }

      return result;
    },

    async getComment(commentId: number): Promise<Comment | null> {
      const cacheKey = `comment-${commentId}`;

      try {
        return await client.getCachedOrFetch('comment', cacheKey, async () => {
          return await client.execute(
            async () => {
              const { data } = await octokit.issues.getComment({
                owner,
                repo,
                comment_id: commentId,
              });
              return mapComment(data);
            },
            `GET /repos/${owner}/${repo}/issues/comments/${commentId}`,
            { operation: 'getComment', commentId }
          );
        });
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        return handleError(error, 'get comment', { commentId });
      }
    },

    async updateComment(commentId: number, body: string): Promise<Comment> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.issues.updateComment({
              owner,
              repo,
              comment_id: commentId,
              body,
            });
            logger.debug(`Updated comment #${commentId}`);
            return mapComment(data);
          },
          `PATCH /repos/${owner}/${repo}/issues/comments/${commentId}`,
          { operation: 'updateComment', commentId }
        );
      } catch (error) {
        return handleError(error, 'update comment', { commentId });
      }
    },

    async updateCommentWithFallback(commentId: number, body: string): Promise<DegradedResult<Comment | undefined>> {
      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.issues.updateComment({
            owner,
            repo,
            comment_id: commentId,
            body,
          });
          logger.debug(`Updated comment #${commentId}`);
          return mapComment(data);
        },
        undefined,
        `PATCH /repos/${owner}/${repo}/issues/comments/${commentId}`,
        { operation: 'updateComment', commentId }
      );

      if (result.degraded) {
        logger.warn('Update comment degraded - operation skipped', { commentId });
      }

      return result;
    },

    async deleteComment(commentId: number): Promise<void> {
      try {
        await client.execute(
          async () => {
            await octokit.issues.deleteComment({
              owner,
              repo,
              comment_id: commentId,
            });
            logger.debug(`Deleted comment #${commentId}`);
          },
          `DELETE /repos/${owner}/${repo}/issues/comments/${commentId}`,
          { operation: 'deleteComment', commentId }
        );
      } catch (error: any) {
        // Ignore if comment doesn't exist
        if (error.status !== 404) {
          handleError(error, 'delete comment', { commentId });
        }
      }
    },

    async deleteCommentWithFallback(commentId: number): Promise<DegradedResult<void>> {
      const result = await client.executeWithFallback(
        async () => {
          await octokit.issues.deleteComment({
            owner,
            repo,
            comment_id: commentId,
          });
          logger.debug(`Deleted comment #${commentId}`);
        },
        undefined,
        `DELETE /repos/${owner}/${repo}/issues/comments/${commentId}`,
        { operation: 'deleteComment', commentId }
      );

      if (result.degraded) {
        logger.warn('Delete comment degraded - operation skipped', { commentId });
      }

      return result;
    },

    invalidateCache(): void {
      client.invalidateCacheType('issue');
      client.invalidateCacheType('issue-list');
      client.invalidateCacheType('comment');
      client.invalidateCacheType('comment-list');
      logger.debug('Invalidated issue and comment cache');
    },

    invalidateIssue(number: number): void {
      const cache = client.getCache();
      const cacheKey = cache.generateKey('issue', owner, repo, `issue-${number}`);
      cache.invalidate(cacheKey);
      // Also invalidate the list cache since it may contain stale data
      client.invalidateCacheType('issue-list');
      logger.debug(`Invalidated cache for issue #${number}`);
    },

    invalidateComments(issueNumber: number): void {
      const cache = client.getCache();
      const cacheKey = cache.generateKey('comment-list', owner, repo, `comments-${issueNumber}`);
      cache.invalidate(cacheKey);
      logger.debug(`Invalidated comments cache for issue #${issueNumber}`);
    },
  };
}
