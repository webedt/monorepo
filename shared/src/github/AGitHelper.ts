/**
 * Abstract Git Helper Service
 *
 * Base class for local Git operations on workspace repositories.
 *
 * @see GitHelper for the concrete implementation
 */
import { AService } from '../services/abstracts/AService.js';

/**
 * Abstract Git helper service.
 */
export abstract class AGitHelper extends AService {
  /**
   * Reconfigure the helper with a new workspace path.
   */
  abstract configure(workspacePath: string): void;

  /**
   * Get human-readable git status.
   */
  abstract getStatus(): Promise<string>;

  /**
   * Get git diff output.
   */
  abstract getDiff(): Promise<string>;

  /**
   * Check if there are uncommitted changes.
   */
  abstract hasChanges(): Promise<boolean>;

  /**
   * Create and checkout a new local branch.
   */
  abstract createBranch(branchName: string): Promise<void>;

  /**
   * Check if a local branch exists.
   */
  abstract branchExists(branchName: string): Promise<boolean>;

  /**
   * Stage all changes and create a commit.
   */
  abstract commitAll(message: string): Promise<string>;

  /**
   * Push the current branch to a remote.
   */
  abstract push(remote?: string, branch?: string): Promise<void>;

  /**
   * Get the current branch name.
   */
  abstract getCurrentBranch(): Promise<string>;

  /**
   * Check if the workspace is a git repository.
   */
  abstract isGitRepo(): Promise<boolean>;

  /**
   * Checkout an existing branch.
   */
  abstract checkout(branchName: string): Promise<void>;

  /**
   * Pull latest changes from remote.
   */
  abstract pull(branch?: string): Promise<void>;
}
