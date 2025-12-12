import { GitHubClient } from './client.js';
import { logger } from '../utils/logger.js';

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

export interface PRManager {
  listOpenPRs(): Promise<PullRequest[]>;
  getPR(number: number): Promise<PullRequest | null>;
  findPRForBranch(branchName: string, base?: string): Promise<PullRequest | null>;
  createPR(options: CreatePROptions): Promise<PullRequest>;
  mergePR(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<MergeResult>;
  closePR(number: number): Promise<void>;
  updatePRFromBase(number: number): Promise<boolean>;
  waitForMergeable(number: number, maxAttempts?: number): Promise<boolean>;
  getChecksStatus(ref: string): Promise<{ state: string; statuses: Array<{ context: string; state: string }> }>;
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

  return {
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
        logger.error('Failed to list PRs', { error });
        throw error;
      }
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
        throw error;
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
        logger.error('Failed to find PR for branch', { error, branchName });
        throw error;
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
        logger.error('Failed to create PR', { error, head: options.head });
        throw error;
      }
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
        logger.error('Failed to merge PR', { error, number, method });

        return {
          merged: false,
          sha: null,
          message: error.message || 'Merge failed',
        };
      }
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
        logger.error('Failed to close PR', { error, number });
        throw error;
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
        logger.error('Failed to update PR from base', { error, number });
        throw error;
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
        logger.error('Failed to get checks status', { error, ref });
        throw error;
      }
    },
  };
}
