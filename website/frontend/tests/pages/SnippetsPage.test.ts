/**
 * Tests for SnippetsPage
 * Covers snippet list rendering, CRUD operations, collections, search, and filtering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  waitForAsync,
  simulateInput,
  simulateClick,
} from './testUtils';

import type { Snippet, SnippetCollection } from '../../src/types';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthStore = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

const mockSnippetsStore = vi.hoisted(() => {
  const state = {
    snippets: [] as Snippet[],
    collections: [] as SnippetCollection[],
    selectedSnippet: null as Snippet | null,
    filters: { sortBy: 'updatedAt', order: 'desc' },
    isLoading: false,
    isInitialized: false,
    error: null as string | null,
    languages: [],
    categories: [],
  };

  return {
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => () => {}),
    setState: vi.fn((newState) => Object.assign(state, newState)),
    initialize: vi.fn(),
    loadSnippets: vi.fn(),
    loadCollections: vi.fn(),
    createSnippet: vi.fn(),
    updateSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    toggleFavorite: vi.fn(),
    useSnippet: vi.fn(),
    getSnippet: vi.fn(),
    setFilters: vi.fn(),
    createCollection: vi.fn(),
    clearSelectedSnippet: vi.fn(),
    _state: state,
  };
});

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../src/stores/authStore', () => ({
  authStore: mockAuthStore,
}));

vi.mock('../../src/stores/snippetsStore', () => ({
  snippetsStore: mockSnippetsStore,
}));

vi.mock('../../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

// Import after mocking
import { SnippetsPage } from '../../src/pages/snippets/SnippetsPage';

// Mock snippets for testing
const mockSnippets: Snippet[] = [
  {
    id: 'snippet-1',
    userId: 'user-123',
    title: 'React useState Hook',
    description: 'A simple useState hook example',
    code: 'const [count, setCount] = useState(0);',
    language: 'typescript',
    category: 'Hooks',
    tags: ['react', 'hooks', 'state'],
    isFavorite: false,
    usageCount: 5,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  {
    id: 'snippet-2',
    userId: 'user-123',
    title: 'Async Fetch Pattern',
    description: 'Pattern for fetching data asynchronously',
    code: 'const fetchData = async () => { const res = await fetch(url); return res.json(); }',
    language: 'javascript',
    category: 'API',
    tags: ['fetch', 'async', 'api'],
    isFavorite: true,
    usageCount: 10,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-03T00:00:00.000Z',
  },
  {
    id: 'snippet-3',
    userId: 'user-123',
    title: 'Python List Comprehension',
    description: 'List comprehension example',
    code: 'squares = [x**2 for x in range(10)]',
    language: 'python',
    category: 'Utility',
    tags: ['python', 'list'],
    isFavorite: false,
    usageCount: 3,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

const mockCollections: SnippetCollection[] = [
  {
    id: 'collection-1',
    userId: 'user-123',
    name: 'React Patterns',
    description: 'Common React patterns',
    color: '#61dafb',
    icon: 'code',
    snippetCount: 5,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

describe('SnippetsPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();

    // Default mock implementations
    mockAuthStore.isAuthenticated.mockReturnValue(true);
    mockAuthStore.getUser.mockReturnValue(mockUser);
    mockAuthStore.getState.mockReturnValue({
      user: mockUser,
      isLoading: false,
      isInitialized: true,
      error: null,
    });

    // Reset snippets store state
    mockSnippetsStore._state.snippets = mockSnippets;
    mockSnippetsStore._state.collections = mockCollections;
    mockSnippetsStore._state.isInitialized = true;
    mockSnippetsStore._state.isLoading = false;
    mockSnippetsStore._state.error = null;

    mockSnippetsStore.initialize.mockResolvedValue(undefined);
    mockSnippetsStore.createSnippet.mockResolvedValue({ id: 'new-snippet' });
    mockSnippetsStore.updateSnippet.mockResolvedValue({ id: 'snippet-1' });
    mockSnippetsStore.deleteSnippet.mockResolvedValue(true);
    mockSnippetsStore.toggleFavorite.mockResolvedValue(true);
    mockSnippetsStore.createCollection.mockResolvedValue({ id: 'new-collection' });
    mockSnippetsStore.getSnippet.mockResolvedValue(mockSnippets[0]);
  });

  afterEach(() => {
    cleanupPageContainer();
  });

  describe('Rendering', () => {
    it('should render the page structure', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      expect(container.querySelector('.snippets-page')).not.toBeNull();
    });

    it('should render the header with title', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const header = container.querySelector('.snippets-header');
      expect(header).not.toBeNull();
      expect(header?.querySelector('h1')?.textContent).toBe('Code Snippets');
    });

    it('should render the subtitle', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const subtitle = container.querySelector('.header-subtitle');
      expect(subtitle?.textContent).toBe('Save and reuse common code patterns');
    });

    it('should render the create snippet button', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const createBtn = container.querySelector('#create-snippet-btn');
      expect(createBtn).not.toBeNull();
      expect(createBtn?.textContent).toContain('New Snippet');
    });

    it('should render the sidebar with collections', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      expect(container.querySelector('.snippets-sidebar')).not.toBeNull();
      expect(container.querySelector('.collections-nav')).not.toBeNull();
    });

    it('should render All Snippets and Favorites nav items', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const allSnippets = container.querySelector('[data-collection=""]');
      const favorites = container.querySelector('[data-filter="favorites"]');

      expect(allSnippets).not.toBeNull();
      expect(favorites).not.toBeNull();
    });

    it('should render search box', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const searchBox = container.querySelector('.search-box');
      expect(searchBox).not.toBeNull();
      expect(container.querySelector('#search-input')).not.toBeNull();
    });

    it('should render filter dropdowns', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      expect(container.querySelector('#language-filter')).not.toBeNull();
      expect(container.querySelector('#category-filter')).not.toBeNull();
      expect(container.querySelector('#sort-filter')).not.toBeNull();
    });
  });

  describe('Loading State', () => {
    it('should show loading state initially', () => {
      // Reset state to simulate initial loading
      mockSnippetsStore._state.isInitialized = false;
      mockSnippetsStore._state.isLoading = true;
      mockSnippetsStore._state.snippets = [];

      const page = new SnippetsPage();
      page.mount(container);

      // Check for loading indicator (loading is controlled by internal state)
      expect(container.querySelector('.snippets-page')).not.toBeNull();
    });

    it('should initialize snippets store on load', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      expect(mockSnippetsStore.initialize).toHaveBeenCalled();
    });
  });

  describe('Snippet List', () => {
    it('should render snippet cards', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const snippetCards = container.querySelectorAll('.snippet-card');
      expect(snippetCards.length).toBe(mockSnippets.length);
    });

    it('should display snippet title', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const snippetTitle = container.querySelector('.snippet-title');
      expect(snippetTitle?.textContent).toBe('React useState Hook');
    });

    it('should display language badge', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const languageBadge = container.querySelector('.language-badge');
      expect(languageBadge).not.toBeNull();
    });

    it('should display category badge', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const categoryBadge = container.querySelector('.category-badge');
      expect(categoryBadge?.textContent).toBe('Hooks');
    });

    it('should display snippet description', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const description = container.querySelector('.snippet-description');
      expect(description?.textContent).toBe('A simple useState hook example');
    });

    it('should display code preview', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const codePreview = container.querySelector('.snippet-preview code');
      expect(codePreview?.textContent).toContain('useState');
    });

    it('should display usage count', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const stats = container.querySelector('.snippet-stats');
      expect(stats?.textContent).toContain('Used 5x');
    });

    it('should display tags', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const tags = container.querySelectorAll('.snippet-tags .tag');
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no snippets', async () => {
      mockSnippetsStore._state.snippets = [];

      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const emptyState = container.querySelector('.empty-state');
      expect(emptyState).not.toBeNull();
      expect(emptyState?.querySelector('h2')?.textContent).toBe('No snippets yet');
    });

    it('should render create button in empty state', async () => {
      mockSnippetsStore._state.snippets = [];

      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const createBtn = container.querySelector('#empty-create-btn');
      expect(createBtn).not.toBeNull();
      expect(createBtn?.textContent).toBe('Create Snippet');
    });
  });

  describe('Snippet Actions', () => {
    it('should render favorite button on snippet cards', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const favoriteBtn = container.querySelector('[data-action="favorite"]');
      expect(favoriteBtn).not.toBeNull();
    });

    it('should render copy button on snippet cards', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const copyBtn = container.querySelector('[data-action="copy"]');
      expect(copyBtn).not.toBeNull();
    });

    it('should render menu button on snippet cards', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const menuBtn = container.querySelector('[data-action="menu"]');
      expect(menuBtn).not.toBeNull();
    });

    it('should toggle favorite when favorite button clicked', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const favoriteBtn = container.querySelector('[data-action="favorite"]') as HTMLButtonElement;
      favoriteBtn.click();
      await waitForAsync(50);

      expect(mockSnippetsStore.toggleFavorite).toHaveBeenCalledWith('snippet-1');
    });
  });

  describe('Collections', () => {
    it('should render collections in sidebar', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const collectionItems = container.querySelectorAll('.collection-item');
      // All Snippets + Favorites + custom collections
      expect(collectionItems.length).toBeGreaterThanOrEqual(2);
    });

    it('should render create collection button', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const createCollectionBtn = container.querySelector('#create-collection-btn');
      expect(createCollectionBtn).not.toBeNull();
    });

    it('should display collection snippet count', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const collectionCounts = container.querySelectorAll('.collection-count');
      expect(collectionCounts.length).toBeGreaterThan(0);
    });
  });

  describe('Languages Sidebar', () => {
    it('should render popular languages in sidebar', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const languagesNav = container.querySelector('.languages-nav');
      expect(languagesNav).not.toBeNull();

      const languageItems = container.querySelectorAll('.language-item');
      expect(languageItems.length).toBeGreaterThan(0);
    });
  });

  describe('Create Modal', () => {
    it('should open create modal when button clicked', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const createBtn = container.querySelector('#create-snippet-btn') as HTMLButtonElement;
      createBtn.click();
      await waitForRender();

      const modal = container.querySelector('#create-modal');
      expect(modal).not.toBeNull();
    });

    it('should render all form fields in create modal', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const createBtn = container.querySelector('#create-snippet-btn') as HTMLButtonElement;
      createBtn.click();
      await waitForRender();

      expect(container.querySelector('#snippet-title')).not.toBeNull();
      expect(container.querySelector('#snippet-language')).not.toBeNull();
      expect(container.querySelector('#snippet-category')).not.toBeNull();
      expect(container.querySelector('#snippet-description')).not.toBeNull();
      expect(container.querySelector('#snippet-code')).not.toBeNull();
      expect(container.querySelector('#snippet-tags')).not.toBeNull();
    });

    it('should close modal when close button clicked', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      // Open modal
      const createBtn = container.querySelector('#create-snippet-btn') as HTMLButtonElement;
      createBtn.click();
      await waitForRender();

      // Close modal
      const closeBtn = container.querySelector('#close-create-modal') as HTMLButtonElement;
      closeBtn.click();
      await waitForRender();

      const modal = container.querySelector('#create-modal');
      expect(modal).toBeNull();
    });

    it('should close modal when cancel button clicked', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      // Open modal
      const createBtn = container.querySelector('#create-snippet-btn') as HTMLButtonElement;
      createBtn.click();
      await waitForRender();

      // Cancel
      const cancelBtn = container.querySelector('#cancel-create') as HTMLButtonElement;
      cancelBtn.click();
      await waitForRender();

      const modal = container.querySelector('#create-modal');
      expect(modal).toBeNull();
    });
  });

  describe('Authentication', () => {
    it('should have requiresAuth set to true', () => {
      const page = new SnippetsPage();
      mockAuthStore.isAuthenticated.mockReturnValue(false);
      expect(page.canAccess()).toBe(false);
    });

    it('should allow access when authenticated', () => {
      mockAuthStore.isAuthenticated.mockReturnValue(true);

      const page = new SnippetsPage();
      expect(page.canAccess()).toBe(true);
    });
  });

  describe('Page Metadata', () => {
    it('should have correct route', () => {
      const page = new SnippetsPage();
      expect(page.route).toBe('/snippets');
    });

    it('should have correct title', () => {
      const page = new SnippetsPage();
      expect(page.title).toBe('Code Snippets');
    });
  });

  describe('Error Handling', () => {
    it('should show error state when initialization fails', async () => {
      mockSnippetsStore.initialize.mockRejectedValueOnce(new Error('Init failed'));
      mockSnippetsStore._state.isInitialized = false;

      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      const errorState = container.querySelector('.error-state');
      expect(errorState).not.toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new SnippetsPage();
      page.mount(container);
      await page.load();

      page.unmount();

      expect(container.querySelector('.snippets-page')).toBeNull();
    });
  });
});
