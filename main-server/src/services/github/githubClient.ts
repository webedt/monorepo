/**
 * GitHub Client for repository clone/pull operations
 * Consolidated from github-worker/src/clients/githubClient.ts
 */

import simpleGitModule, { SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';

// Handle ESM/CommonJS interop for simple-git
const simpleGit = (simpleGitModule as unknown as { default: typeof simpleGitModule }).default || simpleGitModule;

export interface GitHubPullOptions {
  repoUrl: string;
  branch?: string;
  directory?: string;
  accessToken?: string;
  workspaceRoot: string;
}

export interface GitHubPullResult {
  targetPath: string;
  wasCloned: boolean;
  branch: string;
}

export class GitHubClient {
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit();
  }

  /**
   * Clone or pull a GitHub repository
   */
  async pullRepository(options: GitHubPullOptions): Promise<GitHubPullResult> {
    const { repoUrl, branch, directory, accessToken, workspaceRoot } = options;

    // Extract repo name from URL
    const repoName = directory || this.extractRepoName(repoUrl);
    const targetPath = path.join(workspaceRoot, repoName);

    // Check if repo already exists
    const repoExists = fs.existsSync(targetPath);

    if (repoExists) {
      // Pull latest changes
      return await this.pullExisting(targetPath, branch);
    } else {
      // Clone fresh
      return await this.cloneRepository(repoUrl, targetPath, branch, accessToken);
    }
  }

  /**
   * Clone a new repository
   * Implements fallback: tries requested branch, then falls back to default branch
   */
  private async cloneRepository(
    repoUrl: string,
    targetPath: string,
    branch?: string,
    accessToken?: string
  ): Promise<GitHubPullResult> {
    const cloneUrl = accessToken ? this.injectToken(repoUrl, accessToken) : repoUrl;

    let actualBranch = branch || 'main';

    try {
      // Try cloning with specified branch
      const cloneOptions: string[] = [];
      if (branch) {
        cloneOptions.push('--branch', branch);
      }

      await this.git.clone(cloneUrl, targetPath, cloneOptions);
      logger.info('Cloned repository', {
        component: 'GitHubClient',
        repoUrl,
        branch: actualBranch
      });
    } catch (error) {
      // If branch doesn't exist, try cloning default branch
      if (branch && error instanceof Error && error.message.includes('Remote branch')) {
        logger.warn('Branch not found, falling back to default branch', {
          component: 'GitHubClient',
          requestedBranch: branch
        });

        try {
          // Clone without specifying branch (uses default)
          await this.git.clone(cloneUrl, targetPath);

          // Detect the actual default branch
          const repoGit = simpleGit(targetPath);
          const status = await repoGit.status();
          actualBranch = status.current || 'main';

          logger.info('Cloned using default branch', {
            component: 'GitHubClient',
            actualBranch
          });
        } catch (fallbackError) {
          logger.error('Failed to clone with default branch', fallbackError, {
            component: 'GitHubClient'
          });
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }

    return {
      targetPath,
      wasCloned: true,
      branch: actualBranch
    };
  }

  /**
   * Pull latest changes from existing repository
   */
  private async pullExisting(targetPath: string, branch?: string): Promise<GitHubPullResult> {
    const repoGit = simpleGit(targetPath);

    // Get current branch if not specified
    const status = await repoGit.status();
    const actualBranch = branch || status.current || 'main';

    // Checkout branch if specified and different
    if (branch && branch !== status.current) {
      await repoGit.checkout(branch);
    }

    // Pull latest changes
    await repoGit.pull('origin', actualBranch);

    logger.info('Pulled latest changes', {
      component: 'GitHubClient',
      targetPath,
      branch: actualBranch
    });

    return {
      targetPath,
      wasCloned: false,
      branch: actualBranch
    };
  }

  /**
   * Extract repository name from URL
   */
  extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1];
  }

  /**
   * Extract owner from repository URL
   */
  extractOwner(repoUrl: string): string {
    // Match patterns like:
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    const match = repoUrl.match(/github\.com\/([^\/]+)\//);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1];
  }

  /**
   * Inject access token into GitHub URL
   */
  private injectToken(repoUrl: string, token: string): string {
    if (repoUrl.startsWith('https://github.com/')) {
      return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
    }
    return repoUrl;
  }
}
