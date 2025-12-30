/**
 * Base Page Component
 * Extended by all page components
 */

import { authStore } from '../../stores/authStore';
import { registerPage, unregisterPage } from '../../lib/hmr';
import { ListenerRegistry } from '../../lib/listenerRegistry';

export interface PageOptions {
  params?: Record<string, string>;
  query?: URLSearchParams;
}

export abstract class Page<T extends PageOptions = PageOptions> {
  protected element: HTMLElement;
  protected options: T;
  private eventListeners: Array<{ el: Element; type: string; handler: EventListener }> = [];
  private hmrId: string;

  /**
   * Registry for tracking event listeners with automatic cleanup.
   * Use this.listeners.add() to register listeners that will be
   * automatically removed when the page is unmounted.
   */
  protected readonly listeners: ListenerRegistry = new ListenerRegistry();

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
    this.hmrId = `page:${this.constructor.name}`;
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

    // Register for HMR page tracking
    registerPage(this.hmrId, container, () => this.refreshForHmr());
  }

  /**
   * Unmount the page
   */
  unmount(): void {
    this.onUnmount();

    // Clean up all listeners registered via the ListenerRegistry
    this.listeners.removeAll();

    // Clean up legacy event listeners (for backward compatibility)
    for (const { el, type, handler } of this.eventListeners) {
      el.removeEventListener(type, handler);
    }
    this.eventListeners = [];

    // Unregister from HMR
    unregisterPage(this.hmrId);

    this.element.remove();
  }

  /**
   * Refresh the page for HMR (re-render without full reload)
   */
  refreshForHmr(): void {
    // Save scroll position
    const scrollTop = this.element.scrollTop;
    const scrollLeft = this.element.scrollLeft;

    // Clean up all listeners registered via the ListenerRegistry
    this.listeners.removeAll();

    // Clean up legacy event listeners
    for (const { el, type, handler } of this.eventListeners) {
      el.removeEventListener(type, handler);
    }
    this.eventListeners = [];

    // Re-render
    this.element.innerHTML = this.render();
    this.onMount();

    // Restore scroll position
    this.element.scrollTop = scrollTop;
    this.element.scrollLeft = scrollLeft;

    console.log(`[HMR] Page refreshed: ${this.constructor.name}`);
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
   * Add event listener with cleanup tracking (legacy method for backward compatibility).
   * Prefer using this.listeners.add() or this.addListener() for new code.
   */
  protected on(selector: string, type: string, handler: EventListener): void {
    const el = this.$(selector);
    if (el) {
      el.addEventListener(type, handler);
      this.eventListeners.push({ el, type, handler });
    }
  }

  /**
   * Add an event listener to any EventTarget with automatic cleanup.
   * This is the recommended method for adding event listeners in pages.
   *
   * @example
   * // Listen to window events
   * this.addListener(window, 'resize', this.handleResize.bind(this));
   *
   * // Listen to document events
   * this.addListener(document, 'keydown', this.handleKeydown.bind(this));
   *
   * // Listen to element events
   * const button = this.$('.my-button');
   * if (button) this.addListener(button, 'click', this.handleClick.bind(this));
   */
  protected addListener(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): void {
    this.listeners.add(target, type, handler, options);
  }

  /**
   * Add event listeners to an element found by selector.
   * Returns true if element was found and listener was added.
   */
  protected addListenerBySelector(
    selector: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): boolean {
    return this.listeners.addBySelector(this.element, selector, type, handler, options);
  }

  /**
   * Add event listeners to all elements matching a selector.
   * Returns the number of listeners added.
   */
  protected addListenerToAll(
    selector: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): number {
    return this.listeners.addAllBySelector(this.element, selector, type, handler, options);
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

// HMR setup for Page base class
if (import.meta.hot) {
  import.meta.hot.accept();
}
