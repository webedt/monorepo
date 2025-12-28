/**
 * Snippets Store
 * Manages user code snippets and templates state
 */

import { Store } from '../lib/store';
import { snippetsApi } from '../lib/api';
import type {
  Snippet,
  SnippetCollection,
  SnippetLanguage,
  SnippetCategory,
  CreateSnippetRequest,
  UpdateSnippetRequest,
  SnippetListFilters,
} from '../types';

interface SnippetsState {
  snippets: Snippet[];
  collections: SnippetCollection[];
  selectedSnippet: Snippet | null;
  filters: SnippetListFilters;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  languages: readonly SnippetLanguage[];
  categories: readonly SnippetCategory[];
}

class SnippetsStore extends Store<SnippetsState> {
  constructor() {
    super({
      snippets: [],
      collections: [],
      selectedSnippet: null,
      filters: {
        sortBy: 'updatedAt',
        order: 'desc',
      },
      isLoading: false,
      isInitialized: false,
      error: null,
      languages: [],
      categories: [],
    });
  }

  /**
   * Load snippets with optional filters
   */
  async loadSnippets(filters?: SnippetListFilters): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const mergedFilters = { ...this.getState().filters, ...filters };
      const result = await snippetsApi.list(mergedFilters);

      this.setState({
        snippets: result.snippets,
        filters: mergedFilters,
        languages: result.languages,
        categories: result.categories,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      this.setState({
        isLoading: false,
        isInitialized: true,
        error: error instanceof Error ? error.message : 'Failed to load snippets',
      });
    }
  }

  /**
   * Load snippet collections
   */
  async loadCollections(): Promise<void> {
    try {
      const result = await snippetsApi.listCollections();
      this.setState({ collections: result.collections });
    } catch (error) {
      console.error('Failed to load snippet collections:', error);
    }
  }

  /**
   * Initialize store - load both snippets and collections
   * Uses Promise.allSettled to ensure both requests complete even if one fails
   */
  async initialize(): Promise<void> {
    if (this.getState().isInitialized) {
      return;
    }

    this.setState({ isLoading: true });

    const results = await Promise.allSettled([
      this.loadSnippets(),
      this.loadCollections(),
    ]);

    // Log any errors but don't fail initialization
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Failed to load snippets data:', result.reason);
      }
    }

    this.setState({ isLoading: false, isInitialized: true });
  }

  /**
   * Get a single snippet by ID
   */
  async getSnippet(id: string): Promise<Snippet | null> {
    try {
      const snippet = await snippetsApi.get(id);
      this.setState({ selectedSnippet: snippet });
      return snippet;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Failed to load snippet',
      });
      return null;
    }
  }

  /**
   * Create a new snippet
   */
  async createSnippet(data: CreateSnippetRequest): Promise<Snippet | null> {
    this.setState({ isLoading: true, error: null });

    try {
      const snippet = await snippetsApi.create(data);
      const snippets = [snippet, ...this.getState().snippets];
      this.setState({ snippets, isLoading: false });
      return snippet;
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create snippet',
      });
      return null;
    }
  }

  /**
   * Update a snippet
   */
  async updateSnippet(id: string, data: UpdateSnippetRequest): Promise<Snippet | null> {
    this.setState({ isLoading: true, error: null });

    try {
      const updated = await snippetsApi.update(id, data);
      const snippets = this.getState().snippets.map(s =>
        s.id === id ? updated : s
      );
      this.setState({
        snippets,
        selectedSnippet: this.getState().selectedSnippet?.id === id ? updated : this.getState().selectedSnippet,
        isLoading: false,
      });
      return updated;
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update snippet',
      });
      return null;
    }
  }

  /**
   * Delete a snippet
   */
  async deleteSnippet(id: string): Promise<boolean> {
    this.setState({ isLoading: true, error: null });

    try {
      await snippetsApi.delete(id);
      const snippets = this.getState().snippets.filter(s => s.id !== id);
      this.setState({
        snippets,
        selectedSnippet: this.getState().selectedSnippet?.id === id ? null : this.getState().selectedSnippet,
        isLoading: false,
      });
      return true;
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete snippet',
      });
      return false;
    }
  }

  /**
   * Record snippet usage
   */
  async useSnippet(id: string): Promise<Snippet | null> {
    try {
      const updated = await snippetsApi.use(id);
      const snippets = this.getState().snippets.map(s =>
        s.id === id ? updated : s
      );
      this.setState({ snippets });
      return updated;
    } catch (error) {
      console.error('Failed to record snippet usage:', error);
      return null;
    }
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(id: string): Promise<boolean> {
    try {
      const updated = await snippetsApi.toggleFavorite(id);
      const snippets = this.getState().snippets.map(s =>
        s.id === id ? updated : s
      );
      this.setState({
        snippets,
        selectedSnippet: this.getState().selectedSnippet?.id === id ? updated : this.getState().selectedSnippet,
      });
      return true;
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      return false;
    }
  }

  /**
   * Duplicate a snippet
   */
  async duplicateSnippet(id: string): Promise<Snippet | null> {
    try {
      const duplicated = await snippetsApi.duplicate(id);
      const snippets = [duplicated, ...this.getState().snippets];
      this.setState({ snippets });
      return duplicated;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Failed to duplicate snippet',
      });
      return null;
    }
  }

  /**
   * Create a collection
   */
  async createCollection(data: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    isDefault?: boolean;
  }): Promise<SnippetCollection | null> {
    try {
      const collection = await snippetsApi.createCollection(data);
      const collections = [...this.getState().collections, collection];
      this.setState({ collections });
      return collection;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Failed to create collection',
      });
      return null;
    }
  }

  /**
   * Update a collection
   */
  async updateCollection(id: string, data: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
    sortOrder?: number;
    isDefault?: boolean;
  }): Promise<SnippetCollection | null> {
    try {
      const updated = await snippetsApi.updateCollection(id, data);
      const collections = this.getState().collections.map(c =>
        c.id === id ? updated : c
      );
      this.setState({ collections });
      return updated;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Failed to update collection',
      });
      return null;
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(id: string): Promise<boolean> {
    try {
      await snippetsApi.deleteCollection(id);
      const collections = this.getState().collections.filter(c => c.id !== id);
      this.setState({ collections });
      return true;
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Failed to delete collection',
      });
      return false;
    }
  }

  /**
   * Add snippet to collection
   */
  async addToCollection(collectionId: string, snippetId: string): Promise<boolean> {
    try {
      await snippetsApi.addToCollection(collectionId, snippetId);
      // Reload to get updated collection counts
      await this.loadCollections();
      return true;
    } catch (error) {
      console.error('Failed to add snippet to collection:', error);
      return false;
    }
  }

  /**
   * Remove snippet from collection
   */
  async removeFromCollection(collectionId: string, snippetId: string): Promise<boolean> {
    try {
      await snippetsApi.removeFromCollection(collectionId, snippetId);
      // Reload to get updated collection counts
      await this.loadCollections();
      return true;
    } catch (error) {
      console.error('Failed to remove snippet from collection:', error);
      return false;
    }
  }

  /**
   * Set filters and reload
   */
  async setFilters(filters: Partial<SnippetListFilters>): Promise<void> {
    await this.loadSnippets(filters);
  }

  /**
   * Clear selected snippet
   */
  clearSelectedSnippet(): void {
    this.setState({ selectedSnippet: null });
  }

  /**
   * Clear error
   */
  clearError(): void {
    this.setState({ error: null });
  }

  /**
   * Get snippets by language
   */
  getSnippetsByLanguage(language: SnippetLanguage): Snippet[] {
    return this.getState().snippets.filter(s => s.language === language);
  }

  /**
   * Get snippets by category
   */
  getSnippetsByCategory(category: SnippetCategory): Snippet[] {
    return this.getState().snippets.filter(s => s.category === category);
  }

  /**
   * Get favorite snippets
   */
  getFavorites(): Snippet[] {
    return this.getState().snippets.filter(s => s.isFavorite);
  }

  /**
   * Get recently used snippets
   */
  getRecentlyUsed(limit = 5): Snippet[] {
    return this.getState().snippets
      .filter(s => s.lastUsedAt)
      .sort((a, b) => {
        const aDate = new Date(a.lastUsedAt!).getTime();
        const bDate = new Date(b.lastUsedAt!).getTime();
        return bDate - aDate;
      })
      .slice(0, limit);
  }

  /**
   * Search snippets locally
   */
  searchSnippets(query: string): Snippet[] {
    const lowerQuery = query.toLowerCase();
    return this.getState().snippets.filter(s =>
      s.title.toLowerCase().includes(lowerQuery) ||
      s.description?.toLowerCase().includes(lowerQuery) ||
      s.code.toLowerCase().includes(lowerQuery) ||
      s.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }
}

// Singleton instance
export const snippetsStore = new SnippetsStore();
