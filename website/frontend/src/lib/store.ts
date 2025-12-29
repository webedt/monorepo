/**
 * Simple State Store
 * Reactive state management with subscriptions
 */

import { registerStore, getHmrState, saveHmrState } from './hmr';

type Subscriber<T> = (state: T, prevState: T) => void;
type Selector<T, R> = (state: T) => R;
type Updater<T> = (state: T) => Partial<T>;

export class Store<T extends object> {
  private hmrId: string | null = null;
  private state: T;
  private subscribers: Set<Subscriber<T>> = new Set();
  private selectorSubscribers: Map<Selector<T, unknown>, Set<(value: unknown) => void>> = new Map();

  constructor(initialState: T) {
    this.state = { ...initialState };
  }

  /**
   * Get current state
   */
  getState(): Readonly<T> {
    return this.state;
  }

  /**
   * Get a specific value using a selector
   */
  get<R>(selector: Selector<T, R>): R {
    return selector(this.state);
  }

  /**
   * Update state
   */
  setState(partial: Partial<T> | Updater<T>): void {
    const prevState = this.state;
    const updates = typeof partial === 'function' ? partial(this.state) : partial;

    this.state = { ...this.state, ...updates };

    // Notify subscribers
    for (const subscriber of this.subscribers) {
      subscriber(this.state, prevState);
    }

    // Notify selector subscribers
    for (const [selector, subs] of this.selectorSubscribers) {
      const prevValue = selector(prevState);
      const newValue = selector(this.state);

      if (!Object.is(prevValue, newValue)) {
        for (const sub of subs) {
          sub(newValue);
        }
      }
    }
  }

  /**
   * Reset state to initial
   */
  reset(initialState: T): void {
    this.setState(initialState);
  }

  /**
   * Enable HMR for this store
   * State will be preserved across module updates
   * Note: Uses shallow merge - nested objects may not be fully restored
   */
  enableHmr(id: string): this {
    this.hmrId = id;

    // Try to restore state from HMR (uses setState to notify subscribers)
    const savedState = getHmrState<T>(`store:${id}`);
    if (savedState !== undefined) {
      this.setState(savedState);
    }

    // Register for future HMR cycles (without auto-restore since we handle it above)
    registerStore(id, () => this.state);

    return this;
  }

  /**
   * Save state for HMR before module disposal
   */
  saveForHmr(): void {
    if (this.hmrId) {
      saveHmrState(`store:${this.hmrId}`, this.state);
    }
  }

  /**
   * Subscribe to all state changes
   */
  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /**
   * Subscribe to specific state slice changes
   */
  subscribeToSelector<R>(
    selector: Selector<T, R>,
    callback: (value: R) => void
  ): () => void {
    if (!this.selectorSubscribers.has(selector)) {
      this.selectorSubscribers.set(selector, new Set());
    }

    const subs = this.selectorSubscribers.get(selector)!;
    subs.add(callback as (value: unknown) => void);

    return () => {
      subs.delete(callback as (value: unknown) => void);
      if (subs.size === 0) {
        this.selectorSubscribers.delete(selector);
      }
    };
  }
}

/**
 * Create a store with actions
 */
export function createStore<T extends object, A extends object>(
  initialState: T,
  actions: (set: (partial: Partial<T> | Updater<T>) => void, get: () => T) => A
): Store<T> & A {
  const store = new Store(initialState);

  const boundActions = actions(
    (partial) => store.setState(partial),
    () => store.getState()
  );

  return Object.assign(store, boundActions);
}

/**
 * Persist store state to localStorage
 */
export function persist<T extends object>(
  store: Store<T>,
  key: string,
  options?: {
    include?: (keyof T)[];
    exclude?: (keyof T)[];
  }
): void {
  // Load persisted state
  try {
    const persisted = localStorage.getItem(key);
    if (persisted) {
      const parsed = JSON.parse(persisted);
      store.setState(parsed);
    }
  } catch {
    // Ignore parse errors
  }

  // Save state on changes
  store.subscribe((state) => {
    let toSave: Partial<T> = state;

    if (options?.include) {
      toSave = {};
      for (const k of options.include) {
        toSave[k] = state[k];
      }
    } else if (options?.exclude) {
      toSave = { ...state };
      for (const k of options.exclude) {
        delete toSave[k];
      }
    }

    try {
      localStorage.setItem(key, JSON.stringify(toSave));
    } catch {
      // Ignore storage errors
    }
  });
}
