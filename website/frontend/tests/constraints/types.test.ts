/**
 * Tests for Constraint Types
 * Covers factory functions, anchor position calculations, and type validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createPinConstraint,
  createSizeConstraint,
  createMarginConstraint,
  createDistanceConstraint,
  createAlignConstraint,
  createAspectRatioConstraint,
  createChainConstraint,
  getAnchorPosition,
  applyAnchorOffset,
} from '../../src/lib/constraints/types.js';
import type { Bounds, AnchorPoint } from '../../src/lib/constraints/types.js';

describe('Constraint Factory Functions', () => {
  describe('createPinConstraint', () => {
    it('should create pin constraint with all properties', () => {
      const constraint = createPinConstraint(
        'obj1',
        'top-left',
        { type: 'parent' },
        'top-left',
        10,
        20
      );

      assert.strictEqual(constraint.type, 'pin');
      assert.strictEqual(constraint.objectId, 'obj1');
      assert.strictEqual(constraint.sourceAnchor, 'top-left');
      assert.deepStrictEqual(constraint.target, { type: 'parent' });
      assert.strictEqual(constraint.targetAnchor, 'top-left');
      assert.strictEqual(constraint.offsetX, 10);
      assert.strictEqual(constraint.offsetY, 20);
      assert.strictEqual(constraint.enabled, true);
      assert.strictEqual(constraint.priority, 1);
    });

    it('should use default offsets when not provided', () => {
      const constraint = createPinConstraint(
        'obj1',
        'center',
        { type: 'viewport' },
        'center'
      );

      assert.strictEqual(constraint.offsetX, 0);
      assert.strictEqual(constraint.offsetY, 0);
    });

    it('should generate unique ID', () => {
      const c1 = createPinConstraint('obj1', 'center', { type: 'parent' }, 'center');
      const c2 = createPinConstraint('obj1', 'center', { type: 'parent' }, 'center');

      assert.ok(c1.id.startsWith('pin-'));
      assert.ok(c2.id.startsWith('pin-'));
      assert.notStrictEqual(c1.id, c2.id);
    });
  });

  describe('createSizeConstraint', () => {
    it('should create size constraint with fixed mode', () => {
      const constraint = createSizeConstraint('obj1', 'width', 'fixed', 100);

      assert.strictEqual(constraint.type, 'size');
      assert.strictEqual(constraint.objectId, 'obj1');
      assert.strictEqual(constraint.axis, 'width');
      assert.strictEqual(constraint.mode, 'fixed');
      assert.strictEqual(constraint.value, 100);
    });

    it('should create size constraint with percentage mode', () => {
      const constraint = createSizeConstraint('obj1', 'both', 'percentage', 50);

      assert.strictEqual(constraint.axis, 'both');
      assert.strictEqual(constraint.mode, 'percentage');
      assert.strictEqual(constraint.value, 50);
    });

    it('should generate unique ID', () => {
      const c1 = createSizeConstraint('obj1', 'width', 'fixed', 100);
      const c2 = createSizeConstraint('obj1', 'width', 'fixed', 100);

      assert.ok(c1.id.startsWith('size-'));
      assert.notStrictEqual(c1.id, c2.id);
    });
  });

  describe('createMarginConstraint', () => {
    it('should create margin constraint with all margins', () => {
      const constraint = createMarginConstraint('obj1', { type: 'parent' }, {
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      });

      assert.strictEqual(constraint.type, 'margin');
      assert.strictEqual(constraint.objectId, 'obj1');
      assert.strictEqual(constraint.top, 10);
      assert.strictEqual(constraint.right, 20);
      assert.strictEqual(constraint.bottom, 30);
      assert.strictEqual(constraint.left, 40);
    });

    it('should create margin constraint with partial margins', () => {
      const constraint = createMarginConstraint('obj1', { type: 'viewport' }, {
        left: 10,
        right: 10,
      });

      assert.strictEqual(constraint.left, 10);
      assert.strictEqual(constraint.right, 10);
      assert.strictEqual(constraint.top, undefined);
      assert.strictEqual(constraint.bottom, undefined);
    });
  });

  describe('createDistanceConstraint', () => {
    it('should create distance constraint', () => {
      const constraint = createDistanceConstraint(
        'obj1',
        { type: 'object', objectId: 'obj2' },
        'horizontal',
        50
      );

      assert.strictEqual(constraint.type, 'distance');
      assert.strictEqual(constraint.objectId, 'obj1');
      assert.deepStrictEqual(constraint.target, { type: 'object', objectId: 'obj2' });
      assert.strictEqual(constraint.axis, 'horizontal');
      assert.strictEqual(constraint.distance, 50);
    });
  });

  describe('createAlignConstraint', () => {
    it('should create align constraint with multiple targets', () => {
      const targets = [
        { type: 'object' as const, objectId: 'obj2' },
        { type: 'object' as const, objectId: 'obj3' },
      ];
      const constraint = createAlignConstraint('obj1', targets, 'center');

      assert.strictEqual(constraint.type, 'align');
      assert.strictEqual(constraint.alignment, 'center');
      assert.strictEqual(constraint.targets.length, 2);
    });
  });

  describe('createAspectRatioConstraint', () => {
    it('should create aspect ratio constraint', () => {
      const constraint = createAspectRatioConstraint('obj1', 16 / 9);

      assert.strictEqual(constraint.type, 'aspectRatio');
      assert.strictEqual(constraint.ratio, 16 / 9);
      assert.strictEqual(constraint.lockToSource, false);
    });

    it('should create aspect ratio constraint locked to source', () => {
      const constraint = createAspectRatioConstraint('obj1', 1, true);

      assert.strictEqual(constraint.lockToSource, true);
    });
  });

  describe('createChainConstraint', () => {
    it('should create chain constraint', () => {
      const objectIds = ['obj1', 'obj2', 'obj3'];
      const constraint = createChainConstraint(objectIds, 'horizontal', 10, 'spread');

      assert.strictEqual(constraint.type, 'chain');
      assert.strictEqual(constraint.objectId, 'obj1');
      assert.deepStrictEqual(constraint.objectIds, objectIds);
      assert.strictEqual(constraint.axis, 'horizontal');
      assert.strictEqual(constraint.spacing, 10);
      assert.strictEqual(constraint.spreadMode, 'spread');
    });

    it('should default to packed spread mode', () => {
      const constraint = createChainConstraint(['obj1', 'obj2'], 'vertical', 5);

      assert.strictEqual(constraint.spreadMode, 'packed');
    });

    it('should handle empty object array', () => {
      const constraint = createChainConstraint([], 'horizontal', 10);

      assert.strictEqual(constraint.objectId, '');
    });
  });
});

describe('Anchor Position Calculations', () => {
  const testBounds: Bounds = { x: 100, y: 200, width: 50, height: 80 };

  describe('getAnchorPosition', () => {
    it('should return correct position for top-left', () => {
      const pos = getAnchorPosition(testBounds, 'top-left');
      assert.deepStrictEqual(pos, { x: 100, y: 200 });
    });

    it('should return correct position for top-center', () => {
      const pos = getAnchorPosition(testBounds, 'top-center');
      assert.deepStrictEqual(pos, { x: 125, y: 200 });
    });

    it('should return correct position for top-right', () => {
      const pos = getAnchorPosition(testBounds, 'top-right');
      assert.deepStrictEqual(pos, { x: 150, y: 200 });
    });

    it('should return correct position for center-left', () => {
      const pos = getAnchorPosition(testBounds, 'center-left');
      assert.deepStrictEqual(pos, { x: 100, y: 240 });
    });

    it('should return correct position for center', () => {
      const pos = getAnchorPosition(testBounds, 'center');
      assert.deepStrictEqual(pos, { x: 125, y: 240 });
    });

    it('should return correct position for center-right', () => {
      const pos = getAnchorPosition(testBounds, 'center-right');
      assert.deepStrictEqual(pos, { x: 150, y: 240 });
    });

    it('should return correct position for bottom-left', () => {
      const pos = getAnchorPosition(testBounds, 'bottom-left');
      assert.deepStrictEqual(pos, { x: 100, y: 280 });
    });

    it('should return correct position for bottom-center', () => {
      const pos = getAnchorPosition(testBounds, 'bottom-center');
      assert.deepStrictEqual(pos, { x: 125, y: 280 });
    });

    it('should return correct position for bottom-right', () => {
      const pos = getAnchorPosition(testBounds, 'bottom-right');
      assert.deepStrictEqual(pos, { x: 150, y: 280 });
    });
  });

  describe('applyAnchorOffset', () => {
    const position = { x: 200, y: 300 };
    const width = 100;
    const height = 60;

    it('should offset for top-left anchor (no offset)', () => {
      const result = applyAnchorOffset(position, 'top-left', width, height);
      assert.deepStrictEqual(result, { x: 200, y: 300 });
    });

    it('should offset for top-center anchor (half width left)', () => {
      const result = applyAnchorOffset(position, 'top-center', width, height);
      assert.deepStrictEqual(result, { x: 150, y: 300 });
    });

    it('should offset for top-right anchor (full width left)', () => {
      const result = applyAnchorOffset(position, 'top-right', width, height);
      assert.deepStrictEqual(result, { x: 100, y: 300 });
    });

    it('should offset for center-left anchor (half height up)', () => {
      const result = applyAnchorOffset(position, 'center-left', width, height);
      assert.deepStrictEqual(result, { x: 200, y: 270 });
    });

    it('should offset for center anchor (half width and height)', () => {
      const result = applyAnchorOffset(position, 'center', width, height);
      assert.deepStrictEqual(result, { x: 150, y: 270 });
    });

    it('should offset for bottom-left anchor (full height up)', () => {
      const result = applyAnchorOffset(position, 'bottom-left', width, height);
      assert.deepStrictEqual(result, { x: 200, y: 240 });
    });

    it('should offset for bottom-right anchor (full width and height)', () => {
      const result = applyAnchorOffset(position, 'bottom-right', width, height);
      assert.deepStrictEqual(result, { x: 100, y: 240 });
    });
  });

  describe('getAnchorPosition with zero dimensions', () => {
    const zeroBounds: Bounds = { x: 50, y: 50, width: 0, height: 0 };

    it('should handle zero-dimension bounds', () => {
      const pos = getAnchorPosition(zeroBounds, 'center');
      assert.deepStrictEqual(pos, { x: 50, y: 50 });
    });
  });
});
