/**
 * Repo Store
 * Manages selected repository state
 */

import { Store } from '../lib/store';

interface RepoState {
  selectedRepo: string; // Format: "owner/repo"
  selectedBranch: string;
  isLocked: boolean;
  recentRepos: string[];
}

const STORAGE_KEY = 'repoStore';
const MAX_RECENT_REPOS = 10;

class RepoStore extends Store<RepoState> {
  constructor() {
    super({
      selectedRepo: '',
      selectedBranch: '',
      isLocked: false,
      recentRepos: [],
    });

    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.setState({
          selectedRepo: parsed.selectedRepo || '',
          selectedBranch: parsed.selectedBranch || '',
          isLocked: parsed.isLocked || false,
          recentRepos: parsed.recentRepos || [],
        });
      }
    } catch {
      // Ignore parse errors
    }

    // Save on changes
    this.subscribe((state) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Ignore storage errors
      }
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

// Singleton instance
export const repoStore = new RepoStore();
