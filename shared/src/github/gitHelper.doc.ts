/**
 * Git Helper Documentation Interface
 *
 * This file contains the fully-documented interface for the Git Helper service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AGitHelper for the abstract base class
 * @see GitHelper for the concrete implementation
 */

/**
 * Interface for Git Helper with full documentation.
 *
 * Provides methods for local Git operations on workspace repositories.
 * Handles common tasks like status, diff, commit, push, and branch management.
 *
 * ## Features
 *
 * - **Safe directory handling** - Automatically configures git safe.directory
 *   to avoid "dubious ownership" errors in container environments
 * - **Index refresh** - Forcefully refreshes git index after tarball extraction
 * - **Structured logging** - All operations are logged for debugging
 *
 * ## Usage
 *
 * ```typescript
 * import { GitHelper } from '@webedt/shared';
 *
 * const git = new GitHelper('/path/to/workspace');
 *
 * // Check for changes
 * if (await git.hasChanges()) {
 *   // Create a branch and commit
 *   await git.createBranch('feature/new-feature');
 *   await git.commitAll('Add new feature');
 *   await git.push();
 * }
 * ```
 *
 * ## Container Considerations
 *
 * When running in Docker containers where files may be owned by different
 * users (e.g., after extracting a tarball), the helper automatically
 * adds the workspace to git's `safe.directory` configuration.
 */
export interface IGitHelper {
  /**
   * Reconfigure the helper with a new workspace path.
   *
   * Use this method to change the workspace path without creating
   * a new instance.
   *
   * @param workspacePath - New workspace path
   *
   * @example
   * ```typescript
   * git.configure('/new/workspace/path');
   * ```
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
   *
   * @example
   * ```typescript
   * const status = await git.getStatus();
   * console.log(status);
   * // Branch: main
   * // Changes not staged: 2
   * // Untracked files: 1
   * // Modified: src/app.ts, src/utils.ts
   * // Deleted: none
   * // New files: src/newFile.ts
   * ```
   */
  getStatus(): Promise<string>;

  /**
   * Get git diff output.
   *
   * Returns the unstaged diff for all modified files.
   *
   * @returns Diff output string, or "No changes" if clean
   * @throws Error if git diff fails
   *
   * @example
   * ```typescript
   * const diff = await git.getDiff();
   * if (diff !== 'No changes') {
   *   console.log('Changes detected:', diff);
   * }
   * ```
   */
  getDiff(): Promise<string>;

  /**
   * Check if there are uncommitted changes.
   *
   * Performs an aggressive index refresh to ensure accurate detection,
   * especially after tarball extraction where git's cache may be stale.
   *
   * Uses both `git status --porcelain` and simple-git's structured status
   * for maximum reliability.
   *
   * @returns `true` if there are uncommitted changes
   * @throws Error if git commands fail (does NOT silently return false)
   *
   * @example
   * ```typescript
   * if (await git.hasChanges()) {
   *   await git.commitAll('Apply AI changes');
   *   await git.push();
   * }
   * ```
   */
  hasChanges(): Promise<boolean>;

  /**
   * Create and checkout a new local branch.
   *
   * @param branchName - Name of the branch to create
   * @throws Error if branch creation fails
   *
   * @example
   * ```typescript
   * await git.createBranch('claude/add-dark-mode');
   * ```
   */
  createBranch(branchName: string): Promise<void>;

  /**
   * Check if a local branch exists.
   *
   * @param branchName - Name of the branch to check
   * @returns `true` if the branch exists locally
   *
   * @example
   * ```typescript
   * if (await git.branchExists('feature/dark-mode')) {
   *   await git.checkout('feature/dark-mode');
   * } else {
   *   await git.createBranch('feature/dark-mode');
   * }
   * ```
   */
  branchExists(branchName: string): Promise<boolean>;

  /**
   * Stage all changes and create a commit.
   *
   * Automatically configures git identity if not set (using
   * "Internal API Server" as the author).
   *
   * @param message - Commit message
   * @returns The commit hash
   * @throws Error if commit fails
   *
   * @example
   * ```typescript
   * const hash = await git.commitAll('Fix authentication bug');
   * console.log(`Created commit: ${hash}`);
   * ```
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
   *
   * @example
   * ```typescript
   * // Push current branch to origin
   * await git.push();
   *
   * // Push specific branch
   * await git.push('origin', 'claude/fix-bug-123');
   * ```
   */
  push(remote?: string, branch?: string): Promise<void>;

  /**
   * Get the current branch name.
   *
   * @returns Current branch name, or "unknown" if it cannot be determined
   *
   * @example
   * ```typescript
   * const branch = await git.getCurrentBranch();
   * console.log(`Currently on branch: ${branch}`);
   * ```
   */
  getCurrentBranch(): Promise<string>;

  /**
   * Check if the workspace is a git repository.
   *
   * @returns `true` if the directory is a valid git repository
   *
   * @example
   * ```typescript
   * if (await git.isGitRepo()) {
   *   console.log('Valid git repository');
   * }
   * ```
   */
  isGitRepo(): Promise<boolean>;

  /**
   * Checkout an existing branch.
   *
   * @param branchName - Name of the branch to checkout
   * @throws Error if checkout fails
   *
   * @example
   * ```typescript
   * await git.checkout('main');
   * ```
   */
  checkout(branchName: string): Promise<void>;

  /**
   * Pull latest changes from remote.
   *
   * @param branch - Branch to pull (default: current branch)
   * @throws Error if pull fails
   *
   * @example
   * ```typescript
   * // Pull current branch
   * await git.pull();
   *
   * // Pull specific branch
   * await git.pull('main');
   * ```
   */
  pull(branch?: string): Promise<void>;
}
