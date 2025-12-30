/**
 * TimerManager - Utility for tracking and cleaning up timers
 *
 * This utility helps prevent memory leaks by:
 * - Tracking all registered setTimeout and setInterval timers
 * - Providing automatic cleanup on dispose
 * - Supporting optional unref() for timers that shouldn't keep the process alive
 *
 * Usage:
 * ```typescript
 * const manager = new TimerManager();
 *
 * // Create a timeout
 * const timeoutId = manager.setTimeout(() => console.log('done'), 1000);
 *
 * // Create an interval
 * const intervalId = manager.setInterval(() => console.log('tick'), 1000);
 *
 * // Clear a specific timer
 * manager.clearTimeout(timeoutId);
 *
 * // Clean up all timers
 * manager.dispose();
 * ```
 */

type TimerId = ReturnType<typeof setTimeout>;

interface TrackedTimer {
  id: TimerId;
  type: 'timeout' | 'interval';
}

/**
 * Abstract interface for TimerManager
 */
export interface ITimerManager {
  /** Create a tracked setTimeout */
  setTimeout(callback: () => void, ms: number, unref?: boolean): TimerId;

  /** Create a tracked setInterval */
  setInterval(callback: () => void, ms: number, unref?: boolean): TimerId;

  /** Clear a specific timeout */
  clearTimeout(id: TimerId): void;

  /** Clear a specific interval */
  clearInterval(id: TimerId): void;

  /** Dispose all tracked timers */
  dispose(): void;

  /** Get the count of active timers */
  getTimerCount(): number;
}

/**
 * Manages timers and ensures proper cleanup
 */
export class TimerManager implements ITimerManager {
  private timers: TrackedTimer[] = [];
  private disposed = false;

  /**
   * Create a tracked setTimeout
   * @param callback - Function to call after the delay
   * @param ms - Delay in milliseconds
   * @param unref - If true, allows the process to exit if this is the only timer
   */
  setTimeout(callback: () => void, ms: number, unref = false): TimerId {
    if (this.disposed) {
      throw new Error('TimerManager has been disposed');
    }

    const id = setTimeout(() => {
      this.removeFromTracking(id);
      callback();
    }, ms);

    if (unref && id.unref) {
      id.unref();
    }

    this.timers.push({ id, type: 'timeout' });
    return id;
  }

  /**
   * Create a tracked setInterval
   * @param callback - Function to call on each interval
   * @param ms - Interval in milliseconds
   * @param unref - If true, allows the process to exit if this is the only timer
   */
  setInterval(callback: () => void, ms: number, unref = false): TimerId {
    if (this.disposed) {
      throw new Error('TimerManager has been disposed');
    }

    const id = setInterval(callback, ms);

    if (unref && id.unref) {
      id.unref();
    }

    this.timers.push({ id, type: 'interval' });
    return id;
  }

  /**
   * Clear a specific timeout
   */
  clearTimeout(id: TimerId): void {
    clearTimeout(id);
    this.removeFromTracking(id);
  }

  /**
   * Clear a specific interval
   */
  clearInterval(id: TimerId): void {
    clearInterval(id);
    this.removeFromTracking(id);
  }

  /**
   * Remove a timer from internal tracking
   */
  private removeFromTracking(id: TimerId): void {
    const index = this.timers.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.timers.splice(index, 1);
    }
  }

  /**
   * Dispose all tracked timers
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const timer of this.timers) {
      if (timer.type === 'timeout') {
        clearTimeout(timer.id);
      } else {
        clearInterval(timer.id);
      }
    }

    this.timers = [];
    this.disposed = true;
  }

  /**
   * Get the count of active timers
   */
  getTimerCount(): number {
    return this.timers.length;
  }

  /**
   * Check if this manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Create a new TimerManager instance
 */
export function createTimerManager(): ITimerManager {
  return new TimerManager();
}
