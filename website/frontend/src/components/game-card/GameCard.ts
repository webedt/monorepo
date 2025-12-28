import { Component, ComponentOptions } from '../base';
import type { Game } from '../../types';
import './game-card.css';

export interface GameCardOptions extends ComponentOptions {
  game: Game;
  onClick?: (game: Game) => void;
  showPrice?: boolean;
  showRating?: boolean;
  compact?: boolean;
}

export class GameCard extends Component<HTMLDivElement> {
  private game: Game;
  private options: GameCardOptions;

  constructor(options: GameCardOptions) {
    super('div', {
      className: 'game-card',
      ...options,
    });

    this.game = options.game;
    this.options = options;

    if (options.compact) {
      this.addClass('game-card--compact');
    }

    this.buildContent();

    if (options.onClick) {
      this.addClass('game-card--interactive');
      this.on('click', () => options.onClick!(this.game));
      this.setAttribute('role', 'button');
      this.setAttribute('tabindex', '0');
      this.on('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          options.onClick!(this.game);
        }
      });
    }
  }

  private buildContent(): void {
    const { game, options } = this;

    // Cover image
    const coverWrapper = document.createElement('div');
    coverWrapper.className = 'game-card__cover';

    if (game.coverImage) {
      const img = document.createElement('img');
      img.src = game.coverImage;
      img.alt = game.title;
      img.loading = 'lazy';
      coverWrapper.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'game-card__cover-placeholder';
      placeholder.textContent = game.title.charAt(0).toUpperCase();
      coverWrapper.appendChild(placeholder);
    }

    // Featured badge
    if (game.featured) {
      const badge = document.createElement('span');
      badge.className = 'game-card__badge game-card__badge--featured';
      badge.textContent = 'Featured';
      coverWrapper.appendChild(badge);
    }

    this.element.appendChild(coverWrapper);

    // Info section
    const info = document.createElement('div');
    info.className = 'game-card__info';

    // Title
    const title = document.createElement('h3');
    title.className = 'game-card__title';
    title.textContent = game.title;
    info.appendChild(title);

    // Developer/Publisher
    if (game.developer) {
      const developer = document.createElement('p');
      developer.className = 'game-card__developer';
      developer.textContent = game.developer;
      info.appendChild(developer);
    }

    // Meta row (genres, rating)
    const meta = document.createElement('div');
    meta.className = 'game-card__meta';

    if (game.genres && game.genres.length > 0 && !options.compact) {
      const genres = document.createElement('span');
      genres.className = 'game-card__genres';
      genres.textContent = game.genres.slice(0, 2).join(', ');
      meta.appendChild(genres);
    }

    if (options.showRating !== false && game.averageScore !== undefined && game.averageScore !== null) {
      const rating = document.createElement('span');
      rating.className = 'game-card__rating';
      const stars = Math.round(game.averageScore / 20); // Convert 0-100 to 1-5
      rating.innerHTML = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`;
      rating.title = `${game.averageScore}% positive (${game.reviewCount} reviews)`;
      meta.appendChild(rating);
    }

    if (meta.children.length > 0) {
      info.appendChild(meta);
    }

    this.element.appendChild(info);

    // Price section
    if (options.showPrice !== false) {
      const priceSection = document.createElement('div');
      priceSection.className = 'game-card__price';

      if (game.price === 0) {
        priceSection.textContent = 'Free';
        priceSection.classList.add('game-card__price--free');
      } else {
        priceSection.textContent = this.formatPrice(game.price, game.currency);
      }

      this.element.appendChild(priceSection);
    }
  }

  private formatPrice(cents: number, currency: string): string {
    const amount = cents / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  }

  getGame(): Game {
    return this.game;
  }
}
