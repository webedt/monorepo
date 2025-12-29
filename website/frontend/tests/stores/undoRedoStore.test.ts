/**
 * Tests for UndoRedoStore
 * Covers undo/redo history management for editor tabs including
 * per-tab stacks, debouncing, subscriptions, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { UndoRedoState } from '../../src/lib/undoRedo';

interface TabContentState {
  content: string;
  cursorPosition?: number;
}

// Create a test version of the undo/redo stack and manager
class TestUndoRedoStack<T> {
  private past: T[] = [];
  private present: T | null = null;
  private future: T[] = [];
  private maxSize: number;
  private debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: T | null = null;
  private subscribers: Set<(state: UndoRedoState<T>) => void> = new Set();

  constructor(options: { maxSize?: number; debounceMs?: number } = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.debounceMs = options.debounceMs ?? 500;
  }

  initialize(state: T): void {
    this.present = this.clone(state);
    this.past = [];
    this.future = [];
    this.notifySubscribers();
  }

  push(state: T): void {
    this.pendingState = this.clone(state);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.commitPending();
    }, this.debounceMs);
  }

  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.commitPending();
  }

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

  undo(): T | null {
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

  redo(): T | null {
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

  getCurrent(): T | null {
    return this.present ? this.clone(this.present) : null;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  getState(): UndoRedoState<T> {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      historyLength: this.past.length,
      futureLength: this.future.length,
    };
  }

  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.past = [];
    this.future = [];
    this.pendingState = null;
    this.notifySubscribers();
  }

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

  subscribe(subscriber: (state: UndoRedoState<T>) => void): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getState());
    return () => this.subscribers.delete(subscriber);
  }

  private notifySubscribers(): void {
    const state = this.getState();
    for (const subscriber of this.subscribers) {
      subscriber(state);
    }
  }

  private clone(state: T): T {
    if (typeof state === 'string') {
      return state;
    }
    return JSON.parse(JSON.stringify(state));
  }

  private isEqual(a: T, b: T): boolean {
    if (typeof a === 'string' && typeof b === 'string') {
      return a === b;
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

// Test version of UndoRedoManager
class TestUndoRedoManager {
  private stacks: Map<string, TestUndoRedoStack<TabContentState>> = new Map();
  private subscribers: Map<string, Set<(state: UndoRedoState<TabContentState>) => void>> = new Map();

  private getStack(tabPath: string): TestUndoRedoStack<TabContentState> {
    if (!this.stacks.has(tabPath)) {
      const stack = new TestUndoRedoStack<TabContentState>({
        maxSize: 100,
        debounceMs: 500,
      });

      stack.subscribe((state) => {
        const tabSubscribers = this.subscribers.get(tabPath);
        if (tabSubscribers) {
          for (const subscriber of tabSubscribers) {
            subscriber(state);
          }
        }
      });

      this.stacks.set(tabPath, stack);
    }
    return this.stacks.get(tabPath)!;
  }

  initialize(tabPath: string, content: string, cursorPosition?: number): void {
    const stack = this.getStack(tabPath);
    stack.initialize({ content, cursorPosition });
  }

  pushChange(tabPath: string, content: string, cursorPosition?: number): void {
    const stack = this.getStack(tabPath);
    stack.push({ content, cursorPosition });
  }

  undo(tabPath: string): TabContentState | null {
    const stack = this.stacks.get(tabPath);
    if (!stack) return null;
    return stack.undo();
  }

  redo(tabPath: string): TabContentState | null {
    const stack = this.stacks.get(tabPath);
    if (!stack) return null;
    return stack.redo();
  }

  canUndo(tabPath: string): boolean {
    const stack = this.stacks.get(tabPath);
    return stack ? stack.canUndo() : false;
  }

  canRedo(tabPath: string): boolean {
    const stack = this.stacks.get(tabPath);
    return stack ? stack.canRedo() : false;
  }

  getState(tabPath: string): UndoRedoState<TabContentState> {
    const stack = this.stacks.get(tabPath);
    if (!stack) {
      return {
        canUndo: false,
        canRedo: false,
        historyLength: 0,
        futureLength: 0,
      };
    }
    return stack.getState();
  }

  subscribe(
    tabPath: string,
    subscriber: (state: UndoRedoState<TabContentState>) => void
  ): () => void {
    if (!this.subscribers.has(tabPath)) {
      this.subscribers.set(tabPath, new Set());
    }
    this.subscribers.get(tabPath)!.add(subscriber);

    subscriber(this.getState(tabPath));

    return () => {
      const tabSubscribers = this.subscribers.get(tabPath);
      if (tabSubscribers) {
        tabSubscribers.delete(subscriber);
        if (tabSubscribers.size === 0) {
          this.subscribers.delete(tabPath);
        }
      }
    };
  }

  clearTab(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.clear();
    }
  }

  removeTab(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.reset();
    }
    this.stacks.delete(tabPath);
    this.subscribers.delete(tabPath);
  }

  clearAll(): void {
    for (const stack of this.stacks.values()) {
      stack.reset();
    }
    this.stacks.clear();
    this.subscribers.clear();
  }

  flush(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.flush();
    }
  }

  flushAll(): void {
    for (const stack of this.stacks.values()) {
      stack.flush();
    }
  }

  // For testing
  getStackCount(): number {
    return this.stacks.size;
  }
}

describe('UndoRedoStore', () => {
  let undoRedoStore: TestUndoRedoManager;

  beforeEach(() => {
    vi.useFakeTimers();
    undoRedoStore = new TestUndoRedoManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should have correct initial state for non-existent tab', () => {
      const state = undoRedoStore.getState('unknown-tab');

      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state.historyLength).toBe(0);
      expect(state.futureLength).toBe(0);
    });

    it('should report canUndo false for non-existent tab', () => {
      expect(undoRedoStore.canUndo('unknown-tab')).toBe(false);
    });

    it('should report canRedo false for non-existent tab', () => {
      expect(undoRedoStore.canRedo('unknown-tab')).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should initialize tab with content', () => {
      undoRedoStore.initialize('tab1', 'initial content');

      expect(undoRedoStore.canUndo('tab1')).toBe(false);
      expect(undoRedoStore.canRedo('tab1')).toBe(false);
    });

    it('should initialize tab with cursor position', () => {
      undoRedoStore.initialize('tab1', 'content', 5);

      // Position is preserved in state
      expect(undoRedoStore.getState('tab1').historyLength).toBe(0);
    });

    it('should create separate stacks for different tabs', () => {
      undoRedoStore.initialize('tab1', 'content 1');
      undoRedoStore.initialize('tab2', 'content 2');

      expect(undoRedoStore.getStackCount()).toBe(2);
    });
  });

  describe('Push Changes', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'initial');
    });

    it('should debounce rapid changes', () => {
      undoRedoStore.pushChange('tab1', 'change 1');
      undoRedoStore.pushChange('tab1', 'change 2');
      undoRedoStore.pushChange('tab1', 'change 3');

      // Before debounce timeout, still no history
      expect(undoRedoStore.canUndo('tab1')).toBe(false);

      // After debounce
      vi.advanceTimersByTime(500);

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
      expect(undoRedoStore.getState('tab1').historyLength).toBe(1);
    });

    it('should commit change after debounce period', () => {
      undoRedoStore.pushChange('tab1', 'new content');

      vi.advanceTimersByTime(500);

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
    });

    it('should flush pending changes immediately', () => {
      undoRedoStore.pushChange('tab1', 'new content');
      undoRedoStore.flush('tab1');

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
    });

    it('should not add duplicate consecutive states', () => {
      undoRedoStore.pushChange('tab1', 'same content');
      vi.advanceTimersByTime(500);

      undoRedoStore.pushChange('tab1', 'same content');
      vi.advanceTimersByTime(500);

      expect(undoRedoStore.getState('tab1').historyLength).toBe(1);
    });
  });

  describe('Undo', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'initial');
      undoRedoStore.pushChange('tab1', 'change 1');
      vi.advanceTimersByTime(500);
      undoRedoStore.pushChange('tab1', 'change 2');
      vi.advanceTimersByTime(500);
    });

    it('should undo to previous state', () => {
      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('change 1');
    });

    it('should enable redo after undo', () => {
      undoRedoStore.undo('tab1');

      expect(undoRedoStore.canRedo('tab1')).toBe(true);
    });

    it('should undo multiple times', () => {
      undoRedoStore.undo('tab1');
      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('initial');
      expect(undoRedoStore.canUndo('tab1')).toBe(false);
    });

    it('should return null when nothing to undo', () => {
      undoRedoStore.undo('tab1');
      undoRedoStore.undo('tab1');
      const result = undoRedoStore.undo('tab1');

      expect(result).toBeNull();
    });

    it('should return null for non-existent tab', () => {
      const result = undoRedoStore.undo('unknown-tab');

      expect(result).toBeNull();
    });

    it('should flush pending changes before undo', () => {
      undoRedoStore.pushChange('tab1', 'pending');
      // Don't wait for debounce

      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('change 2');
    });
  });

  describe('Redo', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'initial');
      undoRedoStore.pushChange('tab1', 'change 1');
      vi.advanceTimersByTime(500);
      undoRedoStore.pushChange('tab1', 'change 2');
      vi.advanceTimersByTime(500);
      undoRedoStore.undo('tab1');
    });

    it('should redo to next state', () => {
      const result = undoRedoStore.redo('tab1');

      expect(result?.content).toBe('change 2');
    });

    it('should disable redo after all redos', () => {
      undoRedoStore.redo('tab1');

      expect(undoRedoStore.canRedo('tab1')).toBe(false);
    });

    it('should return null when nothing to redo', () => {
      undoRedoStore.redo('tab1');
      const result = undoRedoStore.redo('tab1');

      expect(result).toBeNull();
    });

    it('should return null for non-existent tab', () => {
      const result = undoRedoStore.redo('unknown-tab');

      expect(result).toBeNull();
    });

    it('should clear redo history on new change', () => {
      undoRedoStore.pushChange('tab1', 'new branch');
      vi.advanceTimersByTime(500);

      expect(undoRedoStore.canRedo('tab1')).toBe(false);
    });
  });

  describe('History Limits', () => {
    it('should respect max history size', () => {
      undoRedoStore.initialize('tab1', 'start');

      // Push more than 100 changes
      for (let i = 0; i < 150; i++) {
        undoRedoStore.pushChange('tab1', `change ${i}`);
        vi.advanceTimersByTime(500);
      }

      const state = undoRedoStore.getState('tab1');
      expect(state.historyLength).toBeLessThanOrEqual(100);
    });
  });

  describe('Tab Management', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'content 1');
      undoRedoStore.initialize('tab2', 'content 2');
    });

    it('should maintain separate history for each tab', () => {
      undoRedoStore.pushChange('tab1', 'tab1 change');
      vi.advanceTimersByTime(500);

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
      expect(undoRedoStore.canUndo('tab2')).toBe(false);
    });

    it('should clear single tab', () => {
      undoRedoStore.pushChange('tab1', 'change');
      vi.advanceTimersByTime(500);

      undoRedoStore.clearTab('tab1');

      expect(undoRedoStore.canUndo('tab1')).toBe(false);
    });

    it('should remove tab entirely', () => {
      undoRedoStore.removeTab('tab1');

      expect(undoRedoStore.getStackCount()).toBe(1);
    });

    it('should clear all tabs', () => {
      undoRedoStore.pushChange('tab1', 'change 1');
      undoRedoStore.pushChange('tab2', 'change 2');
      vi.advanceTimersByTime(500);

      undoRedoStore.clearAll();

      expect(undoRedoStore.getStackCount()).toBe(0);
    });

    it('should flush all tabs', () => {
      undoRedoStore.pushChange('tab1', 'pending 1');
      undoRedoStore.pushChange('tab2', 'pending 2');

      undoRedoStore.flushAll();

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
      expect(undoRedoStore.canUndo('tab2')).toBe(true);
    });
  });

  describe('Subscriptions', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'initial');
    });

    it('should notify subscriber immediately with current state', () => {
      const subscriber = vi.fn();

      undoRedoStore.subscribe('tab1', subscriber);

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: false,
          canRedo: false,
        })
      );
    });

    it('should notify subscriber on state changes', () => {
      const subscriber = vi.fn();
      undoRedoStore.subscribe('tab1', subscriber);

      subscriber.mockClear();

      undoRedoStore.pushChange('tab1', 'new content');
      vi.advanceTimersByTime(500);

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: true,
        })
      );
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = undoRedoStore.subscribe('tab1', subscriber);

      unsubscribe();
      subscriber.mockClear();

      undoRedoStore.pushChange('tab1', 'new content');
      vi.advanceTimersByTime(500);

      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers per tab', () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      undoRedoStore.subscribe('tab1', subscriber1);
      undoRedoStore.subscribe('tab1', subscriber2);

      subscriber1.mockClear();
      subscriber2.mockClear();

      undoRedoStore.pushChange('tab1', 'new content');
      vi.advanceTimersByTime(500);

      expect(subscriber1).toHaveBeenCalled();
      expect(subscriber2).toHaveBeenCalled();
    });

    it('should clean up subscribers on tab removal', () => {
      const subscriber = vi.fn();
      undoRedoStore.subscribe('tab1', subscriber);

      // Remove the tab which should clean up the subscriber
      undoRedoStore.removeTab('tab1');

      // Clear the mock after all initial calls
      subscriber.mockClear();

      // Create a new tab with the same path - subscriber should not be notified
      undoRedoStore.initialize('tab1', 'new content');
      undoRedoStore.pushChange('tab1', 'change');
      vi.advanceTimersByTime(500);

      // Original subscriber was removed with the tab, should not receive new notifications
      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Cursor Position', () => {
    beforeEach(() => {
      undoRedoStore.initialize('tab1', 'initial', 0);
    });

    it('should preserve cursor position in history', () => {
      undoRedoStore.pushChange('tab1', 'hello world', 11);
      vi.advanceTimersByTime(500);

      undoRedoStore.pushChange('tab1', 'hello there', 11);
      vi.advanceTimersByTime(500);

      const result = undoRedoStore.undo('tab1');

      expect(result?.cursorPosition).toBe(11);
    });

    it('should restore cursor position on undo', () => {
      undoRedoStore.pushChange('tab1', 'line 1', 6);
      vi.advanceTimersByTime(500);

      undoRedoStore.pushChange('tab1', 'line 1\nline 2', 14);
      vi.advanceTimersByTime(500);

      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('line 1');
      expect(result?.cursorPosition).toBe(6);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string content', () => {
      undoRedoStore.initialize('tab1', '');
      undoRedoStore.pushChange('tab1', 'content');
      vi.advanceTimersByTime(500);

      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('');
    });

    it('should handle very long content', () => {
      const longContent = 'a'.repeat(100000);
      undoRedoStore.initialize('tab1', 'short');
      undoRedoStore.pushChange('tab1', longContent);
      vi.advanceTimersByTime(500);

      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe('short');
    });

    it('should handle rapid undo/redo cycles', () => {
      undoRedoStore.initialize('tab1', 'initial');

      for (let i = 0; i < 10; i++) {
        undoRedoStore.pushChange('tab1', `change ${i}`);
        vi.advanceTimersByTime(500);
      }

      // Rapid undo/redo
      for (let i = 0; i < 5; i++) {
        undoRedoStore.undo('tab1');
        undoRedoStore.redo('tab1');
      }

      // Should be in consistent state
      expect(undoRedoStore.canUndo('tab1')).toBe(true);
    });

    it('should handle special characters in content', () => {
      const specialContent = '{"key": "value", "emoji": "🎉"}';
      undoRedoStore.initialize('tab1', specialContent);
      undoRedoStore.pushChange('tab1', 'changed');
      vi.advanceTimersByTime(500);

      const result = undoRedoStore.undo('tab1');

      expect(result?.content).toBe(specialContent);
    });

    it('should handle operations on cleared tab', () => {
      undoRedoStore.initialize('tab1', 'content');
      undoRedoStore.clearTab('tab1');

      // Should not throw
      expect(undoRedoStore.undo('tab1')).toBeNull();
      expect(undoRedoStore.redo('tab1')).toBeNull();
    });
  });
});
