/**
 * Interface for GitHub Client - Repository Clone/Pull Operations
 *
 * Defines the contract for a client that handles cloning and pulling
 * GitHub repositories with authentication support.
 *
 * @see GitHubClient for the implementation
 * @module interfaces/IGitHubClient
 */

/**
 * Options for cloning or pulling a repository.
 */
export interface GitHubPullOptions {
  /** Full GitHub repository URL (HTTPS format) */
  repoUrl: string;
  /** Branch to checkout (default: repository's default branch) */
  branch?: string;
  /** Custom directory name for the clone (default: extracted from URL) */
  directory?: string;
  /** GitHub access token for private repositories */
  accessToken?: string;
  /** Root directory where repositories are cloned */
  workspaceRoot: string;
}

/**
 * Result of a clone or pull operation.
 */
export interface GitHubPullResult {
  /** Absolute path to the repository directory */
  targetPath: string;
  /** `true` if the repo was cloned fresh, `false` if it was pulled */
  wasCloned: boolean;
  /** The actual branch that was checked out */
  branch: string;
}

/**
 * GitHub repository client interface for clone and pull operations.
 *
 * @example
 * ```typescript
 * const client: IGitHubClient = new GitHubClient();
 *
 * const { targetPath, branch } = await client.pullRepository({
 *   repoUrl: 'https://github.com/org/repo',
 *   workspaceRoot: '/workspace',
 * });
 *
 * const owner = client.extractOwner('https://github.com/org/repo');
 * const repo = client.extractRepoName('https://github.com/org/repo');
 * ```
 */
export interface IGitHubClient {
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
   */
  pullRepository(options: GitHubPullOptions): Promise<GitHubPullResult>;

  /**
   * Extract repository name from a GitHub URL.
   *
   * @param repoUrl - GitHub repository URL
   * @returns Repository name (without `.git` suffix)
   * @throws Error if URL format is invalid
   *
   * @example
   * ```typescript
   * client.extractRepoName('https://github.com/org/my-repo.git');
   * // 'my-repo'
   * ```
   */
  extractRepoName(repoUrl: string): string;

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
   * ```
   */
  extractOwner(repoUrl: string): string;
}
