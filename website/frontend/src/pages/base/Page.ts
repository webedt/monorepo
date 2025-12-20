/**
 * Base Page Component
 * Extended by all page components
 */

import { authStore } from '../../stores/authStore';

export interface PageOptions {
  params?: Record<string, string>;
  query?: URLSearchParams;
}

export abstract class Page<T extends PageOptions = PageOptions> {
  protected element: HTMLElement;
  protected options: T;
  private eventListeners: Array<{ el: Element; type: string; handler: EventListener }> = [];

  /** Route pattern (e.g., '/chat/:id') */
  abstract readonly route: string;

  /** Page title */
  abstract readonly title: string;

  /** Whether this page requires authentication */
  protected requiresAuth = false;

  /** Whether this page requires admin access */
  protected requiresAdmin = false;

  constructor(options?: T) {
    this.options = (options || {}) as T;
    this.element = document.createElement('div');
    this.element.className = 'page';
    this.element.innerHTML = this.render();
  }

  /**
   * Render the page HTML
   */
  protected abstract render(): string;

  /**
   * Check if user can access this page
   */
  canAccess(): boolean {
    if (this.requiresAuth && !authStore.isAuthenticated()) {
      return false;
    }

    if (this.requiresAdmin) {
      const user = authStore.getUser();
      if (!user?.isAdmin) {
        return false;
      }
    }

    return true;
  }

  /**
   * Mount the page to a container
   */
  mount(container: HTMLElement): void {
    container.appendChild(this.element);
    this.onMount();
  }

  /**
   * Unmount the page
   */
  unmount(): void {
    this.onUnmount();
    // Clean up event listeners
    for (const { el, type, handler } of this.eventListeners) {
      el.removeEventListener(type, handler);
    }
    this.eventListeners = [];
    this.element.remove();
  }

  /**
   * Called after mount
   */
  protected onMount(): void {
    this.setTitle(this.title);
  }

  /**
   * Called before unmount
   */
  protected onUnmount(): void {
    // Override in subclasses
  }

  /**
   * Called when navigating to this page
   * Override to load data
   */
  async load(): Promise<void> {
    // Override in subclasses
  }

  /**
   * Update page content
   */
  update(newOptions: Partial<T>): void {
    this.options = { ...this.options, ...newOptions };
    this.element.innerHTML = this.render();
    this.onMount();
  }

  /**
   * Get element
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Query selector helper
   */
  protected $(selector: string): Element | null {
    return this.element.querySelector(selector);
  }

  /**
   * Query selector all helper
   */
  protected $$(selector: string): NodeListOf<Element> {
    return this.element.querySelectorAll(selector);
  }

  /**
   * Add event listener with cleanup tracking
   */
  protected on(selector: string, type: string, handler: EventListener): void {
    const el = this.$(selector);
    if (el) {
      el.addEventListener(type, handler);
      this.eventListeners.push({ el, type, handler });
    }
  }

  /**
   * Get route params
   */
  protected getParams(): Record<string, string> {
    return this.options.params || {};
  }

  /**
   * Get query params
   */
  protected getQuery(): URLSearchParams {
    return this.options.query || new URLSearchParams();
  }

  /**
   * Navigate to a different route
   */
  protected navigate(path: string, options?: { replace?: boolean }): void {
    if (options?.replace) {
      window.location.replace(`#${path}`);
    } else {
      window.location.hash = path;
    }
  }

  /**
   * Set page title
   */
  protected setTitle(title: string): void {
    document.title = title ? `${title} | WebEDT` : 'WebEDT';
  }

  /**
   * Escape HTML
   */
  protected escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
