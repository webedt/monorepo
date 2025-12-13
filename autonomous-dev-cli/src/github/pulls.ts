import { GitHubClient, type ServiceHealth } from './client.js';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
} from '../utils/errors.js';

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  htmlUrl: string;
  mergeable: boolean | null;
  merged: boolean;
  draft: boolean;
}

export interface CreatePROptions {
  title: string;
  body: string;
  head: string; // Branch name
  base: string; // Base branch (e.g., 'main')
  draft?: boolean;
}

export interface MergeResult {
  merged: boolean;
  sha: string | null;
  message: string;
}

/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
  value: T;
  degraded: boolean;
}

export interface PRManager {
  listOpenPRs(): Promise<PullRequest[]>;
  listOpenPRsWithFallback(fallback?: PullRequest[]): Promise<DegradedResult<PullRequest[]>>;
  getPR(number: number): Promise<PullRequest | null>;
  findPRForBranch(branchName: string, base?: string): Promise<PullRequest | null>;
  createPR(options: CreatePROptions): Promise<PullRequest>;
  createPRWithFallback(options: CreatePROptions): Promise<DegradedResult<PullRequest | null>>;
  mergePR(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<MergeResult>;
  mergePRWithFallback(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<DegradedResult<MergeResult>>;
  closePR(number: number): Promise<void>;
  updatePRFromBase(number: number): Promise<boolean>;
  waitForMergeable(number: number, maxAttempts?: number): Promise<boolean>;
  getChecksStatus(ref: string): Promise<{ state: string; statuses: Array<{ context: string; state: string }> }>;
  getServiceHealth(): ServiceHealth;
  isAvailable(): boolean;
}

export function createPRManager(client: GitHubClient): PRManager {
  const octokit = client.client;
  const { owner, repo } = client;

  const mapPR = (data: any): PullRequest => ({
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state,
    head: { ref: data.head.ref, sha: data.head.sha },
    base: { ref: data.base.ref, sha: data.base.sha },
    htmlUrl: data.html_url,
    mergeable: data.mergeable,
    merged: data.merged,
    draft: data.draft,
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

    async listOpenPRs(): Promise<PullRequest[]> {
      try {
        const { data } = await octokit.pulls.list({
          owner,
          repo,
          state: 'open',
          per_page: 100,
        });

        return data.map(mapPR);
      } catch (error) {
        handleError(error, 'list PRs');
      }
    },

    async listOpenPRsWithFallback(fallback: PullRequest[] = []): Promise<DegradedResult<PullRequest[]>> {
      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.pulls.list({
            owner,
            repo,
            state: 'open',
            per_page: 100,
          });
          return data.map(mapPR);
        },
        fallback,
        `GET /repos/${owner}/${repo}/pulls`,
        { operation: 'listOpenPRs' }
      );

      if (result.degraded) {
        logger.warn('PR list fetch degraded - using fallback', {
          fallbackCount: fallback.length,
        });
      }

      return result;
    },

    async getPR(number: number): Promise<PullRequest | null> {
      try {
        const { data } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: number,
        });

        return mapPR(data);
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        handleError(error, 'get PR', { prNumber: number });
      }
    },

    async findPRForBranch(branchName: string, base?: string): Promise<PullRequest | null> {
      try {
        const params: {
          owner: string;
          repo: string;
          head: string;
          state: 'open';
          base?: string;
        } = {
          owner,
          repo,
          head: `${owner}:${branchName}`,
          state: 'open',
        };

        if (base) {
          params.base = base;
        }

        const { data } = await octokit.pulls.list(params);

        if (data.length === 0) {
          return null;
        }

        return mapPR(data[0]);
      } catch (error) {
        handleError(error, 'find PR for branch', { branchName, base });
      }
    },

    async createPR(options: CreatePROptions): Promise<PullRequest> {
      try {
        // Check if PR already exists
        const existing = await this.findPRForBranch(options.head, options.base);
        if (existing) {
          logger.info(`PR already exists for branch '${options.head}': #${existing.number}`);
          return existing;
        }

        const { data } = await octokit.pulls.create({
          owner,
          repo,
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
          draft: options.draft,
        });

        logger.info(`Created PR #${data.number}: ${data.title}`);

        return mapPR(data);
      } catch (error: any) {
        // Handle case where PR already exists
        if (error.message?.includes('A pull request already exists')) {
          const existing = await this.findPRForBranch(options.head, options.base);
          if (existing) {
            return existing;
          }
        }
        handleError(error, 'create PR', { head: options.head, base: options.base });
      }
    },

    async createPRWithFallback(options: CreatePROptions): Promise<DegradedResult<PullRequest | null>> {
      const result = await client.executeWithFallback(
        async () => {
          // Check if PR already exists
          const existing = await this.findPRForBranch(options.head, options.base);
          if (existing) {
            logger.info(`PR already exists for branch '${options.head}': #${existing.number}`);
            return existing;
          }

          const { data } = await octokit.pulls.create({
            owner,
            repo,
            title: options.title,
            body: options.body,
            head: options.head,
            base: options.base,
            draft: options.draft,
          });

          logger.info(`Created PR #${data.number}: ${data.title}`);
          return mapPR(data);
        },
        null,
        `POST /repos/${owner}/${repo}/pulls`,
        { operation: 'createPR', head: options.head }
      );

      if (result.degraded) {
        logger.warn('PR creation degraded - operation skipped', {
          head: options.head,
          base: options.base,
        });
      }

      return result;
    },

    async mergePR(number: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<MergeResult> {
      try {
        const { data } = await octokit.pulls.merge({
          owner,
          repo,
          pull_number: number,
          merge_method: method,
        });

        logger.info(`Merged PR #${number} via ${method}`);

        return {
          merged: data.merged,
          sha: data.sha,
          message: data.message,
        };
      } catch (error: any) {
        logger.error('Failed to merge PR', { error: error.message, number, method });

        return {
          merged: false,
          sha: null,
          message: error.message || 'Merge failed',
        };
      }
    },

    async mergePRWithFallback(number: number, method: 'merge' | 'squash' | 'rebase' = 'squash'): Promise<DegradedResult<MergeResult>> {
      const failedResult: MergeResult = {
        merged: false,
        sha: null,
        message: 'Merge skipped due to service degradation',
      };

      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.pulls.merge({
            owner,
            repo,
            pull_number: number,
            merge_method: method,
          });

          logger.info(`Merged PR #${number} via ${method}`);

          return {
            merged: data.merged,
            sha: data.sha,
            message: data.message,
          };
        },
        failedResult,
        `PUT /repos/${owner}/${repo}/pulls/${number}/merge`,
        { operation: 'mergePR', prNumber: number, method }
      );

      if (result.degraded) {
        logger.warn('PR merge degraded - operation skipped', {
          prNumber: number,
          method,
        });
      }

      return result;
    },

    async closePR(number: number): Promise<void> {
      try {
        await octokit.pulls.update({
          owner,
          repo,
          pull_number: number,
          state: 'closed',
        });
        logger.info(`Closed PR #${number}`);
      } catch (error) {
        handleError(error, 'close PR', { prNumber: number });
      }
    },

    async updatePRFromBase(number: number): Promise<boolean> {
      try {
        const pr = await this.getPR(number);
        if (!pr) {
          logger.error('PR not found', { number });
          return false;
        }

        // Merge base branch into the PR branch
        await octokit.repos.merge({
          owner,
          repo,
          base: pr.head.ref,
          head: pr.base.ref,
          commit_message: `Merge ${pr.base.ref} into ${pr.head.ref}`,
        });

        logger.info(`Updated PR #${number} with changes from ${pr.base.ref}`);
        return true;
      } catch (error: any) {
        if (error.status === 204) {
          // Already up to date
          logger.info(`PR #${number} is already up to date`);
          return true;
        }
        if (error.status === 409) {
          // Merge conflict
          logger.warn(`PR #${number} has merge conflicts`);
          return false;
        }
        handleError(error, 'update PR from base', { prNumber: number });
      }
    },

    async waitForMergeable(number: number, maxAttempts: number = 30): Promise<boolean> {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const pr = await this.getPR(number);
        if (!pr) {
          return false;
        }

        if (pr.mergeable === true) {
          return true;
        }

        if (pr.mergeable === false) {
          logger.warn(`PR #${number} has conflicts`);
          return false;
        }

        // mergeable is null - GitHub is still computing
        logger.debug(`Waiting for PR #${number} mergeability check... (${attempt + 1}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.warn(`Timed out waiting for PR #${number} mergeability`);
      return false;
    },

    async getChecksStatus(ref: string): Promise<{ state: string; statuses: Array<{ context: string; state: string }> }> {
      try {
        const { data } = await octokit.repos.getCombinedStatusForRef({
          owner,
          repo,
          ref,
        });

        return {
          state: data.state,
          statuses: data.statuses.map((s) => ({
            context: s.context,
            state: s.state,
          })),
        };
      } catch (error) {
        handleError(error, 'get checks status', { ref });
      }
    },
  };
}
