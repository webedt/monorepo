/**
 * Constraint Store
 * Manages constraint state for scene objects
 */

import { createStore } from '../lib/store.js';

import type {
  Constraint,
  ObjectConstraints,
  ConstraintPreset,
  ConstraintSolverResult,
  ConstraintObjectData,
  ViewportBounds,
} from '../lib/constraints/types.js';
import {
  createPinConstraint,
  createMarginConstraint,
} from '../lib/constraints/types.js';
import { solveConstraints } from '../lib/constraints/resolver.js';

export interface ConstraintStoreState {
  /** All constraints indexed by constraint ID */
  constraints: Record<string, Constraint>;
  /** Object constraints grouping indexed by object ID */
  objectConstraints: Record<string, ObjectConstraints>;
  /** Currently selected constraint ID for editing */
  selectedConstraintId: string | null;
  /** Whether constraint visualization is enabled */
  showConstraints: boolean;
  /** Whether live preview is enabled */
  livePreview: boolean;
  /** Last solver result */
  lastSolverResult: ConstraintSolverResult | null;
}

const initialState: ConstraintStoreState = {
  constraints: {},
  objectConstraints: {},
  selectedConstraintId: null,
  showConstraints: true,
  livePreview: true,
  lastSolverResult: null,
};

// Helper function to add a constraint to state
function addConstraintToState(
  state: ConstraintStoreState,
  constraint: Constraint
): Partial<ConstraintStoreState> {
  // Add to constraints map
  const newConstraints = {
    ...state.constraints,
    [constraint.id]: constraint,
  };

  // Update object constraints grouping
  const objectId = constraint.objectId;
  const existingGroup = state.objectConstraints[objectId] || {
    objectId,
    constraints: [],
    horizontalBias: 0.5,
    verticalBias: 0.5,
  };

  const newObjectConstraints = {
    ...state.objectConstraints,
    [objectId]: {
      ...existingGroup,
      constraints: [...existingGroup.constraints, constraint],
    },
  };

  return {
    constraints: newConstraints,
    objectConstraints: newObjectConstraints,
  };
}

// Helper function to remove all constraints for an object
function removeObjectConstraintsFromState(
  state: ConstraintStoreState,
  objectId: string
): Partial<ConstraintStoreState> {
  const group = state.objectConstraints[objectId];
  if (!group) return {};

  // Remove all constraints for this object
  const constraintIds = group.constraints.map(c => c.id);
  const newConstraints = { ...state.constraints };
  for (const id of constraintIds) {
    delete newConstraints[id];
  }

  // Remove object constraint group
  const { [objectId]: _, ...remainingGroups } = state.objectConstraints;

  return {
    constraints: newConstraints,
    objectConstraints: remainingGroups,
    selectedConstraintId: constraintIds.includes(state.selectedConstraintId || '')
      ? null
      : state.selectedConstraintId,
  };
}

export const constraintStore = createStore<
  ConstraintStoreState,
  {
    // Constraint CRUD
    addConstraint: (constraint: Constraint) => void;
    updateConstraint: (id: string, updates: Partial<Constraint>) => void;
    removeConstraint: (id: string) => void;
    removeObjectConstraints: (objectId: string) => void;

    // Constraint selection
    selectConstraint: (id: string | null) => void;

    // Constraint presets
    applyPreset: (objectId: string, preset: ConstraintPreset) => void;

    // Object constraint management
    getConstraintsForObject: (objectId: string) => Constraint[];
    setObjectBias: (objectId: string, horizontal: number, vertical: number) => void;

    // Constraint solving
    solve: (objects: ConstraintObjectData[], viewport: ViewportBounds) => ConstraintSolverResult;

    // Visualization
    toggleShowConstraints: () => void;
    toggleLivePreview: () => void;

    // Bulk operations
    clearAllConstraints: () => void;
    importConstraints: (constraints: Constraint[]) => void;
    exportConstraints: () => Constraint[];

    // Constraint validation
    validateConstraint: (constraint: Constraint) => { valid: boolean; error?: string };

    // Duplicate constraints for copied objects
    duplicateConstraintsForObject: (sourceObjectId: string, targetObjectId: string) => void;
  }
>(initialState, (set, get) => ({
  addConstraint(constraint: Constraint): void {
    const state = get();
    set(addConstraintToState(state, constraint));
  },

  updateConstraint(id: string, updates: Partial<Constraint>): void {
    const state = get();
    const constraint = state.constraints[id];
    if (!constraint) return;

    const updatedConstraint = { ...constraint, ...updates } as Constraint;

    // Update constraints map
    const newConstraints = {
      ...state.constraints,
      [id]: updatedConstraint,
    };

    // Update in object constraints
    const objectId = constraint.objectId;
    const group = state.objectConstraints[objectId];
    if (group) {
      const newGroupConstraints = group.constraints.map(c =>
        c.id === id ? updatedConstraint : c
      );

      set({
        constraints: newConstraints,
        objectConstraints: {
          ...state.objectConstraints,
          [objectId]: {
            ...group,
            constraints: newGroupConstraints,
          },
        },
      });
    } else {
      set({ constraints: newConstraints });
    }
  },

  removeConstraint(id: string): void {
    const state = get();
    const constraint = state.constraints[id];
    if (!constraint) return;

    // Remove from constraints map
    const { [id]: _, ...remainingConstraints } = state.constraints;

    // Remove from object constraints
    const objectId = constraint.objectId;
    const group = state.objectConstraints[objectId];
    if (group) {
      const newGroupConstraints = group.constraints.filter(c => c.id !== id);

      let newObjectConstraints: Record<string, ObjectConstraints>;
      if (newGroupConstraints.length === 0) {
        // Remove the group entirely if no constraints remain
        const { [objectId]: __, ...remaining } = state.objectConstraints;
        newObjectConstraints = remaining;
      } else {
        newObjectConstraints = {
          ...state.objectConstraints,
          [objectId]: {
            ...group,
            constraints: newGroupConstraints,
          },
        };
      }

      set({
        constraints: remainingConstraints,
        objectConstraints: newObjectConstraints,
        selectedConstraintId:
          state.selectedConstraintId === id ? null : state.selectedConstraintId,
      });
    } else {
      set({
        constraints: remainingConstraints,
        selectedConstraintId:
          state.selectedConstraintId === id ? null : state.selectedConstraintId,
      });
    }
  },

  removeObjectConstraints(objectId: string): void {
    const state = get();
    set(removeObjectConstraintsFromState(state, objectId));
  },

  selectConstraint(id: string | null): void {
    set({ selectedConstraintId: id });
  },

  applyPreset(objectId: string, preset: ConstraintPreset): void {
    let state = get();

    // Clear existing constraints for this object
    const removeUpdates = removeObjectConstraintsFromState(state, objectId);
    state = { ...state, ...removeUpdates };

    const parent = { type: 'parent' as const };
    const constraintsToAdd: Constraint[] = [];

    switch (preset) {
      case 'pin-top-left':
        constraintsToAdd.push(createPinConstraint(objectId, 'top-left', parent, 'top-left', 0, 0));
        break;
      case 'pin-top-right':
        constraintsToAdd.push(createPinConstraint(objectId, 'top-right', parent, 'top-right', 0, 0));
        break;
      case 'pin-bottom-left':
        constraintsToAdd.push(createPinConstraint(objectId, 'bottom-left', parent, 'bottom-left', 0, 0));
        break;
      case 'pin-bottom-right':
        constraintsToAdd.push(createPinConstraint(objectId, 'bottom-right', parent, 'bottom-right', 0, 0));
        break;
      case 'pin-center':
        constraintsToAdd.push(createPinConstraint(objectId, 'center', parent, 'center', 0, 0));
        break;
      case 'fill-parent':
        constraintsToAdd.push(createMarginConstraint(objectId, parent, { top: 0, right: 0, bottom: 0, left: 0 }));
        break;
      case 'fill-width':
        constraintsToAdd.push(createMarginConstraint(objectId, parent, { left: 0, right: 0 }));
        break;
      case 'fill-height':
        constraintsToAdd.push(createMarginConstraint(objectId, parent, { top: 0, bottom: 0 }));
        break;
      case 'center-horizontal':
        constraintsToAdd.push(createPinConstraint(objectId, 'center-left', parent, 'center-left', 0, 0));
        break;
      case 'center-vertical':
        constraintsToAdd.push(createPinConstraint(objectId, 'top-center', parent, 'top-center', 0, 0));
        break;
      case 'center-both':
        constraintsToAdd.push(createPinConstraint(objectId, 'center', parent, 'center', 0, 0));
        break;
    }

    // Add all constraints
    for (const constraint of constraintsToAdd) {
      const addUpdates = addConstraintToState(state, constraint);
      state = { ...state, ...addUpdates };
    }

    set(state);
  },

  getConstraintsForObject(objectId: string): Constraint[] {
    const state = get();
    return state.objectConstraints[objectId]?.constraints || [];
  },

  setObjectBias(objectId: string, horizontal: number, vertical: number): void {
    const state = get();
    const group = state.objectConstraints[objectId];

    if (group) {
      set({
        objectConstraints: {
          ...state.objectConstraints,
          [objectId]: {
            ...group,
            horizontalBias: Math.max(0, Math.min(1, horizontal)),
            verticalBias: Math.max(0, Math.min(1, vertical)),
          },
        },
      });
    }
  },

  solve(objects: ConstraintObjectData[], viewport: ViewportBounds): ConstraintSolverResult {
    const state = get();
    const allConstraints = Object.values(state.constraints);

    const result = solveConstraints(objects, allConstraints, viewport);

    set({ lastSolverResult: result });

    return result;
  },

  toggleShowConstraints(): void {
    const state = get();
    set({ showConstraints: !state.showConstraints });
  },

  toggleLivePreview(): void {
    const state = get();
    set({ livePreview: !state.livePreview });
  },

  clearAllConstraints(): void {
    set({
      constraints: {},
      objectConstraints: {},
      selectedConstraintId: null,
      lastSolverResult: null,
    });
  },

  importConstraints(constraints: Constraint[]): void {
    let state = get();

    for (const constraint of constraints) {
      const addUpdates = addConstraintToState(state, constraint);
      state = { ...state, ...addUpdates };
    }

    set(state);
  },

  exportConstraints(): Constraint[] {
    const state = get();
    return Object.values(state.constraints);
  },

  validateConstraint(constraint: Constraint): { valid: boolean; error?: string } {
    // Basic validation
    if (!constraint.id) {
      return { valid: false, error: 'Constraint must have an ID' };
    }
    if (!constraint.objectId) {
      return { valid: false, error: 'Constraint must have an object ID' };
    }

    // Type-specific validation
    switch (constraint.type) {
      case 'pin':
        if (!constraint.sourceAnchor || !constraint.targetAnchor) {
          return { valid: false, error: 'Pin constraint requires source and target anchors' };
        }
        break;
      case 'size':
        if (constraint.value < 0) {
          return { valid: false, error: 'Size value cannot be negative' };
        }
        if (constraint.minValue !== undefined && constraint.maxValue !== undefined) {
          if (constraint.minValue > constraint.maxValue) {
            return { valid: false, error: 'Min value cannot exceed max value' };
          }
        }
        break;
      case 'aspectRatio':
        if (constraint.ratio <= 0) {
          return { valid: false, error: 'Aspect ratio must be positive' };
        }
        break;
      case 'chain':
        if (constraint.objectIds.length < 2) {
          return { valid: false, error: 'Chain constraint requires at least 2 objects' };
        }
        break;
    }

    return { valid: true };
  },

  duplicateConstraintsForObject(sourceObjectId: string, targetObjectId: string): void {
    let state = get();

    const sourceConstraints = state.objectConstraints[sourceObjectId]?.constraints || [];

    for (const constraint of sourceConstraints) {
      const duplicated = {
        ...constraint,
        id: `${constraint.type}-${crypto.randomUUID()}`,
        objectId: targetObjectId,
      } as Constraint;

      const addUpdates = addConstraintToState(state, duplicated);
      state = { ...state, ...addUpdates };
    }

    set(state);
  },
}));

export default constraintStore;
