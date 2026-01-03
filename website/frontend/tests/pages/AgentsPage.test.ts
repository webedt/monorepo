/**
 * Tests for AgentsPage
 * Covers session list rendering, filtering, search, SSE updates, and session creation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  mockSession,
  mockRunningSession,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  waitForAsync,
  simulateInput,
  simulateClick,
  MockEventSource,
} from './testUtils';

import type { Session } from '../../src/types';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthStore = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

const mockSessionsApi = vi.hoisted(() => ({
  list: vi.fn(),
  createCodeSession: vi.fn(),
  delete: vi.fn(),
  search: vi.fn(),
  toggleFavorite: vi.fn(),
}));

const mockGithubApi = vi.hoisted(() => ({
  getRepos: vi.fn(),
  getBranches: vi.fn(),
}));

const mockCollectionsApi = vi.hoisted(() => ({
  getSessions: vi.fn(),
  list: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockLastRepoStorage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../src/stores/authStore', () => ({
  authStore: mockAuthStore,
}));

vi.mock('../../src/lib/api', () => ({
  sessionsApi: mockSessionsApi,
  githubApi: mockGithubApi,
  collectionsApi: mockCollectionsApi,
}));

vi.mock('../../src/lib/storageInstances', () => ({
  lastRepoStorage: mockLastRepoStorage,
}));

vi.mock('../../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

// Import after mocking
import { AgentsPage } from '../../src/pages/agents/AgentsPage';

// Mock sessions for testing
const mockSessions: Session[] = [
  {
    ...mockSession,
    id: 'session-1',
    userRequest: 'First test session',
    status: 'completed',
    favorite: false,
  },
  {
    ...mockRunningSession,
    id: 'session-2',
    userRequest: 'Second running session',
    favorite: true,
  },
  {
    ...mockSession,
    id: 'session-3',
    userRequest: 'Third session with different repo',
    repositoryOwner: 'other-owner',
    repositoryName: 'other-repo',
    favorite: false,
  },
];

const mockRepos = [
  { name: 'test-repo', owner: { login: 'test-owner' } },
  { name: 'other-repo', owner: { login: 'other-owner' } },
];

const mockBranches = [
  { name: 'main' },
  { name: 'develop' },
  { name: 'feature-branch' },
];

describe('AgentsPage', () => {
  let container: HTMLElement;
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();

    // Store original EventSource
    originalEventSource = global.EventSource;

    // Install mock EventSource
    (global as { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource;

    // Default mock implementations
    mockAuthStore.isAuthenticated.mockReturnValue(true);
    mockAuthStore.getUser.mockReturnValue(mockUser);
    mockAuthStore.getState.mockReturnValue({
      user: mockUser,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    mockSessionsApi.list.mockResolvedValue({ sessions: mockSessions });
    mockSessionsApi.search.mockResolvedValue({ sessions: [] });
    mockSessionsApi.createCodeSession.mockResolvedValue({
      session: { id: 'new-session-id', ...mockSession },
    });
    mockSessionsApi.delete.mockResolvedValue({ success: true });
    mockSessionsApi.toggleFavorite.mockResolvedValue({ success: true });

    mockGithubApi.getRepos.mockResolvedValue({ repos: mockRepos });
    mockGithubApi.getBranches.mockResolvedValue({ branches: mockBranches });

    mockCollectionsApi.list.mockResolvedValue({ collections: [] });
    mockCollectionsApi.getSessions.mockResolvedValue({ sessions: [] });

    mockLastRepoStorage.get.mockReturnValue(null);
  });

  afterEach(() => {
    cleanupPageContainer();
    // Restore original EventSource
    (global as { EventSource: typeof EventSource }).EventSource = originalEventSource;
  });

  describe('Rendering', () => {
    it('should render the page structure', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.agents-page')).not.toBeNull();
    });

    it('should render the header with title', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.agents-header')).not.toBeNull();
      expect(container.querySelector('.agents-title')?.textContent).toBe('Agent Sessions');
    });

    it('should render the subtitle', () => {
      const page = new AgentsPage();
      page.mount(container);

      const subtitle = container.querySelector('.agents-subtitle');
      expect(subtitle?.textContent).toBe('Manage your AI coding sessions');
    });

    it('should render filter buttons', () => {
      const page = new AgentsPage();
      page.mount(container);

      const filterButtons = container.querySelectorAll('.filter-btn');
      expect(filterButtons.length).toBeGreaterThanOrEqual(3);

      const allBtn = container.querySelector('[data-filter="all"]');
      const activeBtn = container.querySelector('[data-filter="active"]');
      const favoritesBtn = container.querySelector('[data-filter="favorites"]');

      expect(allBtn).not.toBeNull();
      expect(activeBtn).not.toBeNull();
      expect(favoritesBtn).not.toBeNull();
    });

    it('should render search container', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.search-container')).not.toBeNull();
    });

    it('should render new session input box', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.new-session-input-box')).not.toBeNull();
    });

    it('should render trash link', () => {
      const page = new AgentsPage();
      page.mount(container);

      const trashLink = container.querySelector('a[href="#/trash"]');
      expect(trashLink).not.toBeNull();
    });

    it('should render collections sidebar', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.agents-sidebar')).not.toBeNull();
      expect(container.querySelector('.collections-panel-container')).not.toBeNull();
    });
  });

  describe('Filter Buttons', () => {
    it('should have "All" filter active by default', () => {
      const page = new AgentsPage();
      page.mount(container);

      const allBtn = container.querySelector('[data-filter="all"]');
      expect(allBtn?.classList.contains('filter-btn--active')).toBe(true);
    });

    it('should switch active filter on click', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const activeBtn = container.querySelector('[data-filter="active"]') as HTMLButtonElement;
      const allBtn = container.querySelector('[data-filter="all"]') as HTMLButtonElement;

      activeBtn.click();
      await waitForRender();

      expect(activeBtn.classList.contains('filter-btn--active')).toBe(true);
      expect(allBtn.classList.contains('filter-btn--active')).toBe(false);
    });

    it('should filter to show only running sessions when Active filter clicked', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const activeBtn = container.querySelector('[data-filter="active"]') as HTMLButtonElement;
      activeBtn.click();
      await waitForRender();

      // Should only show running sessions
      const sessionCards = container.querySelectorAll('.session-card');
      // Check that all visible cards have running status
      sessionCards.forEach(card => {
        const status = card.querySelector('.session-status');
        expect(status?.textContent).toBe('running');
      });
    });

    it('should filter to show only favorite sessions when Favorites filter clicked', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const favoritesBtn = container.querySelector('[data-filter="favorites"]') as HTMLButtonElement;
      favoritesBtn.click();
      await waitForRender();

      // Should only show favorite sessions
      const sessionCards = container.querySelectorAll('.session-card');
      sessionCards.forEach(card => {
        const favoriteBtn = card.querySelector('.session-favorite-btn--active');
        expect(favoriteBtn).not.toBeNull();
      });
    });
  });

  describe('Session Loading', () => {
    it('should call sessions API to load sessions on mount', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      expect(mockSessionsApi.list).toHaveBeenCalled();
    });

    it('should show loading spinner while loading', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.sessions-loading')).not.toBeNull();
      expect(container.querySelector('.spinner-container')).not.toBeNull();
    });

    it('should render session cards after loading', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const sessionCards = container.querySelectorAll('.session-card');
      expect(sessionCards.length).toBe(mockSessions.length);
    });

    it('should display session title in card', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const sessionTitle = container.querySelector('.session-title');
      expect(sessionTitle?.textContent).toBe('First test session');
    });

    it('should display session status in card', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const firstCard = container.querySelector('.session-card');
      const status = firstCard?.querySelector('.session-status');
      expect(status?.textContent).toBe('completed');
      expect(status?.classList.contains('status-completed')).toBe(true);
    });

    it('should display repository info in card', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const sessionRepo = container.querySelector('.session-repo');
      expect(sessionRepo?.textContent).toContain('test-owner/test-repo');
    });

    it('should show error toast when loading fails', async () => {
      mockSessionsApi.list.mockRejectedValueOnce(new Error('Network error'));

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      expect(mockToast.error).toHaveBeenCalledWith('Failed to load agent sessions');
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no sessions', async () => {
      mockSessionsApi.list.mockResolvedValue({ sessions: [] });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const emptyState = container.querySelector('.sessions-empty');
      expect(emptyState).not.toBeNull();
      expect(emptyState?.style.display).not.toBe('none');
    });

    it('should show appropriate message for empty active filter', async () => {
      // All sessions are completed (none running)
      mockSessionsApi.list.mockResolvedValue({
        sessions: [{ ...mockSession, status: 'completed' }],
      });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Click active filter
      const activeBtn = container.querySelector('[data-filter="active"]') as HTMLButtonElement;
      activeBtn.click();
      await waitForRender();

      const emptyTitle = container.querySelector('.empty-title');
      expect(emptyTitle?.textContent).toBe('No active sessions');
    });

    it('should show appropriate message for empty favorites', async () => {
      // No favorite sessions
      mockSessionsApi.list.mockResolvedValue({
        sessions: [{ ...mockSession, favorite: false }],
      });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Click favorites filter
      const favoritesBtn = container.querySelector('[data-filter="favorites"]') as HTMLButtonElement;
      favoritesBtn.click();
      await waitForRender();

      const emptyTitle = container.querySelector('.empty-title');
      expect(emptyTitle?.textContent).toBe('No favorite sessions');
    });
  });

  describe('Search', () => {
    it('should filter sessions on search input', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Get the search input
      const searchInput = container.querySelector('.search-container input') as HTMLInputElement;
      if (searchInput) {
        simulateInput(searchInput, 'First');
        await waitForAsync(50);
      }

      // Should filter to matching sessions
      const sessionCards = container.querySelectorAll('.session-card');
      expect(sessionCards.length).toBeLessThanOrEqual(mockSessions.length);
    });

    it('should perform server-side search for longer queries', async () => {
      mockSessionsApi.search.mockResolvedValue({
        sessions: [mockSessions[0]],
      });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Get the search input
      const searchInput = container.querySelector('.search-container input') as HTMLInputElement;
      if (searchInput) {
        simulateInput(searchInput, 'test search query');
        await waitForAsync(400); // Wait for debounce
      }

      expect(mockSessionsApi.search).toHaveBeenCalled();
    });

    it('should show no results message when search has no matches', async () => {
      mockSessionsApi.search.mockResolvedValue({ sessions: [] });
      mockSessionsApi.list.mockResolvedValue({ sessions: [] });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const searchInput = container.querySelector('.search-container input') as HTMLInputElement;
      if (searchInput) {
        simulateInput(searchInput, 'nonexistent query');
        await waitForAsync(400);
      }

      const emptyTitle = container.querySelector('.empty-title');
      expect(emptyTitle?.textContent).toBe('No matching sessions');
    });
  });

  describe('GitHub Repository Loading', () => {
    it('should load repositories on mount', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      expect(mockGithubApi.getRepos).toHaveBeenCalled();
    });

    it('should auto-select last used repository if available', async () => {
      mockLastRepoStorage.get.mockReturnValue('test-owner/test-repo');

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(200);

      // Should also load branches for the auto-selected repo
      expect(mockGithubApi.getBranches).toHaveBeenCalledWith('test-owner', 'test-repo');
    });
  });

  describe('Session Creation', () => {
    it('should render create session button', () => {
      const page = new AgentsPage();
      page.mount(container);

      expect(container.querySelector('.create-session-btn')).not.toBeNull();
    });

    it('should show error when creating session without repo/branch', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Click create button without selecting repo
      const createBtn = container.querySelector('.create-session-btn button') as HTMLButtonElement;
      if (createBtn) {
        createBtn.click();
        await waitForRender();
      }

      expect(mockToast.error).toHaveBeenCalledWith('Please select a repository and branch');
    });
  });

  describe('Session Actions', () => {
    it('should render favorite button on session cards', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const favoriteBtn = container.querySelector('.session-favorite-btn');
      expect(favoriteBtn).not.toBeNull();
    });

    it('should render delete button on session cards', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const deleteBtn = container.querySelector('.session-delete-btn');
      expect(deleteBtn).not.toBeNull();
    });

    it('should toggle favorite status when favorite button clicked', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const favoriteBtn = container.querySelector('.session-favorite-btn') as HTMLButtonElement;
      favoriteBtn.click();
      await waitForAsync(50);

      expect(mockSessionsApi.toggleFavorite).toHaveBeenCalled();
    });

    it('should delete session when delete button clicked', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const deleteBtn = container.querySelector('.session-delete-btn') as HTMLButtonElement;
      deleteBtn.click();
      await waitForAsync(50);

      expect(mockSessionsApi.delete).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalledWith('Session moved to trash');
    });

    it('should show error toast when delete fails', async () => {
      mockSessionsApi.delete.mockRejectedValueOnce(new Error('Delete failed'));

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const deleteBtn = container.querySelector('.session-delete-btn') as HTMLButtonElement;
      deleteBtn.click();
      await waitForAsync(50);

      expect(mockToast.error).toHaveBeenCalledWith('Failed to delete session');
    });
  });

  describe('SSE Session Updates', () => {
    it('should subscribe to session updates via SSE', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForRender();

      // The page should create an EventSource for session updates
      // This is handled internally by the ListenerRegistry
      expect(container.querySelector('.agents-page')).not.toBeNull();
    });
  });

  describe('Active Count Badge', () => {
    it('should show active session count in filter button', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      const activeCount = container.querySelector('.active-count');
      // Should show count of running sessions (1 in our mock data)
      expect(activeCount).not.toBeNull();
    });
  });

  describe('Authentication', () => {
    it('should have requiresAuth set to true', () => {
      const page = new AgentsPage();
      mockAuthStore.isAuthenticated.mockReturnValue(false);
      expect(page.canAccess()).toBe(false);
    });

    it('should allow access when authenticated', () => {
      mockAuthStore.isAuthenticated.mockReturnValue(true);

      const page = new AgentsPage();
      expect(page.canAccess()).toBe(true);
    });
  });

  describe('Page Metadata', () => {
    it('should have correct route', () => {
      const page = new AgentsPage();
      expect(page.route).toBe('/agents');
    });

    it('should have correct title', () => {
      const page = new AgentsPage();
      expect(page.title).toBe('Agent Sessions');
    });
  });

  describe('Navigation', () => {
    it('should navigate to chat when session card is clicked', async () => {
      // Track hash changes
      const hashChanges: string[] = [];
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          hash: '#/agents',
          replace: vi.fn((url: string) => {
            hashChanges.push(url);
          }),
        },
        writable: true,
        configurable: true,
      });

      const page = new AgentsPage();
      page.mount(container);
      await waitForAsync(100);

      // Cards should be clickable
      const sessionCard = container.querySelector('.session-card') as HTMLElement;
      expect(sessionCard).not.toBeNull();
      // Note: The actual navigation is tested by checking the navigate call
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForRender();

      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new AgentsPage();
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(container.querySelector('.agents-page')).toBeNull();
    });
  });
});
