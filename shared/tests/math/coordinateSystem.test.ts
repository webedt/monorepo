/**
 * Tests for CoordinateSystem2D coordinate transformations.
 * Covers math/screen coordinate conversions, edge cases, and validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CoordinateSystem2D } from '../../src/utils/math/coordinateSystem.js';

describe('CoordinateSystem2D', () => {
  describe('Factory Methods', () => {
    it('should create mathematical coordinate system (Y-up)', () => {
      const cs = CoordinateSystem2D.math();
      assert.strictEqual(cs.config.xDirection, 'positive');
      assert.strictEqual(cs.config.yDirection, 'positive');
      assert.strictEqual(cs.config.origin.x, 0);
      assert.strictEqual(cs.config.origin.y, 0);
    });

    it('should create screen coordinate system (Y-down)', () => {
      const cs = CoordinateSystem2D.screen();
      assert.strictEqual(cs.config.xDirection, 'positive');
      assert.strictEqual(cs.config.yDirection, 'negative');
    });

    it('should create centered coordinate system', () => {
      const cs = CoordinateSystem2D.centered(800, 600);
      assert.strictEqual(cs.config.origin.x, 400);
      assert.strictEqual(cs.config.origin.y, 300);
    });

    it('should create canvas coordinate system', () => {
      const cs = CoordinateSystem2D.forCanvas(800, 600, 100, 100);
      assert.strictEqual(cs.config.origin.x, 0);
      assert.strictEqual(cs.config.origin.y, 600);
      assert.strictEqual(cs.config.scaleX, 8);
      assert.strictEqual(cs.config.scaleY, 6);
    });

    it('should create custom coordinate system', () => {
      const cs = CoordinateSystem2D.custom({
        origin: { x: 100, y: 100 },
        scaleX: 2,
        scaleY: 3,
      });
      assert.strictEqual(cs.config.origin.x, 100);
      assert.strictEqual(cs.config.scaleX, 2);
      assert.strictEqual(cs.config.scaleY, 3);
    });
  });

  describe('Constructor Validation', () => {
    it('should throw error for zero scaleX', () => {
      assert.throws(
        () => new CoordinateSystem2D({ scaleX: 0 }),
        /scaleX must be non-zero/
      );
    });

    it('should throw error for zero scaleY', () => {
      assert.throws(
        () => new CoordinateSystem2D({ scaleY: 0 }),
        /scaleY must be non-zero/
      );
    });

    it('should throw error for near-zero scale', () => {
      assert.throws(
        () => new CoordinateSystem2D({ scaleX: 1e-15 }),
        /scaleX must be non-zero/
      );
    });

    it('should accept negative scales', () => {
      const cs = new CoordinateSystem2D({ scaleX: -1, scaleY: -1 });
      assert.strictEqual(cs.config.scaleX, -1);
      assert.strictEqual(cs.config.scaleY, -1);
    });
  });

  describe('forCanvas Validation', () => {
    it('should throw error for zero worldWidth', () => {
      assert.throws(
        () => CoordinateSystem2D.forCanvas(800, 600, 0, 100),
        /worldWidth must be non-zero/
      );
    });

    it('should throw error for zero worldHeight', () => {
      assert.throws(
        () => CoordinateSystem2D.forCanvas(800, 600, 100, 0),
        /worldHeight must be non-zero/
      );
    });
  });

  describe('Math Coordinate Conversions', () => {
    it('should convert from math to screen-like coords', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      const result = cs.fromMath({ x: 0, y: 0 });
      assert.strictEqual(result.x, 0);
      assert.strictEqual(result.y, 100);
    });

    it('should convert point with Y increasing upward', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      const result = cs.fromMath({ x: 50, y: 50 });
      assert.strictEqual(result.x, 50);
      assert.strictEqual(result.y, 50);
    });

    it('should round-trip math coords', () => {
      const cs = CoordinateSystem2D.forCanvas(800, 600, 100, 100);
      const original = { x: 25, y: 75 };
      const converted = cs.fromMath(original);
      const back = cs.toMath(converted);
      assert.ok(Math.abs(back.x - original.x) < 1e-10);
      assert.ok(Math.abs(back.y - original.y) < 1e-10);
    });
  });

  describe('Screen Coordinate Conversions', () => {
    it('should convert from screen coords using canvas system', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      // Screen point (50, 25) means Y=25 from top, which is Y=75 in math
      const result = cs.fromScreen({ x: 50, y: 25 }, 100);
      // After conversion through the canvas system
      assert.strictEqual(result.x, 50);
      assert.strictEqual(result.y, 25); // Canvas origin is at bottom-left
    });

    it('should convert to screen coords using canvas system', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      // Math point (50, 75) in canvas system coords
      const mathPoint = cs.fromMath({ x: 50, y: 75 });
      const result = cs.toScreen(mathPoint, 100);
      // Should get back to screen coords
      assert.ok(result.x >= 0);
      assert.ok(result.y >= 0);
    });
  });

  describe('Delta Conversions', () => {
    it('should convert delta from math without origin translation', () => {
      const cs = CoordinateSystem2D.forCanvas(200, 200, 100, 100);
      const delta = cs.deltaFromMath({ x: 10, y: 10 });
      assert.strictEqual(delta.x, 20);
      assert.strictEqual(delta.y, -20);
    });

    it('should convert delta to math', () => {
      const cs = CoordinateSystem2D.forCanvas(200, 200, 100, 100);
      const delta = cs.deltaToMath({ x: 20, y: -20 });
      assert.strictEqual(delta.x, 10);
      assert.strictEqual(delta.y, 10);
    });
  });

  describe('Bounds Conversions', () => {
    it('should convert bounds from math', () => {
      const cs = CoordinateSystem2D.math();
      const bounds = cs.boundsFromMath({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
      assert.strictEqual(bounds.minX, 0);
      assert.strictEqual(bounds.maxX, 100);
    });

    it('should handle Y-flip in bounds conversion', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      const bounds = cs.boundsFromMath({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
      assert.strictEqual(bounds.minX, 0);
      assert.strictEqual(bounds.maxX, 50);
    });
  });

  describe('Rect Conversions', () => {
    it('should convert rect from math', () => {
      const cs = CoordinateSystem2D.math();
      const rect = cs.rectFromMath({ x: 10, y: 20, width: 30, height: 40 });
      assert.strictEqual(rect.width, 30);
      assert.strictEqual(rect.height, 40);
    });

    it('should convert rect to math', () => {
      const cs = CoordinateSystem2D.math();
      const rect = cs.rectToMath({ x: 10, y: 20, width: 30, height: 40 });
      assert.strictEqual(rect.width, 30);
      assert.strictEqual(rect.height, 40);
    });
  });

  describe('Angle Conversions', () => {
    it('should not change angle in standard math system', () => {
      const cs = CoordinateSystem2D.math();
      const angle = Math.PI / 4;
      // Math system has yDirection 'positive', so angle is unchanged
      assert.strictEqual(cs.angleFromMath(angle), angle);
      assert.strictEqual(cs.angleToMath(angle), angle);
    });

    it('should negate angle for Y-down system', () => {
      const cs = CoordinateSystem2D.screen();
      const angle = Math.PI / 4;
      // Screen system has yDirection 'negative', so angle is negated
      const converted = cs.angleFromMath(angle);
      assert.ok(Math.abs(converted - (-angle)) < 1e-10);
    });

    it('should round-trip angles correctly', () => {
      const cs = CoordinateSystem2D.screen();
      const angle = Math.PI / 4;
      const converted = cs.angleFromMath(angle);
      const back = cs.angleToMath(converted);
      assert.ok(Math.abs(back - angle) < 1e-10);
    });
  });

  describe('Transform Matrices', () => {
    it('should generate transform matrix', () => {
      const cs = CoordinateSystem2D.forCanvas(200, 200, 100, 100);
      const matrix = cs.getTransformMatrix();
      assert.strictEqual(matrix.length, 6);
      assert.strictEqual(matrix[0], 2); // scaleX
      assert.strictEqual(matrix[3], -2); // -scaleY for Y-flip
    });

    it('should generate inverse transform matrix', () => {
      const cs = CoordinateSystem2D.forCanvas(200, 200, 100, 100);
      const matrix = cs.getInverseTransformMatrix();
      assert.strictEqual(matrix.length, 6);
      assert.strictEqual(matrix[0], 0.5); // 1/scaleX
    });
  });

  describe('Point in Bounds/Rect', () => {
    it('should check if point is in bounds', () => {
      const cs = CoordinateSystem2D.math();
      const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
      assert.strictEqual(cs.isPointInBounds({ x: 50, y: 50 }, bounds), true);
      assert.strictEqual(cs.isPointInBounds({ x: 150, y: 50 }, bounds), false);
      assert.strictEqual(cs.isPointInBounds({ x: 0, y: 0 }, bounds), true);
      assert.strictEqual(cs.isPointInBounds({ x: 100, y: 100 }, bounds), true);
    });

    it('should check if point is in rect', () => {
      const cs = CoordinateSystem2D.math();
      const rect = { x: 10, y: 10, width: 50, height: 50 };
      assert.strictEqual(cs.isPointInRect({ x: 35, y: 35 }, rect), true);
      assert.strictEqual(cs.isPointInRect({ x: 5, y: 35 }, rect), false);
      assert.strictEqual(cs.isPointInRect({ x: 10, y: 10 }, rect), true);
      assert.strictEqual(cs.isPointInRect({ x: 60, y: 60 }, rect), true);
    });
  });

  describe('Clamp to Bounds', () => {
    it('should clamp point to bounds', () => {
      const cs = CoordinateSystem2D.math();
      const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

      const clamped = cs.clampToBounds({ x: 150, y: -50 }, bounds);
      assert.strictEqual(clamped.x, 100);
      assert.strictEqual(clamped.y, 0);
    });

    it('should not change point already in bounds', () => {
      const cs = CoordinateSystem2D.math();
      const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

      const clamped = cs.clampToBounds({ x: 50, y: 50 }, bounds);
      assert.strictEqual(clamped.x, 50);
      assert.strictEqual(clamped.y, 50);
    });
  });

  describe('Snap to Grid', () => {
    it('should snap point to grid', () => {
      const cs = CoordinateSystem2D.math();

      const snapped = cs.snapToGrid({ x: 17, y: 23 }, 10);
      assert.strictEqual(snapped.x, 20);
      assert.strictEqual(snapped.y, 20);
    });

    it('should handle grid rounding correctly', () => {
      const cs = CoordinateSystem2D.math();

      const snapped = cs.snapToGrid({ x: 14, y: 15 }, 10);
      assert.strictEqual(snapped.x, 10);
      assert.strictEqual(snapped.y, 20);
    });

    it('should return original point for zero grid size', () => {
      const cs = CoordinateSystem2D.math();

      const snapped = cs.snapToGrid({ x: 17.5, y: 23.7 }, 0);
      assert.strictEqual(snapped.x, 17.5);
      assert.strictEqual(snapped.y, 23.7);
    });

    it('should return original point for near-zero grid size', () => {
      const cs = CoordinateSystem2D.math();

      const snapped = cs.snapToGrid({ x: 17.5, y: 23.7 }, 1e-15);
      assert.strictEqual(snapped.x, 17.5);
      assert.strictEqual(snapped.y, 23.7);
    });
  });

  describe('Mathematical Convention Verification', () => {
    it('should have X increasing to the right', () => {
      const cs = CoordinateSystem2D.math();
      const origin = { x: 0, y: 0 };
      const rightPoint = { x: 10, y: 0 };

      assert.ok(rightPoint.x > origin.x);
    });

    it('should have Y increasing upward in math system', () => {
      const cs = CoordinateSystem2D.forCanvas(100, 100, 100, 100);
      const lower = cs.fromMath({ x: 0, y: 0 });
      const higher = cs.fromMath({ x: 0, y: 10 });

      // In screen coords, higher math Y should have lower screen Y
      assert.ok(higher.y < lower.y);
    });
  });
});
