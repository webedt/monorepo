/**
 * Tests for the Matrix4 class.
 * Covers construction, transformations, and matrix operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Matrix4 } from '../../src/geometry/Matrix4.js';
import { Vector3 } from '../../src/geometry/Vector3.js';
import { Quaternion } from '../../src/geometry/Quaternion.js';

describe('Matrix4', () => {
  describe('construction', () => {
    it('should create identity matrix by default', () => {
      const m = new Matrix4();
      assert.ok(m.isIdentity());
    });

    it('should have correct identity static getter', () => {
      const id = Matrix4.identity;
      assert.strictEqual(id.get(0), 1);
      assert.strictEqual(id.get(5), 1);
      assert.strictEqual(id.get(10), 1);
      assert.strictEqual(id.get(15), 1);
      assert.strictEqual(id.get(1), 0);
    });

    it('should create from row-major array', () => {
      const m = Matrix4.fromRowMajor([
        1, 0, 0, 5,
        0, 1, 0, 6,
        0, 0, 1, 7,
        0, 0, 0, 1
      ]);
      // Translation should be at indices 12, 13, 14 in column-major
      assert.strictEqual(m.get(12), 5);
      assert.strictEqual(m.get(13), 6);
      assert.strictEqual(m.get(14), 7);
    });
  });

  describe('translation', () => {
    it('should create translation matrix from values', () => {
      const m = Matrix4.translation(1, 2, 3);
      assert.strictEqual(m.get(12), 1);
      assert.strictEqual(m.get(13), 2);
      assert.strictEqual(m.get(14), 3);
    });

    it('should create translation matrix from vector', () => {
      const m = Matrix4.translation(new Vector3(4, 5, 6));
      assert.strictEqual(m.get(12), 4);
      assert.strictEqual(m.get(13), 5);
      assert.strictEqual(m.get(14), 6);
    });

    it('should translate points correctly', () => {
      const m = Matrix4.translation(10, 20, 30);
      const p = new Vector3(1, 2, 3);
      const result = m.transformPoint(p);
      assert.ok(result.equals(new Vector3(11, 22, 33)));
    });
  });

  describe('scale', () => {
    it('should create uniform scale matrix', () => {
      const m = Matrix4.scale(2);
      assert.strictEqual(m.get(0), 2);
      assert.strictEqual(m.get(5), 2);
      assert.strictEqual(m.get(10), 2);
    });

    it('should create non-uniform scale matrix', () => {
      const m = Matrix4.scale(1, 2, 3);
      assert.strictEqual(m.get(0), 1);
      assert.strictEqual(m.get(5), 2);
      assert.strictEqual(m.get(10), 3);
    });

    it('should scale points correctly', () => {
      const m = Matrix4.scale(2, 3, 4);
      const p = new Vector3(1, 1, 1);
      const result = m.transformPoint(p);
      assert.ok(result.equals(new Vector3(2, 3, 4)));
    });
  });

  describe('rotation', () => {
    it('should create rotation around X axis', () => {
      const m = Matrix4.rotationX(Math.PI / 2);
      const p = new Vector3(0, 1, 0);
      const result = m.transformPoint(p);
      assert.ok(Math.abs(result.x) < 0.00001);
      assert.ok(Math.abs(result.y) < 0.00001);
      assert.ok(Math.abs(result.z - 1) < 0.00001);
    });

    it('should create rotation around Y axis', () => {
      const m = Matrix4.rotationY(Math.PI / 2);
      const p = new Vector3(0, 0, -1); // forward
      const result = m.transformPoint(p);
      // Forward (-Z) rotated 90 CCW around Y should become Left (-X)
      assert.ok(Math.abs(result.x + 1) < 0.00001);
      assert.ok(Math.abs(result.y) < 0.00001);
      assert.ok(Math.abs(result.z) < 0.00001);
    });

    it('should create rotation around Z axis', () => {
      const m = Matrix4.rotationZ(Math.PI / 2);
      const p = new Vector3(1, 0, 0); // right
      const result = m.transformPoint(p);
      // Right (+X) rotated 90 CCW around Z should become Up (+Y)
      assert.ok(Math.abs(result.x) < 0.00001);
      assert.ok(Math.abs(result.y - 1) < 0.00001);
      assert.ok(Math.abs(result.z) < 0.00001);
    });

    it('should create rotation around arbitrary axis', () => {
      const m = Matrix4.rotationAxis(Vector3.up, Math.PI / 2);
      const p = Vector3.forward; // -Z
      const result = m.transformPoint(p);
      // Same as rotationY
      assert.ok(Math.abs(result.x + 1) < 0.00001);
      assert.ok(Math.abs(result.y) < 0.00001);
      assert.ok(Math.abs(result.z) < 0.00001);
    });
  });

  describe('fromQuaternion', () => {
    it('should create matrix from quaternion', () => {
      const q = Quaternion.rotationY(Math.PI / 2);
      const m = Matrix4.fromQuaternion(q);
      const p = Vector3.forward;
      const result = m.transformPoint(p);
      assert.ok(Math.abs(result.x + 1) < 0.00001);
      assert.ok(Math.abs(result.y) < 0.00001);
      assert.ok(Math.abs(result.z) < 0.00001);
    });
  });

  describe('compose', () => {
    it('should compose TRS matrix correctly', () => {
      const position = new Vector3(10, 0, 0);
      const rotation = Quaternion.identity;
      const scale = new Vector3(2, 2, 2);

      const m = Matrix4.compose(position, rotation, scale);
      const p = new Vector3(1, 1, 1);
      const result = m.transformPoint(p);

      // Scale first (2, 2, 2), then translate (+10, 0, 0)
      assert.ok(result.equals(new Vector3(12, 2, 2)));
    });
  });

  describe('lookAt', () => {
    it('should create view matrix looking at target', () => {
      const eye = new Vector3(0, 0, 5);
      const target = new Vector3(0, 0, 0);
      const up = Vector3.up;

      const m = Matrix4.lookAt(eye, target, up);

      // Transform a point at origin should move it by -eye
      const p = new Vector3(0, 0, 0);
      const result = m.transformPoint(p);
      assert.ok(Math.abs(result.z + 5) < 0.00001);
    });
  });

  describe('perspective', () => {
    it('should create perspective projection matrix', () => {
      const m = Matrix4.perspective(Math.PI / 4, 1, 0.1, 100);
      // Basic sanity check - not identity
      assert.ok(!m.isIdentity());
      // Check that perspective division column is set
      assert.strictEqual(m.get(11), -1); // Right-handed: -1
    });
  });

  describe('orthographic', () => {
    it('should create orthographic projection matrix', () => {
      const m = Matrix4.orthographic(-1, 1, -1, 1, 0.1, 100);
      assert.ok(!m.isIdentity());
    });
  });

  describe('matrix operations', () => {
    it('should multiply matrices correctly', () => {
      const t = Matrix4.translation(10, 0, 0);
      const s = Matrix4.scale(2);

      // Scale then translate
      const combined = t.multiply(s);
      const p = new Vector3(1, 0, 0);
      const result = combined.transformPoint(p);

      // Scale first (2, 0, 0), then translate (12, 0, 0)
      assert.ok(Math.abs(result.x - 12) < 0.00001);
    });

    it('should transpose correctly', () => {
      const m = Matrix4.translation(1, 2, 3);
      const t = m.transpose();
      // Translation was at 12, 13, 14, should now be at 3, 7, 11
      assert.strictEqual(t.get(3), 1);
      assert.strictEqual(t.get(7), 2);
      assert.strictEqual(t.get(11), 3);
    });

    it('should calculate determinant of identity as 1', () => {
      assert.strictEqual(Matrix4.identity.determinant(), 1);
    });

    it('should calculate determinant of scale matrix', () => {
      const m = Matrix4.scale(2, 3, 4);
      assert.ok(Math.abs(m.determinant() - 24) < 0.00001);
    });

    it('should calculate inverse correctly', () => {
      const m = Matrix4.translation(5, 10, 15);
      const inv = m.inverse();
      const product = m.multiply(inv);
      assert.ok(product.isIdentity());
    });

    it('should throw on singular matrix inverse', () => {
      const singular = new Matrix4([
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0
      ]);
      assert.throws(() => singular.inverse());
    });
  });

  describe('vector transformation', () => {
    it('should transform point (with translation)', () => {
      const m = Matrix4.translation(5, 0, 0);
      const p = new Vector3(1, 0, 0);
      const result = m.transformPoint(p);
      assert.strictEqual(result.x, 6);
    });

    it('should transform direction (without translation)', () => {
      const m = Matrix4.translation(5, 0, 0);
      const d = new Vector3(1, 0, 0);
      const result = m.transformDirection(d);
      assert.strictEqual(result.x, 1); // Translation ignored
    });
  });

  describe('decompose', () => {
    it('should decompose TRS matrix', () => {
      const position = new Vector3(10, 20, 30);
      const rotation = Quaternion.rotationY(Math.PI / 4);
      const scale = new Vector3(1, 2, 3);

      const m = Matrix4.compose(position, rotation, scale);
      const decomposed = m.decompose();

      assert.ok(decomposed.position.equals(position));
      assert.ok(Math.abs(decomposed.scale.x - scale.x) < 0.0001);
      assert.ok(Math.abs(decomposed.scale.y - scale.y) < 0.0001);
      assert.ok(Math.abs(decomposed.scale.z - scale.z) < 0.0001);
    });

    it('should throw on zero scale', () => {
      // Matrix with zero scale on X axis
      const m = Matrix4.scale(0, 1, 1);
      assert.throws(() => m.decompose(), {
        message: 'Cannot decompose matrix with zero scale'
      });
    });
  });

  describe('getters', () => {
    it('should get translation component', () => {
      const m = Matrix4.translation(1, 2, 3);
      const t = m.getTranslation();
      assert.ok(t.equals(new Vector3(1, 2, 3)));
    });

    it('should get scale component', () => {
      const m = Matrix4.scale(2, 3, 4);
      const s = m.getScale();
      assert.ok(Math.abs(s.x - 2) < 0.00001);
      assert.ok(Math.abs(s.y - 3) < 0.00001);
      assert.ok(Math.abs(s.z - 4) < 0.00001);
    });

    it('should get column as Vector3', () => {
      const m = Matrix4.translation(5, 6, 7);
      const col3 = m.getColumn(3);
      assert.strictEqual(col3.x, 5);
      assert.strictEqual(col3.y, 6);
      assert.strictEqual(col3.z, 7);
    });
  });

  describe('conversion', () => {
    it('should convert to array', () => {
      const m = Matrix4.identity;
      const arr = m.toArray();
      assert.strictEqual(arr.length, 16);
      assert.strictEqual(arr[0], 1);
      assert.strictEqual(arr[5], 1);
    });

    it('should convert to Float32Array', () => {
      const m = Matrix4.identity;
      const f32 = m.toFloat32Array();
      assert.ok(f32 instanceof Float32Array);
      assert.strictEqual(f32.length, 16);
    });

    it('should have meaningful toString', () => {
      const m = Matrix4.identity;
      const str = m.toString();
      assert.ok(str.includes('Matrix4'));
    });
  });

  describe('comparison', () => {
    it('should detect equal matrices', () => {
      const a = Matrix4.translation(1, 2, 3);
      const b = Matrix4.translation(1, 2, 3);
      assert.ok(a.equals(b));
    });

    it('should detect different matrices', () => {
      const a = Matrix4.translation(1, 2, 3);
      const b = Matrix4.translation(4, 5, 6);
      assert.ok(!a.equals(b));
    });
  });
});
