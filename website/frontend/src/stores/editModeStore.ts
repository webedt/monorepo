/**
 * Edit Mode Store
 * Manages scene editing mode state for the scene editor
 */

import { createStore } from '../lib/store';

/**
 * Available edit modes for scene editing
 */
export type EditMode = 'select' | 'pan' | 'draw-rectangle' | 'draw-circle' | 'draw-text';

/**
 * Selection handle being dragged during transform
 */
export type SelectionHandle =
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

/**
 * Transform operation in progress
 */
export interface ActiveTransform {
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

/**
 * Edit mode store state
 */
export interface EditModeState {
  /** Current active edit mode */
  mode: EditMode;
  /** Whether multi-select is active (holding Shift) */
  isMultiSelectActive: boolean;
  /** IDs of currently selected objects */
  selectedObjectIds: string[];
  /** Active transform operation (null if none) */
  activeTransform: ActiveTransform | null;
  /** Whether snapping is enabled */
  snapEnabled: boolean;
  /** Snap grid size in pixels */
  snapSize: number;
  /** Whether to show transform handles */
  showHandles: boolean;
  /** Whether to show selection bounding box */
  showBoundingBox: boolean;
  /** Clipboard for copy/paste operations */
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

export const editModeStore = createStore<EditModeState, {
  // Mode Management
  setMode: (mode: EditMode) => void;
  getMode: () => EditMode;

  // Selection Management
  selectObject: (objectId: string, addToSelection?: boolean) => void;
  deselectObject: (objectId: string) => void;
  selectObjects: (objectIds: string[]) => void;
  clearSelection: () => void;
  toggleObjectSelection: (objectId: string) => void;
  isObjectSelected: (objectId: string) => boolean;
  getSelectedObjectIds: () => string[];

  // Multi-select
  setMultiSelectActive: (active: boolean) => void;

  // Transform Operations
  startTransform: (handle: SelectionHandle, x: number, y: number, transform: ActiveTransform['startTransform']) => void;
  updateTransform: (x: number, y: number) => { deltaX: number; deltaY: number } | null;
  endTransform: () => void;
  getActiveTransform: () => ActiveTransform | null;

  // Snapping
  setSnapEnabled: (enabled: boolean) => void;
  setSnapSize: (size: number) => void;
  snapValue: (value: number) => number;

  // Display Options
  setShowHandles: (show: boolean) => void;
  setShowBoundingBox: (show: boolean) => void;

  // Clipboard
  copyToClipboard: (objectIds: string[]) => void;
  getClipboard: () => string[];
  clearClipboard: () => void;

  // Reset
  reset: () => void;
}>(
  DEFAULT_STATE,
  (set, get) => ({
    // Mode Management
    setMode(mode: EditMode): void {
      set({ mode });
    },

    getMode(): EditMode {
      return get().mode;
    },

    // Selection Management
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

    // Multi-select
    setMultiSelectActive(active: boolean): void {
      set({ isMultiSelectActive: active });
    },

    // Transform Operations
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

    // Snapping
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

    // Display Options
    setShowHandles(show: boolean): void {
      set({ showHandles: show });
    },

    setShowBoundingBox(show: boolean): void {
      set({ showBoundingBox: show });
    },

    // Clipboard
    copyToClipboard(objectIds: string[]): void {
      set({ clipboard: [...objectIds] });
    },

    getClipboard(): string[] {
      return get().clipboard;
    },

    clearClipboard(): void {
      set({ clipboard: [] });
    },

    // Reset
    reset(): void {
      set(DEFAULT_STATE);
    },
  })
);

export default editModeStore;
