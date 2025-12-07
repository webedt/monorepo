/**
 * Helper for Git operations (status, diff, commit, push, branch)
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { logger } from '../../utils/logger.js';

export class GitHelper {
  private git: SimpleGit;
  private workspacePath: string;
  private safeDirectoryAdded: boolean = false;

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
   * Get git status output
   */
  async getStatus(): Promise<string> {
    try {
      const status = await this.git.status();
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
   * Get git diff output
   */
  async getDiff(): Promise<string> {
    try {
      const diff = await this.git.diff();
      return diff || 'No changes';
    } catch (error) {
      logger.error('Failed to get git diff', error, { component: 'GitHelper' });
      throw error;
    }
  }

  /**
   * Check if there are changes to commit
   */
  async hasChanges(): Promise<boolean> {
    try {
      // Refresh git index before checking status
      // This is important after extracting files from a tarball
      // because git's index might be out of sync with the actual file contents
      try {
        await this.git.raw(['update-index', '--refresh']);
      } catch {
        // Ignore errors - this might fail if there are actual changes
        // which is fine, we just want to refresh the index cache
      }

      const status = await this.git.status();

      logger.info('Git status check result', {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        isClean: status.isClean(),
        modified: status.modified,
        notAdded: status.not_added,
        deleted: status.deleted,
        created: status.created,
        renamed: status.renamed,
        staged: status.staged
      });

      return !status.isClean();
    } catch (error) {
      logger.error('Failed to check for changes', error, { component: 'GitHelper' });
      return false;
    }
  }

  /**
   * Create a new branch
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
   * Check if branch already exists
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
   * Commit all changes with message
   */
  async commitAll(message: string): Promise<string> {
    try {
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
   * Push current branch to remote
   */
  async push(remote: string = 'origin', branch?: string): Promise<void> {
    try {
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
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error) {
      logger.error('Failed to get current branch', error, { component: 'GitHelper' });
      return 'unknown';
    }
  }

  /**
   * Check if directory is a git repository
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
   * Checkout an existing branch
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
   * Pull latest changes
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
