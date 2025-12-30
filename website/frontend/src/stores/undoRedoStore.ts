/**
 * Undo/Redo Store
 * Manages per-user, per-tab undo/redo history for the code editor
 */

import { UndoRedoStack, createUndoRedoStack } from '../lib/undoRedo';

import type { UndoRedoState } from '../lib/undoRedo';

export type { UndoRedoState };

/**
 * Content state for a single editor tab
 */
export interface TabContentState {
  content: string;
  cursorPosition?: number;
}

/**
 * Undo/Redo manager for editor tabs
 * Each tab has its own independent history stack
 */
export class UndoRedoManager {
  private stacks: Map<string, UndoRedoStack<TabContentState>> = new Map();
  private subscribers: Map<string, Set<(state: UndoRedoState<TabContentState>) => void>> = new Map();

  /**
   * Get or create an undo/redo stack for a tab
   */
  private getStack(tabPath: string): UndoRedoStack<TabContentState> {
    if (!this.stacks.has(tabPath)) {
      const stack = createUndoRedoStack<TabContentState>({
        maxSize: 100,
        debounceMs: 500,
      });

      // Subscribe to stack changes and forward to tab-specific subscribers
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

  /**
   * Initialize history for a tab with initial content
   */
  initialize(tabPath: string, content: string, cursorPosition?: number): void {
    const stack = this.getStack(tabPath);
    stack.initialize({ content, cursorPosition });
  }

  /**
   * Record a content change for a tab
   */
  pushChange(tabPath: string, content: string, cursorPosition?: number): void {
    const stack = this.getStack(tabPath);
    stack.push({ content, cursorPosition });
  }

  /**
   * Undo the last change for a tab
   */
  undo(tabPath: string): TabContentState | null {
    const stack = this.stacks.get(tabPath);
    if (!stack) return null;
    return stack.undo();
  }

  /**
   * Redo the last undone change for a tab
   */
  redo(tabPath: string): TabContentState | null {
    const stack = this.stacks.get(tabPath);
    if (!stack) return null;
    return stack.redo();
  }

  /**
   * Check if undo is available for a tab
   */
  canUndo(tabPath: string): boolean {
    const stack = this.stacks.get(tabPath);
    return stack ? stack.canUndo() : false;
  }

  /**
   * Check if redo is available for a tab
   */
  canRedo(tabPath: string): boolean {
    const stack = this.stacks.get(tabPath);
    return stack ? stack.canRedo() : false;
  }

  /**
   * Get the undo/redo state for a tab
   */
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

  /**
   * Subscribe to undo/redo state changes for a specific tab
   */
  subscribe(
    tabPath: string,
    subscriber: (state: UndoRedoState<TabContentState>) => void
  ): () => void {
    let tabSubscribers = this.subscribers.get(tabPath);
    if (!tabSubscribers) {
      tabSubscribers = new Set();
      this.subscribers.set(tabPath, tabSubscribers);
    }
    tabSubscribers.add(subscriber);

    // Immediately notify with current state
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

  /**
   * Clear history for a specific tab
   */
  clearTab(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.clear();
    }
  }

  /**
   * Remove a tab's history entirely
   */
  removeTab(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.reset();
    }
    this.stacks.delete(tabPath);
    this.subscribers.delete(tabPath);
  }

  /**
   * Clear all history for all tabs
   */
  clearAll(): void {
    for (const stack of this.stacks.values()) {
      stack.reset();
    }
    this.stacks.clear();
    this.subscribers.clear();
  }

  /**
   * Flush any pending debounced changes for a tab
   */
  flush(tabPath: string): void {
    const stack = this.stacks.get(tabPath);
    if (stack) {
      stack.flush();
    }
  }

  /**
   * Flush all pending changes for all tabs
   */
  flushAll(): void {
    for (const stack of this.stacks.values()) {
      stack.flush();
    }
  }
}

// Singleton instance
export const undoRedoStore = new UndoRedoManager();
