/**
 * Base Component Class
 *
 * A lightweight base class for creating reusable UI components.
 * Components manage their own DOM element and lifecycle.
 */

import { createHmrId, registerComponent, unregisterComponent } from '../../lib/hmr';

export interface ComponentOptions {
  className?: string;
  id?: string;
  attributes?: Record<string, string>;
}

export abstract class Component<T extends HTMLElement = HTMLElement> {
  protected element: T;
  private eventListeners: Array<{
    target: EventTarget;
    type: string;
    handler: EventListener;
    options?: AddEventListenerOptions;
  }> = [];
  private hmrId: string | null = null;
  protected hmrParent: HTMLElement | null = null;

  constructor(
    tagName: keyof HTMLElementTagNameMap = 'div',
    options: ComponentOptions = {}
  ) {
    this.element = document.createElement(tagName) as T;

    if (options.className) {
      this.element.className = options.className;
    }

    if (options.id) {
      this.element.id = options.id;
    }

    if (options.attributes) {
      for (const [key, value] of Object.entries(options.attributes)) {
        this.element.setAttribute(key, value);
      }
    }
  }

  /**
   * Get the component's root DOM element
   */
  getElement(): T {
    return this.element;
  }

  /**
   * Mount the component to a parent element
   */
  mount(parent: HTMLElement | string): this {
    const parentElement = typeof parent === 'string'
      ? document.querySelector<HTMLElement>(parent)
      : parent;

    if (!parentElement) {
      throw new Error(`Parent element not found: ${parent}`);
    }

    parentElement.appendChild(this.element);
    this.hmrParent = parentElement;
    this.onMount();

    // Register for HMR if enabled
    if (this.hmrId) {
      registerComponent(
        this.hmrId,
        this.element,
        parentElement,
        () => this.recreateForHmr()
      );
    }

    return this;
  }

  /**
   * Unmount the component from the DOM
   */
  unmount(): this {
    this.onUnmount();
    this.removeAllEventListeners();

    // Unregister from HMR
    if (this.hmrId) {
      unregisterComponent(this.hmrId);
    }

    this.element.remove();
    this.hmrParent = null;
    return this;
  }

  /**
   * Add an event listener with automatic cleanup tracking
   */
  protected on<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions
  ): this;
  protected on(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): this;
  protected on(
    targetOrType: EventTarget | string,
    typeOrHandler: string | EventListener,
    handlerOrOptions?: EventListener | AddEventListenerOptions,
    options?: AddEventListenerOptions
  ): this {
    let target: EventTarget;
    let type: string;
    let handler: EventListener;
    let opts: AddEventListenerOptions | undefined;

    if (typeof targetOrType === 'string') {
      target = this.element;
      type = targetOrType;
      handler = typeOrHandler as EventListener;
      opts = handlerOrOptions as AddEventListenerOptions | undefined;
    } else {
      target = targetOrType;
      type = typeOrHandler as string;
      handler = handlerOrOptions as EventListener;
      opts = options;
    }

    target.addEventListener(type, handler, opts);
    this.eventListeners.push({ target, type, handler, options: opts });
    return this;
  }

  /**
   * Remove all tracked event listeners
   */
  protected removeAllEventListeners(): void {
    for (const { target, type, handler, options } of this.eventListeners) {
      target.removeEventListener(type, handler, options);
    }
    this.eventListeners = [];
  }

  /**
   * Add a CSS class to the element
   */
  addClass(...classes: string[]): this {
    this.element.classList.add(...classes);
    return this;
  }

  /**
   * Remove a CSS class from the element
   */
  removeClass(...classes: string[]): this {
    this.element.classList.remove(...classes);
    return this;
  }

  /**
   * Toggle a CSS class on the element
   */
  toggleClass(className: string, force?: boolean): this {
    this.element.classList.toggle(className, force);
    return this;
  }

  /**
   * Check if the element has a CSS class
   */
  hasClass(className: string): boolean {
    return this.element.classList.contains(className);
  }

  /**
   * Set inline styles on the element
   */
  setStyle(styles: Partial<CSSStyleDeclaration>): this {
    Object.assign(this.element.style, styles);
    return this;
  }

  /**
   * Set an attribute on the element
   */
  setAttribute(name: string, value: string): this {
    this.element.setAttribute(name, value);
    return this;
  }

  /**
   * Get an attribute from the element
   */
  getAttribute(name: string): string | null {
    return this.element.getAttribute(name);
  }

  /**
   * Remove an attribute from the element
   */
  removeAttribute(name: string): this {
    this.element.removeAttribute(name);
    return this;
  }

  /**
   * Set the text content of the element
   */
  setText(text: string): this {
    this.element.textContent = text;
    return this;
  }

  /**
   * Set the HTML content of the element
   */
  setHTML(html: string): this {
    this.element.innerHTML = html;
    return this;
  }

  /**
   * Append a child component or element
   */
  append(child: Component | HTMLElement | string): this {
    if (child instanceof Component) {
      this.element.appendChild(child.getElement());
    } else if (typeof child === 'string') {
      this.element.insertAdjacentHTML('beforeend', child);
    } else {
      this.element.appendChild(child);
    }
    return this;
  }

  /**
   * Prepend a child component or element
   */
  prepend(child: Component | HTMLElement | string): this {
    if (child instanceof Component) {
      this.element.prepend(child.getElement());
    } else if (typeof child === 'string') {
      this.element.insertAdjacentHTML('afterbegin', child);
    } else {
      this.element.prepend(child);
    }
    return this;
  }

  /**
   * Remove all children from the element
   */
  empty(): this {
    this.element.innerHTML = '';
    return this;
  }

  /**
   * Show the element
   */
  show(): this {
    this.element.style.display = '';
    this.element.removeAttribute('hidden');
    return this;
  }

  /**
   * Hide the element
   */
  hide(): this {
    this.element.setAttribute('hidden', '');
    return this;
  }

  /**
   * Check if the element is visible
   */
  isVisible(): boolean {
    return !this.element.hasAttribute('hidden') && this.element.style.display !== 'none';
  }

  /**
   * Focus the element
   */
  focus(): this {
    this.element.focus();
    return this;
  }

  /**
   * Blur the element
   */
  blur(): this {
    this.element.blur();
    return this;
  }

  /**
   * Called after the component is mounted to the DOM
   */
  protected onMount(): void {
    // Override in subclasses
  }

  /**
   * Called before the component is unmounted from the DOM
   */
  protected onUnmount(): void {
    // Override in subclasses
  }

  /**
   * Render/update the component (override in subclasses)
   */
  render(): this {
    return this;
  }

  /**
   * Enable HMR tracking for this component
   * Components with HMR enabled can be hot-reloaded
   */
  enableHmr(id?: string): this {
    this.hmrId = id || createHmrId(this.constructor.name);
    return this;
  }

  /**
   * Get the HMR ID for this component
   */
  getHmrId(): string | null {
    return this.hmrId;
  }

  /**
   * Recreate the component for HMR
   * Override in subclasses to provide custom recreation logic
   */
  protected recreateForHmr(): HTMLElement {
    // Default: just return the current element
    // Subclasses can override to re-render
    this.render();
    return this.element;
  }
}

// HMR setup for Component base class
if (import.meta.hot) {
  import.meta.hot.accept();
}
