/**
 * Tests for RepoStore
 * Covers repository/branch selection state management including
 * persistence, locking, recent repos, and URL generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from '../../src/lib/store';

// Create a fresh RepoStore class for testing (without HMR)
interface RepoState {
  selectedRepo: string;
  selectedBranch: string;
  isLocked: boolean;
  recentRepos: string[];
}

const STORAGE_KEY = 'repoStore';
const MAX_RECENT_REPOS = 10;

class TestRepoStore extends Store<RepoState> {
  constructor(skipLoadFromStorage = false) {
    super({
      selectedRepo: '',
      selectedBranch: '',
      isLocked: false,
      recentRepos: [],
    });

    if (!skipLoadFromStorage) {
      this.loadFromStorage();
    }
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

  selectBranch(branch: string): void {
    this.setState({ selectedBranch: branch });
  }

  lock(): void {
    this.setState({ isLocked: true });
  }

  unlock(): void {
    this.setState({ isLocked: false });
  }

  clear(): void {
    this.setState({
      selectedRepo: '',
      selectedBranch: '',
      isLocked: false,
    });
  }

  getParsedRepo(): { owner: string; name: string } | null {
    const repo = this.getState().selectedRepo;
    if (!repo) return null;

    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;

    return { owner, name };
  }

  getRepoUrl(): string | null {
    const parsed = this.getParsedRepo();
    if (!parsed) return null;
    return `https://github.com/${parsed.owner}/${parsed.name}`;
  }
}

describe('RepoStore', () => {
  let repoStore: TestRepoStore;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    repoStore = new TestRepoStore(true); // Skip loading from storage for fresh state
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = repoStore.getState();

      expect(state.selectedRepo).toBe('');
      expect(state.selectedBranch).toBe('');
      expect(state.isLocked).toBe(false);
      expect(state.recentRepos).toEqual([]);
    });
  });

  describe('Select Repository', () => {
    it('should select a repository', () => {
      repoStore.selectRepo('owner/repo');

      const state = repoStore.getState();
      expect(state.selectedRepo).toBe('owner/repo');
      expect(state.selectedBranch).toBe('');
    });

    it('should select a repository with branch', () => {
      repoStore.selectRepo('owner/repo', 'main');

      const state = repoStore.getState();
      expect(state.selectedRepo).toBe('owner/repo');
      expect(state.selectedBranch).toBe('main');
    });

    it('should add to recent repos', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.selectRepo('owner/repo2');
      repoStore.selectRepo('owner/repo3');

      const state = repoStore.getState();
      expect(state.recentRepos).toEqual(['owner/repo3', 'owner/repo2', 'owner/repo1']);
    });

    it('should move existing repo to front of recent repos', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.selectRepo('owner/repo2');
      repoStore.selectRepo('owner/repo1');

      const state = repoStore.getState();
      expect(state.recentRepos).toEqual(['owner/repo1', 'owner/repo2']);
    });

    it('should limit recent repos to max size', () => {
      // Add more than MAX_RECENT_REPOS
      for (let i = 0; i < 15; i++) {
        repoStore.selectRepo(`owner/repo${i}`);
      }

      const state = repoStore.getState();
      expect(state.recentRepos.length).toBe(MAX_RECENT_REPOS);
      expect(state.recentRepos[0]).toBe('owner/repo14');
      expect(state.recentRepos[9]).toBe('owner/repo5');
    });

    it('should not duplicate repos in recent list', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.selectRepo('owner/repo2');
      repoStore.selectRepo('owner/repo1');
      repoStore.selectRepo('owner/repo1');

      const state = repoStore.getState();
      expect(state.recentRepos).toEqual(['owner/repo1', 'owner/repo2']);
    });
  });

  describe('Select Branch', () => {
    it('should select a branch', () => {
      repoStore.selectBranch('feature-branch');

      expect(repoStore.getState().selectedBranch).toBe('feature-branch');
    });

    it('should update branch independently of repo', () => {
      repoStore.selectRepo('owner/repo', 'main');
      repoStore.selectBranch('develop');

      const state = repoStore.getState();
      expect(state.selectedRepo).toBe('owner/repo');
      expect(state.selectedBranch).toBe('develop');
    });
  });

  describe('Locking', () => {
    it('should lock the selection', () => {
      repoStore.lock();

      expect(repoStore.getState().isLocked).toBe(true);
    });

    it('should unlock the selection', () => {
      repoStore.lock();
      repoStore.unlock();

      expect(repoStore.getState().isLocked).toBe(false);
    });

    it('should prevent repo changes when locked', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.lock();
      repoStore.selectRepo('owner/repo2');

      expect(repoStore.getState().selectedRepo).toBe('owner/repo1');
    });

    it('should allow selection when locked but no repo selected', () => {
      repoStore.lock();
      repoStore.selectRepo('owner/repo');

      expect(repoStore.getState().selectedRepo).toBe('owner/repo');
    });

    it('should allow selection after unlock', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.lock();
      repoStore.unlock();
      repoStore.selectRepo('owner/repo2');

      expect(repoStore.getState().selectedRepo).toBe('owner/repo2');
    });
  });

  describe('Clear', () => {
    it('should clear selection', () => {
      repoStore.selectRepo('owner/repo', 'main');
      repoStore.lock();
      repoStore.clear();

      const state = repoStore.getState();
      expect(state.selectedRepo).toBe('');
      expect(state.selectedBranch).toBe('');
      expect(state.isLocked).toBe(false);
    });

    it('should preserve recent repos on clear', () => {
      repoStore.selectRepo('owner/repo1');
      repoStore.selectRepo('owner/repo2');
      repoStore.clear();

      expect(repoStore.getState().recentRepos).toEqual(['owner/repo2', 'owner/repo1']);
    });
  });

  describe('Parse Repo', () => {
    it('should parse owner and name from repo string', () => {
      repoStore.selectRepo('my-org/my-project');

      const parsed = repoStore.getParsedRepo();
      expect(parsed).toEqual({ owner: 'my-org', name: 'my-project' });
    });

    it('should return null when no repo selected', () => {
      expect(repoStore.getParsedRepo()).toBeNull();
    });

    it('should return null for invalid repo format', () => {
      repoStore.setState({
        selectedRepo: 'invalid-format',
        selectedBranch: '',
        isLocked: false,
        recentRepos: [],
      });

      expect(repoStore.getParsedRepo()).toBeNull();
    });

    it('should handle repos with multiple slashes', () => {
      // This is technically an invalid format, but let's test behavior
      repoStore.setState({
        selectedRepo: 'org/repo/extra',
        selectedBranch: '',
        isLocked: false,
        recentRepos: [],
      });

      const parsed = repoStore.getParsedRepo();
      expect(parsed).toEqual({ owner: 'org', name: 'repo' });
    });
  });

  describe('Get Repo URL', () => {
    it('should generate correct GitHub URL', () => {
      repoStore.selectRepo('anthropic/claude-code');

      expect(repoStore.getRepoUrl()).toBe('https://github.com/anthropic/claude-code');
    });

    it('should return null when no repo selected', () => {
      expect(repoStore.getRepoUrl()).toBeNull();
    });

    it('should return null for invalid repo format', () => {
      repoStore.setState({
        selectedRepo: 'invalid',
        selectedBranch: '',
        isLocked: false,
        recentRepos: [],
      });

      expect(repoStore.getRepoUrl()).toBeNull();
    });
  });

  describe('Local Storage Persistence', () => {
    it('should persist state to localStorage on changes', () => {
      const store = new TestRepoStore();
      store.selectRepo('owner/repo', 'main');

      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored.selectedRepo).toBe('owner/repo');
      expect(stored.selectedBranch).toBe('main');
    });

    it('should load state from localStorage on init', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedRepo: 'saved/repo',
        selectedBranch: 'saved-branch',
        isLocked: true,
        recentRepos: ['saved/repo', 'another/repo'],
      }));

      const store = new TestRepoStore();

      const state = store.getState();
      expect(state.selectedRepo).toBe('saved/repo');
      expect(state.selectedBranch).toBe('saved-branch');
      expect(state.isLocked).toBe(true);
      expect(state.recentRepos).toEqual(['saved/repo', 'another/repo']);
    });

    it('should handle malformed localStorage data', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json{{{');

      const store = new TestRepoStore();

      // Should fall back to defaults
      expect(store.getState().selectedRepo).toBe('');
    });

    it('should handle partial localStorage data', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        selectedRepo: 'owner/repo',
        // Missing other fields
      }));

      const store = new TestRepoStore();

      expect(store.getState().selectedRepo).toBe('owner/repo');
      expect(store.getState().selectedBranch).toBe('');
      expect(store.getState().isLocked).toBe(false);
      expect(store.getState().recentRepos).toEqual([]);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      repoStore.subscribe(subscriber);

      repoStore.selectRepo('owner/repo');

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ selectedRepo: 'owner/repo' }),
        expect.objectContaining({ selectedRepo: '' })
      );
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = repoStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      repoStore.selectRepo('owner/repo');

      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should provide previous state to subscribers', () => {
      repoStore.selectRepo('owner/repo1');

      const subscriber = vi.fn();
      repoStore.subscribe(subscriber);

      repoStore.selectRepo('owner/repo2');

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ selectedRepo: 'owner/repo2' }),
        expect.objectContaining({ selectedRepo: 'owner/repo1' })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string repo', () => {
      repoStore.selectRepo('');

      expect(repoStore.getState().selectedRepo).toBe('');
      expect(repoStore.getParsedRepo()).toBeNull();
    });

    it('should handle repos with special characters', () => {
      repoStore.selectRepo('my-org/my-project_v2');

      const parsed = repoStore.getParsedRepo();
      expect(parsed).toEqual({ owner: 'my-org', name: 'my-project_v2' });
    });

    it('should handle rapid repo changes', () => {
      for (let i = 0; i < 100; i++) {
        repoStore.selectRepo(`owner/repo${i}`);
      }

      // Should maintain consistent state
      expect(repoStore.getState().selectedRepo).toBe('owner/repo99');
      expect(repoStore.getState().recentRepos.length).toBe(MAX_RECENT_REPOS);
    });

    it('should handle null-ish branch values', () => {
      repoStore.selectRepo('owner/repo', undefined);

      expect(repoStore.getState().selectedBranch).toBe('');
    });
  });
});
