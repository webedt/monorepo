/**
 * Interface for Git Helper - Local Git Operations
 *
 * Defines the contract for a wrapper around simple-git that provides
 * high-level Git operations for managing workspace repositories.
 *
 * @see GitHelper for the implementation
 * @module interfaces/IGitHelper
 */

/**
 * Git operations helper interface for workspace repositories.
 *
 * Provides a high-level interface for common Git operations with
 * automatic safe directory handling and comprehensive logging.
 *
 * @example
 * ```typescript
 * const git: IGitHelper = new GitHelper('/workspace/my-project');
 *
 * if (await git.hasChanges()) {
 *   await git.createBranch('claude/fix-bug-123');
 *   await git.commitAll('Fix null pointer bug in parser');
 *   await git.push('origin', 'claude/fix-bug-123');
 * }
 * ```
 */
export interface IGitHelper {
  /**
   * Reconfigure the helper with a new workspace path.
   *
   * Use this method to change the workspace path without creating
   * a new instance.
   *
   * @param workspacePath - New workspace path
   */
  configure(workspacePath: string): void;

  /**
   * Get human-readable git status.
   *
   * Returns a formatted string showing the current branch, modified files,
   * untracked files, and deleted files.
   *
   * @returns Formatted status string
   * @throws Error if git status fails
   */
  getStatus(): Promise<string>;

  /**
   * Get git diff output.
   *
   * Returns the unstaged diff for all modified files.
   *
   * @returns Diff output string, or "No changes" if clean
   * @throws Error if git diff fails
   */
  getDiff(): Promise<string>;

  /**
   * Check if there are uncommitted changes.
   *
   * Performs an aggressive index refresh to ensure accurate detection,
   * especially after tarball extraction where git's cache may be stale.
   *
   * @returns `true` if there are uncommitted changes
   * @throws Error if git commands fail
   */
  hasChanges(): Promise<boolean>;

  /**
   * Create and checkout a new local branch.
   *
   * @param branchName - Name of the branch to create
   * @throws Error if branch creation fails
   */
  createBranch(branchName: string): Promise<void>;

  /**
   * Check if a local branch exists.
   *
   * @param branchName - Name of the branch to check
   * @returns `true` if the branch exists locally
   */
  branchExists(branchName: string): Promise<boolean>;

  /**
   * Stage all changes and create a commit.
   *
   * Automatically configures git identity if not set.
   *
   * @param message - Commit message
   * @returns The commit hash
   * @throws Error if commit fails
   */
  commitAll(message: string): Promise<string>;

  /**
   * Push the current branch to a remote.
   *
   * Sets upstream tracking with the `-u` flag.
   *
   * @param remote - Remote name (default: "origin")
   * @param branch - Branch name (default: current branch)
   * @throws Error if push fails
   */
  push(remote?: string, branch?: string): Promise<void>;

  /**
   * Get the current branch name.
   *
   * @returns Current branch name, or "unknown" if it cannot be determined
   */
  getCurrentBranch(): Promise<string>;

  /**
   * Check if the workspace is a git repository.
   *
   * @returns `true` if the directory is a valid git repository
   */
  isGitRepo(): Promise<boolean>;

  /**
   * Checkout an existing branch.
   *
   * @param branchName - Name of the branch to checkout
   * @throws Error if checkout fails
   */
  checkout(branchName: string): Promise<void>;

  /**
   * Pull latest changes from remote.
   *
   * @param branch - Branch to pull (default: current branch)
   * @throws Error if pull fails
   */
  pull(branch?: string): Promise<void>;
}
