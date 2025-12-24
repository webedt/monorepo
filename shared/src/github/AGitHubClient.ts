/**
 * Abstract GitHub Client Service
 *
 * Base class for cloning and pulling GitHub repositories.
 *
 * @see GitHubClient for the concrete implementation
 */
import { AService } from '../services/abstracts/AService.js';

/**
 * Options for cloning or pulling a repository.
 */
export interface GitHubPullOptions {
  repoUrl: string;
  branch?: string;
  directory?: string;
  accessToken?: string;
  workspaceRoot: string;
}

/**
 * Result of a clone or pull operation.
 */
export interface GitHubPullResult {
  targetPath: string;
  wasCloned: boolean;
  branch: string;
}

/**
 * Abstract GitHub client service.
 */
export abstract class AGitHubClient extends AService {
  /**
   * Clone or pull a GitHub repository.
   */
  abstract pullRepository(options: GitHubPullOptions): Promise<GitHubPullResult>;

  /**
   * Extract repository name from a GitHub URL.
   */
  abstract extractRepoName(repoUrl: string): string;

  /**
   * Extract owner from a GitHub URL.
   */
  abstract extractOwner(repoUrl: string): string;
}
