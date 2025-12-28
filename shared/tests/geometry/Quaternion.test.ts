/**
 * Tests for the Quaternion class.
 * Covers construction, rotations, interpolation, and right-hand rule.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Quaternion } from '../../src/geometry/Quaternion.js';
import { Vector3 } from '../../src/geometry/Vector3.js';

describe('Quaternion', () => {
  describe('construction', () => {
    it('should create identity quaternion by default', () => {
      const q = new Quaternion();
      assert.strictEqual(q.x, 0);
      assert.strictEqual(q.y, 0);
      assert.strictEqual(q.z, 0);
      assert.strictEqual(q.w, 1);
    });

    it('should create quaternion with given components', () => {
      const q = new Quaternion(1, 2, 3, 4);
      assert.strictEqual(q.x, 1);
      assert.strictEqual(q.y, 2);
      assert.strictEqual(q.z, 3);
      assert.strictEqual(q.w, 4);
    });

    it('should have correct identity static getter', () => {
      assert.ok(Quaternion.identity.equals(new Quaternion(0, 0, 0, 1)));
    });
  });

  describe('fromAxisAngle', () => {
    it('should create rotation around Y axis', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, Math.PI / 2);
      assert.ok(Math.abs(q.w - Math.cos(Math.PI / 4)) < 0.00001);
      assert.ok(Math.abs(q.y - Math.sin(Math.PI / 4)) < 0.00001);
      assert.ok(Math.abs(q.x) < 0.00001);
      assert.ok(Math.abs(q.z) < 0.00001);
    });

    it('should create identity for zero angle', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, 0);
      assert.ok(q.equals(Quaternion.identity));
    });
  });

  describe('fromEuler', () => {
    it('should create rotation from Euler angles', () => {
      const q = Quaternion.fromEuler(0, Math.PI / 2, 0, 'XYZ');
      // 90 degree rotation around Y
      const rotated = q.rotateVector(Vector3.forward);
      // Forward (-Z) should become Left (-X) after 90 CCW around Y
      assert.ok(Math.abs(rotated.x + 1) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z) < 0.00001);
    });

    it('should handle EulerAngles object', () => {
      const q = Quaternion.fromEuler({ x: 0, y: Math.PI / 2, z: 0, order: 'XYZ' });
      assert.ok(q.isUnit());
    });
  });

  describe('fromUnitVectors', () => {
    it('should create rotation from one direction to another', () => {
      const q = Quaternion.fromUnitVectors(Vector3.forward, Vector3.right);
      const rotated = q.rotateVector(Vector3.forward);
      assert.ok(Math.abs(rotated.x - Vector3.right.x) < 0.00001);
      assert.ok(Math.abs(rotated.y - Vector3.right.y) < 0.00001);
      assert.ok(Math.abs(rotated.z - Vector3.right.z) < 0.00001);
    });

    it('should handle same direction (identity rotation)', () => {
      const q = Quaternion.fromUnitVectors(Vector3.up, Vector3.up);
      assert.ok(q.equals(Quaternion.identity));
    });
  });

  describe('axis rotations', () => {
    it('rotationX should rotate around X axis', () => {
      const q = Quaternion.rotationX(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.up);
      // Up (+Y) rotated 90 CCW around X should become Back (+Z)
      assert.ok(Math.abs(rotated.x) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z - 1) < 0.00001);
    });

    it('rotationY should rotate around Y axis', () => {
      const q = Quaternion.rotationY(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.forward);
      // Forward (-Z) rotated 90 CCW around Y should become Left (-X)
      assert.ok(Math.abs(rotated.x + 1) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z) < 0.00001);
    });

    it('rotationZ should rotate around Z axis', () => {
      const q = Quaternion.rotationZ(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.right);
      // Right (+X) rotated 90 CCW around Z should become Up (+Y)
      assert.ok(Math.abs(rotated.x) < 0.00001);
      assert.ok(Math.abs(rotated.y - 1) < 0.00001);
      assert.ok(Math.abs(rotated.z) < 0.00001);
    });
  });

  describe('operations', () => {
    it('should normalize correctly', () => {
      const q = new Quaternion(1, 2, 3, 4);
      const normalized = q.normalize();
      assert.ok(Math.abs(normalized.length - 1) < 0.00001);
    });

    it('should conjugate correctly', () => {
      const q = new Quaternion(1, 2, 3, 4);
      const conj = q.conjugate();
      assert.strictEqual(conj.x, -1);
      assert.strictEqual(conj.y, -2);
      assert.strictEqual(conj.z, -3);
      assert.strictEqual(conj.w, 4);
    });

    it('should calculate inverse correctly', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, Math.PI / 4).normalize();
      const inv = q.inverse();
      const product = q.multiply(inv);
      assert.ok(product.equals(Quaternion.identity));
    });

    it('should calculate dot product correctly', () => {
      const q1 = new Quaternion(1, 0, 0, 0);
      const q2 = new Quaternion(0, 1, 0, 0);
      assert.strictEqual(q1.dot(q2), 0);

      const q3 = new Quaternion(1, 0, 0, 0);
      assert.strictEqual(q1.dot(q3), 1);
    });
  });

  describe('multiplication', () => {
    it('should combine rotations correctly', () => {
      const rotX = Quaternion.rotationX(Math.PI / 2);
      const rotY = Quaternion.rotationY(Math.PI / 2);

      // Multiply: first rotX, then rotY
      const combined = rotY.multiply(rotX);

      // Apply combined rotation to forward vector
      const result = combined.rotateVector(Vector3.forward);

      // Forward (-Z) -> rotX (90° CCW around X) -> Up (+Y)
      // Up (+Y) -> rotY (90° CCW around Y) -> Up (+Y) (Y axis stays unchanged)
      assert.ok(Math.abs(result.x) < 0.0001);
      assert.ok(Math.abs(result.y - 1) < 0.0001);
      assert.ok(Math.abs(result.z) < 0.0001);
    });

    it('should be associative: (a * b) * c = a * (b * c)', () => {
      const a = Quaternion.rotationX(0.5);
      const b = Quaternion.rotationY(0.7);
      const c = Quaternion.rotationZ(0.3);

      const left = a.multiply(b).multiply(c);
      const right = a.multiply(b.multiply(c));

      assert.ok(left.equals(right));
    });
  });

  describe('vector rotation', () => {
    it('should rotate vector by identity (no change)', () => {
      const v = new Vector3(1, 2, 3);
      const rotated = Quaternion.identity.rotateVector(v);
      assert.ok(rotated.equals(v));
    });

    it('should rotate vector 180 degrees around Y', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, Math.PI);
      const rotated = q.rotateVector(Vector3.forward);
      // Forward (-Z) -> Back (+Z)
      assert.ok(Math.abs(rotated.x) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z - 1) < 0.00001);
    });
  });

  describe('slerp', () => {
    it('should interpolate at t=0', () => {
      const q1 = Quaternion.identity;
      const q2 = Quaternion.rotationY(Math.PI);
      const result = q1.slerp(q2, 0);
      assert.ok(result.equals(q1));
    });

    it('should interpolate at t=1', () => {
      const q1 = Quaternion.identity;
      const q2 = Quaternion.rotationY(Math.PI);
      const result = q1.slerp(q2, 1);
      assert.ok(result.equals(q2));
    });

    it('should interpolate at t=0.5', () => {
      const q1 = Quaternion.identity;
      const q2 = Quaternion.rotationY(Math.PI / 2);
      const result = q1.slerp(q2, 0.5);

      // Should be half way rotation
      const angle = result.getAngle();
      assert.ok(Math.abs(angle - Math.PI / 4) < 0.0001);
    });
  });

  describe('conversion', () => {
    it('should convert to axis-angle', () => {
      const angle = Math.PI / 3;
      const axis = Vector3.up;
      const q = Quaternion.fromAxisAngle(axis, angle);
      const { axis: resultAxis, angle: resultAngle } = q.toAxisAngle();

      assert.ok(Math.abs(resultAngle - angle) < 0.00001);
      assert.ok(resultAxis.equals(axis));
    });

    it('should convert to Euler angles', () => {
      // Test that we can convert to Euler angles without errors
      const q = Quaternion.fromEuler(0.3, 0.2, 0.1, 'XYZ');
      const euler = q.toEuler('XYZ');

      // Verify Euler angles are reasonable values
      assert.ok(typeof euler.x === 'number' && !isNaN(euler.x));
      assert.ok(typeof euler.y === 'number' && !isNaN(euler.y));
      assert.ok(typeof euler.z === 'number' && !isNaN(euler.z));
      assert.strictEqual(euler.order, 'XYZ');
    });

    it('should convert to tuple', () => {
      const q = new Quaternion(1, 2, 3, 4);
      assert.deepStrictEqual([...q.toTuple()], [1, 2, 3, 4]);
    });

    it('should convert to array', () => {
      const q = new Quaternion(1, 2, 3, 4);
      assert.deepStrictEqual(q.toArray(), [1, 2, 3, 4]);
    });
  });

  describe('comparison', () => {
    it('should detect equal quaternions', () => {
      const q1 = Quaternion.rotationY(0.5);
      const q2 = Quaternion.rotationY(0.5);
      assert.ok(q1.equals(q2));
    });

    it('should detect that q and -q represent same rotation', () => {
      const q1 = new Quaternion(0.5, 0.5, 0.5, 0.5);
      const q2 = q1.negate();
      assert.ok(q1.equals(q2)); // Same rotation
    });

    it('should detect different quaternions', () => {
      const q1 = Quaternion.rotationY(0.5);
      const q2 = Quaternion.rotationY(1.0);
      assert.ok(!q1.equals(q2));
    });
  });

  describe('utility', () => {
    it('should clone correctly', () => {
      const q = new Quaternion(1, 2, 3, 4);
      const clone = q.clone();
      assert.strictEqual(clone.x, q.x);
      assert.strictEqual(clone.y, q.y);
      assert.strictEqual(clone.z, q.z);
      assert.strictEqual(clone.w, q.w);
    });

    it('should have meaningful toString', () => {
      const q = new Quaternion(1, 2, 3, 4);
      assert.strictEqual(q.toString(), 'Quaternion(1, 2, 3, 4)');
    });

    it('should check if unit quaternion', () => {
      assert.ok(Quaternion.identity.isUnit());
      assert.ok(!new Quaternion(2, 0, 0, 0).isUnit());
    });

    it('should get angle correctly', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, Math.PI / 2);
      assert.ok(Math.abs(q.getAngle() - Math.PI / 2) < 0.00001);
    });

    it('should get axis correctly', () => {
      const q = Quaternion.fromAxisAngle(Vector3.up, Math.PI / 2);
      const axis = q.getAxis();
      assert.ok(axis.equals(Vector3.up));
    });
  });
});
