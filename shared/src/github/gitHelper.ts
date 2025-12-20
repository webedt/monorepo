/**
 * Git Helper - Local Git Operations
 *
 * A wrapper around simple-git that provides high-level Git operations
 * for managing workspace repositories. Handles common tasks like
 * status, diff, commit, push, and branch management.
 *
 * ## Key Features
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
 *
 * @module github/gitHelper
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { logger } from '../logger.js';

/**
 * Git operations helper for workspace repositories.
 *
 * Provides a high-level interface for common Git operations with
 * automatic safe directory handling and comprehensive logging.
 *
 * @example
 * ```typescript
 * const git = new GitHelper('/workspace/my-project');
 *
 * // Get status and diff
 * console.log(await git.getStatus());
 * console.log(await git.getDiff());
 *
 * // Create branch, commit, and push
 * await git.createBranch('claude/fix-bug-123');
 * await git.commitAll('Fix null pointer bug in parser');
 * await git.push('origin', 'claude/fix-bug-123');
 * ```
 */
export class GitHelper {
  private git: SimpleGit;
  private workspacePath: string;
  private safeDirectoryAdded: boolean = false;

  /**
   * Create a new GitHelper for a workspace directory.
   *
   * @param workspacePath - Absolute path to the git repository
   *
   * @example
   * ```typescript
   * const git = new GitHelper('/var/workspace/my-repo');
   * ```
   */
  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.git = simpleGit(workspacePath);
  }

  /**
   * Add the workspace to git's safe.directory config to avoid
   * "dubious ownership" errors when running git commands on
   * directories owned by different users
   */
  private async ensureSafeDirectory(): Promise<void> {
    if (this.safeDirectoryAdded) {
      return;
    }

    try {
      // Add the workspace path to git's safe.directory config
      // This is necessary because the directory may be owned by a different user
      // (e.g., when extracted from a tarball by the AI worker)
      await this.git.raw(['config', '--global', '--add', 'safe.directory', this.workspacePath]);
      this.safeDirectoryAdded = true;
      logger.info('Added workspace to git safe.directory', {
        component: 'GitHelper',
        workspacePath: this.workspacePath
      });
    } catch (error) {
      logger.warn('Failed to add workspace to safe.directory', {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue anyway - the directory might already be safe
    }
  }

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
  async getStatus(): Promise<string> {
    try {
      // Ensure safe.directory is configured before running git commands
      await this.ensureSafeDirectory();

      const status = await this.git.status();

      logger.info('Git getStatus() result', {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        branch: status.current,
        modified: status.modified,
        notAdded: status.not_added,
        deleted: status.deleted,
        created: status.created,
        staged: status.staged,
        isClean: status.isClean()
      });

      return `
Branch: ${status.current}
Changes not staged: ${status.not_added.length + status.modified.length + status.deleted.length}
Untracked files: ${status.not_added.length}
Modified: ${status.modified.join(', ') || 'none'}
Deleted: ${status.deleted.join(', ') || 'none'}
New files: ${status.not_added.join(', ') || 'none'}
`.trim();
    } catch (error) {
      logger.error('Failed to get git status', error, { component: 'GitHelper' });
      throw error;
    }
  }

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
  async getDiff(): Promise<string> {
    try {
      // Ensure safe.directory is configured before running git commands
      await this.ensureSafeDirectory();

      const diff = await this.git.diff();

      logger.info('Git getDiff() result', {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        diffLength: diff.length,
        hasChanges: diff.length > 0
      });

      return diff || 'No changes';
    } catch (error) {
      logger.error('Failed to get git diff', error, { component: 'GitHelper' });
      throw error;
    }
  }

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
  async hasChanges(): Promise<boolean> {
    // CRITICAL: Ensure safe.directory is configured FIRST before any git commands
    // This is especially important after extracting files from a tarball
    // where the directory ownership may differ from the current user
    await this.ensureSafeDirectory();

    try {
      // AGGRESSIVE INDEX REFRESH: After tarball extraction, git's index cache
      // can be stale. We need to forcefully refresh it to detect changes.

      // Step 1: Clear stat cache - forces git to re-read file stats
      try {
        await this.git.raw(['update-index', '--really-refresh']);
        logger.info('Git index forcefully refreshed (--really-refresh)', {
          component: 'GitHelper',
          workspacePath: this.workspacePath
        });
      } catch (refreshError) {
        // This failing with exit code 1 actually indicates there ARE changes
        logger.info('Git update-index --really-refresh indicated changes exist', {
          component: 'GitHelper',
          workspacePath: this.workspacePath,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError)
        });
      }

      // Step 2: Also try update-index -q --refresh for good measure
      try {
        await this.git.raw(['update-index', '-q', '--refresh']);
      } catch {
        // Ignore - changes may exist
      }

      // Step 3: Run raw git status --porcelain for the most reliable check
      // This bypasses simple-git's parsing which might miss some edge cases
      let rawStatusOutput = '';
      try {
        rawStatusOutput = await this.git.raw(['status', '--porcelain']);
        logger.info('Raw git status --porcelain output', {
          component: 'GitHelper',
          workspacePath: this.workspacePath,
          output: rawStatusOutput.substring(0, 1000),
          outputLength: rawStatusOutput.length,
          hasOutput: rawStatusOutput.trim().length > 0
        });
      } catch (rawStatusError) {
        logger.warn('Raw git status failed', {
          component: 'GitHelper',
          workspacePath: this.workspacePath,
          error: rawStatusError instanceof Error ? rawStatusError.message : String(rawStatusError)
        });
      }

      // Step 4: Use simple-git status for structured data
      const status = await this.git.status();

      // Determine changes from both raw and structured status
      const rawHasChanges = rawStatusOutput.trim().length > 0;
      const structuredHasChanges = !status.isClean();
      const hasChanges = rawHasChanges || structuredHasChanges;

      logger.info('Git hasChanges() status check result', {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        hasChanges,
        rawHasChanges,
        structuredHasChanges,
        isClean: status.isClean(),
        modifiedCount: status.modified.length,
        modified: status.modified,
        notAddedCount: status.not_added.length,
        notAdded: status.not_added,
        deletedCount: status.deleted.length,
        deleted: status.deleted,
        createdCount: status.created.length,
        created: status.created,
        renamedCount: status.renamed.length,
        renamed: status.renamed,
        stagedCount: status.staged.length,
        staged: status.staged,
        conflictedCount: status.conflicted.length,
        conflicted: status.conflicted
      });

      return hasChanges;
    } catch (error) {
      // CRITICAL: Do NOT silently return false on errors!
      // This was hiding git errors like "dubious ownership" and making it look
      // like there are no changes when in fact git couldn't even run properly.
      logger.error('Failed to check for changes - this error should NOT be silent!', error, {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });

      // Re-throw the error instead of returning false
      // This ensures the caller knows something went wrong
      throw error;
    }
  }

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
  async createBranch(branchName: string): Promise<void> {
    try {
      await this.git.checkoutLocalBranch(branchName);
      logger.info('Created and checked out branch', {
        component: 'GitHelper',
        branchName
      });
    } catch (error) {
      logger.error('Failed to create branch', error, {
        component: 'GitHelper',
        branchName
      });
      throw error;
    }
  }

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
  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branchLocal();
      return branches.all.includes(branchName);
    } catch (error) {
      logger.error('Failed to check branch existence', error, {
        component: 'GitHelper',
        branchName
      });
      return false;
    }
  }

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
  async commitAll(message: string): Promise<string> {
    try {
      // Ensure safe.directory is configured before running git commands
      await this.ensureSafeDirectory();

      // Stage all changes
      await this.git.add('.');

      // Ensure Git identity is configured
      await this.git.addConfig('user.name', 'Internal API Server');
      await this.git.addConfig('user.email', 'worker@internal-api-server.local');

      // Commit
      const result = await this.git.commit(message);

      logger.info('Created commit', {
        component: 'GitHelper',
        commitHash: result.commit,
        message
      });

      return result.commit;
    } catch (error) {
      logger.error('Failed to commit changes', error, {
        component: 'GitHelper',
        message
      });
      throw error;
    }
  }

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
  async push(remote: string = 'origin', branch?: string): Promise<void> {
    try {
      // Ensure safe.directory is configured before running git commands
      await this.ensureSafeDirectory();

      // Get current branch if not specified
      const currentBranch = branch || await this.getCurrentBranch();

      // Push to remote with upstream tracking
      await this.git.push(['-u', remote, currentBranch]);

      logger.info('Pushed to remote', {
        component: 'GitHelper',
        remote,
        branch: currentBranch
      });
    } catch (error) {
      logger.error('Failed to push to remote', error, {
        component: 'GitHelper',
        remote,
        branch
      });
      throw error;
    }
  }

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
  async getCurrentBranch(): Promise<string> {
    try {
      // Ensure safe.directory is configured before running git commands
      await this.ensureSafeDirectory();

      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error) {
      logger.error('Failed to get current branch', error, { component: 'GitHelper' });
      return 'unknown';
    }
  }

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
  async isGitRepo(): Promise<boolean> {
    try {
      // Ensure the directory is marked as safe before checking
      await this.ensureSafeDirectory();
      await this.git.status();
      return true;
    } catch (error) {
      logger.error('Git status check failed', error, {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

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
  async checkout(branchName: string): Promise<void> {
    try {
      await this.git.checkout(branchName);
      logger.info('Checked out branch', {
        component: 'GitHelper',
        branchName
      });
    } catch (error) {
      logger.error('Failed to checkout branch', error, {
        component: 'GitHelper',
        branchName
      });
      throw error;
    }
  }

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
  async pull(branch?: string): Promise<void> {
    try {
      const currentBranch = branch || await this.getCurrentBranch();
      await this.git.pull('origin', currentBranch);
      logger.info('Pulled latest changes', {
        component: 'GitHelper',
        branch: currentBranch
      });
    } catch (error) {
      logger.error('Failed to pull', error, { component: 'GitHelper' });
      throw error;
    }
  }
}
