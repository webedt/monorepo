import { GitHubClient } from './client.js';
import { logger } from '../utils/logger.js';

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface BranchManager {
  listBranches(): Promise<Branch[]>;
  getBranch(name: string): Promise<Branch | null>;
  createBranch(name: string, baseBranch: string): Promise<Branch>;
  deleteBranch(name: string): Promise<void>;
  branchExists(name: string): Promise<boolean>;
}

export function createBranchManager(client: GitHubClient): BranchManager {
  const octokit = client.client;
  const { owner, repo } = client;

  return {
    async listBranches(): Promise<Branch[]> {
      try {
        const { data } = await octokit.repos.listBranches({
          owner,
          repo,
          per_page: 100,
        });

        return data.map((branch) => ({
          name: branch.name,
          sha: branch.commit.sha,
          protected: branch.protected,
        }));
      } catch (error) {
        logger.error('Failed to list branches', { error });
        throw error;
      }
    },

    async getBranch(name: string): Promise<Branch | null> {
      try {
        const { data } = await octokit.repos.getBranch({
          owner,
          repo,
          branch: name,
        });

        return {
          name: data.name,
          sha: data.commit.sha,
          protected: data.protected,
        };
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async createBranch(name: string, baseBranch: string): Promise<Branch> {
      try {
        // Get the SHA of the base branch
        const { data: baseBranchData } = await octokit.repos.getBranch({
          owner,
          repo,
          branch: baseBranch,
        });

        // Create the new branch
        await octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${name}`,
          sha: baseBranchData.commit.sha,
        });

        logger.info(`Created branch '${name}' from '${baseBranch}'`);

        return {
          name,
          sha: baseBranchData.commit.sha,
          protected: false,
        };
      } catch (error: any) {
        // Check if branch already exists
        if (error.status === 422 && error.message?.includes('Reference already exists')) {
          logger.warn(`Branch '${name}' already exists`);
          const existing = await this.getBranch(name);
          if (existing) {
            return existing;
          }
        }
        logger.error('Failed to create branch', { error, name, baseBranch });
        throw error;
      }
    },

    async deleteBranch(name: string): Promise<void> {
      try {
        await octokit.git.deleteRef({
          owner,
          repo,
          ref: `heads/${name}`,
        });
        logger.info(`Deleted branch '${name}'`);
      } catch (error: any) {
        if (error.status === 404) {
          logger.warn(`Branch '${name}' not found (may already be deleted)`);
          return;
        }
        logger.error('Failed to delete branch', { error, name });
        throw error;
      }
    },

    async branchExists(name: string): Promise<boolean> {
      const branch = await this.getBranch(name);
      return branch !== null;
    },
  };
}
