/**
 * TimerRegistry - Centralized timer tracking and cleanup
 *
 * Solves memory leaks from uncleared setTimeout/setInterval calls.
 * Tracks all registered timers and provides automatic cleanup via clearAll().
 */

export interface TimerEntry {
  id: number;
  type: 'timeout' | 'interval';
  delay: number;
  createdAt: number;
}

export class TimerRegistry {
  private timers: Map<number, TimerEntry> = new Map();
  private debounceKeys: Map<string, number> = new Map();
  private nextId = 1;

  /**
   * Set a timeout and track it for cleanup.
   * Returns a timer ID that can be used to clear it.
   */
  setTimeout(callback: () => void, delay: number): number {
    const internalId = this.nextId++;
    const createdAt = Date.now();

    const timeoutId = window.setTimeout(() => {
      this.timers.delete(internalId);
      callback();
    }, delay);

    this.timers.set(internalId, {
      id: timeoutId,
      type: 'timeout',
      delay,
      createdAt,
    });

    return internalId;
  }

  /**
   * Set an interval and track it for cleanup.
   * Returns a timer ID that can be used to clear it.
   */
  setInterval(callback: () => void, delay: number): number {
    const internalId = this.nextId++;
    const createdAt = Date.now();

    const intervalId = window.setInterval(callback, delay);

    this.timers.set(internalId, {
      id: intervalId,
      type: 'interval',
      delay,
      createdAt,
    });

    return internalId;
  }

  /**
   * Clear a specific timeout by its internal ID.
   * Returns true if the timer was found and cleared.
   */
  clearTimeout(internalId: number): boolean {
    const entry = this.timers.get(internalId);
    if (entry && entry.type === 'timeout') {
      window.clearTimeout(entry.id);
      this.timers.delete(internalId);
      return true;
    }
    return false;
  }

  /**
   * Clear a specific interval by its internal ID.
   * Returns true if the timer was found and cleared.
   */
  clearInterval(internalId: number): boolean {
    const entry = this.timers.get(internalId);
    if (entry && entry.type === 'interval') {
      window.clearInterval(entry.id);
      this.timers.delete(internalId);
      return true;
    }
    return false;
  }

  /**
   * Clear any timer (timeout or interval) by its internal ID.
   * Returns true if the timer was found and cleared.
   */
  clear(internalId: number): boolean {
    const entry = this.timers.get(internalId);
    if (entry) {
      if (entry.type === 'timeout') {
        window.clearTimeout(entry.id);
      } else {
        window.clearInterval(entry.id);
      }
      this.timers.delete(internalId);
      return true;
    }
    return false;
  }

  /**
   * Clear all tracked timers.
   * This should be called in disconnect/unmount/destroy methods.
   */
  clearAll(): void {
    for (const entry of this.timers.values()) {
      if (entry.type === 'timeout') {
        window.clearTimeout(entry.id);
      } else {
        window.clearInterval(entry.id);
      }
    }
    this.timers.clear();
    this.debounceKeys.clear();
  }

  /**
   * Get the count of active tracked timers.
   * Useful for debugging memory leaks.
   */
  get count(): number {
    return this.timers.size;
  }

  /**
   * Get the count of active timeouts.
   */
  get timeoutCount(): number {
    let count = 0;
    for (const entry of this.timers.values()) {
      if (entry.type === 'timeout') count++;
    }
    return count;
  }

  /**
   * Get the count of active intervals.
   */
  get intervalCount(): number {
    let count = 0;
    for (const entry of this.timers.values()) {
      if (entry.type === 'interval') count++;
    }
    return count;
  }

  /**
   * Check if a specific timer is tracked.
   */
  has(internalId: number): boolean {
    return this.timers.has(internalId);
  }

  /**
   * Get a snapshot of all tracked timers.
   * Useful for debugging.
   */
  getTimers(): ReadonlyArray<TimerEntry> {
    return [...this.timers.values()];
  }

  /**
   * Clear all timeouts (keep intervals running).
   */
  clearAllTimeouts(): number {
    let cleared = 0;
    for (const [id, entry] of this.timers.entries()) {
      if (entry.type === 'timeout') {
        window.clearTimeout(entry.id);
        this.timers.delete(id);
        cleared++;
      }
    }
    // Also clear debounce keys since they are timeouts
    this.debounceKeys.clear();
    return cleared;
  }

  /**
   * Clear all intervals (keep timeouts running).
   */
  clearAllIntervals(): number {
    let cleared = 0;
    for (const [id, entry] of this.timers.entries()) {
      if (entry.type === 'interval') {
        window.clearInterval(entry.id);
        this.timers.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * Debounce helper - clears any existing timeout with the same key and sets a new one.
   * Useful for search inputs, resize handlers, etc.
   * Uses a separate key-to-ID map to avoid hash collisions.
   */
  debounce(key: string, callback: () => void, delay: number): number {
    // Clear existing timer for this key if it exists
    const existingId = this.debounceKeys.get(key);
    if (existingId !== undefined) {
      this.clear(existingId);
    }

    // Create new timer and track it
    const internalId = this.nextId++;
    const createdAt = Date.now();

    const timeoutId = window.setTimeout(() => {
      this.timers.delete(internalId);
      this.debounceKeys.delete(key);
      callback();
    }, delay);

    this.timers.set(internalId, {
      id: timeoutId,
      type: 'timeout',
      delay,
      createdAt,
    });

    this.debounceKeys.set(key, internalId);

    return internalId;
  }

  /**
   * Cancel a debounced timer by its key.
   * Returns true if the timer was found and cleared.
   */
  cancelDebounce(key: string): boolean {
    const internalId = this.debounceKeys.get(key);
    if (internalId !== undefined) {
      this.debounceKeys.delete(key);
      return this.clear(internalId);
    }
    return false;
  }

  /**
   * Check if a debounce key has an active timer.
   */
  hasDebounce(key: string): boolean {
    return this.debounceKeys.has(key);
  }
}

/**
 * Create a standalone timer registry.
 * Use this when you need isolated timer tracking.
 */
export function createTimerRegistry(): TimerRegistry {
  return new TimerRegistry();
}
