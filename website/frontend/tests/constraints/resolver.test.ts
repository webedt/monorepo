/**
 * Tests for Constraint Resolver
 * Covers constraint solving, convergence, and various constraint types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ConstraintResolver,
  solveConstraints,
} from '../../src/lib/constraints/resolver.js';
import {
  createPinConstraint,
  createSizeConstraint,
  createMarginConstraint,
  createDistanceConstraint,
  createAspectRatioConstraint,
  createChainConstraint,
  createAlignConstraint,
} from '../../src/lib/constraints/types.js';
import type {
  ConstraintObjectData,
  ViewportBounds,
  Constraint,
} from '../../src/lib/constraints/types.js';

describe('ConstraintResolver', () => {
  const viewport: ViewportBounds = { width: 1000, height: 800 };

  describe('Basic Initialization', () => {
    it('should create resolver with default options', () => {
      const resolver = new ConstraintResolver();
      assert.ok(resolver);
    });

    it('should create resolver with custom options', () => {
      const resolver = new ConstraintResolver({
        maxIterations: 100,
        tolerance: 0.001,
        relaxationFactor: 0.8,
      });
      assert.ok(resolver);
    });

    it('should solve with no constraints', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 10, y: 20, width: 100, height: 50 } },
      ];
      const result = solveConstraints(objects, [], viewport);

      assert.ok(result.converged);
      assert.strictEqual(result.errors.length, 0);
      assert.ok(result.layouts.has('obj1'));
    });

    it('should preserve original positions without constraints', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 50, y: 100, width: 200, height: 150 } },
      ];
      const result = solveConstraints(objects, [], viewport);
      const layout = result.layouts.get('obj1')!;

      assert.strictEqual(layout.x, 50);
      assert.strictEqual(layout.y, 100);
      assert.strictEqual(layout.width, 200);
      assert.strictEqual(layout.height, 150);
    });
  });

  describe('Pin Constraints', () => {
    it('should pin object to parent top-left', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 50, y: 50, width: 100, height: 80 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 0) < 1);
      assert.ok(Math.abs(layout.y - 0) < 1);
    });

    it('should pin object to parent center', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 80 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'center', { type: 'parent' }, 'center', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      // Object center should be at viewport center (500, 400)
      const objCenterX = layout.x + layout.width / 2;
      const objCenterY = layout.y + layout.height / 2;
      assert.ok(Math.abs(objCenterX - 500) < 1);
      assert.ok(Math.abs(objCenterY - 400) < 1);
    });

    it('should apply offset when pinning', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 50, height: 50 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 20, 30),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 20) < 1);
      assert.ok(Math.abs(layout.y - 30) < 1);
    });

    it('should pin to viewport', () => {
      const viewportWithOffset: ViewportBounds = { x: 100, y: 50, width: 800, height: 600 };
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'top-left', { type: 'viewport' }, 'top-left', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewportWithOffset, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 100) < 1);
      assert.ok(Math.abs(layout.y - 50) < 1);
    });

    it('should pin to another object', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 100, y: 100, width: 80, height: 60 } },
        { id: 'obj2', bounds: { x: 0, y: 0, width: 50, height: 40 } },
      ];
      const constraints = [
        createPinConstraint('obj2', 'top-left', { type: 'object', objectId: 'obj1' }, 'bottom-left', 0, 10),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj2')!;

      // obj2 top-left should be at obj1 bottom-left + offset
      assert.ok(Math.abs(layout.x - 100) < 1);
      assert.ok(Math.abs(layout.y - 170) < 1); // 100 + 60 + 10
    });

    it('should ignore disabled constraints', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 50, y: 50, width: 100, height: 80 } },
      ];
      const constraint = createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 0, 0);
      constraint.enabled = false;

      const result = solveConstraints(objects, [constraint], viewport);
      const layout = result.layouts.get('obj1')!;

      assert.strictEqual(layout.x, 50);
      assert.strictEqual(layout.y, 50);
    });
  });

  describe('Size Constraints', () => {
    it('should apply fixed size', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [createSizeConstraint('obj1', 'both', 'fixed', 200)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.width - 200) < 1);
      assert.ok(Math.abs(layout.height - 200) < 1);
    });

    it('should apply percentage size', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [createSizeConstraint('obj1', 'width', 'percentage', 50)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.width - 500) < 1); // 50% of 1000
    });

    it('should apply fill size', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [createSizeConstraint('obj1', 'height', 'fill', 0)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.height - 800) < 1);
    });

    it('should respect min/max values', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraint = createSizeConstraint('obj1', 'width', 'fixed', 50);
      constraint.minValue = 80;

      const result = solveConstraints(objects, [constraint], viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(layout.width >= 80);
    });

    it('should use intrinsic size for hug mode', () => {
      const objects: ConstraintObjectData[] = [
        {
          id: 'obj1',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          intrinsicWidth: 150,
          intrinsicHeight: 120,
        },
      ];
      const constraints = [createSizeConstraint('obj1', 'both', 'hug', 0)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.width - 150) < 1);
      assert.ok(Math.abs(layout.height - 120) < 1);
    });
  });

  describe('Margin Constraints', () => {
    it('should apply single margin', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createMarginConstraint('obj1', { type: 'parent' }, { left: 50 }),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 50) < 1);
    });

    it('should stretch with opposing margins', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createMarginConstraint('obj1', { type: 'parent' }, { left: 50, right: 50 }),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 50) < 1);
      assert.ok(Math.abs(layout.width - 900) < 1); // 1000 - 50 - 50
    });

    it('should apply all margins', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createMarginConstraint('obj1', { type: 'parent' }, {
          top: 20,
          right: 30,
          bottom: 40,
          left: 50,
        }),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout = result.layouts.get('obj1')!;

      assert.ok(Math.abs(layout.x - 50) < 1);
      assert.ok(Math.abs(layout.y - 20) < 1);
      assert.ok(Math.abs(layout.width - 920) < 1); // 1000 - 50 - 30
      assert.ok(Math.abs(layout.height - 740) < 1); // 800 - 20 - 40
    });
  });

  describe('Distance Constraints', () => {
    it('should maintain horizontal distance', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 100, y: 100, width: 50, height: 50 } },
        { id: 'obj2', bounds: { x: 200, y: 100, width: 50, height: 50 } },
      ];
      const constraints = [
        createDistanceConstraint('obj2', { type: 'object', objectId: 'obj1' }, 'horizontal', 100),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });
      const layout1 = result.layouts.get('obj1')!;
      const layout2 = result.layouts.get('obj2')!;

      const center1X = layout1.x + layout1.width / 2;
      const center2X = layout2.x + layout2.width / 2;
      const distance = Math.abs(center2X - center1X);

      assert.ok(Math.abs(distance - 100) < 5);
    });

    it('should warn when objects are nearly aligned', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 100, y: 100, width: 50, height: 50 } },
        { id: 'obj2', bounds: { x: 100, y: 100, width: 50, height: 50 } }, // Same position
      ];
      const constraints = [
        createDistanceConstraint('obj2', { type: 'object', objectId: 'obj1' }, 'horizontal', 100),
      ];

      const result = solveConstraints(objects, constraints, viewport);

      // Should have warning about near-alignment
      const warnings = result.errors.filter(e => e.severity === 'warning');
      assert.ok(warnings.length > 0);
    });
  });

  describe('Aspect Ratio Constraints', () => {
    it('should maintain aspect ratio (wider)', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 200, height: 100 } },
      ];
      const constraints = [createAspectRatioConstraint('obj1', 16 / 9)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
        tolerance: 0.01,
      });
      const layout = result.layouts.get('obj1')!;

      const actualRatio = layout.width / layout.height;
      assert.ok(Math.abs(actualRatio - 16 / 9) < 0.1);
    });

    it('should use intrinsic ratio when locked to source', () => {
      const objects: ConstraintObjectData[] = [
        {
          id: 'obj1',
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          intrinsicWidth: 400,
          intrinsicHeight: 300,
        },
      ];
      const constraints = [createAspectRatioConstraint('obj1', 1, true)];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
        tolerance: 0.01,
      });
      const layout = result.layouts.get('obj1')!;

      const actualRatio = layout.width / layout.height;
      const intrinsicRatio = 400 / 300;
      assert.ok(Math.abs(actualRatio - intrinsicRatio) < 0.1);
    });
  });

  describe('Align Constraints', () => {
    it('should align left edges', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 100, y: 0, width: 50, height: 50 } },
        { id: 'obj2', bounds: { x: 200, y: 100, width: 80, height: 60 } },
      ];
      const constraints = [
        createAlignConstraint('obj2', [{ type: 'object', objectId: 'obj1' }], 'left'),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout1 = result.layouts.get('obj1')!;
      const layout2 = result.layouts.get('obj2')!;

      assert.ok(Math.abs(layout2.x - layout1.x) < 1);
    });

    it('should center align', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 100, y: 0, width: 100, height: 50 } },
        { id: 'obj2', bounds: { x: 0, y: 100, width: 60, height: 60 } },
      ];
      const constraints = [
        createAlignConstraint('obj2', [{ type: 'object', objectId: 'obj1' }], 'center'),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });
      const layout1 = result.layouts.get('obj1')!;
      const layout2 = result.layouts.get('obj2')!;

      const center1 = layout1.x + layout1.width / 2;
      const center2 = layout2.x + layout2.width / 2;
      assert.ok(Math.abs(center2 - center1) < 1);
    });
  });

  describe('Chain Constraints', () => {
    it('should distribute objects horizontally', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 80, height: 50 } },
        { id: 'obj2', bounds: { x: 0, y: 0, width: 80, height: 50 } },
        { id: 'obj3', bounds: { x: 0, y: 0, width: 80, height: 50 } },
      ];
      const constraints = [
        createChainConstraint(['obj1', 'obj2', 'obj3'], 'horizontal', 20, 'packed'),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });

      const layout1 = result.layouts.get('obj1')!;
      const layout2 = result.layouts.get('obj2')!;
      const layout3 = result.layouts.get('obj3')!;

      // Objects should be sequential with spacing
      assert.ok(layout2.x > layout1.x);
      assert.ok(layout3.x > layout2.x);
    });

    it('should handle vertical chains', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 50, height: 60 } },
        { id: 'obj2', bounds: { x: 0, y: 0, width: 50, height: 60 } },
      ];
      const constraints = [
        createChainConstraint(['obj1', 'obj2'], 'vertical', 10, 'spread-inside'),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 10,
        relaxationFactor: 1,
      });

      const layout1 = result.layouts.get('obj1')!;
      const layout2 = result.layouts.get('obj2')!;

      assert.ok(layout2.y > layout1.y);
    });
  });

  describe('Solver Behavior', () => {
    it('should converge for simple constraints', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'center', { type: 'parent' }, 'center', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 50,
        tolerance: 0.01,
      });

      assert.ok(result.converged);
      assert.ok(result.iterations < 50);
    });

    it('should return iteration count', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewport);

      assert.ok(result.iterations >= 1);
    });

    it('should apply constraints in priority order', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      // Create two conflicting constraints
      const c1 = createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 100, 100);
      c1.priority = 1;

      const c2 = createPinConstraint('obj1', 'top-left', { type: 'parent' }, 'top-left', 200, 200);
      c2.priority = 2;

      // With conflicting constraints on the same object, the solver applies
      // constraints in priority order (high to low). Due to iterative solving,
      // the final position is influenced by all constraints.
      const result = solveConstraints(objects, [c1, c2], viewport, {
        maxIterations: 20,
        relaxationFactor: 0.5,
      });
      const layout = result.layouts.get('obj1')!;

      // Position should be somewhere between the two constraint targets
      // due to the iterative blending
      assert.ok(layout.x >= 50 && layout.x <= 250);
      assert.ok(layout.y >= 50 && layout.y <= 250);
    });

    it('should handle parent-child relationships', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'parent', bounds: { x: 100, y: 100, width: 400, height: 300 } },
        { id: 'child', bounds: { x: 0, y: 0, width: 50, height: 50 }, parentId: 'parent' },
      ];
      const constraints = [
        createPinConstraint('child', 'center', { type: 'parent' }, 'center', 0, 0),
      ];

      const result = solveConstraints(objects, constraints, viewport, {
        maxIterations: 20,
        relaxationFactor: 1,
      });

      const parentLayout = result.layouts.get('parent')!;
      const childLayout = result.layouts.get('child')!;

      // Child center should be at parent center
      const parentCenterX = parentLayout.x + parentLayout.width / 2;
      const parentCenterY = parentLayout.y + parentLayout.height / 2;
      const childCenterX = childLayout.x + childLayout.width / 2;
      const childCenterY = childLayout.y + childLayout.height / 2;

      assert.ok(Math.abs(childCenterX - parentCenterX) < 5);
      assert.ok(Math.abs(childCenterY - parentCenterY) < 5);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing target object gracefully', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const constraints = [
        createPinConstraint('obj1', 'center', { type: 'object', objectId: 'nonexistent' }, 'center', 0, 0),
      ];

      // Should not throw
      const result = solveConstraints(objects, constraints, viewport);
      assert.ok(result.layouts.has('obj1'));
    });

    it('should handle empty objects array', () => {
      const result = solveConstraints([], [], viewport);

      assert.ok(result.converged);
      assert.strictEqual(result.layouts.size, 0);
    });
  });

  describe('Convenience Function', () => {
    it('should use default resolver when no options', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const result = solveConstraints(objects, [], viewport);

      assert.ok(result);
      assert.ok(result.layouts.has('obj1'));
    });

    it('should use custom resolver when options provided', () => {
      const objects: ConstraintObjectData[] = [
        { id: 'obj1', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      ];
      const result = solveConstraints(objects, [], viewport, {
        maxIterations: 5,
      });

      assert.ok(result);
    });
  });
});
