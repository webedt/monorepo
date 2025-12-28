/**
 * Undo/Redo Stack
 * Generic history management for state changes with debouncing
 */

export interface UndoRedoOptions {
  maxSize?: number;
  debounceMs?: number;
}

export interface UndoRedoState<_T = unknown> {
  canUndo: boolean;
  canRedo: boolean;
  historyLength: number;
  futureLength: number;
}

type Subscriber<T> = (state: UndoRedoState<T>) => void;

export class UndoRedoStack<T> {
  private past: T[] = [];
  private present: T | null = null;
  private future: T[] = [];
  private maxSize: number;
  private debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: T | null = null;
  private subscribers: Set<Subscriber<T>> = new Set();

  constructor(options: UndoRedoOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /**
   * Initialize with a starting state
   */
  initialize(state: T): void {
    this.present = this.clone(state);
    this.past = [];
    this.future = [];
    this.notifySubscribers();
  }

  /**
   * Push a new state to the history
   * Uses debouncing to group rapid changes
   */
  push(state: T): void {
    this.pendingState = this.clone(state);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.commitPending();
    }, this.debounceMs);
  }

  /**
   * Force commit any pending state immediately
   */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.commitPending();
  }

  /**
   * Commit pending state to history
   */
  private commitPending(): void {
    if (this.pendingState === null) return;

    // Don't push if state is the same as current present
    if (this.present !== null && this.isEqual(this.present, this.pendingState)) {
      this.pendingState = null;
      return;
    }

    // Push current present to past (if exists)
    if (this.present !== null) {
      this.past.push(this.present);

      // Trim history if exceeds max size
      while (this.past.length > this.maxSize) {
        this.past.shift();
      }
    }

    // Update present
    this.present = this.pendingState;
    this.pendingState = null;

    // Clear future (new timeline)
    this.future = [];

    this.notifySubscribers();
  }

  /**
   * Undo to previous state
   */
  undo(): T | null {
    // Commit any pending changes first
    this.flush();

    if (this.past.length === 0) {
      return null;
    }

    // Move present to future
    if (this.present !== null) {
      this.future.unshift(this.present);
    }

    // Pop from past to present
    this.present = this.past.pop()!;
    this.notifySubscribers();

    return this.clone(this.present);
  }

  /**
   * Redo to next state
   */
  redo(): T | null {
    // Commit any pending changes first
    this.flush();

    if (this.future.length === 0) {
      return null;
    }

    // Move present to past
    if (this.present !== null) {
      this.past.push(this.present);
    }

    // Pop from future to present
    this.present = this.future.shift()!;
    this.notifySubscribers();

    return this.clone(this.present);
  }

  /**
   * Get current state
   */
  getCurrent(): T | null {
    return this.present ? this.clone(this.present) : null;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.past.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Get current undo/redo state
   */
  getState(): UndoRedoState<T> {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      historyLength: this.past.length,
      futureLength: this.future.length,
    };
  }

  /**
   * Clear all history
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.past = [];
    this.future = [];
    this.pendingState = null;
    // Keep present as current state
    this.notifySubscribers();
  }

  /**
   * Reset completely (including current state)
   */
  reset(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.past = [];
    this.present = null;
    this.future = [];
    this.pendingState = null;
    this.notifySubscribers();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    // Immediately notify with current state
    subscriber(this.getState());
    return () => this.subscribers.delete(subscriber);
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(): void {
    const state = this.getState();
    for (const subscriber of this.subscribers) {
      subscriber(state);
    }
  }

  /**
   * Clone state to prevent mutations
   */
  private clone(state: T): T {
    if (typeof state === 'string') {
      return state;
    }
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Check if two states are equal
   */
  private isEqual(a: T, b: T): boolean {
    if (typeof a === 'string' && typeof b === 'string') {
      return a === b;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/**
 * Create an undo/redo stack with default options
 */
export function createUndoRedoStack<T>(options?: UndoRedoOptions): UndoRedoStack<T> {
  return new UndoRedoStack<T>(options);
}
