/**
 * Repo Store
 * Manages selected repository state
 */

import { z } from 'zod';

import { Store } from '../lib/store';
import { STORE_KEYS } from '../lib/storageKeys';
import { TypedStorage } from '../lib/typedStorage';

interface RepoState {
  selectedRepo: string; // Format: "owner/repo"
  selectedBranch: string;
  isLocked: boolean;
  recentRepos: string[];
}

const RepoStateSchema = z.object({
  selectedRepo: z.string().default(''),
  selectedBranch: z.string().default(''),
  isLocked: z.boolean().default(false),
  recentRepos: z.array(z.string()).default([]),
});

const MAX_RECENT_REPOS = 10;

const DEFAULT_STATE: RepoState = {
  selectedRepo: '',
  selectedBranch: '',
  isLocked: false,
  recentRepos: [],
};

const repoStorage = new TypedStorage({
  key: STORE_KEYS.REPO,
  schema: RepoStateSchema,
  defaultValue: DEFAULT_STATE,
  version: 1,
});

export class RepoStore extends Store<RepoState> {
  constructor() {
    super(DEFAULT_STATE);

    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const stored = repoStorage.get();
    this.setState(stored);

    // Save on changes
    this.subscribe((state) => {
      repoStorage.set(state);
    });
  }

  /**
   * Select a repository
   */
  selectRepo(repo: string, branch?: string): void {
    const state = this.getState();

    // Don't change if locked
    if (state.isLocked && state.selectedRepo) {
      return;
    }

    // Add to recent repos
    const recentRepos = [repo, ...state.recentRepos.filter(r => r !== repo)]
      .slice(0, MAX_RECENT_REPOS);

    this.setState({
      selectedRepo: repo,
      selectedBranch: branch || '',
      recentRepos,
    });
  }

  /**
   * Select a branch
   */
  selectBranch(branch: string): void {
    this.setState({ selectedBranch: branch });
  }

  /**
   * Lock the current selection
   */
  lock(): void {
    this.setState({ isLocked: true });
  }

  /**
   * Unlock selection
   */
  unlock(): void {
    this.setState({ isLocked: false });
  }

  /**
   * Clear selection
   */
  clear(): void {
    this.setState({
      selectedRepo: '',
      selectedBranch: '',
      isLocked: false,
    });
  }

  /**
   * Parse repo string into owner and name
   */
  getParsedRepo(): { owner: string; name: string } | null {
    const repo = this.getState().selectedRepo;
    if (!repo) return null;

    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;

    return { owner, name };
  }

  /**
   * Get full repo URL
   */
  getRepoUrl(): string | null {
    const parsed = this.getParsedRepo();
    if (!parsed) return null;
    return `https://github.com/${parsed.owner}/${parsed.name}`;
  }
}

// Singleton instance with HMR support
export const repoStore = new RepoStore().enableHmr('repo');

// HMR setup
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    repoStore.saveForHmr();
  });
}
