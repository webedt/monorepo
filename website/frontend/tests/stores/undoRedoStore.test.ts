/**
 * Tests for UndoRedoStore
 * Covers undo/redo history management for editor tabs including
 * per-tab stacks, debouncing, subscriptions, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import actual production classes
import { UndoRedoStack } from '../../src/lib/undoRedo';
import { UndoRedoManager } from '../../src/stores/undoRedoStore';

import type { UndoRedoState } from '../../src/lib/undoRedo';

describe('UndoRedoStack', () => {
  let stack: UndoRedoStack<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    stack = new UndoRedoStack<string>({ maxSize: 100, debounceMs: 500 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = stack.getState();

      expect(state.canUndo).toBe(false);
      expect(state.canRedo).toBe(false);
      expect(state.historyLength).toBe(0);
      expect(state.futureLength).toBe(0);
    });

    it('should return null for getCurrent before initialization', () => {
      expect(stack.getCurrent()).toBeNull();
    });
  });

  describe('Initialization', () => {
    it('should initialize with a state', () => {
      stack.initialize('initial content');

      expect(stack.getCurrent()).toBe('initial content');
      expect(stack.canUndo()).toBe(false);
      expect(stack.canRedo()).toBe(false);
    });

    it('should clear history on re-initialization', () => {
      stack.initialize('first');
      stack.push('second');
      vi.advanceTimersByTime(500);

      stack.initialize('new start');

      expect(stack.getCurrent()).toBe('new start');
      expect(stack.canUndo()).toBe(false);
    });
  });

  describe('Push and Debouncing', () => {
    beforeEach(() => {
      stack.initialize('initial');
    });

    it('should debounce rapid changes', () => {
      stack.push('change 1');
      stack.push('change 2');
      stack.push('change 3');

      // Before debounce timeout, still no history
      expect(stack.canUndo()).toBe(false);

      // After debounce
      vi.advanceTimersByTime(500);

      expect(stack.canUndo()).toBe(true);
      expect(stack.getState().historyLength).toBe(1);
    });

    it('should commit change after debounce period', () => {
      stack.push('new content');

      vi.advanceTimersByTime(500);

      expect(stack.canUndo()).toBe(true);
      expect(stack.getCurrent()).toBe('new content');
    });

    it('should flush pending changes immediately', () => {
      stack.push('new content');
      stack.flush();

      expect(stack.canUndo()).toBe(true);
    });

    it('should not add duplicate consecutive states', () => {
      stack.push('same content');
      vi.advanceTimersByTime(500);

      stack.push('same content');
      vi.advanceTimersByTime(500);

      expect(stack.getState().historyLength).toBe(1);
    });
  });

  describe('Undo', () => {
    beforeEach(() => {
      stack.initialize('initial');
      stack.push('change 1');
      vi.advanceTimersByTime(500);
      stack.push('change 2');
      vi.advanceTimersByTime(500);
    });

    it('should undo to previous state', () => {
      const result = stack.undo();

      expect(result).toBe('change 1');
    });

    it('should enable redo after undo', () => {
      stack.undo();

      expect(stack.canRedo()).toBe(true);
    });

    it('should undo multiple times', () => {
      stack.undo();
      const result = stack.undo();

      expect(result).toBe('initial');
      expect(stack.canUndo()).toBe(false);
    });

    it('should return null when nothing to undo', () => {
      stack.undo();
      stack.undo();
      const result = stack.undo();

      expect(result).toBeNull();
    });

    it('should flush pending changes before undo', () => {
      stack.push('pending');
      // Don't wait for debounce

      const result = stack.undo();

      expect(result).toBe('change 2');
    });
  });

  describe('Redo', () => {
    beforeEach(() => {
      stack.initialize('initial');
      stack.push('change 1');
      vi.advanceTimersByTime(500);
      stack.push('change 2');
      vi.advanceTimersByTime(500);
      stack.undo();
    });

    it('should redo to next state', () => {
      const result = stack.redo();

      expect(result).toBe('change 2');
    });

    it('should disable redo after all redos', () => {
      stack.redo();

      expect(stack.canRedo()).toBe(false);
    });

    it('should return null when nothing to redo', () => {
      stack.redo();
      const result = stack.redo();

      expect(result).toBeNull();
    });

    it('should clear redo history on new change', () => {
      stack.push('new branch');
      vi.advanceTimersByTime(500);

      expect(stack.canRedo()).toBe(false);
    });
  });

  describe('History Limits', () => {
    it('should respect max history size', () => {
      stack.initialize('start');

      // Push more than 100 changes
      for (let i = 0; i < 150; i++) {
        stack.push(`change ${i}`);
        vi.advanceTimersByTime(500);
      }

      const state = stack.getState();
      expect(state.historyLength).toBeLessThanOrEqual(100);
    });
  });

  describe('Clear and Reset', () => {
    beforeEach(() => {
      stack.initialize('initial');
      stack.push('change');
      vi.advanceTimersByTime(500);
    });

    it('should clear history but keep current state', () => {
      stack.clear();

      expect(stack.canUndo()).toBe(false);
      expect(stack.canRedo()).toBe(false);
    });

    it('should reset everything including current state', () => {
      stack.reset();

      expect(stack.getCurrent()).toBeNull();
      expect(stack.canUndo()).toBe(false);
      expect(stack.canRedo()).toBe(false);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscriber immediately with current state', () => {
      stack.initialize('initial');
      const subscriber = vi.fn();

      stack.subscribe(subscriber);

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: false,
          canRedo: false,
        })
      );
    });

    it('should notify subscriber on state changes', () => {
      stack.initialize('initial');
      const subscriber = vi.fn();
      stack.subscribe(subscriber);

      subscriber.mockClear();

      stack.push('new content');
      vi.advanceTimersByTime(500);

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: true,
        })
      );
    });

    it('should unsubscribe correctly', () => {
      stack.initialize('initial');
      const subscriber = vi.fn();
      const unsubscribe = stack.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      stack.push('new content');
      vi.advanceTimersByTime(500);

      expect(subscriber).not.toHaveBeenCalled();
    });
  });
});

describe('UndoRedoManager', () => {
  let undoRedoStore: UndoRedoManager;

  beforeEach(() => {
    vi.useFakeTimers();
    undoRedoStore = new UndoRedoManager();
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

      // Verify tabs are independent by modifying one
      undoRedoStore.pushChange('tab1', 'changed');
      vi.advanceTimersByTime(500);

      expect(undoRedoStore.canUndo('tab1')).toBe(true);
      expect(undoRedoStore.canUndo('tab2')).toBe(false);
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
      undoRedoStore.pushChange('tab1', 'change');
      vi.advanceTimersByTime(500);

      undoRedoStore.removeTab('tab1');

      // Tab is gone, returns default state
      expect(undoRedoStore.getState('tab1').historyLength).toBe(0);
    });

    it('should clear all tabs', () => {
      undoRedoStore.pushChange('tab1', 'change 1');
      undoRedoStore.pushChange('tab2', 'change 2');
      vi.advanceTimersByTime(500);

      undoRedoStore.clearAll();

      expect(undoRedoStore.canUndo('tab1')).toBe(false);
      expect(undoRedoStore.canUndo('tab2')).toBe(false);
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
