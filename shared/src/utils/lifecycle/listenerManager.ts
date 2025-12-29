/**
 * ListenerManager - Utility for tracking and cleaning up event listeners
 *
 * This utility helps prevent memory leaks by:
 * - Tracking all registered event listeners
 * - Providing automatic cleanup on dispose
 * - Supporting EventEmitter (.on/.off) patterns
 *
 * Usage:
 * ```typescript
 * const manager = new ListenerManager();
 *
 * // For EventEmitter (Node.js style)
 * manager.on(emitter, 'event', handler);
 *
 * // Clean up all listeners
 * manager.dispose();
 * ```
 */

import type { EventEmitter } from 'events';

type AnyFunction = (...args: unknown[]) => unknown;

interface TrackedListener {
  target: EventEmitter;
  event: string;
  handler: AnyFunction;
}

/**
 * Abstract interface for ListenerManager
 */
export interface IListenerManager {
  /** Register a listener on an EventEmitter */
  on<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void;

  /** Register a once listener on an EventEmitter */
  once<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void;

  /** Remove a specific listener from an EventEmitter */
  off<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void;

  /** Dispose all tracked listeners */
  dispose(): void;

  /** Get the count of tracked listeners */
  getListenerCount(): number;
}

/**
 * Manages event listeners and ensures proper cleanup
 */
export class ListenerManager implements IListenerManager {
  private listeners: TrackedListener[] = [];
  private disposed = false;

  /**
   * Register a listener on an EventEmitter (Node.js style)
   */
  on<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void {
    if (this.disposed) {
      throw new Error('ListenerManager has been disposed');
    }

    emitter.on(event, handler);
    this.listeners.push({
      target: emitter,
      event,
      handler,
    });
  }

  /**
   * Register a once listener on an EventEmitter
   */
  once<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void {
    if (this.disposed) {
      throw new Error('ListenerManager has been disposed');
    }

    // Wrap the handler to remove it from tracking after it fires
    const wrappedHandler = (...args: unknown[]) => {
      this.removeFromTracking(emitter, event, wrappedHandler);
      return handler(...args);
    };

    emitter.once(event, wrappedHandler);
    this.listeners.push({
      target: emitter,
      event,
      handler: wrappedHandler,
    });
  }

  /**
   * Remove a specific listener from an EventEmitter
   */
  off<T extends EventEmitter>(emitter: T, event: string, handler: AnyFunction): void {
    emitter.off(event, handler);
    this.removeFromTracking(emitter, event, handler);
  }

  /**
   * Remove a listener from internal tracking
   */
  private removeFromTracking(
    target: EventEmitter,
    event: string,
    handler: AnyFunction
  ): void {
    const index = this.listeners.findIndex(
      (l) => l.target === target && l.event === event && l.handler === handler
    );
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Dispose all tracked listeners
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener.target.off(listener.event, listener.handler);
      } catch {
        // Ignore errors during cleanup - target may already be disposed
      }
    }

    this.listeners = [];
    this.disposed = true;
  }

  /**
   * Get the count of tracked listeners
   */
  getListenerCount(): number {
    return this.listeners.length;
  }

  /**
   * Check if this manager has been disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Create a new ListenerManager instance
 */
export function createListenerManager(): IListenerManager {
  return new ListenerManager();
}
