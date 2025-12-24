import { AService } from '../services/abstracts/AService.js';
import type { IGitHubClient } from './githubClient.doc.js';
import type { GitHubPullOptions } from './githubClient.doc.js';
import type { GitHubPullResult } from './githubClient.doc.js';

export type { GitHubPullOptions, GitHubPullResult } from './githubClient.doc.js';

export abstract class AGitHubClient extends AService implements IGitHubClient {
  abstract pullRepository(options: GitHubPullOptions): Promise<GitHubPullResult>;

  abstract extractRepoName(repoUrl: string): string;

  abstract extractOwner(repoUrl: string): string;
}
