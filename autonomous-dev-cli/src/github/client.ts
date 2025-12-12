import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubClient {
  private octokit: Octokit;
  public readonly owner: string;
  public readonly repo: string;

  constructor(options: GitHubClientOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
  }

  get client(): Octokit {
    return this.octokit;
  }

  // Verify authentication works
  async verifyAuth(): Promise<{ login: string; name: string }> {
    const { data } = await this.octokit.users.getAuthenticated();
    return { login: data.login, name: data.name || data.login };
  }

  // Get repository info
  async getRepo(): Promise<{
    defaultBranch: string;
    fullName: string;
    private: boolean;
  }> {
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return {
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      private: data.private,
    };
  }
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new GitHubClient(options);
}
