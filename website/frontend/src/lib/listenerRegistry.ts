/**
 * ListenerRegistry - Centralized event listener tracking and cleanup
 *
 * Solves memory leaks from unbalanced addEventListener/removeEventListener calls.
 * Tracks all registered listeners and provides automatic cleanup via removeAll().
 *
 * Extended features:
 * - EventSource subscriptions with automatic close()
 * - Timer management (setTimeout/setInterval) with automatic cleanup
 * - Generic subscription cleanup (for store.subscribe() patterns)
 */

export interface ListenerEntry {
  target: EventTarget;
  type: string;
  handler: EventListener;
  options?: AddEventListenerOptions | boolean;
}

export interface EventSourceHandlerEntry {
  type: string;
  handler: EventListener;
}

export interface EventSourceEntry {
  eventSource: EventSource;
  handlers: EventSourceHandlerEntry[];
}

export interface TimerEntry {
  id: ReturnType<typeof setTimeout>;
  type: 'timeout' | 'interval';
}

export class ListenerRegistry {
  private listeners: ListenerEntry[] = [];
  private abortController: AbortController | null = null;
  private eventSources: EventSourceEntry[] = [];
  private timers: Map<ReturnType<typeof setTimeout>, TimerEntry> = new Map();
  private subscriptions: Array<() => void> = [];

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
   *
   * Note: The options parameter is accepted for API symmetry with addEventListener
   * but is not used for matching. Listeners are matched by target, type, and handler
   * reference only, since the same handler cannot be registered multiple times with
   * different options on the same target/type combination.
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
   * Remove all tracked listeners, EventSources, timers, and subscriptions.
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

    // Close all EventSources
    this.closeAllEventSources();

    // Clear all timers
    this.clearAllTimers();

    // Remove all subscriptions
    this.removeAllSubscriptions();
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

  // ============================================
  // EventSource Management
  // ============================================

  /**
   * Create and track an EventSource connection.
   * The EventSource will be automatically closed on removeAll().
   */
  addEventSource(
    url: string | URL,
    options?: EventSourceInit
  ): EventSource {
    const eventSource = new EventSource(url, options);
    const entry: EventSourceEntry = {
      eventSource,
      handlers: [],
    };
    this.eventSources.push(entry);
    return eventSource;
  }

  /**
   * Add an event listener to a tracked EventSource.
   * Supports multiple handlers per event type.
   * Both the EventSource and listener will be cleaned up on removeAll().
   */
  addEventSourceListener(
    eventSource: EventSource,
    type: string,
    handler: EventListener
  ): this {
    const entry = this.eventSources.find(e => e.eventSource === eventSource);
    if (entry) {
      entry.handlers.push({ type, handler });
    }
    eventSource.addEventListener(type, handler);
    return this;
  }

  /**
   * Close a specific EventSource and remove all its listeners.
   * Returns true if the EventSource was found and closed.
   */
  closeEventSource(eventSource: EventSource): boolean {
    const index = this.eventSources.findIndex(e => e.eventSource === eventSource);
    if (index !== -1) {
      const entry = this.eventSources[index];
      // Remove all event listeners
      for (const { type, handler } of entry.handlers) {
        entry.eventSource.removeEventListener(type, handler);
      }
      entry.eventSource.close();
      this.eventSources.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Close all tracked EventSources.
   */
  closeAllEventSources(): void {
    for (const entry of this.eventSources) {
      for (const { type, handler } of entry.handlers) {
        entry.eventSource.removeEventListener(type, handler);
      }
      entry.eventSource.close();
    }
    this.eventSources = [];
  }

  /**
   * Get the count of tracked EventSources.
   */
  get eventSourceCount(): number {
    return this.eventSources.length;
  }

  // ============================================
  // Timer Management
  // ============================================

  /**
   * Set a timeout and track it for cleanup.
   * The timeout will be automatically cleared on removeAll().
   */
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      // Remove from tracking after execution (O(1) with Map)
      this.timers.delete(id);
      callback();
    }, delay);
    this.timers.set(id, { id, type: 'timeout' });
    return id;
  }

  /**
   * Set an interval and track it for cleanup.
   * The interval will be automatically cleared on removeAll().
   */
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval> {
    const id = setInterval(callback, delay);
    this.timers.set(id, { id, type: 'interval' });
    return id;
  }

  /**
   * Clear a specific timer.
   * Returns true if the timer was found and cleared.
   */
  clearTimer(id: ReturnType<typeof setTimeout>): boolean {
    const entry = this.timers.get(id);
    if (entry) {
      if (entry.type === 'timeout') {
        clearTimeout(entry.id);
      } else {
        clearInterval(entry.id);
      }
      this.timers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Clear all tracked timers.
   */
  clearAllTimers(): void {
    for (const entry of this.timers.values()) {
      if (entry.type === 'timeout') {
        clearTimeout(entry.id);
      } else {
        clearInterval(entry.id);
      }
    }
    this.timers.clear();
  }

  /**
   * Get the count of tracked timers.
   */
  get timerCount(): number {
    return this.timers.size;
  }

  // ============================================
  // Subscription Management
  // ============================================

  /**
   * Track a subscription cleanup function.
   * This is useful for store.subscribe() or other patterns that
   * return an unsubscribe function.
   *
   * @example
   * const unsubscribe = store.subscribe(() => { ... });
   * this.listeners.addSubscription(unsubscribe);
   */
  addSubscription(unsubscribe: () => void): this {
    this.subscriptions.push(unsubscribe);
    return this;
  }

  /**
   * Remove and call a specific subscription cleanup function.
   * Returns true if the subscription was found and cleaned up.
   */
  removeSubscription(unsubscribe: () => void): boolean {
    const index = this.subscriptions.indexOf(unsubscribe);
    if (index !== -1) {
      const fn = this.subscriptions[index];
      fn();
      this.subscriptions.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Remove and call all subscription cleanup functions.
   */
  removeAllSubscriptions(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
  }

  /**
   * Get the count of tracked subscriptions.
   */
  get subscriptionCount(): number {
    return this.subscriptions.length;
  }
}

/**
 * Create a standalone listener registry.
 * Use this when you need isolated event listener tracking.
 */
export function createListenerRegistry(): ListenerRegistry {
  return new ListenerRegistry();
}
