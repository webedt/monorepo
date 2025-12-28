/**
 * Game Detail Page
 * View game details and purchase
 */

import { Page } from '../base/Page';
import { storeApi, purchasesApi, communityApi } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import type { Game, CommunityPost } from '../../types';
import './game-detail.css';

export class GameDetailPage extends Page {
  readonly route = '/game/:id';
  readonly title = 'Game Details';

  private game: Game | null = null;
  private owned = false;
  private inWishlist = false;
  private reviews: CommunityPost[] = [];
  private loading = true;
  private purchasing = false;

  protected render(): string {
    if (this.loading) {
      return `
        <div class="game-detail-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading game details...</p>
          </div>
        </div>
      `;
    }

    if (!this.game) {
      return `
        <div class="game-detail-page">
          <div class="error-state">
            <h2>Game not found</h2>
            <p>The game you're looking for doesn't exist</p>
            <button id="back-to-store">Back to Store</button>
          </div>
        </div>
      `;
    }

    const game = this.game;

    return `
      <div class="game-detail-page">
        <nav class="breadcrumb">
          <a href="#/store">Store</a>
          <span>/</span>
          <span>${this.escapeHtml(game.title)}</span>
        </nav>

        <div class="game-hero">
          <div class="game-media">
            ${game.coverImage ? `
              <img src="${game.coverImage}" alt="${this.escapeHtml(game.title)}" class="game-cover" />
            ` : `
              <div class="game-cover-placeholder">${game.title.charAt(0)}</div>
            `}
            ${this.renderScreenshots()}
          </div>

          <div class="game-info">
            <h1 class="game-title">${this.escapeHtml(game.title)}</h1>

            ${game.developer ? `
              <p class="game-developer">by ${this.escapeHtml(game.developer)}</p>
            ` : ''}

            ${this.renderRating()}

            <div class="game-meta">
              ${game.genres && game.genres.length > 0 ? `
                <div class="meta-item">
                  <span class="meta-label">Genres</span>
                  <span class="meta-value">${game.genres.join(', ')}</span>
                </div>
              ` : ''}

              ${game.platforms && game.platforms.length > 0 ? `
                <div class="meta-item">
                  <span class="meta-label">Platforms</span>
                  <span class="meta-value">${game.platforms.join(', ')}</span>
                </div>
              ` : ''}

              ${game.releaseDate ? `
                <div class="meta-item">
                  <span class="meta-label">Release Date</span>
                  <span class="meta-value">${new Date(game.releaseDate).toLocaleDateString()}</span>
                </div>
              ` : ''}
            </div>

            <div class="purchase-section">
              <div class="game-price ${game.price === 0 ? 'game-price--free' : ''}">
                ${game.price === 0 ? 'Free' : this.formatPrice(game.price, game.currency)}
              </div>

              ${this.renderPurchaseButtons()}
            </div>
          </div>
        </div>

        <div class="game-content">
          <section class="game-description">
            <h2>About This Game</h2>
            <div class="description-text">
              ${game.description ? this.escapeHtml(game.description).replace(/\n/g, '<br>') : 'No description available.'}
            </div>
          </section>

          ${this.renderReviews()}
        </div>
      </div>
    `;
  }

  private renderScreenshots(): string {
    if (!this.game?.screenshots || this.game.screenshots.length === 0) return '';

    return `
      <div class="screenshots">
        ${this.game.screenshots.slice(0, 4).map((url, i) => `
          <img src="${url}" alt="Screenshot ${i + 1}" class="screenshot" loading="lazy" />
        `).join('')}
      </div>
    `;
  }

  private renderRating(): string {
    if (!this.game || this.game.averageScore === undefined || this.game.averageScore === null) {
      return '';
    }

    const stars = Math.round(this.game.averageScore / 20);
    return `
      <div class="game-rating">
        <span class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
        <span class="rating-text">${this.game.averageScore}% positive</span>
        <span class="review-count">(${this.game.reviewCount} reviews)</span>
      </div>
    `;
  }

  private renderPurchaseButtons(): string {
    const isAuthenticated = authStore.isAuthenticated();

    if (this.owned) {
      return `
        <div class="owned-badge">
          <span class="checkmark">✓</span> In Your Library
        </div>
        <a href="#/library" class="btn btn-secondary">Go to Library</a>
      `;
    }

    if (!isAuthenticated) {
      return `
        <a href="#/login" class="btn btn-primary btn-lg">Login to Purchase</a>
      `;
    }

    return `
      <button id="buy-btn" class="btn btn-primary btn-lg" ${this.purchasing ? 'disabled' : ''}>
        ${this.purchasing ? 'Processing...' : (this.game?.price === 0 ? 'Get Game' : 'Buy Now')}
      </button>
      ${this.inWishlist ? `
        <button id="wishlist-btn" class="btn btn-secondary">Remove from Wishlist</button>
      ` : `
        <button id="wishlist-btn" class="btn btn-secondary">Add to Wishlist</button>
      `}
    `;
  }

  private renderReviews(): string {
    if (this.reviews.length === 0) {
      return `
        <section class="game-reviews">
          <h2>User Reviews</h2>
          <p class="no-reviews">No reviews yet. Be the first to review this game!</p>
          ${authStore.isAuthenticated() ? `
            <a href="#/community/new?type=review&gameId=${this.game?.id}" class="btn btn-secondary">Write a Review</a>
          ` : ''}
        </section>
      `;
    }

    return `
      <section class="game-reviews">
        <h2>User Reviews</h2>
        <div class="reviews-list">
          ${this.reviews.map((review) => `
            <div class="review-card">
              <div class="review-header">
                <span class="review-author">${review.author?.displayName || 'Anonymous'}</span>
                <span class="review-rating">${'★'.repeat(review.rating || 0)}${'☆'.repeat(5 - (review.rating || 0))}</span>
                <span class="review-date">${new Date(review.createdAt).toLocaleDateString()}</span>
              </div>
              <h4 class="review-title">${this.escapeHtml(review.title)}</h4>
              <p class="review-content">${this.escapeHtml(review.content).substring(0, 300)}${review.content.length > 300 ? '...' : ''}</p>
              <div class="review-votes">
                <span>👍 ${review.upvotes}</span>
                <span>👎 ${review.downvotes}</span>
              </div>
            </div>
          `).join('')}
        </div>
        <a href="#/community?type=review&gameId=${this.game?.id}" class="btn btn-link">View All Reviews</a>
      </section>
    `;
  }

  private formatPrice(cents: number, currency: string): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(cents / 100);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.element.innerHTML = this.render();

    const gameId = this.getParams().id;
    if (!gameId) {
      this.loading = false;
      this.element.innerHTML = this.render();
      return;
    }

    try {
      // Load game details
      const gameResult = await storeApi.getGame(gameId);
      this.game = gameResult.game;

      // Check ownership and wishlist status if authenticated
      if (authStore.isAuthenticated()) {
        try {
          const ownershipResult = await storeApi.checkOwnership(gameId);
          this.owned = ownershipResult.owned;
        } catch {
          // User may not be authenticated
        }

        try {
          const wishlistResult = await storeApi.getWishlist();
          this.inWishlist = wishlistResult.items.some((item) => item.gameId === gameId);
        } catch {
          // Wishlist fetch failed
        }
      }

      // Load reviews
      try {
        const reviewsResult = await communityApi.getGameReviews(gameId, { limit: 5 });
        this.reviews = reviewsResult.reviews || [];
      } catch {
        // Reviews fetch failed
      }

      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to load game details:', error);
      this.loading = false;
      this.game = null;
      this.element.innerHTML = this.render();
    }
  }

  private setupEventListeners(): void {
    // Back to store button
    const backBtn = this.$('#back-to-store');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.navigate('/store'));
    }

    // Buy button
    const buyBtn = this.$('#buy-btn');
    if (buyBtn) {
      buyBtn.addEventListener('click', () => this.handlePurchase());
    }

    // Wishlist button
    const wishlistBtn = this.$('#wishlist-btn');
    if (wishlistBtn) {
      wishlistBtn.addEventListener('click', () => this.handleWishlistToggle());
    }
  }

  private async handlePurchase(): Promise<void> {
    if (!this.game || this.purchasing) return;

    this.purchasing = true;
    this.element.innerHTML = this.render();
    this.setupEventListeners();

    try {
      await purchasesApi.buyGame(this.game.id);
      this.owned = true;
      this.inWishlist = false;
      this.purchasing = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error: unknown) {
      console.error('Purchase failed:', error);
      this.purchasing = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();

      // Show error message
      const errorMsg = error instanceof Error ? error.message : 'Purchase failed';
      alert(errorMsg);
    }
  }

  private async handleWishlistToggle(): Promise<void> {
    if (!this.game) return;

    try {
      if (this.inWishlist) {
        await storeApi.removeFromWishlist(this.game.id);
        this.inWishlist = false;
      } else {
        await storeApi.addToWishlist(this.game.id);
        this.inWishlist = true;
      }
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Wishlist operation failed:', error);
    }
  }
}
