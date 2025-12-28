import { Component, ComponentOptions } from '../base';
import { GameCard } from '../game-card';
import type { Game, StoreHighlights as StoreHighlightsData } from '../../types';
import './store-highlights.css';

export interface StoreHighlightsOptions extends ComponentOptions {
  highlights: StoreHighlightsData;
  onGameClick?: (game: Game) => void;
  featuredTitle?: string;
  newTitle?: string;
  compact?: boolean;
}

export class StoreHighlights extends Component<HTMLDivElement> {
  private highlights: StoreHighlightsData;
  private options: StoreHighlightsOptions;

  constructor(options: StoreHighlightsOptions) {
    super('div', {
      className: 'store-highlights',
      ...options,
    });

    this.highlights = options.highlights;
    this.options = options;

    if (options.compact) {
      this.addClass('store-highlights--compact');
    }

    this.buildContent();
  }

  private buildContent(): void {
    const { highlights, options } = this;

    if (!highlights.hasHighlights) {
      return;
    }

    // Featured section
    if (highlights.featured.length > 0) {
      const featuredSection = document.createElement('section');
      featuredSection.className = 'store-highlights__section store-highlights__featured';

      const featuredHeader = document.createElement('div');
      featuredHeader.className = 'store-highlights__header';

      const featuredTitle = document.createElement('h2');
      featuredTitle.className = 'store-highlights__title';
      featuredTitle.textContent = options.featuredTitle || 'Featured';

      const featuredBadge = document.createElement('span');
      featuredBadge.className = 'store-highlights__badge store-highlights__badge--featured';
      featuredBadge.textContent = `${highlights.featured.length} items`;

      featuredHeader.appendChild(featuredTitle);
      featuredHeader.appendChild(featuredBadge);
      featuredSection.appendChild(featuredHeader);

      const featuredGrid = document.createElement('div');
      featuredGrid.className = 'store-highlights__grid store-highlights__grid--featured';

      for (const game of highlights.featured) {
        const card = new GameCard({
          game,
          onClick: options.onGameClick,
          compact: options.compact,
        });
        featuredGrid.appendChild(card.getElement());
      }

      featuredSection.appendChild(featuredGrid);
      this.element.appendChild(featuredSection);
    }

    // New Releases section
    if (highlights.new.length > 0) {
      const newSection = document.createElement('section');
      newSection.className = 'store-highlights__section store-highlights__new';

      const newHeader = document.createElement('div');
      newHeader.className = 'store-highlights__header';

      const newTitle = document.createElement('h2');
      newTitle.className = 'store-highlights__title';
      newTitle.textContent = options.newTitle || 'New Releases';

      const newBadge = document.createElement('span');
      newBadge.className = 'store-highlights__badge store-highlights__badge--new';
      newBadge.textContent = `${highlights.new.length} items`;

      newHeader.appendChild(newTitle);
      newHeader.appendChild(newBadge);
      newSection.appendChild(newHeader);

      const newGrid = document.createElement('div');
      newGrid.className = 'store-highlights__grid store-highlights__grid--new';

      for (const game of highlights.new) {
        const card = new GameCard({
          game,
          onClick: options.onGameClick,
          compact: options.compact,
        });
        newGrid.appendChild(card.getElement());
      }

      newSection.appendChild(newGrid);
      this.element.appendChild(newSection);
    }
  }

  getHighlights(): StoreHighlightsData {
    return this.highlights;
  }

  hasHighlights(): boolean {
    return this.highlights.hasHighlights;
  }

  update(highlights: StoreHighlightsData): void {
    this.highlights = highlights;
    this.element.innerHTML = '';
    this.buildContent();
  }
}
