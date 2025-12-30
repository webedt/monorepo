/**
 * ListenerRegistry - Centralized event listener tracking and cleanup
 *
 * Solves memory leaks from unbalanced addEventListener/removeEventListener calls.
 * Tracks all registered listeners and provides automatic cleanup via removeAll().
 */

export interface ListenerEntry {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options?: AddEventListenerOptions | boolean;
}

export class ListenerRegistry {
  private listeners: ListenerEntry[] = [];
  private abortController: AbortController | null = null;

  /**
   * Add an event listener and track it for cleanup.
   * Supports multiple call signatures for flexibility.
   */
  add(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): this {
    target.addEventListener(type, handler, options);
    this.listeners.push({ target, type, handler, options });
    return this;
  }

  /**
   * Add a listener with AbortController support for modern cleanup.
   * All listeners added this way can be removed via abort().
   */
  addWithAbort(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: Omit<AddEventListenerOptions, 'signal'>
  ): this {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }

    const opts: AddEventListenerOptions = {
      ...options,
      signal: this.abortController.signal,
    };

    target.addEventListener(type, handler, opts);
    // Still track for inspection, though removal is via abort
    this.listeners.push({ target, type, handler, options: opts });
    return this;
  }

  /**
   * Add a listener to a DOM element found by selector.
   * Returns false if element not found, true if listener was added.
   */
  addBySelector(
    root: ParentNode,
    selector: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): boolean {
    const element = root.querySelector(selector);
    if (element) {
      this.add(element, type, handler, options);
      return true;
    }
    return false;
  }

  /**
   * Add listeners to all elements matching a selector.
   * Returns the number of listeners added.
   */
  addAllBySelector(
    root: ParentNode,
    selector: string,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): number {
    const elements = root.querySelectorAll(selector);
    let count = 0;
    elements.forEach((element) => {
      this.add(element, type, handler, options);
      count++;
    });
    return count;
  }

  /**
   * Remove a specific listener.
   * Returns true if the listener was found and removed.
   */
  remove(
    target: EventTarget,
    type: string,
    handler: EventListener,
    _options?: AddEventListenerOptions | boolean
  ): boolean {
    const index = this.listeners.findIndex(
      (entry) =>
        entry.target === target &&
        entry.type === type &&
        entry.handler === handler
    );

    if (index !== -1) {
      const entry = this.listeners[index];
      entry.target.removeEventListener(entry.type, entry.handler, entry.options);
      this.listeners.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Remove all tracked listeners.
   * This should be called in disconnect/unmount/destroy methods.
   */
  removeAll(): void {
    // Abort any listeners using AbortController
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Remove all manually tracked listeners
    for (const entry of this.listeners) {
      entry.target.removeEventListener(entry.type, entry.handler, entry.options);
    }

    this.listeners = [];
  }

  /**
   * Get the count of tracked listeners.
   * Useful for debugging memory leaks.
   */
  get count(): number {
    return this.listeners.length;
  }

  /**
   * Get a snapshot of all tracked listeners.
   * Useful for debugging.
   */
  getListeners(): ReadonlyArray<ListenerEntry> {
    return [...this.listeners];
  }

  /**
   * Check if a specific listener is tracked.
   */
  has(target: EventTarget, type: string, handler?: EventListener): boolean {
    return this.listeners.some(
      (entry) =>
        entry.target === target &&
        entry.type === type &&
        (handler === undefined || entry.handler === handler)
    );
  }

  /**
   * Remove all listeners of a specific type from a target.
   * Useful for selectively cleaning up certain event types.
   */
  removeByType(target: EventTarget, type: string): number {
    let removed = 0;
    const remaining: ListenerEntry[] = [];

    for (const entry of this.listeners) {
      if (entry.target === target && entry.type === type) {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options);
        removed++;
      } else {
        remaining.push(entry);
      }
    }

    this.listeners = remaining;
    return removed;
  }

  /**
   * Remove all listeners from a specific target.
   * Useful when a DOM element is being destroyed.
   */
  removeByTarget(target: EventTarget): number {
    let removed = 0;
    const remaining: ListenerEntry[] = [];

    for (const entry of this.listeners) {
      if (entry.target === target) {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options);
        removed++;
      } else {
        remaining.push(entry);
      }
    }

    this.listeners = remaining;
    return removed;
  }
}

/**
 * Create a standalone listener registry.
 * Use this when you need isolated event listener tracking.
 */
export function createListenerRegistry(): ListenerRegistry {
  return new ListenerRegistry();
}
