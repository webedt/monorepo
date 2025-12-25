import { simpleGit } from 'simple-git';
import { AGitHelper } from './AGitHelper.js';
import { logger } from '../utils/logging/logger.js';
import type { SimpleGit } from 'simple-git';

export class GitHelper extends AGitHelper {
  private git: SimpleGit;
  private workspacePath: string;
  private safeDirectoryAdded: boolean = false;

  constructor(workspacePath: string) {
    super();
    this.workspacePath = workspacePath;
    this.git = simpleGit(workspacePath);
  }

  configure(workspacePath: string): void {
    this.workspacePath = workspacePath;
    this.git = simpleGit(workspacePath);
    this.safeDirectoryAdded = false;
  }

  private async ensureSafeDirectory(): Promise<void> {
    if (this.safeDirectoryAdded) {
      return;
    }

    try {
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
    }
  }

  async getStatus(): Promise<string> {
    try {
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

  async getDiff(): Promise<string> {
    try {
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

  async hasChanges(): Promise<boolean> {
    await this.ensureSafeDirectory();

    try {
      try {
        await this.git.raw(['update-index', '--really-refresh']);
        logger.info('Git index forcefully refreshed (--really-refresh)', {
          component: 'GitHelper',
          workspacePath: this.workspacePath
        });
      } catch (refreshError) {
        logger.info('Git update-index --really-refresh indicated changes exist', {
          component: 'GitHelper',
          workspacePath: this.workspacePath,
          error: refreshError instanceof Error ? refreshError.message : String(refreshError)
        });
      }

      try {
        await this.git.raw(['update-index', '-q', '--refresh']);
      } catch {
        // Ignore - changes may exist
      }

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

      const status = await this.git.status();

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
      logger.error('Failed to check for changes - this error should NOT be silent!', error, {
        component: 'GitHelper',
        workspacePath: this.workspacePath,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

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

  async commitAll(message: string): Promise<string> {
    try {
      await this.ensureSafeDirectory();

      await this.git.add('.');

      await this.git.addConfig('user.name', 'Internal API Server');
      await this.git.addConfig('user.email', 'worker@internal-api-server.local');

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

  async push(remote: string = 'origin', branch?: string): Promise<void> {
    try {
      await this.ensureSafeDirectory();

      const currentBranch = branch || await this.getCurrentBranch();

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

  async getCurrentBranch(): Promise<string> {
    try {
      await this.ensureSafeDirectory();

      const status = await this.git.status();
      return status.current || 'unknown';
    } catch (error) {
      logger.error('Failed to get current branch', error, { component: 'GitHelper' });
      return 'unknown';
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
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
