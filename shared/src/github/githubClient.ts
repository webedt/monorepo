/**
 * GitHub Client - Repository Clone/Pull Operations
 *
 * A client for cloning and pulling GitHub repositories with authentication
 * support. Handles branch resolution with intelligent fallback behavior.
 *
 * ## Features
 *
 * - **Clone with authentication** - Inject access tokens for private repos
 * - **Branch fallback** - Falls back to default branch if requested branch doesn't exist
 * - **Smart updates** - Pulls latest changes if repo already exists
 *
 * ## Usage
 *
 * ```typescript
 * import { GitHubClient } from '@webedt/shared';
 *
 * const client = new GitHubClient();
 *
 * // Clone a repository
 * const result = await client.pullRepository({
 *   repoUrl: 'https://github.com/org/repo',
 *   branch: 'main',
 *   workspaceRoot: '/var/workspace',
 *   accessToken: process.env.GITHUB_TOKEN,
 * });
 *
 * console.log(`Cloned to: ${result.targetPath}`);
 * console.log(`Branch: ${result.branch}`);
 * ```
 *
 * @module github/githubClient
 */

import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import type { IGitHubClient, GitHubPullOptions, GitHubPullResult } from '../interfaces/IGitHubClient.js';
import { logger } from '../logger.js';

// Re-export types from interface for backwards compatibility
export type { GitHubPullOptions, GitHubPullResult } from '../interfaces/IGitHubClient.js';

/**
 * GitHub repository client for clone and pull operations.
 *
 * @example
 * ```typescript
 * const client = new GitHubClient();
 *
 * // Clone or update a repository
 * const { targetPath, branch } = await client.pullRepository({
 *   repoUrl: 'https://github.com/org/repo',
 *   workspaceRoot: '/workspace',
 * });
 *
 * // Extract repo info from URL
 * const owner = client.extractOwner('https://github.com/org/repo');
 * const repo = client.extractRepoName('https://github.com/org/repo');
 * ```
 */
export class GitHubClient implements IGitHubClient {
  private git: SimpleGit;

  /**
   * Create a new GitHub client.
   */
  constructor() {
    this.git = simpleGit();
  }

  /**
   * Clone or pull a GitHub repository.
   *
   * If the repository already exists locally, pulls the latest changes.
   * Otherwise, clones a fresh copy. Handles branch fallback if the
   * requested branch doesn't exist.
   *
   * @param options - Clone/pull options
   * @returns Result with target path and branch information
   * @throws Error if clone/pull fails
   *
   * @example
   * ```typescript
   * // Clone a public repository
   * const result = await client.pullRepository({
   *   repoUrl: 'https://github.com/org/repo',
   *   workspaceRoot: '/workspace',
   * });
   *
   * // Clone a private repository with auth
   * const result = await client.pullRepository({
   *   repoUrl: 'https://github.com/org/private-repo',
   *   accessToken: process.env.GITHUB_TOKEN,
   *   workspaceRoot: '/workspace',
   * });
   *
   * // Clone a specific branch
   * const result = await client.pullRepository({
   *   repoUrl: 'https://github.com/org/repo',
   *   branch: 'develop',
   *   workspaceRoot: '/workspace',
   * });
   * ```
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
   * Extract repository name from a GitHub URL.
   *
   * @param repoUrl - GitHub repository URL
   * @returns Repository name (without `.git` suffix)
   * @throws Error if URL format is invalid
   *
   * @example
   * ```typescript
   * client.extractRepoName('https://github.com/org/my-repo');
   * // 'my-repo'
   *
   * client.extractRepoName('https://github.com/org/my-repo.git');
   * // 'my-repo'
   * ```
   */
  extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1];
  }

  /**
   * Extract owner (username or organization) from a GitHub URL.
   *
   * @param repoUrl - GitHub repository URL
   * @returns Owner name
   * @throws Error if URL format is invalid
   *
   * @example
   * ```typescript
   * client.extractOwner('https://github.com/my-org/repo');
   * // 'my-org'
   *
   * client.extractOwner('https://github.com/username/repo.git');
   * // 'username'
   * ```
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
