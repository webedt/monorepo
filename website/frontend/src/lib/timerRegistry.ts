/**
 * TimerRegistry - Centralized timer tracking and cleanup
 *
 * Solves memory leaks from uncleared setTimeout/setInterval calls.
 * Tracks all registered timers and provides automatic cleanup via clearAll().
 */

export interface TimerEntry {
  id: number;
  type: 'timeout' | 'interval';
  callback: () => void;
  delay: number;
  createdAt: number;
}

export class TimerRegistry {
  private timers: Map<number, TimerEntry> = new Map();
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
      callback,
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
      callback,
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
   */
  debounce(key: string, callback: () => void, delay: number): number {
    // Use negative IDs for keyed debounce timers to avoid conflicts
    const keyedId = -Math.abs(this.hashCode(key));

    // Clear existing timer for this key
    const existing = this.timers.get(keyedId);
    if (existing) {
      window.clearTimeout(existing.id);
      this.timers.delete(keyedId);
    }

    const createdAt = Date.now();
    const timeoutId = window.setTimeout(() => {
      this.timers.delete(keyedId);
      callback();
    }, delay);

    this.timers.set(keyedId, {
      id: timeoutId,
      type: 'timeout',
      callback,
      delay,
      createdAt,
    });

    return keyedId;
  }

  /**
   * Cancel a debounced timer by its key.
   */
  cancelDebounce(key: string): boolean {
    const keyedId = -Math.abs(this.hashCode(key));
    return this.clear(keyedId);
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
}

/**
 * Create a standalone timer registry.
 * Use this when you need isolated timer tracking.
 */
export function createTimerRegistry(): TimerRegistry {
  return new TimerRegistry();
}
