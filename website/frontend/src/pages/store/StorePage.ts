/**
 * Store Page
 * Browse and search games in the store
 */

import { Page } from '../base/Page';
import { storeApi } from '../../lib/api';
import { GameCard } from '../../components';
import type { Game } from '../../types';
import './store.css';

export class StorePage extends Page {
  readonly route = '/store';
  readonly title = 'Store';
  protected requiresAuth = false;

  private games: Game[] = [];
  private featuredGames: Game[] = [];
  private genres: string[] = [];
  private loading = true;
  private searchQuery = '';
  private selectedGenre = '';
  private selectedTag = '';
  private sortBy: 'releaseDate' | 'title' | 'price' | 'rating' = 'releaseDate';
  private total = 0;
  private offset = 0;
  private limit = 20;

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

        ${this.renderFeatured()}

        <section class="store-browse">
          <div class="store-filters">
            <div class="search-box">
              <input
                type="text"
                id="store-search"
                placeholder="Search games..."
                value="${this.escapeHtml(this.searchQuery)}"
              />
            </div>

            <select id="genre-filter">
              <option value="">All Genres</option>
              ${this.genres.map((g) => `
                <option value="${g}" ${this.selectedGenre === g ? 'selected' : ''}>${g}</option>
              `).join('')}
            </select>

            <select id="sort-filter">
              <option value="releaseDate" ${this.sortBy === 'releaseDate' ? 'selected' : ''}>Newest</option>
              <option value="title" ${this.sortBy === 'title' ? 'selected' : ''}>Title</option>
              <option value="price" ${this.sortBy === 'price' ? 'selected' : ''}>Price</option>
              <option value="rating" ${this.sortBy === 'rating' ? 'selected' : ''}>Rating</option>
            </select>
          </div>

          <div class="store-results">
            <div class="store-grid" id="games-grid">
              ${this.games.length === 0 ? `
                <div class="empty-state">
                  <h3>No games found</h3>
                  <p>Try adjusting your search or filters</p>
                </div>
              ` : ''}
            </div>

            ${this.total > this.offset + this.limit ? `
              <div class="load-more">
                <button id="load-more-btn" class="btn btn-secondary">
                  Load More (${this.total - this.offset - this.limit} remaining)
                </button>
              </div>
            ` : ''}
          </div>
        </section>
      </div>
    `;
  }

  private renderFeatured(): string {
    if (this.featuredGames.length === 0) return '';

    return `
      <section class="store-featured">
        <h2>Featured Games</h2>
        <div class="featured-grid" id="featured-grid"></div>
      </section>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.element.innerHTML = this.render();

    try {
      // Load featured games, genres, and initial browse results in parallel
      const [featuredResult, genresResult, browseResult] = await Promise.all([
        storeApi.getFeatured(6),
        storeApi.getGenres(),
        storeApi.browse({ limit: this.limit, sort: this.sortBy, order: 'desc' }),
      ]);

      this.featuredGames = featuredResult.games || [];
      this.genres = genresResult.genres || [];
      this.games = browseResult.games || [];
      this.total = browseResult.total || 0;

      this.loading = false;
      this.element.innerHTML = this.render();
      this.renderGameCards();
      this.setupEventListeners();
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

  private renderGameCards(): void {
    // Render featured games
    const featuredGrid = this.$('#featured-grid');
    if (featuredGrid && this.featuredGames.length > 0) {
      featuredGrid.innerHTML = '';
      for (const game of this.featuredGames) {
        const card = new GameCard({
          game,
          onClick: (g) => this.navigate(`/game/${g.id}`),
        });
        featuredGrid.appendChild(card.getElement());
      }
    }

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

  private setupEventListeners(): void {
    // Search input
    const searchInput = this.$('#store-search') as HTMLInputElement;
    if (searchInput) {
      let debounceTimer: number;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
          this.searchQuery = searchInput.value;
          this.offset = 0;
          this.browseGames();
        }, 300);
      });
    }

    // Genre filter
    const genreFilter = this.$('#genre-filter') as HTMLSelectElement;
    if (genreFilter) {
      genreFilter.addEventListener('change', () => {
        this.selectedGenre = genreFilter.value;
        this.offset = 0;
        this.browseGames();
      });
    }

    // Sort filter
    const sortFilter = this.$('#sort-filter') as HTMLSelectElement;
    if (sortFilter) {
      sortFilter.addEventListener('change', () => {
        this.sortBy = sortFilter.value as typeof this.sortBy;
        this.offset = 0;
        this.browseGames();
      });
    }

    // Load more button
    const loadMoreBtn = this.$('#load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.offset += this.limit;
        this.browseGames(true);
      });
    }
  }

  private async browseGames(append = false): Promise<void> {
    try {
      const result = await storeApi.browse({
        q: this.searchQuery || undefined,
        genre: this.selectedGenre || undefined,
        tag: this.selectedTag || undefined,
        sort: this.sortBy,
        order: 'desc',
        limit: this.limit,
        offset: this.offset,
      });

      if (append) {
        this.games = [...this.games, ...(result.games || [])];
      } else {
        this.games = result.games || [];
      }
      this.total = result.total || 0;

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

      // Update load more button
      const loadMoreSection = this.$('.load-more');
      if (loadMoreSection) {
        if (this.total > this.offset + this.limit) {
          loadMoreSection.innerHTML = `
            <button id="load-more-btn" class="btn btn-secondary">
              Load More (${this.total - this.offset - this.limit} remaining)
            </button>
          `;
          const newBtn = this.$('#load-more-btn');
          if (newBtn) {
            newBtn.addEventListener('click', () => {
              this.offset += this.limit;
              this.browseGames(true);
            });
          }
        } else {
          loadMoreSection.remove();
        }
      }
    } catch (error) {
      console.error('Failed to browse games:', error);
    }
  }
}
