/**
 * Tests for Vec2 2D vector mathematics.
 * Covers vector operations, edge cases, and mathematical conventions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Vec2 } from '../../src/utils/math/vec2.js';

describe('Vec2', () => {
  describe('Construction and Factory Methods', () => {
    it('should create vector with x and y', () => {
      const v = new Vec2(3, 4);
      assert.strictEqual(v.x, 3);
      assert.strictEqual(v.y, 4);
    });

    it('should create vector using static create', () => {
      const v = Vec2.create(5, 6);
      assert.strictEqual(v.x, 5);
      assert.strictEqual(v.y, 6);
    });

    it('should create vector from Point2D', () => {
      const v = Vec2.fromPoint({ x: 1, y: 2 });
      assert.strictEqual(v.x, 1);
      assert.strictEqual(v.y, 2);
    });

    it('should create vector from array', () => {
      const v = Vec2.fromArray([7, 8]);
      assert.strictEqual(v.x, 7);
      assert.strictEqual(v.y, 8);
    });

    it('should create vector from polar coordinates', () => {
      const v = Vec2.fromPolar(1, 0);
      assert.ok(Math.abs(v.x - 1) < 1e-10);
      assert.ok(Math.abs(v.y - 0) < 1e-10);

      const v2 = Vec2.fromPolar(1, Math.PI / 2);
      assert.ok(Math.abs(v2.x - 0) < 1e-10);
      assert.ok(Math.abs(v2.y - 1) < 1e-10);
    });

    it('should create unit vector from angle', () => {
      const v = Vec2.fromAngle(Math.PI / 4);
      const expected = Math.SQRT1_2;
      assert.ok(Math.abs(v.x - expected) < 1e-10);
      assert.ok(Math.abs(v.y - expected) < 1e-10);
    });
  });

  describe('Static Direction Vectors', () => {
    it('should return correct zero vector', () => {
      const v = Vec2.zero();
      assert.strictEqual(v.x, 0);
      assert.strictEqual(v.y, 0);
    });

    it('should return correct right vector (1, 0)', () => {
      const v = Vec2.right();
      assert.strictEqual(v.x, 1);
      assert.strictEqual(v.y, 0);
    });

    it('should return correct left vector (-1, 0)', () => {
      const v = Vec2.left();
      assert.strictEqual(v.x, -1);
      assert.strictEqual(v.y, 0);
    });

    it('should return correct up vector (0, 1) - Y increases upward', () => {
      const v = Vec2.up();
      assert.strictEqual(v.x, 0);
      assert.strictEqual(v.y, 1);
    });

    it('should return correct down vector (0, -1)', () => {
      const v = Vec2.down();
      assert.strictEqual(v.x, 0);
      assert.strictEqual(v.y, -1);
    });

    it('should return normalized (1, 1) vector', () => {
      const v = Vec2.one();
      const expected = Math.SQRT1_2;
      assert.ok(Math.abs(v.x - expected) < 1e-10);
      assert.ok(Math.abs(v.y - expected) < 1e-10);
      assert.ok(Math.abs(v.magnitude() - 1) < 1e-10);
    });
  });

  describe('Magnitude Operations', () => {
    it('should calculate magnitude correctly', () => {
      const v = new Vec2(3, 4);
      assert.strictEqual(v.magnitude(), 5);
    });

    it('should calculate magnitude squared', () => {
      const v = new Vec2(3, 4);
      assert.strictEqual(v.magnitudeSquared(), 25);
    });

    it('should handle zero vector magnitude', () => {
      const v = Vec2.zero();
      assert.strictEqual(v.magnitude(), 0);
      assert.strictEqual(v.magnitudeSquared(), 0);
    });
  });

  describe('Normalization', () => {
    it('should normalize vector to unit length', () => {
      const v = new Vec2(3, 4);
      const n = v.normalized();
      assert.ok(Math.abs(n.magnitude() - 1) < 1e-10);
      assert.strictEqual(n.x, 0.6);
      assert.strictEqual(n.y, 0.8);
    });

    it('should return zero vector when normalizing zero vector', () => {
      const v = Vec2.zero();
      const n = v.normalized();
      assert.strictEqual(n.x, 0);
      assert.strictEqual(n.y, 0);
    });

    it('should return zero vector when normalizing near-zero vector', () => {
      const v = new Vec2(1e-15, 1e-15);
      const n = v.normalized();
      assert.strictEqual(n.x, 0);
      assert.strictEqual(n.y, 0);
    });
  });

  describe('Dot and Cross Products', () => {
    it('should calculate dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      assert.strictEqual(a.dot(b), 11);
    });

    it('should return 0 for perpendicular vectors', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      assert.strictEqual(a.dot(b), 0);
    });

    it('should calculate 2D cross product', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      assert.strictEqual(a.cross(b), 1);
      assert.strictEqual(b.cross(a), -1);
    });
  });

  describe('Angle Operations', () => {
    it('should calculate angle from positive X axis', () => {
      assert.ok(Math.abs(Vec2.right().angle() - 0) < 1e-10);
      assert.ok(Math.abs(Vec2.up().angle() - Math.PI / 2) < 1e-10);
      assert.ok(Math.abs(Vec2.left().angle() - Math.PI) < 1e-10);
      assert.ok(Math.abs(Vec2.down().angle() - (-Math.PI / 2)) < 1e-10);
    });

    it('should calculate angle between vectors', () => {
      const a = Vec2.right();
      const b = Vec2.up();
      assert.ok(Math.abs(a.angleTo(b) - Math.PI / 2) < 1e-10);
    });

    it('should return 0 angle for zero vectors', () => {
      const a = Vec2.zero();
      const b = Vec2.right();
      assert.strictEqual(a.angleTo(b), 0);
    });

    it('should calculate signed angle between vectors', () => {
      const a = Vec2.right();
      const b = Vec2.up();
      assert.ok(Math.abs(a.signedAngleTo(b) - Math.PI / 2) < 1e-10);
      assert.ok(Math.abs(b.signedAngleTo(a) - (-Math.PI / 2)) < 1e-10);
    });
  });

  describe('Distance Operations', () => {
    it('should calculate distance to another point', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      assert.strictEqual(a.distanceTo(b), 5);
    });

    it('should calculate squared distance', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      assert.strictEqual(a.distanceSquaredTo(b), 25);
    });

    it('should use static distance method', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };
      assert.strictEqual(Vec2.distance(a, b), 5);
    });
  });

  describe('Arithmetic Operations', () => {
    it('should add vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const result = a.add(b);
      assert.strictEqual(result.x, 4);
      assert.strictEqual(result.y, 6);
    });

    it('should subtract vectors', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(2, 3);
      const result = a.subtract(b);
      assert.strictEqual(result.x, 3);
      assert.strictEqual(result.y, 4);
    });

    it('should scale vector', () => {
      const v = new Vec2(2, 3);
      const result = v.scale(2);
      assert.strictEqual(result.x, 4);
      assert.strictEqual(result.y, 6);
    });

    it('should negate vector', () => {
      const v = new Vec2(3, -4);
      const result = v.negate();
      assert.strictEqual(result.x, -3);
      assert.strictEqual(result.y, 4);
    });
  });

  describe('Rotation Operations', () => {
    it('should rotate vector by angle', () => {
      const v = Vec2.right();
      const rotated = v.rotate(Math.PI / 2);
      assert.ok(Math.abs(rotated.x - 0) < 1e-10);
      assert.ok(Math.abs(rotated.y - 1) < 1e-10);
    });

    it('should return perpendicular vector (counterclockwise)', () => {
      const v = Vec2.right();
      const perp = v.perpendicular();
      // Use epsilon comparison to handle -0 vs 0
      assert.ok(Math.abs(perp.x) < 1e-10);
      assert.strictEqual(perp.y, 1);
    });

    it('should return perpendicular vector (clockwise)', () => {
      const v = Vec2.right();
      const perp = v.perpendicularClockwise();
      // Use epsilon comparison to handle -0 vs 0
      assert.ok(Math.abs(perp.x) < 1e-10);
      assert.strictEqual(perp.y, -1);
    });
  });

  describe('Interpolation and Projection', () => {
    it('should lerp between vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const mid = a.lerp(b, 0.5);
      assert.strictEqual(mid.x, 5);
      assert.strictEqual(mid.y, 5);
    });

    it('should use static lerp', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10, y: 10 };
      const result = Vec2.lerp(a, b, 0.25);
      assert.strictEqual(result.x, 2.5);
      assert.strictEqual(result.y, 2.5);
    });

    it('should project onto another vector', () => {
      const v = new Vec2(3, 4);
      const onto = new Vec2(1, 0);
      const proj = v.projectOnto(onto);
      assert.strictEqual(proj.x, 3);
      assert.strictEqual(proj.y, 0);
    });

    it('should return zero when projecting onto zero vector', () => {
      const v = new Vec2(3, 4);
      const proj = v.projectOnto({ x: 0, y: 0 });
      assert.strictEqual(proj.x, 0);
      assert.strictEqual(proj.y, 0);
    });

    it('should reflect across normal', () => {
      const v = new Vec2(1, -1);
      const normal = new Vec2(0, 1);
      const reflected = v.reflect(normal);
      assert.ok(Math.abs(reflected.x - 1) < 1e-10);
      assert.ok(Math.abs(reflected.y - 1) < 1e-10);
    });
  });

  describe('Clamping Operations', () => {
    it('should clamp magnitude when exceeding max', () => {
      const v = new Vec2(6, 8); // magnitude 10
      const clamped = v.clampMagnitude(5);
      assert.ok(Math.abs(clamped.magnitude() - 5) < 1e-10);
    });

    it('should return new vector when not clamping', () => {
      const v = new Vec2(3, 4); // magnitude 5
      const clamped = v.clampMagnitude(10);
      assert.notStrictEqual(v, clamped);
      assert.strictEqual(clamped.x, 3);
      assert.strictEqual(clamped.y, 4);
    });

    it('should clamp components to range', () => {
      const v = new Vec2(-5, 15);
      const clamped = v.clamp(0, 10);
      assert.strictEqual(clamped.x, 0);
      assert.strictEqual(clamped.y, 10);
    });
  });

  describe('Rounding Operations', () => {
    it('should round components', () => {
      const v = new Vec2(1.4, 2.6);
      const rounded = v.round();
      assert.strictEqual(rounded.x, 1);
      assert.strictEqual(rounded.y, 3);
    });

    it('should floor components', () => {
      const v = new Vec2(1.9, 2.1);
      const floored = v.floor();
      assert.strictEqual(floored.x, 1);
      assert.strictEqual(floored.y, 2);
    });

    it('should ceil components', () => {
      const v = new Vec2(1.1, 2.9);
      const ceiled = v.ceil();
      assert.strictEqual(ceiled.x, 2);
      assert.strictEqual(ceiled.y, 3);
    });

    it('should get absolute values', () => {
      const v = new Vec2(-3, -4);
      const abs = v.abs();
      assert.strictEqual(abs.x, 3);
      assert.strictEqual(abs.y, 4);
    });
  });

  describe('Comparison Operations', () => {
    it('should check equality with default epsilon', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      assert.strictEqual(a.equals(b), true);
    });

    it('should check equality with custom epsilon', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1.001, 2.001);
      assert.strictEqual(a.equals(b, 0.01), true);
      assert.strictEqual(a.equals(b, 0.0001), false);
    });

    it('should check if zero', () => {
      assert.strictEqual(Vec2.zero().isZero(), true);
      assert.strictEqual(new Vec2(0.001, 0).isZero(), false);
      assert.strictEqual(new Vec2(0.001, 0).isZero(0.01), true);
    });
  });

  describe('Min/Max Operations', () => {
    it('should get min components', () => {
      const a = { x: 1, y: 5 };
      const b = { x: 3, y: 2 };
      const result = Vec2.min(a, b);
      assert.strictEqual(result.x, 1);
      assert.strictEqual(result.y, 2);
    });

    it('should get max components', () => {
      const a = { x: 1, y: 5 };
      const b = { x: 3, y: 2 };
      const result = Vec2.max(a, b);
      assert.strictEqual(result.x, 3);
      assert.strictEqual(result.y, 5);
    });
  });

  describe('Conversion Operations', () => {
    it('should convert to object', () => {
      const v = new Vec2(3, 4);
      const obj = v.toObject();
      assert.deepStrictEqual(obj, { x: 3, y: 4 });
    });

    it('should convert to array', () => {
      const v = new Vec2(3, 4);
      const arr = v.toArray();
      assert.deepStrictEqual(arr, [3, 4]);
    });

    it('should convert to string', () => {
      const v = new Vec2(3, 4);
      assert.strictEqual(v.toString(), 'Vec2(3, 4)');
    });
  });

  describe('Immutability', () => {
    it('should not modify original vector on operations', () => {
      const v = new Vec2(1, 2);
      v.add({ x: 3, y: 4 });
      v.scale(2);
      v.negate();
      v.rotate(Math.PI);
      assert.strictEqual(v.x, 1);
      assert.strictEqual(v.y, 2);
    });
  });
});
