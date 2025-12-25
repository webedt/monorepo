import { AService } from '../services/abstracts/AService.js';
import type { IGitHelperDocumentation } from './gitHelper.doc.js';

export abstract class AGitHelper extends AService implements IGitHelperDocumentation {
  abstract configure(workspacePath: string): void;

  abstract getStatus(): Promise<string>;

  abstract getDiff(): Promise<string>;

  abstract hasChanges(): Promise<boolean>;

  abstract createBranch(branchName: string): Promise<void>;

  abstract branchExists(branchName: string): Promise<boolean>;

  abstract commitAll(message: string): Promise<string>;

  abstract push(remote?: string, branch?: string): Promise<void>;

  abstract getCurrentBranch(): Promise<string>;

  abstract isGitRepo(): Promise<boolean>;

  abstract checkout(branchName: string): Promise<void>;

  abstract pull(branch?: string): Promise<void>;
}
