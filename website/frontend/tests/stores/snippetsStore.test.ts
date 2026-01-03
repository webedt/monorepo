/**
 * Tests for SnippetsStore
 * Covers code snippets CRUD, collections management,
 * filtering, favorites, and async API operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Snippet, SnippetCollection, SnippetLanguage, SnippetCategory } from '../../src/types';

// Mock snippetsApi
const mockSnippetsApi = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  use: vi.fn(),
  toggleFavorite: vi.fn(),
  duplicate: vi.fn(),
  listCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addToCollection: vi.fn(),
  removeFromCollection: vi.fn(),
};

vi.mock('../../src/lib/api', () => ({
  snippetsApi: mockSnippetsApi,
}));

// Import after mocks
import { snippetsStore } from '../../src/stores/snippetsStore';

// Test fixtures
const createMockSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 'snippet-1',
  title: 'Test Snippet',
  description: 'A test snippet',
  code: 'console.log("Hello");',
  language: 'typescript' as SnippetLanguage,
  category: 'utility' as SnippetCategory,
  tags: ['test', 'example'],
  isFavorite: false,
  useCount: 0,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createMockCollection = (overrides: Partial<SnippetCollection> = {}): SnippetCollection => ({
  id: 'collection-1',
  name: 'Test Collection',
  description: 'A test collection',
  color: '#ff0000',
  icon: 'folder',
  sortOrder: 0,
  snippetCount: 0,
  isDefault: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('SnippetsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store state
    snippetsStore.setState({
      snippets: [],
      collections: [],
      selectedSnippet: null,
      filters: { sortBy: 'updatedAt', order: 'desc' },
      isLoading: false,
      isInitialized: false,
      error: null,
      languages: [],
      categories: [],
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = snippetsStore.getState();

      expect(state.snippets).toEqual([]);
      expect(state.collections).toEqual([]);
      expect(state.selectedSnippet).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('Initialize', () => {
    it('should load snippets and collections', async () => {
      const snippets = [createMockSnippet()];
      const collections = [createMockCollection()];

      mockSnippetsApi.list.mockResolvedValue({
        snippets,
        languages: ['typescript'],
        categories: ['utility'],
      });
      mockSnippetsApi.listCollections.mockResolvedValue({ collections });

      await snippetsStore.initialize();

      const state = snippetsStore.getState();
      expect(state.snippets).toEqual(snippets);
      expect(state.collections).toEqual(collections);
      expect(state.isInitialized).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      snippetsStore.setState({ isInitialized: true });

      await snippetsStore.initialize();

      expect(mockSnippetsApi.list).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      mockSnippetsApi.list.mockResolvedValue({
        snippets: [],
        languages: [],
        categories: [],
      });
      mockSnippetsApi.listCollections.mockRejectedValue(new Error('Collection error'));

      await snippetsStore.initialize();

      const state = snippetsStore.getState();
      expect(state.isInitialized).toBe(true);
    });
  });

  describe('Load Snippets', () => {
    it('should load snippets with filters', async () => {
      const snippets = [createMockSnippet()];
      mockSnippetsApi.list.mockResolvedValue({
        snippets,
        languages: ['typescript'],
        categories: ['utility'],
      });

      await snippetsStore.loadSnippets({ language: 'typescript' });

      expect(mockSnippetsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'typescript' })
      );
    });

    it('should merge filters with existing', async () => {
      mockSnippetsApi.list.mockResolvedValue({
        snippets: [],
        languages: [],
        categories: [],
      });

      await snippetsStore.loadSnippets({ language: 'typescript' });

      const state = snippetsStore.getState();
      expect(state.filters.sortBy).toBe('updatedAt');
      expect(state.filters.language).toBe('typescript');
    });

    it('should handle load errors', async () => {
      mockSnippetsApi.list.mockRejectedValue(new Error('Network error'));

      await snippetsStore.loadSnippets();

      const state = snippetsStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('Snippet CRUD', () => {
    describe('getSnippet', () => {
      it('should get snippet by ID', async () => {
        const snippet = createMockSnippet();
        mockSnippetsApi.get.mockResolvedValue(snippet);

        const result = await snippetsStore.getSnippet('snippet-1');

        expect(result).toEqual(snippet);
        expect(snippetsStore.getState().selectedSnippet).toEqual(snippet);
      });

      it('should handle get errors', async () => {
        mockSnippetsApi.get.mockRejectedValue(new Error('Not found'));

        const result = await snippetsStore.getSnippet('non-existent');

        expect(result).toBeNull();
        expect(snippetsStore.getState().error).toBe('Not found');
      });
    });

    describe('createSnippet', () => {
      it('should create snippet', async () => {
        const newSnippet = createMockSnippet({ id: 'new-snippet' });
        mockSnippetsApi.create.mockResolvedValue(newSnippet);

        const result = await snippetsStore.createSnippet({
          title: 'New Snippet',
          code: 'const x = 1;',
          language: 'typescript',
          category: 'utility',
        });

        expect(result).toEqual(newSnippet);
        expect(snippetsStore.getState().snippets).toContainEqual(newSnippet);
      });

      it('should add new snippet at beginning of list', async () => {
        const existingSnippet = createMockSnippet({ id: 'existing' });
        snippetsStore.setState({ snippets: [existingSnippet] });

        const newSnippet = createMockSnippet({ id: 'new' });
        mockSnippetsApi.create.mockResolvedValue(newSnippet);

        await snippetsStore.createSnippet({
          title: 'New',
          code: '',
          language: 'typescript',
          category: 'utility',
        });

        expect(snippetsStore.getState().snippets[0].id).toBe('new');
      });

      it('should handle create errors', async () => {
        mockSnippetsApi.create.mockRejectedValue(new Error('Validation error'));

        const result = await snippetsStore.createSnippet({
          title: '',
          code: '',
          language: 'typescript',
          category: 'utility',
        });

        expect(result).toBeNull();
        expect(snippetsStore.getState().error).toBe('Validation error');
      });
    });

    describe('updateSnippet', () => {
      beforeEach(() => {
        snippetsStore.setState({
          snippets: [createMockSnippet({ id: 'snippet-1' })],
        });
      });

      it('should update snippet', async () => {
        const updated = createMockSnippet({ id: 'snippet-1', title: 'Updated' });
        mockSnippetsApi.update.mockResolvedValue(updated);

        const result = await snippetsStore.updateSnippet('snippet-1', { title: 'Updated' });

        expect(result?.title).toBe('Updated');
        expect(snippetsStore.getState().snippets[0].title).toBe('Updated');
      });

      it('should update selected snippet if same ID', async () => {
        const snippet = createMockSnippet();
        snippetsStore.setState({ selectedSnippet: snippet });

        const updated = createMockSnippet({ title: 'Updated' });
        mockSnippetsApi.update.mockResolvedValue(updated);

        await snippetsStore.updateSnippet('snippet-1', { title: 'Updated' });

        expect(snippetsStore.getState().selectedSnippet?.title).toBe('Updated');
      });
    });

    describe('deleteSnippet', () => {
      beforeEach(() => {
        snippetsStore.setState({
          snippets: [createMockSnippet({ id: 'snippet-1' })],
        });
      });

      it('should delete snippet', async () => {
        mockSnippetsApi.delete.mockResolvedValue(undefined);

        const result = await snippetsStore.deleteSnippet('snippet-1');

        expect(result).toBe(true);
        expect(snippetsStore.getState().snippets.length).toBe(0);
      });

      it('should clear selected snippet if deleted', async () => {
        snippetsStore.setState({ selectedSnippet: createMockSnippet() });
        mockSnippetsApi.delete.mockResolvedValue(undefined);

        await snippetsStore.deleteSnippet('snippet-1');

        expect(snippetsStore.getState().selectedSnippet).toBeNull();
      });

      it('should handle delete errors', async () => {
        mockSnippetsApi.delete.mockRejectedValue(new Error('Delete failed'));

        const result = await snippetsStore.deleteSnippet('snippet-1');

        expect(result).toBe(false);
        expect(snippetsStore.getState().error).toBe('Delete failed');
      });
    });

    describe('duplicateSnippet', () => {
      it('should duplicate snippet', async () => {
        const duplicated = createMockSnippet({ id: 'snippet-2', title: 'Copy of Test' });
        mockSnippetsApi.duplicate.mockResolvedValue(duplicated);

        const result = await snippetsStore.duplicateSnippet('snippet-1');

        expect(result?.id).toBe('snippet-2');
        expect(snippetsStore.getState().snippets).toContainEqual(duplicated);
      });
    });
  });

  describe('Snippet Actions', () => {
    describe('useSnippet', () => {
      beforeEach(() => {
        snippetsStore.setState({
          snippets: [createMockSnippet({ useCount: 0 })],
        });
      });

      it('should record snippet usage', async () => {
        const updated = createMockSnippet({ useCount: 1, lastUsedAt: new Date().toISOString() });
        mockSnippetsApi.use.mockResolvedValue(updated);

        const result = await snippetsStore.useSnippet('snippet-1');

        expect(result?.useCount).toBe(1);
        expect(snippetsStore.getState().snippets[0].useCount).toBe(1);
      });
    });

    describe('toggleFavorite', () => {
      beforeEach(() => {
        snippetsStore.setState({
          snippets: [createMockSnippet({ isFavorite: false })],
        });
      });

      it('should toggle favorite status', async () => {
        const updated = createMockSnippet({ isFavorite: true });
        mockSnippetsApi.toggleFavorite.mockResolvedValue(updated);

        const result = await snippetsStore.toggleFavorite('snippet-1');

        expect(result).toBe(true);
        expect(snippetsStore.getState().snippets[0].isFavorite).toBe(true);
      });
    });
  });

  describe('Collections', () => {
    describe('createCollection', () => {
      it('should create collection', async () => {
        const collection = createMockCollection();
        mockSnippetsApi.createCollection.mockResolvedValue(collection);

        const result = await snippetsStore.createCollection({ name: 'Test' });

        expect(result).toEqual(collection);
        expect(snippetsStore.getState().collections).toContainEqual(collection);
      });
    });

    describe('updateCollection', () => {
      beforeEach(() => {
        snippetsStore.setState({
          collections: [createMockCollection()],
        });
      });

      it('should update collection', async () => {
        const updated = createMockCollection({ name: 'Updated' });
        mockSnippetsApi.updateCollection.mockResolvedValue(updated);

        const result = await snippetsStore.updateCollection('collection-1', { name: 'Updated' });

        expect(result?.name).toBe('Updated');
      });
    });

    describe('deleteCollection', () => {
      beforeEach(() => {
        snippetsStore.setState({
          collections: [createMockCollection()],
        });
      });

      it('should delete collection', async () => {
        mockSnippetsApi.deleteCollection.mockResolvedValue(undefined);

        const result = await snippetsStore.deleteCollection('collection-1');

        expect(result).toBe(true);
        expect(snippetsStore.getState().collections.length).toBe(0);
      });
    });

    describe('addToCollection', () => {
      it('should add snippet to collection', async () => {
        mockSnippetsApi.addToCollection.mockResolvedValue(undefined);
        mockSnippetsApi.listCollections.mockResolvedValue({ collections: [] });

        const result = await snippetsStore.addToCollection('collection-1', 'snippet-1');

        expect(result).toBe(true);
        expect(mockSnippetsApi.addToCollection).toHaveBeenCalledWith('collection-1', 'snippet-1');
      });
    });

    describe('removeFromCollection', () => {
      it('should remove snippet from collection', async () => {
        mockSnippetsApi.removeFromCollection.mockResolvedValue(undefined);
        mockSnippetsApi.listCollections.mockResolvedValue({ collections: [] });

        const result = await snippetsStore.removeFromCollection('collection-1', 'snippet-1');

        expect(result).toBe(true);
      });
    });
  });

  describe('Filtering and Searching', () => {
    beforeEach(() => {
      snippetsStore.setState({
        snippets: [
          createMockSnippet({ id: '1', language: 'typescript', category: 'utility' }),
          createMockSnippet({ id: '2', language: 'javascript', category: 'template' }),
          createMockSnippet({ id: '3', language: 'typescript', category: 'template' }),
        ],
      });
    });

    describe('getSnippetsByLanguage', () => {
      it('should filter by language', () => {
        const result = snippetsStore.getSnippetsByLanguage('typescript' as SnippetLanguage);

        expect(result.length).toBe(2);
        expect(result.every(s => s.language === 'typescript')).toBe(true);
      });
    });

    describe('getSnippetsByCategory', () => {
      it('should filter by category', () => {
        const result = snippetsStore.getSnippetsByCategory('template' as SnippetCategory);

        expect(result.length).toBe(2);
        expect(result.every(s => s.category === 'template')).toBe(true);
      });
    });

    describe('getFavorites', () => {
      it('should get favorite snippets', () => {
        snippetsStore.setState({
          snippets: [
            createMockSnippet({ id: '1', isFavorite: true }),
            createMockSnippet({ id: '2', isFavorite: false }),
            createMockSnippet({ id: '3', isFavorite: true }),
          ],
        });

        const result = snippetsStore.getFavorites();

        expect(result.length).toBe(2);
        expect(result.every(s => s.isFavorite)).toBe(true);
      });
    });

    describe('getRecentlyUsed', () => {
      it('should get recently used snippets', () => {
        const now = new Date();
        snippetsStore.setState({
          snippets: [
            createMockSnippet({ id: '1', lastUsedAt: null }),
            createMockSnippet({ id: '2', lastUsedAt: new Date(now.getTime() - 1000).toISOString() }),
            createMockSnippet({ id: '3', lastUsedAt: new Date(now.getTime() - 2000).toISOString() }),
          ],
        });

        const result = snippetsStore.getRecentlyUsed();

        expect(result.length).toBe(2);
        expect(result[0].id).toBe('2'); // Most recent first
      });

      it('should respect limit', () => {
        const now = new Date();
        snippetsStore.setState({
          snippets: [
            createMockSnippet({ id: '1', lastUsedAt: now.toISOString() }),
            createMockSnippet({ id: '2', lastUsedAt: now.toISOString() }),
            createMockSnippet({ id: '3', lastUsedAt: now.toISOString() }),
          ],
        });

        const result = snippetsStore.getRecentlyUsed(2);

        expect(result.length).toBe(2);
      });
    });

    describe('searchSnippets', () => {
      beforeEach(() => {
        snippetsStore.setState({
          snippets: [
            createMockSnippet({ id: '1', title: 'Hello World', code: 'console.log()' }),
            createMockSnippet({ id: '2', title: 'Goodbye', description: 'World description' }),
            createMockSnippet({ id: '3', title: 'Test', tags: ['world'] }),
          ],
        });
      });

      it('should search in title', () => {
        const result = snippetsStore.searchSnippets('Hello');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('1');
      });

      it('should search in description', () => {
        const result = snippetsStore.searchSnippets('World description');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('2');
      });

      it('should search in code', () => {
        const result = snippetsStore.searchSnippets('console');
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('1');
      });

      it('should search in tags', () => {
        const result = snippetsStore.searchSnippets('world');
        expect(result.length).toBe(3); // All contain 'world' somewhere
      });

      it('should be case insensitive', () => {
        const result = snippetsStore.searchSnippets('HELLO');
        expect(result.length).toBe(1);
      });
    });
  });

  describe('Helper Methods', () => {
    describe('clearSelectedSnippet', () => {
      it('should clear selected snippet', () => {
        snippetsStore.setState({ selectedSnippet: createMockSnippet() });

        snippetsStore.clearSelectedSnippet();

        expect(snippetsStore.getState().selectedSnippet).toBeNull();
      });
    });

    describe('clearError', () => {
      it('should clear error', () => {
        snippetsStore.setState({ error: 'Some error' });

        snippetsStore.clearError();

        expect(snippetsStore.getState().error).toBeNull();
      });
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', async () => {
      const subscriber = vi.fn();
      snippetsStore.subscribe(subscriber);

      snippetsStore.setState({ isLoading: true });

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = snippetsStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      snippetsStore.setState({ isLoading: true });

      expect(subscriber).not.toHaveBeenCalled();
    });
  });
});
