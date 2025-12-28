/**
 * Infinite Scroll Utility
 *
 * Uses IntersectionObserver to detect when a sentinel element becomes visible
 * and triggers loading more content automatically as the user scrolls.
 */

export interface InfiniteScrollOptions {
  /** Root element for the intersection observer (default: viewport) */
  root?: Element | null;
  /** Margin around the root (default: '100px') - triggers load before reaching end */
  rootMargin?: string;
  /** Visibility threshold (default: 0.1) */
  threshold?: number;
  /** Callback when more content should be loaded */
  onLoadMore: () => Promise<void>;
  /** Whether there is more content to load */
  hasMore: () => boolean;
  /** Whether loading is in progress */
  isLoading: () => boolean;
}

export class InfiniteScroll {
  private observer: IntersectionObserver | null = null;
  private sentinel: HTMLElement | null = null;
  private options: InfiniteScrollOptions;
  private isDestroyed = false;

  constructor(options: InfiniteScrollOptions) {
    this.options = {
      root: null,
      rootMargin: '100px',
      threshold: 0.1,
      ...options,
    };
  }

  /**
   * Create the sentinel element with loading indicator
   */
  createSentinel(): HTMLElement {
    const sentinel = document.createElement('div');
    sentinel.className = 'infinite-scroll-sentinel';
    sentinel.innerHTML = `
      <div class="infinite-scroll-loader" style="display: none;">
        <div class="spinner"></div>
        <span>Loading more...</span>
      </div>
      <div class="infinite-scroll-end" style="display: none;">
        <span>No more items</span>
      </div>
    `;

    // Add default styles if not already present
    this.injectStyles();

    this.sentinel = sentinel;
    return sentinel;
  }

  /**
   * Attach the observer to the sentinel element
   * Call this after the sentinel is added to the DOM
   */
  attach(sentinel?: HTMLElement): void {
    if (this.isDestroyed) return;

    const targetSentinel = sentinel || this.sentinel;
    if (!targetSentinel) {
      console.warn('InfiniteScroll: No sentinel element to observe');
      return;
    }

    this.sentinel = targetSentinel;

    // Create the observer
    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      {
        root: this.options.root,
        rootMargin: this.options.rootMargin,
        threshold: this.options.threshold,
      }
    );

    this.observer.observe(this.sentinel);
    this.updateSentinelState();
  }

  /**
   * Handle intersection events
   */
  private async handleIntersection(entries: IntersectionObserverEntry[]): Promise<void> {
    const entry = entries[0];

    if (!entry?.isIntersecting) return;
    if (this.isDestroyed) return;
    if (this.options.isLoading()) return;
    if (!this.options.hasMore()) return;

    this.showLoader();

    try {
      await this.options.onLoadMore();
    } catch (error) {
      console.error('InfiniteScroll: Error loading more content:', error);
    } finally {
      if (!this.isDestroyed) {
        this.updateSentinelState();
      }
    }
  }

  /**
   * Show loading indicator
   */
  private showLoader(): void {
    if (!this.sentinel) return;
    const loader = this.sentinel.querySelector('.infinite-scroll-loader') as HTMLElement;
    const end = this.sentinel.querySelector('.infinite-scroll-end') as HTMLElement;
    if (loader) loader.style.display = 'flex';
    if (end) end.style.display = 'none';
  }

  /**
   * Update sentinel state based on hasMore
   */
  updateSentinelState(): void {
    if (!this.sentinel) return;

    const loader = this.sentinel.querySelector('.infinite-scroll-loader') as HTMLElement;
    const end = this.sentinel.querySelector('.infinite-scroll-end') as HTMLElement;

    if (this.options.isLoading()) {
      if (loader) loader.style.display = 'flex';
      if (end) end.style.display = 'none';
    } else if (this.options.hasMore()) {
      if (loader) loader.style.display = 'none';
      if (end) end.style.display = 'none';
    } else {
      if (loader) loader.style.display = 'none';
      if (end) end.style.display = 'flex';
    }
  }

  /**
   * Manually trigger a check (useful after content updates)
   */
  check(): void {
    if (this.sentinel && this.observer) {
      // Disconnect and reconnect to trigger a fresh check
      this.observer.unobserve(this.sentinel);
      this.observer.observe(this.sentinel);
    }
    this.updateSentinelState();
  }

  /**
   * Reset the infinite scroll state (e.g., when filters change)
   */
  reset(): void {
    this.updateSentinelState();
    this.check();
  }

  /**
   * Destroy the observer and clean up
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.sentinel) {
      this.sentinel.remove();
      this.sentinel = null;
    }
  }

  /**
   * Inject default styles for the infinite scroll components
   */
  private injectStyles(): void {
    const styleId = 'infinite-scroll-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .infinite-scroll-sentinel {
        width: 100%;
        padding: 1rem;
        min-height: 60px;
      }

      .infinite-scroll-loader,
      .infinite-scroll-end {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        color: var(--color-text-secondary, #888);
        font-size: 0.875rem;
      }

      .infinite-scroll-loader .spinner {
        width: 20px;
        height: 20px;
        border: 2px solid var(--color-border, #ddd);
        border-top-color: var(--color-primary, #007bff);
        border-radius: 50%;
        animation: infinite-scroll-spin 0.8s linear infinite;
      }

      @keyframes infinite-scroll-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .infinite-scroll-end {
        padding: 1rem 0;
      }
    `;
    document.head.appendChild(style);
  }
}
