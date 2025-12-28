/**
 * Tests for the Vector3 class.
 * Covers construction, arithmetic, cross/dot products, and right-hand rule.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Vector3 } from '../../src/geometry/Vector3.js';

describe('Vector3', () => {
  describe('construction', () => {
    it('should create a zero vector by default', () => {
      const v = new Vector3();
      assert.strictEqual(v.x, 0);
      assert.strictEqual(v.y, 0);
      assert.strictEqual(v.z, 0);
    });

    it('should create a vector with given components', () => {
      const v = new Vector3(1, 2, 3);
      assert.strictEqual(v.x, 1);
      assert.strictEqual(v.y, 2);
      assert.strictEqual(v.z, 3);
    });

    it('should create from Vector3Like object', () => {
      const v = Vector3.from({ x: 4, y: 5, z: 6 });
      assert.strictEqual(v.x, 4);
      assert.strictEqual(v.y, 5);
      assert.strictEqual(v.z, 6);
    });

    it('should create from tuple', () => {
      const v = Vector3.fromTuple([7, 8, 9]);
      assert.strictEqual(v.x, 7);
      assert.strictEqual(v.y, 8);
      assert.strictEqual(v.z, 9);
    });

    it('should create from spherical coordinates', () => {
      const v = Vector3.fromSpherical(1, 0, 0);
      assert.ok(Math.abs(v.x) < 0.00001);
      assert.ok(Math.abs(v.y - 1) < 0.00001);
      assert.ok(Math.abs(v.z) < 0.00001);
    });
  });

  describe('static constants', () => {
    it('should have correct zero vector', () => {
      assert.ok(Vector3.zero.equals(new Vector3(0, 0, 0)));
    });

    it('should have correct one vector', () => {
      assert.ok(Vector3.one.equals(new Vector3(1, 1, 1)));
    });

    it('should have correct up vector (positive Y)', () => {
      assert.ok(Vector3.up.equals(new Vector3(0, 1, 0)));
    });

    it('should have correct right vector (positive X)', () => {
      assert.ok(Vector3.right.equals(new Vector3(1, 0, 0)));
    });

    it('should have correct forward vector (negative Z)', () => {
      assert.ok(Vector3.forward.equals(new Vector3(0, 0, -1)));
    });

    it('should have correct back vector (positive Z)', () => {
      assert.ok(Vector3.back.equals(new Vector3(0, 0, 1)));
    });
  });

  describe('arithmetic operations', () => {
    it('should add vectors correctly', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(4, 5, 6);
      const result = a.add(b);
      assert.ok(result.equals(new Vector3(5, 7, 9)));
    });

    it('should subtract vectors correctly', () => {
      const a = new Vector3(5, 7, 9);
      const b = new Vector3(1, 2, 3);
      const result = a.subtract(b);
      assert.ok(result.equals(new Vector3(4, 5, 6)));
    });

    it('should multiply by scalar correctly', () => {
      const v = new Vector3(1, 2, 3);
      const result = v.multiply(2);
      assert.ok(result.equals(new Vector3(2, 4, 6)));
    });

    it('should divide by scalar correctly', () => {
      const v = new Vector3(2, 4, 6);
      const result = v.divide(2);
      assert.ok(result.equals(new Vector3(1, 2, 3)));
    });

    it('should negate vector correctly', () => {
      const v = new Vector3(1, -2, 3);
      const result = v.negate();
      assert.ok(result.equals(new Vector3(-1, 2, -3)));
    });

    it('should preserve immutability', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(4, 5, 6);
      a.add(b);
      assert.strictEqual(a.x, 1);
      assert.strictEqual(a.y, 2);
      assert.strictEqual(a.z, 3);
    });
  });

  describe('dot product', () => {
    it('should calculate dot product correctly', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(4, 5, 6);
      assert.strictEqual(a.dot(b), 32); // 1*4 + 2*5 + 3*6 = 32
    });

    it('should return 0 for perpendicular vectors', () => {
      assert.strictEqual(Vector3.right.dot(Vector3.up), 0);
    });

    it('should return 1 for same unit vectors', () => {
      assert.strictEqual(Vector3.right.dot(Vector3.right), 1);
    });

    it('should return -1 for opposite unit vectors', () => {
      assert.strictEqual(Vector3.right.dot(Vector3.left), -1);
    });
  });

  describe('cross product (right-hand rule)', () => {
    it('should follow right-hand rule: X × Y = Z', () => {
      const result = Vector3.right.cross(Vector3.up);
      assert.ok(result.equals(Vector3.back)); // +Z
    });

    it('should follow right-hand rule: Y × Z = X', () => {
      const result = Vector3.up.cross(Vector3.back);
      assert.ok(result.equals(Vector3.right)); // +X
    });

    it('should follow right-hand rule: Z × X = Y', () => {
      const result = Vector3.back.cross(Vector3.right);
      assert.ok(result.equals(Vector3.up)); // +Y
    });

    it('should give zero for parallel vectors', () => {
      const result = Vector3.right.cross(Vector3.right);
      assert.ok(result.isZero());
    });

    it('should be anti-commutative: A × B = -(B × A)', () => {
      const a = new Vector3(1, 2, 3);
      const b = new Vector3(4, 5, 6);
      const ab = a.cross(b);
      const ba = b.cross(a);
      assert.ok(ab.equals(ba.negate()));
    });
  });

  describe('length and normalization', () => {
    it('should calculate length correctly', () => {
      const v = new Vector3(3, 4, 0);
      assert.strictEqual(v.length, 5);
    });

    it('should calculate length squared correctly', () => {
      const v = new Vector3(3, 4, 0);
      assert.strictEqual(v.lengthSquared, 25);
    });

    it('should normalize correctly', () => {
      const v = new Vector3(3, 0, 0);
      const normalized = v.normalize();
      assert.ok(Math.abs(normalized.length - 1) < 0.00001);
      assert.ok(Math.abs(normalized.x - 1) < 0.00001);
    });

    it('should return zero vector when normalizing zero vector', () => {
      const result = Vector3.zero.normalize();
      assert.ok(result.isZero());
    });

    it('should identify unit vectors', () => {
      assert.ok(Vector3.right.isUnit());
      assert.ok(Vector3.up.isUnit());
      assert.ok(!Vector3.one.isUnit());
    });
  });

  describe('distance', () => {
    it('should calculate distance correctly', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(3, 4, 0);
      assert.strictEqual(a.distanceTo(b), 5);
    });

    it('should calculate squared distance correctly', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(3, 4, 0);
      assert.strictEqual(a.distanceSquaredTo(b), 25);
    });
  });

  describe('angle', () => {
    it('should calculate angle between perpendicular vectors', () => {
      const angle = Vector3.right.angleTo(Vector3.up);
      assert.ok(Math.abs(angle - Math.PI / 2) < 0.00001);
    });

    it('should calculate angle between same vectors as 0', () => {
      const angle = Vector3.right.angleTo(Vector3.right);
      assert.ok(Math.abs(angle) < 0.00001);
    });

    it('should calculate angle between opposite vectors as PI', () => {
      const angle = Vector3.right.angleTo(Vector3.left);
      assert.ok(Math.abs(angle - Math.PI) < 0.00001);
    });
  });

  describe('interpolation', () => {
    it('should lerp correctly at t=0', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(10, 10, 10);
      assert.ok(a.lerp(b, 0).equals(a));
    });

    it('should lerp correctly at t=1', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(10, 10, 10);
      assert.ok(a.lerp(b, 1).equals(b));
    });

    it('should lerp correctly at t=0.5', () => {
      const a = new Vector3(0, 0, 0);
      const b = new Vector3(10, 10, 10);
      assert.ok(a.lerp(b, 0.5).equals(new Vector3(5, 5, 5)));
    });
  });

  describe('projection', () => {
    it('should project correctly onto axis', () => {
      const v = new Vector3(3, 4, 0);
      const projected = v.projectOnto(Vector3.right);
      assert.ok(projected.equals(new Vector3(3, 0, 0)));
    });

    it('should project onto plane correctly', () => {
      const v = new Vector3(1, 2, 3);
      const projected = v.projectOntoPlane(Vector3.up);
      assert.ok(Math.abs(projected.y) < 0.00001);
      assert.ok(Math.abs(projected.x - 1) < 0.00001);
      assert.ok(Math.abs(projected.z - 3) < 0.00001);
    });
  });

  describe('reflection', () => {
    it('should reflect correctly off a surface', () => {
      const incoming = new Vector3(1, -1, 0).normalize();
      const normal = Vector3.up;
      const reflected = incoming.reflect(normal);
      assert.ok(Math.abs(reflected.x - incoming.x) < 0.00001);
      assert.ok(Math.abs(reflected.y + incoming.y) < 0.00001);
    });
  });

  describe('conversion', () => {
    it('should convert to tuple', () => {
      const v = new Vector3(1, 2, 3);
      const tuple = v.toTuple();
      assert.deepStrictEqual([...tuple], [1, 2, 3]);
    });

    it('should convert to array', () => {
      const v = new Vector3(1, 2, 3);
      const arr = v.toArray();
      assert.deepStrictEqual(arr, [1, 2, 3]);
    });

    it('should convert to object', () => {
      const v = new Vector3(1, 2, 3);
      const obj = v.toObject();
      assert.deepStrictEqual(obj, { x: 1, y: 2, z: 3 });
    });

    it('should have meaningful toString', () => {
      const v = new Vector3(1, 2, 3);
      assert.strictEqual(v.toString(), 'Vector3(1, 2, 3)');
    });
  });

  describe('component access', () => {
    it('should get components by index', () => {
      const v = new Vector3(1, 2, 3);
      assert.strictEqual(v.getComponent(0), 1);
      assert.strictEqual(v.getComponent(1), 2);
      assert.strictEqual(v.getComponent(2), 3);
    });

    it('should set components by index immutably', () => {
      const v = new Vector3(1, 2, 3);
      const modified = v.setComponent(1, 10);
      assert.strictEqual(modified.y, 10);
      assert.strictEqual(v.y, 2); // Original unchanged
    });

    it('should get min/max components', () => {
      const v = new Vector3(-5, 3, 10);
      assert.strictEqual(v.minComponent, -5);
      assert.strictEqual(v.maxComponent, 10);
    });
  });
});
