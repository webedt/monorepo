/**
 * Favorites Widget
 * Displays user's favorite library items for quick access
 */

import { Widget } from './Widget';
import { Icon } from '../icon';
import { libraryApi } from '../../lib/api';

import type { WidgetOptions } from './types';
import type { LibraryItem } from '../../types';

export interface FavoritesWidgetOptions extends WidgetOptions {
  maxItems?: number;
}

export class FavoritesWidget extends Widget {
  private maxItems: number;
  private favorites: LibraryItem[] = [];
  private loading = false;
  private error: string | null = null;

  constructor(options: FavoritesWidgetOptions) {
    super(options);
    this.addClass('widget--favorites');
    this.maxItems = options.maxItems ?? 6;
  }

  async renderContent(): Promise<void> {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    if (this.loading) {
      this.renderLoading(body);
      return;
    }

    if (this.error) {
      this.renderError(body);
      return;
    }

    if (this.favorites.length === 0) {
      this.renderEmpty(body);
      return;
    }

    this.renderFavorites(body);
  }

  private renderLoading(container: HTMLElement): void {
    const loading = document.createElement('div');
    loading.className = 'favorites-loading';
    loading.innerHTML = '<div class="favorites-spinner"></div><span>Loading favorites...</span>';
    container.appendChild(loading);
  }

  private renderError(container: HTMLElement): void {
    const errorEl = document.createElement('div');
    errorEl.className = 'favorites-error';
    errorEl.textContent = this.error || 'Failed to load favorites';
    container.appendChild(errorEl);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'favorites-retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.onclick = () => this.loadFavorites();
    container.appendChild(retryBtn);
  }

  private renderEmpty(container: HTMLElement): void {
    const empty = document.createElement('div');
    empty.className = 'favorites-empty';

    const icon = new Icon('star', { size: 'lg' });
    empty.appendChild(icon.getElement());

    const text = document.createElement('p');
    text.textContent = 'No favorites yet';
    empty.appendChild(text);

    const hint = document.createElement('span');
    hint.className = 'favorites-empty-hint';
    hint.textContent = 'Star games in your library to see them here';
    empty.appendChild(hint);

    container.appendChild(empty);
  }

  private renderFavorites(container: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'favorites-grid';

    for (const item of this.favorites.slice(0, this.maxItems)) {
      const card = this.createFavoriteCard(item);
      grid.appendChild(card);
    }

    container.appendChild(grid);

    // Add "View All" footer if there are more favorites
    if (this.favorites.length > 0) {
      const footer = this.addFooter();
      footer.innerHTML = '';

      const viewAllLink = document.createElement('a');
      viewAllLink.className = 'favorites-view-all';
      viewAllLink.href = '#/library?favorite=true';
      viewAllLink.textContent = `View all favorites`;

      const icon = new Icon('arrowRight', { size: 'sm' });
      viewAllLink.appendChild(icon.getElement());

      footer.appendChild(viewAllLink);
    }
  }

  private createFavoriteCard(item: LibraryItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'favorite-card';
    card.onclick = () => {
      window.location.hash = `/game/${item.gameId}`;
    };

    // Cover image
    const coverContainer = document.createElement('div');
    coverContainer.className = 'favorite-card-cover';

    if (item.game?.coverImage) {
      const img = document.createElement('img');
      img.src = item.game.coverImage;
      img.alt = item.game.title || 'Game cover';
      img.loading = 'lazy';
      coverContainer.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'favorite-card-placeholder';
      const icon = new Icon('gamepad', { size: 'md' });
      placeholder.appendChild(icon.getElement());
      coverContainer.appendChild(placeholder);
    }

    // Favorite star indicator
    const starIndicator = document.createElement('div');
    starIndicator.className = 'favorite-card-star';
    const starIcon = new Icon('star', { size: 'sm' });
    starIndicator.appendChild(starIcon.getElement());
    coverContainer.appendChild(starIndicator);

    card.appendChild(coverContainer);

    // Title
    const title = document.createElement('div');
    title.className = 'favorite-card-title';
    title.textContent = item.game?.title || 'Unknown Game';
    title.title = item.game?.title || 'Unknown Game';
    card.appendChild(title);

    // Playtime info
    if (item.playtimeMinutes > 0) {
      const playtime = document.createElement('div');
      playtime.className = 'favorite-card-playtime';
      playtime.textContent = this.formatPlaytime(item.playtimeMinutes);
      card.appendChild(playtime);
    }

    return card;
  }

  private formatPlaytime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m played`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours}h played`;
    }
    return `${hours}h ${mins}m played`;
  }

  private async loadFavorites(): Promise<void> {
    this.loading = true;
    this.error = null;
    await this.renderContent();

    try {
      const response = await libraryApi.getLibrary({
        favorite: true,
        sort: 'lastPlayed',
        order: 'desc',
        limit: this.maxItems,
      });
      this.favorites = response.items;
    } catch (err) {
      console.error('[FavoritesWidget] Failed to load favorites:', err);
      this.error = err instanceof Error ? err.message : 'Failed to load favorites';
    } finally {
      this.loading = false;
      await this.renderContent();
    }
  }

  protected onMount(): void {
    super.onMount();
    this.loadFavorites();
  }

  /**
   * Refresh favorites data
   */
  async refresh(): Promise<void> {
    await this.loadFavorites();
  }

  /**
   * Set maximum items to display
   */
  setMaxItems(count: number): void {
    this.maxItems = count;
    this.renderContent();
  }
}
