/**
 * Tests for ConstraintStore
 * Covers constraint-based layout management, presets,
 * validation, and constraint solving.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the constraint resolver
vi.mock('../../src/lib/constraints/resolver.js', () => ({
  solveConstraints: vi.fn().mockReturnValue({
    solved: true,
    transforms: {},
    iterations: 1,
  }),
}));

// Mock constraint type creators
vi.mock('../../src/lib/constraints/types.js', () => ({
  createPinConstraint: vi.fn((objectId, sourceAnchor, target, targetAnchor, offsetX, offsetY) => ({
    id: `pin-${crypto.randomUUID()}`,
    type: 'pin',
    objectId,
    sourceAnchor,
    target,
    targetAnchor,
    offsetX,
    offsetY,
    priority: 1,
  })),
  createMarginConstraint: vi.fn((objectId, target, margins) => ({
    id: `margin-${crypto.randomUUID()}`,
    type: 'margin',
    objectId,
    target,
    margins,
    priority: 1,
  })),
}));

// Import after mocks
import { constraintStore } from '../../src/stores/constraintStore';
import { solveConstraints } from '../../src/lib/constraints/resolver.js';

import type { Constraint, ConstraintPreset } from '../../src/lib/constraints/types.js';

// Helper to create test constraints
const createPinConstraint = (objectId: string, overrides: Partial<Constraint> = {}): Constraint => ({
  id: `pin-${Date.now()}-${Math.random()}`,
  type: 'pin',
  objectId,
  sourceAnchor: 'top-left',
  target: { type: 'parent' },
  targetAnchor: 'top-left',
  offsetX: 0,
  offsetY: 0,
  priority: 1,
  ...overrides,
} as Constraint);

const createSizeConstraint = (objectId: string, overrides: Partial<Constraint> = {}): Constraint => ({
  id: `size-${Date.now()}-${Math.random()}`,
  type: 'size',
  objectId,
  axis: 'width',
  value: 100,
  priority: 1,
  ...overrides,
} as Constraint);

const createAspectRatioConstraint = (objectId: string, overrides: Partial<Constraint> = {}): Constraint => ({
  id: `aspect-${Date.now()}-${Math.random()}`,
  type: 'aspectRatio',
  objectId,
  ratio: 1.5,
  priority: 1,
  ...overrides,
} as Constraint);

const createChainConstraint = (objectId: string, overrides: Partial<Constraint> = {}): Constraint => ({
  id: `chain-${Date.now()}-${Math.random()}`,
  type: 'chain',
  objectId,
  objectIds: ['obj-1', 'obj-2', 'obj-3'],
  axis: 'horizontal',
  style: 'spread',
  priority: 1,
  ...overrides,
} as Constraint);

describe('ConstraintStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constraintStore.clearAllConstraints();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = constraintStore.getState();

      expect(state.constraints).toEqual({});
      expect(state.objectConstraints).toEqual({});
      expect(state.selectedConstraintId).toBeNull();
      expect(state.showConstraints).toBe(true);
      expect(state.livePreview).toBe(true);
      expect(state.lastSolverResult).toBeNull();
    });
  });

  describe('Constraint CRUD', () => {
    describe('addConstraint', () => {
      it('should add a constraint', () => {
        const constraint = createPinConstraint('obj-1');

        constraintStore.addConstraint(constraint);

        expect(constraintStore.getState().constraints[constraint.id]).toEqual(constraint);
      });

      it('should create object constraints group', () => {
        const constraint = createPinConstraint('obj-1');

        constraintStore.addConstraint(constraint);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group).toBeDefined();
        expect(group.objectId).toBe('obj-1');
        expect(group.constraints).toContainEqual(constraint);
      });

      it('should add to existing object constraints group', () => {
        const constraint1 = createPinConstraint('obj-1');
        const constraint2 = createSizeConstraint('obj-1');

        constraintStore.addConstraint(constraint1);
        constraintStore.addConstraint(constraint2);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.constraints.length).toBe(2);
      });

      it('should set default bias values', () => {
        const constraint = createPinConstraint('obj-1');

        constraintStore.addConstraint(constraint);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.horizontalBias).toBe(0.5);
        expect(group.verticalBias).toBe(0.5);
      });
    });

    describe('updateConstraint', () => {
      it('should update constraint properties', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);

        constraintStore.updateConstraint(constraint.id, { offsetX: 10 });

        expect(constraintStore.getState().constraints[constraint.id].offsetX).toBe(10);
      });

      it('should update constraint in object group', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);

        constraintStore.updateConstraint(constraint.id, { offsetX: 20 });

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.constraints[0].offsetX).toBe(20);
      });

      it('should do nothing for non-existent constraint', () => {
        constraintStore.updateConstraint('non-existent', { offsetX: 10 });

        expect(Object.keys(constraintStore.getState().constraints).length).toBe(0);
      });
    });

    describe('removeConstraint', () => {
      it('should remove a constraint', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);

        constraintStore.removeConstraint(constraint.id);

        expect(constraintStore.getState().constraints[constraint.id]).toBeUndefined();
      });

      it('should remove from object constraints group', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);

        constraintStore.removeConstraint(constraint.id);

        expect(constraintStore.getState().objectConstraints['obj-1']).toBeUndefined();
      });

      it('should remove group when last constraint removed', () => {
        const constraint1 = createPinConstraint('obj-1');
        const constraint2 = createSizeConstraint('obj-1');
        constraintStore.addConstraint(constraint1);
        constraintStore.addConstraint(constraint2);

        constraintStore.removeConstraint(constraint1.id);

        expect(constraintStore.getState().objectConstraints['obj-1']).toBeDefined();

        constraintStore.removeConstraint(constraint2.id);

        expect(constraintStore.getState().objectConstraints['obj-1']).toBeUndefined();
      });

      it('should clear selected constraint if removed', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);
        constraintStore.selectConstraint(constraint.id);

        constraintStore.removeConstraint(constraint.id);

        expect(constraintStore.getState().selectedConstraintId).toBeNull();
      });
    });

    describe('removeObjectConstraints', () => {
      it('should remove all constraints for an object', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));
        constraintStore.addConstraint(createSizeConstraint('obj-1'));
        constraintStore.addConstraint(createPinConstraint('obj-2'));

        constraintStore.removeObjectConstraints('obj-1');

        expect(constraintStore.getState().objectConstraints['obj-1']).toBeUndefined();
        expect(constraintStore.getState().objectConstraints['obj-2']).toBeDefined();
      });
    });
  });

  describe('Constraint Selection', () => {
    describe('selectConstraint', () => {
      it('should select a constraint', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);

        constraintStore.selectConstraint(constraint.id);

        expect(constraintStore.getState().selectedConstraintId).toBe(constraint.id);
      });

      it('should clear selection with null', () => {
        const constraint = createPinConstraint('obj-1');
        constraintStore.addConstraint(constraint);
        constraintStore.selectConstraint(constraint.id);

        constraintStore.selectConstraint(null);

        expect(constraintStore.getState().selectedConstraintId).toBeNull();
      });
    });
  });

  describe('Constraint Presets', () => {
    describe('applyPreset', () => {
      const presets: ConstraintPreset[] = [
        'pin-top-left',
        'pin-top-right',
        'pin-bottom-left',
        'pin-bottom-right',
        'pin-center',
        'fill-parent',
        'fill-width',
        'fill-height',
        'center-horizontal',
        'center-vertical',
        'center-both',
      ];

      it.each(presets)('should apply %s preset', (preset) => {
        constraintStore.applyPreset('obj-1', preset);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group).toBeDefined();
        expect(group.constraints.length).toBeGreaterThan(0);
      });

      it('should clear existing constraints before applying preset', () => {
        constraintStore.addConstraint(createSizeConstraint('obj-1'));
        constraintStore.addConstraint(createPinConstraint('obj-1'));

        constraintStore.applyPreset('obj-1', 'pin-center');

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.constraints.length).toBe(1);
      });
    });
  });

  describe('Object Bias', () => {
    describe('setObjectBias', () => {
      it('should set horizontal and vertical bias', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));

        constraintStore.setObjectBias('obj-1', 0.3, 0.7);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.horizontalBias).toBe(0.3);
        expect(group.verticalBias).toBe(0.7);
      });

      it('should clamp bias to 0-1 range', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));

        constraintStore.setObjectBias('obj-1', -0.5, 1.5);

        const group = constraintStore.getState().objectConstraints['obj-1'];
        expect(group.horizontalBias).toBe(0);
        expect(group.verticalBias).toBe(1);
      });

      it('should do nothing for non-existent object', () => {
        constraintStore.setObjectBias('non-existent', 0.5, 0.5);

        expect(constraintStore.getState().objectConstraints['non-existent']).toBeUndefined();
      });
    });
  });

  describe('Constraint Getters', () => {
    describe('getConstraintsForObject', () => {
      it('should return constraints for object', () => {
        const constraint1 = createPinConstraint('obj-1');
        const constraint2 = createSizeConstraint('obj-1');
        constraintStore.addConstraint(constraint1);
        constraintStore.addConstraint(constraint2);

        const constraints = constraintStore.getConstraintsForObject('obj-1');

        expect(constraints.length).toBe(2);
      });

      it('should return empty array for object without constraints', () => {
        const constraints = constraintStore.getConstraintsForObject('non-existent');

        expect(constraints).toEqual([]);
      });
    });
  });

  describe('Constraint Solving', () => {
    describe('solve', () => {
      it('should call solver with constraints', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));

        const objects = [{ id: 'obj-1', x: 0, y: 0, width: 100, height: 100 }];
        const viewport = { x: 0, y: 0, width: 800, height: 600 };

        constraintStore.solve(objects, viewport);

        expect(solveConstraints).toHaveBeenCalledWith(
          objects,
          expect.any(Array),
          viewport
        );
      });

      it('should store solver result', () => {
        const mockResult = { solved: true, transforms: {}, iterations: 5 };
        vi.mocked(solveConstraints).mockReturnValue(mockResult);

        constraintStore.solve([], { x: 0, y: 0, width: 800, height: 600 });

        expect(constraintStore.getState().lastSolverResult).toEqual(mockResult);
      });
    });
  });

  describe('Visualization Toggles', () => {
    describe('toggleShowConstraints', () => {
      it('should toggle constraint visibility', () => {
        expect(constraintStore.getState().showConstraints).toBe(true);

        constraintStore.toggleShowConstraints();
        expect(constraintStore.getState().showConstraints).toBe(false);

        constraintStore.toggleShowConstraints();
        expect(constraintStore.getState().showConstraints).toBe(true);
      });
    });

    describe('toggleLivePreview', () => {
      it('should toggle live preview', () => {
        expect(constraintStore.getState().livePreview).toBe(true);

        constraintStore.toggleLivePreview();
        expect(constraintStore.getState().livePreview).toBe(false);

        constraintStore.toggleLivePreview();
        expect(constraintStore.getState().livePreview).toBe(true);
      });
    });
  });

  describe('Bulk Operations', () => {
    describe('clearAllConstraints', () => {
      it('should clear all constraints', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));
        constraintStore.addConstraint(createPinConstraint('obj-2'));
        constraintStore.selectConstraint(Object.keys(constraintStore.getState().constraints)[0]);

        constraintStore.clearAllConstraints();

        const state = constraintStore.getState();
        expect(state.constraints).toEqual({});
        expect(state.objectConstraints).toEqual({});
        expect(state.selectedConstraintId).toBeNull();
        expect(state.lastSolverResult).toBeNull();
      });
    });

    describe('importConstraints', () => {
      it('should import multiple constraints', () => {
        const constraints = [
          createPinConstraint('obj-1'),
          createSizeConstraint('obj-1'),
          createPinConstraint('obj-2'),
        ];

        constraintStore.importConstraints(constraints);

        expect(Object.keys(constraintStore.getState().constraints).length).toBe(3);
      });
    });

    describe('exportConstraints', () => {
      it('should export all constraints', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));
        constraintStore.addConstraint(createSizeConstraint('obj-2'));

        const exported = constraintStore.exportConstraints();

        expect(exported.length).toBe(2);
      });
    });
  });

  describe('Constraint Validation', () => {
    describe('validateConstraint', () => {
      it('should validate constraint with ID', () => {
        const constraint = createPinConstraint('obj-1');
        delete (constraint as { id?: string }).id;

        const result = constraintStore.validateConstraint(constraint as Constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('ID');
      });

      it('should validate constraint with objectId', () => {
        const constraint = createPinConstraint('');

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('object ID');
      });

      it('should validate pin constraint anchors', () => {
        const constraint = createPinConstraint('obj-1');
        delete (constraint as { sourceAnchor?: string }).sourceAnchor;

        const result = constraintStore.validateConstraint(constraint as Constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('anchor');
      });

      it('should validate size constraint value', () => {
        const constraint = createSizeConstraint('obj-1', { value: -10 });

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('negative');
      });

      it('should validate size constraint min/max', () => {
        const constraint = createSizeConstraint('obj-1', { minValue: 100, maxValue: 50 });

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Min value');
      });

      it('should validate aspect ratio positivity', () => {
        const constraint = createAspectRatioConstraint('obj-1', { ratio: 0 });

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('positive');
      });

      it('should validate chain constraint object count', () => {
        const constraint = createChainConstraint('obj-1', { objectIds: ['obj-1'] });

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(false);
        expect(result.error).toContain('at least 2');
      });

      it('should return valid for valid constraints', () => {
        const constraint = createPinConstraint('obj-1');

        const result = constraintStore.validateConstraint(constraint);

        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    });
  });

  describe('Duplicate Constraints', () => {
    describe('duplicateConstraintsForObject', () => {
      it('should duplicate all constraints to new object', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));
        constraintStore.addConstraint(createSizeConstraint('obj-1'));

        constraintStore.duplicateConstraintsForObject('obj-1', 'obj-2');

        const obj2Constraints = constraintStore.getConstraintsForObject('obj-2');
        expect(obj2Constraints.length).toBe(2);
      });

      it('should create new IDs for duplicated constraints', () => {
        const original = createPinConstraint('obj-1');
        constraintStore.addConstraint(original);

        constraintStore.duplicateConstraintsForObject('obj-1', 'obj-2');

        const obj2Constraints = constraintStore.getConstraintsForObject('obj-2');
        expect(obj2Constraints[0].id).not.toBe(original.id);
      });

      it('should update objectId in duplicated constraints', () => {
        constraintStore.addConstraint(createPinConstraint('obj-1'));

        constraintStore.duplicateConstraintsForObject('obj-1', 'obj-2');

        const obj2Constraints = constraintStore.getConstraintsForObject('obj-2');
        expect(obj2Constraints[0].objectId).toBe('obj-2');
      });
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      constraintStore.subscribe(subscriber);

      constraintStore.addConstraint(createPinConstraint('obj-1'));

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = constraintStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      constraintStore.addConstraint(createPinConstraint('obj-1'));

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle many constraints', () => {
      for (let i = 0; i < 100; i++) {
        constraintStore.addConstraint(createPinConstraint(`obj-${i}`));
      }

      expect(Object.keys(constraintStore.getState().constraints).length).toBe(100);
    });

    it('should handle rapid constraint updates', () => {
      const constraint = createPinConstraint('obj-1');
      constraintStore.addConstraint(constraint);

      for (let i = 0; i < 50; i++) {
        constraintStore.updateConstraint(constraint.id, { offsetX: i });
      }

      expect(constraintStore.getState().constraints[constraint.id].offsetX).toBe(49);
    });
  });
});
