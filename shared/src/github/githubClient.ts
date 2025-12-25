import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { AGitHubClient } from './AGitHubClient.js';
import { logger } from '../utils/logging/logger.js';
import type { SimpleGit } from 'simple-git';
import type { GitHubPullOptions } from './AGitHubClient.js';
import type { GitHubPullResult } from './AGitHubClient.js';

export type { GitHubPullOptions, GitHubPullResult } from './AGitHubClient.js';

export class GitHubClient extends AGitHubClient {
  private git: SimpleGit;

  constructor() {
    super();
    this.git = simpleGit();
  }

  async pullRepository(options: GitHubPullOptions): Promise<GitHubPullResult> {
    const { repoUrl, branch, directory, accessToken, workspaceRoot } = options;

    const repoName = directory || this.extractRepoName(repoUrl);
    const targetPath = path.join(workspaceRoot, repoName);

    const repoExists = fs.existsSync(targetPath);

    if (repoExists) {
      return await this.pullExisting(targetPath, branch);
    } else {
      return await this.cloneRepository(repoUrl, targetPath, branch, accessToken);
    }
  }

  private async cloneRepository(
    repoUrl: string,
    targetPath: string,
    branch?: string,
    accessToken?: string
  ): Promise<GitHubPullResult> {
    const cloneUrl = accessToken ? this.injectToken(repoUrl, accessToken) : repoUrl;

    let actualBranch = branch || 'main';

    try {
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
      if (branch && error instanceof Error && error.message.includes('Remote branch')) {
        logger.warn('Branch not found, falling back to default branch', {
          component: 'GitHubClient',
          requestedBranch: branch
        });

        try {
          await this.git.clone(cloneUrl, targetPath);

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

  private async pullExisting(targetPath: string, branch?: string): Promise<GitHubPullResult> {
    const repoGit = simpleGit(targetPath);

    const status = await repoGit.status();
    const actualBranch = branch || status.current || 'main';

    if (branch && branch !== status.current) {
      await repoGit.checkout(branch);
    }

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

  extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1];
  }

  extractOwner(repoUrl: string): string {
    const match = repoUrl.match(/github\.com\/([^\/]+)\//);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1];
  }

  private injectToken(repoUrl: string, token: string): string {
    if (repoUrl.startsWith('https://github.com/')) {
      return repoUrl.replace('https://github.com/', `https://${token}@github.com/`);
    }
    return repoUrl;
  }
}
