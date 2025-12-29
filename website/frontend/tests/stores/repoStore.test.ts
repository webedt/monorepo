/**
 * Tests for RepoStore
 * Covers repository/branch selection state management including
 * persistence, locking, recent repos, and URL generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import the actual RepoStore class
import { RepoStore, __clearStorageCache } from '../../src/stores/repoStore';
import { STORE_KEYS } from '../../src/lib/storageKeys';

const STORAGE_KEY = STORE_KEYS.REPO;
const MAX_RECENT_REPOS = 10;

describe('RepoStore', () => {
  let repoStore: RepoStore;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Clear TypedStorage cache to ensure fresh reads
    __clearStorageCache();
    // Create fresh instance - localStorage is empty so initial state is defaults
    repoStore = new RepoStore();
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
      const store = new RepoStore();
      store.selectRepo('owner/repo', 'main');

      // TypedStorage uses versioned format
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored.version).toBe(1);
      expect(stored.data.selectedRepo).toBe('owner/repo');
      expect(stored.data.selectedBranch).toBe('main');
    });

    it('should load state from localStorage on init', () => {
      // TypedStorage expects versioned format
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        data: {
          selectedRepo: 'saved/repo',
          selectedBranch: 'saved-branch',
          isLocked: true,
          recentRepos: ['saved/repo', 'another/repo'],
        },
      }));

      // Clear cache to ensure fresh read from storage
      __clearStorageCache();
      const store = new RepoStore();

      const state = store.getState();
      expect(state.selectedRepo).toBe('saved/repo');
      expect(state.selectedBranch).toBe('saved-branch');
      expect(state.isLocked).toBe(true);
      expect(state.recentRepos).toEqual(['saved/repo', 'another/repo']);
    });

    it('should handle malformed localStorage data', () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json{{{');

      // Clear cache to ensure fresh read from storage
      __clearStorageCache();
      const store = new RepoStore();

      // Should fall back to defaults
      expect(store.getState().selectedRepo).toBe('');
    });

    it('should handle partial localStorage data', () => {
      // TypedStorage expects versioned format
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        data: {
          selectedRepo: 'owner/repo',
          // Missing other fields - TypedStorage merges with defaults
        },
      }));

      // Clear cache to ensure fresh read from storage
      __clearStorageCache();
      const store = new RepoStore();

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
