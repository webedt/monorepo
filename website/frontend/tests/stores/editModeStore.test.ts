/**
 * Tests for EditModeStore
 * Covers scene editing mode state management including selection,
 * transform operations, snapping, clipboard, and display options.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, Store } from '../../src/lib/store';

type EditMode = 'select' | 'pan' | 'draw-rectangle' | 'draw-circle' | 'draw-text';

type SelectionHandle =
  | 'move'
  | 'rotate'
  | 'scale-nw'
  | 'scale-n'
  | 'scale-ne'
  | 'scale-e'
  | 'scale-se'
  | 'scale-s'
  | 'scale-sw'
  | 'scale-w';

interface ActiveTransform {
  handle: SelectionHandle;
  startX: number;
  startY: number;
  startTransform: {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
}

interface EditModeState {
  mode: EditMode;
  isMultiSelectActive: boolean;
  selectedObjectIds: string[];
  activeTransform: ActiveTransform | null;
  snapEnabled: boolean;
  snapSize: number;
  showHandles: boolean;
  showBoundingBox: boolean;
  clipboard: string[];
}

const DEFAULT_STATE: EditModeState = {
  mode: 'select',
  isMultiSelectActive: false,
  selectedObjectIds: [],
  activeTransform: null,
  snapEnabled: true,
  snapSize: 8,
  showHandles: true,
  showBoundingBox: true,
  clipboard: [],
};

// Create a fresh store instance for testing
function createTestEditModeStore() {
  return createStore<EditModeState, {
    setMode: (mode: EditMode) => void;
    getMode: () => EditMode;
    selectObject: (objectId: string, addToSelection?: boolean) => void;
    deselectObject: (objectId: string) => void;
    selectObjects: (objectIds: string[]) => void;
    clearSelection: () => void;
    toggleObjectSelection: (objectId: string) => void;
    isObjectSelected: (objectId: string) => boolean;
    getSelectedObjectIds: () => string[];
    setMultiSelectActive: (active: boolean) => void;
    startTransform: (handle: SelectionHandle, x: number, y: number, transform: ActiveTransform['startTransform']) => void;
    updateTransform: (x: number, y: number) => { deltaX: number; deltaY: number } | null;
    endTransform: () => void;
    getActiveTransform: () => ActiveTransform | null;
    setSnapEnabled: (enabled: boolean) => void;
    setSnapSize: (size: number) => void;
    snapValue: (value: number) => number;
    setShowHandles: (show: boolean) => void;
    setShowBoundingBox: (show: boolean) => void;
    copyToClipboard: (objectIds: string[]) => void;
    getClipboard: () => string[];
    clearClipboard: () => void;
    reset: () => void;
  }>(
    { ...DEFAULT_STATE },
    (set, get) => ({
      setMode(mode: EditMode): void {
        set({ mode });
      },

      getMode(): EditMode {
        return get().mode;
      },

      selectObject(objectId: string, addToSelection = false): void {
        const state = get();
        if (addToSelection || state.isMultiSelectActive) {
          if (!state.selectedObjectIds.includes(objectId)) {
            set({ selectedObjectIds: [...state.selectedObjectIds, objectId] });
          }
        } else {
          set({ selectedObjectIds: [objectId] });
        }
      },

      deselectObject(objectId: string): void {
        const state = get();
        set({
          selectedObjectIds: state.selectedObjectIds.filter(id => id !== objectId),
        });
      },

      selectObjects(objectIds: string[]): void {
        set({ selectedObjectIds: [...objectIds] });
      },

      clearSelection(): void {
        set({ selectedObjectIds: [] });
      },

      toggleObjectSelection(objectId: string): void {
        const state = get();
        if (state.selectedObjectIds.includes(objectId)) {
          set({
            selectedObjectIds: state.selectedObjectIds.filter(id => id !== objectId),
          });
        } else {
          set({
            selectedObjectIds: [...state.selectedObjectIds, objectId],
          });
        }
      },

      isObjectSelected(objectId: string): boolean {
        return get().selectedObjectIds.includes(objectId);
      },

      getSelectedObjectIds(): string[] {
        return get().selectedObjectIds;
      },

      setMultiSelectActive(active: boolean): void {
        set({ isMultiSelectActive: active });
      },

      startTransform(
        handle: SelectionHandle,
        x: number,
        y: number,
        transform: ActiveTransform['startTransform']
      ): void {
        set({
          activeTransform: {
            handle,
            startX: x,
            startY: y,
            startTransform: { ...transform },
          },
        });
      },

      updateTransform(x: number, y: number): { deltaX: number; deltaY: number } | null {
        const state = get();
        if (!state.activeTransform) return null;

        const deltaX = x - state.activeTransform.startX;
        const deltaY = y - state.activeTransform.startY;

        return { deltaX, deltaY };
      },

      endTransform(): void {
        set({ activeTransform: null });
      },

      getActiveTransform(): ActiveTransform | null {
        return get().activeTransform;
      },

      setSnapEnabled(enabled: boolean): void {
        set({ snapEnabled: enabled });
      },

      setSnapSize(size: number): void {
        set({ snapSize: Math.max(1, size) });
      },

      snapValue(value: number): number {
        const state = get();
        if (!state.snapEnabled) return value;
        return Math.round(value / state.snapSize) * state.snapSize;
      },

      setShowHandles(show: boolean): void {
        set({ showHandles: show });
      },

      setShowBoundingBox(show: boolean): void {
        set({ showBoundingBox: show });
      },

      copyToClipboard(objectIds: string[]): void {
        set({ clipboard: [...objectIds] });
      },

      getClipboard(): string[] {
        return get().clipboard;
      },

      clearClipboard(): void {
        set({ clipboard: [] });
      },

      reset(): void {
        set({ ...DEFAULT_STATE });
      },
    })
  );
}

describe('EditModeStore', () => {
  let editModeStore: ReturnType<typeof createTestEditModeStore>;

  beforeEach(() => {
    editModeStore = createTestEditModeStore();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = editModeStore.getState();

      expect(state.mode).toBe('select');
      expect(state.isMultiSelectActive).toBe(false);
      expect(state.selectedObjectIds).toEqual([]);
      expect(state.activeTransform).toBeNull();
      expect(state.snapEnabled).toBe(true);
      expect(state.snapSize).toBe(8);
      expect(state.showHandles).toBe(true);
      expect(state.showBoundingBox).toBe(true);
      expect(state.clipboard).toEqual([]);
    });
  });

  describe('Mode Management', () => {
    it('should set edit mode', () => {
      editModeStore.setMode('pan');

      expect(editModeStore.getMode()).toBe('pan');
    });

    it('should change between all modes', () => {
      const modes: EditMode[] = ['select', 'pan', 'draw-rectangle', 'draw-circle', 'draw-text'];

      for (const mode of modes) {
        editModeStore.setMode(mode);
        expect(editModeStore.getMode()).toBe(mode);
      }
    });

    it('should update state on mode change', () => {
      editModeStore.setMode('draw-rectangle');

      expect(editModeStore.getState().mode).toBe('draw-rectangle');
    });
  });

  describe('Selection Management', () => {
    describe('selectObject', () => {
      it('should select a single object', () => {
        editModeStore.selectObject('obj-1');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1']);
      });

      it('should replace selection by default', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.selectObject('obj-2');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-2']);
      });

      it('should add to selection when addToSelection is true', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.selectObject('obj-2', true);

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1', 'obj-2']);
      });

      it('should add to selection when multiSelect is active', () => {
        editModeStore.setMultiSelectActive(true);
        editModeStore.selectObject('obj-1');
        editModeStore.selectObject('obj-2');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1', 'obj-2']);
      });

      it('should not duplicate objects in selection', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.selectObject('obj-1', true);

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1']);
      });
    });

    describe('deselectObject', () => {
      it('should deselect a specific object', () => {
        editModeStore.selectObjects(['obj-1', 'obj-2', 'obj-3']);
        editModeStore.deselectObject('obj-2');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1', 'obj-3']);
      });

      it('should handle deselecting non-existent object', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.deselectObject('non-existent');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1']);
      });
    });

    describe('selectObjects', () => {
      it('should select multiple objects at once', () => {
        editModeStore.selectObjects(['obj-1', 'obj-2', 'obj-3']);

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-1', 'obj-2', 'obj-3']);
      });

      it('should replace existing selection', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.selectObjects(['obj-2', 'obj-3']);

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-2', 'obj-3']);
      });

      it('should handle empty array', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.selectObjects([]);

        expect(editModeStore.getSelectedObjectIds()).toEqual([]);
      });
    });

    describe('clearSelection', () => {
      it('should clear all selections', () => {
        editModeStore.selectObjects(['obj-1', 'obj-2', 'obj-3']);
        editModeStore.clearSelection();

        expect(editModeStore.getSelectedObjectIds()).toEqual([]);
      });
    });

    describe('toggleObjectSelection', () => {
      it('should add object if not selected', () => {
        editModeStore.toggleObjectSelection('obj-1');

        expect(editModeStore.isObjectSelected('obj-1')).toBe(true);
      });

      it('should remove object if selected', () => {
        editModeStore.selectObject('obj-1');
        editModeStore.toggleObjectSelection('obj-1');

        expect(editModeStore.isObjectSelected('obj-1')).toBe(false);
      });

      it('should preserve other selections', () => {
        editModeStore.selectObjects(['obj-1', 'obj-2']);
        editModeStore.toggleObjectSelection('obj-1');

        expect(editModeStore.getSelectedObjectIds()).toEqual(['obj-2']);
      });
    });

    describe('isObjectSelected', () => {
      it('should return true for selected object', () => {
        editModeStore.selectObject('obj-1');

        expect(editModeStore.isObjectSelected('obj-1')).toBe(true);
      });

      it('should return false for unselected object', () => {
        expect(editModeStore.isObjectSelected('obj-1')).toBe(false);
      });
    });
  });

  describe('Multi-Select', () => {
    it('should enable multi-select mode', () => {
      editModeStore.setMultiSelectActive(true);

      expect(editModeStore.getState().isMultiSelectActive).toBe(true);
    });

    it('should disable multi-select mode', () => {
      editModeStore.setMultiSelectActive(true);
      editModeStore.setMultiSelectActive(false);

      expect(editModeStore.getState().isMultiSelectActive).toBe(false);
    });
  });

  describe('Transform Operations', () => {
    const mockTransform = {
      x: 100,
      y: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };

    describe('startTransform', () => {
      it('should start a move transform', () => {
        editModeStore.startTransform('move', 50, 50, mockTransform);

        const transform = editModeStore.getActiveTransform();
        expect(transform).not.toBeNull();
        expect(transform?.handle).toBe('move');
        expect(transform?.startX).toBe(50);
        expect(transform?.startY).toBe(50);
      });

      it('should preserve start transform values', () => {
        editModeStore.startTransform('rotate', 50, 50, mockTransform);

        const transform = editModeStore.getActiveTransform();
        expect(transform?.startTransform).toEqual(mockTransform);
      });

      it('should support all handle types', () => {
        const handles: SelectionHandle[] = [
          'move', 'rotate', 'scale-nw', 'scale-n', 'scale-ne',
          'scale-e', 'scale-se', 'scale-s', 'scale-sw', 'scale-w'
        ];

        for (const handle of handles) {
          editModeStore.startTransform(handle, 0, 0, mockTransform);
          expect(editModeStore.getActiveTransform()?.handle).toBe(handle);
        }
      });
    });

    describe('updateTransform', () => {
      it('should calculate delta from start position', () => {
        editModeStore.startTransform('move', 100, 100, mockTransform);

        const delta = editModeStore.updateTransform(150, 120);

        expect(delta).toEqual({ deltaX: 50, deltaY: 20 });
      });

      it('should return null when no transform active', () => {
        const delta = editModeStore.updateTransform(100, 100);

        expect(delta).toBeNull();
      });

      it('should handle negative deltas', () => {
        editModeStore.startTransform('move', 100, 100, mockTransform);

        const delta = editModeStore.updateTransform(50, 80);

        expect(delta).toEqual({ deltaX: -50, deltaY: -20 });
      });
    });

    describe('endTransform', () => {
      it('should clear active transform', () => {
        editModeStore.startTransform('move', 50, 50, mockTransform);
        editModeStore.endTransform();

        expect(editModeStore.getActiveTransform()).toBeNull();
      });
    });
  });

  describe('Snapping', () => {
    describe('setSnapEnabled', () => {
      it('should enable snapping', () => {
        editModeStore.setSnapEnabled(false);
        editModeStore.setSnapEnabled(true);

        expect(editModeStore.getState().snapEnabled).toBe(true);
      });

      it('should disable snapping', () => {
        editModeStore.setSnapEnabled(false);

        expect(editModeStore.getState().snapEnabled).toBe(false);
      });
    });

    describe('setSnapSize', () => {
      it('should set snap size', () => {
        editModeStore.setSnapSize(16);

        expect(editModeStore.getState().snapSize).toBe(16);
      });

      it('should enforce minimum snap size of 1', () => {
        editModeStore.setSnapSize(0);
        expect(editModeStore.getState().snapSize).toBe(1);

        editModeStore.setSnapSize(-5);
        expect(editModeStore.getState().snapSize).toBe(1);
      });
    });

    describe('snapValue', () => {
      it('should snap value to grid', () => {
        editModeStore.setSnapSize(8);

        expect(editModeStore.snapValue(10)).toBe(8);
        expect(editModeStore.snapValue(15)).toBe(16);
        expect(editModeStore.snapValue(24)).toBe(24);
      });

      it('should return original value when snapping disabled', () => {
        editModeStore.setSnapEnabled(false);

        expect(editModeStore.snapValue(10)).toBe(10);
        expect(editModeStore.snapValue(15)).toBe(15);
      });

      it('should handle different snap sizes', () => {
        editModeStore.setSnapSize(10);

        expect(editModeStore.snapValue(14)).toBe(10);
        expect(editModeStore.snapValue(15)).toBe(20);
        expect(editModeStore.snapValue(25)).toBe(30);
      });

      it('should handle zero value', () => {
        expect(editModeStore.snapValue(0)).toBe(0);
      });

      it('should handle negative values', () => {
        editModeStore.setSnapSize(8);

        expect(editModeStore.snapValue(-10)).toBe(-8);
        expect(editModeStore.snapValue(-15)).toBe(-16);
      });
    });
  });

  describe('Display Options', () => {
    describe('setShowHandles', () => {
      it('should show handles', () => {
        editModeStore.setShowHandles(false);
        editModeStore.setShowHandles(true);

        expect(editModeStore.getState().showHandles).toBe(true);
      });

      it('should hide handles', () => {
        editModeStore.setShowHandles(false);

        expect(editModeStore.getState().showHandles).toBe(false);
      });
    });

    describe('setShowBoundingBox', () => {
      it('should show bounding box', () => {
        editModeStore.setShowBoundingBox(false);
        editModeStore.setShowBoundingBox(true);

        expect(editModeStore.getState().showBoundingBox).toBe(true);
      });

      it('should hide bounding box', () => {
        editModeStore.setShowBoundingBox(false);

        expect(editModeStore.getState().showBoundingBox).toBe(false);
      });
    });
  });

  describe('Clipboard', () => {
    describe('copyToClipboard', () => {
      it('should copy object IDs to clipboard', () => {
        editModeStore.copyToClipboard(['obj-1', 'obj-2']);

        expect(editModeStore.getClipboard()).toEqual(['obj-1', 'obj-2']);
      });

      it('should replace existing clipboard contents', () => {
        editModeStore.copyToClipboard(['obj-1']);
        editModeStore.copyToClipboard(['obj-2', 'obj-3']);

        expect(editModeStore.getClipboard()).toEqual(['obj-2', 'obj-3']);
      });

      it('should create independent copy', () => {
        const ids = ['obj-1', 'obj-2'];
        editModeStore.copyToClipboard(ids);

        ids.push('obj-3');

        expect(editModeStore.getClipboard()).toEqual(['obj-1', 'obj-2']);
      });
    });

    describe('clearClipboard', () => {
      it('should clear clipboard contents', () => {
        editModeStore.copyToClipboard(['obj-1', 'obj-2']);
        editModeStore.clearClipboard();

        expect(editModeStore.getClipboard()).toEqual([]);
      });
    });
  });

  describe('Reset', () => {
    it('should reset all state to defaults', () => {
      // Modify all state
      editModeStore.setMode('pan');
      editModeStore.setMultiSelectActive(true);
      editModeStore.selectObjects(['obj-1', 'obj-2']);
      editModeStore.startTransform('move', 50, 50, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      editModeStore.setSnapEnabled(false);
      editModeStore.setSnapSize(16);
      editModeStore.setShowHandles(false);
      editModeStore.setShowBoundingBox(false);
      editModeStore.copyToClipboard(['obj-1']);

      // Reset
      editModeStore.reset();

      // Verify all defaults
      const state = editModeStore.getState();
      expect(state.mode).toBe('select');
      expect(state.isMultiSelectActive).toBe(false);
      expect(state.selectedObjectIds).toEqual([]);
      expect(state.activeTransform).toBeNull();
      expect(state.snapEnabled).toBe(true);
      expect(state.snapSize).toBe(8);
      expect(state.showHandles).toBe(true);
      expect(state.showBoundingBox).toBe(true);
      expect(state.clipboard).toEqual([]);
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      editModeStore.subscribe(subscriber);

      editModeStore.setMode('pan');

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'pan' }),
        expect.objectContaining({ mode: 'select' })
      );
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = editModeStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      editModeStore.setMode('pan');

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle selecting many objects', () => {
      const ids = Array.from({ length: 1000 }, (_, i) => `obj-${i}`);
      editModeStore.selectObjects(ids);

      expect(editModeStore.getSelectedObjectIds().length).toBe(1000);
    });

    it('should handle rapid mode changes', () => {
      const modes: EditMode[] = ['select', 'pan', 'draw-rectangle', 'draw-circle', 'draw-text'];

      for (let i = 0; i < 100; i++) {
        editModeStore.setMode(modes[i % modes.length]);
      }

      // Should be in consistent state
      expect(editModeStore.getMode()).toBeDefined();
    });

    it('should handle transform operations without selection', () => {
      const mockTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

      // Should not throw
      editModeStore.startTransform('move', 50, 50, mockTransform);
      editModeStore.updateTransform(100, 100);
      editModeStore.endTransform();

      expect(editModeStore.getActiveTransform()).toBeNull();
    });
  });
});
