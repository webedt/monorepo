/**
 * Store Page
 * Browse and search games in the store
 */

import { Page } from '../base/Page';
import { storeApi } from '../../lib/api';
import { GameCard, StoreHighlights, FilterBar } from '../../components';
import { InfiniteScroll } from '../../lib/infiniteScroll';
import type { Game, StoreHighlights as StoreHighlightsData } from '../../types';
import type { FilterConfig, RangeValue } from '../../components';
import './store.css';

export class StorePage extends Page {
  readonly route = '/store';
  readonly title = 'Store';
  protected requiresAuth = false;

  private games: Game[] = [];
  private highlights: StoreHighlightsData | null = null;
  private genres: string[] = [];
  private tags: string[] = [];
  private loading = true;
  private searchQuery = '';
  private selectedGenre = '';
  private selectedTags: string[] = [];
  private priceRange: RangeValue = {};
  private freeOnly = false;
  private sortBy: 'releaseDate' | 'title' | 'price' | 'rating' = 'releaseDate';
  private total = 0;
  private offset = 0;
  private limit = 20;
  private loadingMore = false;
  private highlightsComponent: StoreHighlights | null = null;
  private filterBar: FilterBar | null = null;
  private infiniteScroll: InfiniteScroll | null = null;

  protected render(): string {
    if (this.loading) {
      return `
        <div class="store-page">
          <div class="store-loading">
            <div class="spinner"></div>
            <p>Loading store...</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="store-page">
        <header class="store-header">
          <h1>Game Store</h1>
          <p class="store-subtitle">Browse and discover amazing games</p>
        </header>

        <div id="store-highlights-container"></div>

        <section class="store-browse">
          <div id="store-filter-bar"></div>

          <div class="store-results">
            <div class="store-grid" id="games-grid">
              ${this.games.length === 0 ? `
                <div class="empty-state">
                  <h3>No games found</h3>
                  <p>Try adjusting your search or filters</p>
                </div>
              ` : ''}
            </div>

            <div id="infinite-scroll-container"></div>
          </div>
        </section>
      </div>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.element.innerHTML = this.render();

    try {
      // Load highlights, genres, tags, and initial browse results in parallel
      const [highlightsResult, genresResult, tagsResult, browseResult] = await Promise.all([
        storeApi.getHighlights({ featuredLimit: 6, newLimit: 6 }),
        storeApi.getGenres(),
        storeApi.getTags(),
        storeApi.browse({ limit: this.limit, sort: this.sortBy, order: 'desc' }),
      ]);

      this.highlights = highlightsResult || null;
      this.genres = genresResult.genres || [];
      this.tags = tagsResult.tags || [];
      this.games = browseResult.games || [];
      this.total = browseResult.total || 0;

      this.loading = false;
      this.element.innerHTML = this.render();
      this.renderHighlights();
      this.renderFilterBar();
      this.renderGameCards();
      this.setupInfiniteScroll();
    } catch (error) {
      console.error('Failed to load store:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="store-page">
          <div class="error-state">
            <h2>Failed to load store</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private renderHighlights(): void {
    const container = this.$('#store-highlights-container');
    if (!container || !this.highlights || !this.highlights.hasHighlights) {
      return;
    }

    this.highlightsComponent = new StoreHighlights({
      highlights: this.highlights,
      onGameClick: (game) => this.navigate(`/game/${game.id}`),
      featuredTitle: 'Featured Games',
      newTitle: 'New Releases',
    });

    container.appendChild(this.highlightsComponent.getElement());
  }

  private renderFilterBar(): void {
    const container = this.$('#store-filter-bar');
    if (!container) return;

    const filters: FilterConfig[] = [
      {
        id: 'genre',
        type: 'select',
        label: 'Genre',
        placeholder: 'All Genres',
        options: this.genres.map((g) => ({ value: g, label: g })),
        value: this.selectedGenre,
        searchable: true,
      },
      {
        id: 'tags',
        type: 'multi-select',
        label: 'Tags',
        placeholder: 'All Tags',
        options: this.tags.map((t) => ({ value: t, label: t })),
        value: this.selectedTags,
        searchable: true,
      },
      {
        id: 'price',
        type: 'range',
        label: 'Price',
        placeholder: 'Any Price',
        min: 0,
        max: 100,
        step: 1,
        unit: '$',
        value: this.priceRange,
      },
      {
        id: 'free',
        type: 'checkbox',
        label: 'Free Only',
        value: this.freeOnly,
      },
      {
        id: 'sort',
        type: 'select',
        label: 'Sort By',
        placeholder: 'Newest',
        options: [
          { value: 'releaseDate', label: 'Newest' },
          { value: 'title', label: 'Title' },
          { value: 'price', label: 'Price' },
          { value: 'rating', label: 'Rating' },
        ],
        value: this.sortBy,
        clearable: false,
      },
    ];

    this.filterBar = new FilterBar({
      filters,
      searchable: true,
      searchPlaceholder: 'Search games...',
      searchValue: this.searchQuery,
      showClearAll: true,
      showResultCount: true,
      resultCount: this.total,
      onFilterChange: (filterId, value) => {
        this.handleFilterChange(filterId, value);
      },
      onSearchChange: (query) => {
        this.searchQuery = query;
        this.offset = 0;
        this.browseGames();
      },
      onClearAll: () => {
        this.searchQuery = '';
        this.selectedGenre = '';
        this.selectedTags = [];
        this.priceRange = {};
        this.freeOnly = false;
        this.sortBy = 'releaseDate';
        this.offset = 0;
        this.browseGames();
      },
    });

    container.appendChild(this.filterBar.getElement());
  }

  private handleFilterChange(
    filterId: string,
    value: string | string[] | RangeValue | boolean
  ): void {
    switch (filterId) {
      case 'genre':
        this.selectedGenre = value as string;
        break;
      case 'tags':
        this.selectedTags = value as string[];
        break;
      case 'price':
        this.priceRange = value as RangeValue;
        // If price range is set, disable free only
        if (
          (this.priceRange.min !== undefined && this.priceRange.min > 0) ||
          this.priceRange.max !== undefined
        ) {
          this.freeOnly = false;
          this.filterBar?.setValue('free', false);
        }
        break;
      case 'free':
        this.freeOnly = value as boolean;
        // If free only is enabled, clear price range
        if (this.freeOnly) {
          this.priceRange = {};
          this.filterBar?.setValue('price', {});
        }
        break;
      case 'sort': {
        const sortValue = value as string;
        const validSortValues = ['releaseDate', 'title', 'price', 'rating'] as const;
        this.sortBy = validSortValues.includes(sortValue as typeof this.sortBy)
          ? (sortValue as typeof this.sortBy)
          : 'releaseDate';
        break;
      }
    }

    this.offset = 0;
    this.browseGames();
  }

  private renderGameCards(): void {
    // Render browse games
    const gamesGrid = this.$('#games-grid');
    if (gamesGrid && this.games.length > 0) {
      gamesGrid.innerHTML = '';
      for (const game of this.games) {
        const card = new GameCard({
          game,
          onClick: (g) => this.navigate(`/game/${g.id}`),
        });
        gamesGrid.appendChild(card.getElement());
      }
    }
  }

  private setupInfiniteScroll(): void {
    // Clean up previous instance
    if (this.infiniteScroll) {
      this.infiniteScroll.destroy();
      this.infiniteScroll = null;
    }

    const container = this.$('#infinite-scroll-container');
    if (!container) return;

    this.infiniteScroll = new InfiniteScroll({
      onLoadMore: async () => {
        this.offset += this.limit;
        await this.browseGames(true);
      },
      hasMore: () => this.total > this.offset + this.limit,
      isLoading: () => this.loadingMore,
    });

    const sentinel = this.infiniteScroll.createSentinel();
    container.appendChild(sentinel);
    this.infiniteScroll.attach(sentinel);
  }

  protected onUnmount(): void {
    if (this.infiniteScroll) {
      this.infiniteScroll.destroy();
      this.infiniteScroll = null;
    }
  }

  private async browseGames(append = false): Promise<void> {
    if (append) {
      this.loadingMore = true;
    }

    try {
      // Build browse options
      const options: Parameters<typeof storeApi.browse>[0] = {
        sort: this.sortBy,
        order: 'desc',
        limit: this.limit,
        offset: this.offset,
      };

      if (this.searchQuery) {
        options.q = this.searchQuery;
      }

      if (this.selectedGenre) {
        options.genre = this.selectedGenre;
      }

      // For tags, we use the first tag as the API only supports single tag
      if (this.selectedTags.length > 0) {
        options.tag = this.selectedTags[0];
      }

      // Price range
      if (this.freeOnly) {
        options.free = true;
      } else {
        if (this.priceRange.min !== undefined) {
          options.minPrice = this.priceRange.min;
        }
        if (this.priceRange.max !== undefined) {
          options.maxPrice = this.priceRange.max;
        }
      }

      const result = await storeApi.browse(options);

      if (append) {
        this.games = [...this.games, ...(result.games || [])];
      } else {
        this.games = result.games || [];
      }
      this.total = result.total || 0;

      // Update result count in filter bar
      this.filterBar?.setResultCount(this.total);

      // Re-render just the games section
      const gamesGrid = this.$('#games-grid');
      if (gamesGrid) {
        if (!append) {
          gamesGrid.innerHTML = '';
        }
        const newGames = append ? result.games : this.games;
        for (const game of newGames || []) {
          const card = new GameCard({
            game,
            onClick: (g) => this.navigate(`/game/${g.id}`),
          });
          gamesGrid.appendChild(card.getElement());
        }

        if (this.games.length === 0) {
          gamesGrid.innerHTML = `
            <div class="empty-state">
              <h3>No games found</h3>
              <p>Try adjusting your search or filters</p>
            </div>
          `;
        }
      }

      // Update infinite scroll state
      this.infiniteScroll?.updateSentinelState();
    } catch (error) {
      console.error('Failed to browse games:', error);
    } finally {
      this.loadingMore = false;
    }
  }
}
