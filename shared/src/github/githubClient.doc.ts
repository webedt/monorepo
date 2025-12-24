/**
 * GitHub Client Documentation Interface
 *
 * This file contains the fully-documented interface for the GitHub Client service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AGitHubClient for the abstract base class
 * @see GitHubClient for the concrete implementation
 */

/**
 * Options for cloning or pulling a repository.
 */
export interface GitHubPullOptions {
  /** GitHub repository URL (HTTPS format) */
  repoUrl: string;
  /** Branch to checkout (optional, defaults to repository default) */
  branch?: string;
  /** Custom directory name (optional, defaults to repo name) */
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
  /** Full path to the cloned/updated repository */
  targetPath: string;
  /** Whether the repository was freshly cloned (vs updated) */
  wasCloned: boolean;
  /** The branch that was checked out */
  branch: string;
}

/**
 * Interface for GitHub Client with full documentation.
 *
 * Provides methods for cloning and pulling GitHub repositories with
 * authentication support and intelligent branch fallback behavior.
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
   * client.extractRepoName('https://github.com/org/my-repo');
   * // 'my-repo'
   *
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
   *
   * client.extractOwner('https://github.com/username/repo.git');
   * // 'username'
   * ```
   */
  extractOwner(repoUrl: string): string;
}
