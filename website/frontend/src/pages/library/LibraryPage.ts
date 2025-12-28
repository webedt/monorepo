/**
 * Library Page
 * Manage user's game collection
 */

import { Page } from '../base/Page';
import { libraryApi } from '../../lib/api';
import { GameCard } from '../../components';
import { InfiniteScroll } from '../../lib/infiniteScroll';
import type { LibraryItem } from '../../types';
import './library.css';

export class LibraryPage extends Page {
  readonly route = '/library';
  readonly title = 'My Library';
  protected requiresAuth = true;

  private items: LibraryItem[] = [];
  private loading = true;
  private sortBy: 'acquiredAt' | 'title' | 'lastPlayed' | 'playtime' = 'acquiredAt';
  private filterFavorites = false;
  private filterInstalled = false;
  private stats: {
    totalGames: number;
    installedGames: number;
    favoriteGames: number;
    totalPlaytimeHours: number;
  } | null = null;
  private total = 0;
  private offset = 0;
  private limit = 24;
  private loadingMore = false;
  private infiniteScroll: InfiniteScroll | null = null;

  protected render(): string {
    if (this.loading) {
      return `
        <div class="library-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading your library...</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="library-page">
        <header class="library-header">
          <div class="header-content">
            <h1>My Library</h1>
            ${this.stats ? `
              <div class="library-stats">
                <span class="stat">${this.stats.totalGames} games</span>
                <span class="stat">${this.stats.installedGames} installed</span>
                <span class="stat">${this.stats.totalPlaytimeHours}h played</span>
              </div>
            ` : ''}
          </div>
        </header>

        <div class="library-filters">
          <div class="filter-group">
            <label>
              <input type="checkbox" id="filter-favorites" ${this.filterFavorites ? 'checked' : ''} />
              Favorites only
            </label>
            <label>
              <input type="checkbox" id="filter-installed" ${this.filterInstalled ? 'checked' : ''} />
              Installed only
            </label>
          </div>

          <select id="sort-select">
            <option value="acquiredAt" ${this.sortBy === 'acquiredAt' ? 'selected' : ''}>Recently Added</option>
            <option value="lastPlayed" ${this.sortBy === 'lastPlayed' ? 'selected' : ''}>Recently Played</option>
            <option value="title" ${this.sortBy === 'title' ? 'selected' : ''}>Title</option>
            <option value="playtime" ${this.sortBy === 'playtime' ? 'selected' : ''}>Playtime</option>
          </select>
        </div>

        <div class="library-content">
          ${this.items.length === 0 ? `
            <div class="empty-state">
              <h2>Your library is empty</h2>
              <p>Browse the store to find games to add to your library</p>
              <a href="#/store" class="btn btn-primary">Browse Store</a>
            </div>
          ` : `
            <div class="library-grid" id="library-grid"></div>
          `}
          <div id="infinite-scroll-container"></div>
        </div>
      </div>
    `;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.offset = 0;
    this.element.innerHTML = this.render();

    try {
      // Load library items and stats in parallel
      const [libraryResult, statsResult] = await Promise.all([
        libraryApi.getLibrary({
          sort: this.sortBy,
          order: this.sortBy === 'title' ? 'asc' : 'desc',
          favorite: this.filterFavorites || undefined,
          installed: this.filterInstalled || undefined,
          limit: this.limit,
          offset: this.offset,
        }),
        libraryApi.getStats(),
      ]);

      this.items = libraryResult.items || [];
      this.total = libraryResult.total || 0;
      this.stats = statsResult;

      this.loading = false;
      this.element.innerHTML = this.render();
      this.renderGameCards();
      this.setupEventListeners();
      this.setupInfiniteScroll();
    } catch (error) {
      console.error('Failed to load library:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="library-page">
          <div class="error-state">
            <h2>Failed to load library</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private renderGameCards(): void {
    const grid = this.$('#library-grid');
    if (!grid || this.items.length === 0) return;

    grid.innerHTML = '';

    for (const item of this.items) {
      if (!item.game) continue;
      const cardWrapper = this.createLibraryItemElement(item);
      grid.appendChild(cardWrapper);
    }
  }

  private setupEventListeners(): void {
    // Favorites filter
    const favoritesCheckbox = this.$('#filter-favorites') as HTMLInputElement;
    if (favoritesCheckbox) {
      favoritesCheckbox.addEventListener('change', () => {
        this.filterFavorites = favoritesCheckbox.checked;
        this.refreshLibrary();
      });
    }

    // Installed filter
    const installedCheckbox = this.$('#filter-installed') as HTMLInputElement;
    if (installedCheckbox) {
      installedCheckbox.addEventListener('change', () => {
        this.filterInstalled = installedCheckbox.checked;
        this.refreshLibrary();
      });
    }

    // Sort select
    const sortSelect = this.$('#sort-select') as HTMLSelectElement;
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.sortBy = sortSelect.value as typeof this.sortBy;
        this.refreshLibrary();
      });
    }

    // Action buttons
    const actionButtons = this.$$('.action-btn');
    actionButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        const gameId = (btn as HTMLElement).dataset.gameId;
        if (action && gameId) {
          this.handleAction(action, gameId);
        }
      });
    });
  }

  private async handleAction(action: string, gameId: string): Promise<void> {
    try {
      switch (action) {
        case 'favorite':
          await libraryApi.toggleFavorite(gameId);
          this.refreshLibrary();
          break;
        case 'play':
          // Simulate launching the game
          console.log('Launching game:', gameId);
          alert('Game launch feature coming soon!');
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
    }
  }

  private async refreshLibrary(): Promise<void> {
    this.offset = 0;
    try {
      const result = await libraryApi.getLibrary({
        sort: this.sortBy,
        order: this.sortBy === 'title' ? 'asc' : 'desc',
        favorite: this.filterFavorites || undefined,
        installed: this.filterInstalled || undefined,
        limit: this.limit,
        offset: this.offset,
      });

      this.items = result.items || [];
      this.total = result.total || 0;
      this.renderGameCards();
      this.infiniteScroll?.reset();
    } catch (error) {
      console.error('Failed to refresh library:', error);
    }
  }

  private async loadMoreItems(): Promise<void> {
    this.loadingMore = true;
    try {
      const result = await libraryApi.getLibrary({
        sort: this.sortBy,
        order: this.sortBy === 'title' ? 'asc' : 'desc',
        favorite: this.filterFavorites || undefined,
        installed: this.filterInstalled || undefined,
        limit: this.limit,
        offset: this.offset,
      });

      const newItems = result.items || [];
      this.items = [...this.items, ...newItems];
      this.total = result.total || 0;

      // Append new items to the grid
      const grid = this.$('#library-grid');
      if (grid) {
        for (const item of newItems) {
          if (!item.game) continue;
          const cardWrapper = this.createLibraryItemElement(item);
          grid.appendChild(cardWrapper);
        }
        this.setupActionListeners();
      }

      this.infiniteScroll?.updateSentinelState();
    } catch (error) {
      console.error('Failed to load more items:', error);
      // Roll back offset on error so retry works correctly
      this.offset -= this.limit;
    } finally {
      this.loadingMore = false;
    }
  }

  private createLibraryItemElement(item: LibraryItem): HTMLElement {
    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'library-item';

    // Create game card
    const card = new GameCard({
      game: item.game!,
      showPrice: false,
      onClick: () => this.navigate(`/game/${item.game!.id}`),
    });

    cardWrapper.appendChild(card.getElement());

    // Add library-specific info
    const itemInfo = document.createElement('div');
    itemInfo.className = 'library-item-info';
    itemInfo.innerHTML = `
      <div class="item-stats">
        ${item.playtimeMinutes > 0 ? `
          <span class="playtime">${this.formatPlaytime(item.playtimeMinutes)}</span>
        ` : ''}
        ${item.lastPlayedAt ? `
          <span class="last-played">Last played: ${this.formatDate(item.lastPlayedAt)}</span>
        ` : ''}
      </div>
      <div class="item-actions">
        <button class="action-btn ${item.favorite ? 'active' : ''}" data-action="favorite" data-game-id="${item.gameId}" title="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">
          ${item.favorite ? '★' : '☆'}
        </button>
        <button class="action-btn" data-action="play" data-game-id="${item.gameId}" title="Play">
          ▶
        </button>
      </div>
    `;

    cardWrapper.appendChild(itemInfo);
    return cardWrapper;
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
        await this.loadMoreItems();
      },
      hasMore: () => this.total > this.offset + this.limit,
      isLoading: () => this.loadingMore,
    });

    const sentinel = this.infiniteScroll.createSentinel();
    container.appendChild(sentinel);
    this.infiniteScroll.attach(sentinel);
  }

  private setupActionListeners(): void {
    const actionButtons = this.$$('.action-btn');
    actionButtons.forEach((btn) => {
      // Clone to remove existing listeners
      const newBtn = btn.cloneNode(true);
      btn.parentNode?.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (newBtn as HTMLElement).dataset.action;
        const gameId = (newBtn as HTMLElement).dataset.gameId;
        if (action && gameId) {
          this.handleAction(action, gameId);
        }
      });
    });
  }

  protected onUnmount(): void {
    if (this.infiniteScroll) {
      this.infiniteScroll.destroy();
      this.infiniteScroll = null;
    }
  }

  private formatPlaytime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  private formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }
}
