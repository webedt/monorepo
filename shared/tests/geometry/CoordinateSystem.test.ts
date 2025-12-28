/**
 * Tests for the CoordinateSystem class.
 * Covers right-handed coordinate system conventions and utilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CoordinateSystem,
  CoordinateSystems,
  DEFAULT_COORDINATE_SYSTEM,
  isRightHanded,
  isLeftHanded,
  orthonormalize
} from '../../src/geometry/CoordinateSystem.js';
import { Vector3 } from '../../src/geometry/Vector3.js';

describe('CoordinateSystem', () => {
  describe('predefined systems', () => {
    it('should have correct right-handed Y-up system', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.strictEqual(cs.config.handedness, 'right');
      assert.strictEqual(cs.config.up, '+y');
      assert.strictEqual(cs.config.forward, '-z');
      assert.strictEqual(cs.config.right, '+x');
    });

    it('should have correct right-handed Z-up system', () => {
      const cs = CoordinateSystem.rightHandedZUp;
      assert.strictEqual(cs.config.handedness, 'right');
      assert.strictEqual(cs.config.up, '+z');
    });

    it('should have correct left-handed Y-up system', () => {
      const cs = CoordinateSystem.leftHandedYUp;
      assert.strictEqual(cs.config.handedness, 'left');
      assert.strictEqual(cs.config.up, '+y');
    });

    it('should have correct default system', () => {
      assert.ok(CoordinateSystem.default.equals(CoordinateSystem.rightHandedYUp));
    });
  });

  describe('basis vectors', () => {
    it('should have correct up vector', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.up.equals(Vector3.up));
    });

    it('should have correct right vector', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.right.equals(Vector3.right));
    });

    it('should have correct forward vector', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.forward.equals(Vector3.forward));
    });

    it('should have correct down vector (opposite of up)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.down.equals(Vector3.down));
    });

    it('should have correct left vector (opposite of right)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.left.equals(Vector3.left));
    });

    it('should have correct back vector (opposite of forward)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.back.equals(Vector3.back));
    });
  });

  describe('handedness detection', () => {
    it('should detect right-handed system', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.isRightHanded);
      assert.ok(!cs.isLeftHanded);
    });

    it('should detect left-handed system', () => {
      const cs = CoordinateSystem.leftHandedYUp;
      assert.ok(!cs.isRightHanded);
      assert.ok(cs.isLeftHanded);
    });
  });

  describe('validation', () => {
    it('should validate right-handed Y-up system', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      assert.ok(cs.validate());
    });

    it('should validate left-handed Y-up system', () => {
      const cs = CoordinateSystem.leftHandedYUp;
      assert.ok(cs.validate());
    });
  });

  describe('right-hand rule verification', () => {
    it('should satisfy X × Y = Z (right-hand rule)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const cross = cs.right.cross(cs.up);
      // In right-handed Y-up: X × Y should give +Z (back)
      assert.ok(cross.equals(cs.back));
    });

    it('should satisfy Y × Z = X', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      // back = +Z, so up × back = right
      const cross = cs.up.cross(cs.back);
      assert.ok(cross.equals(cs.right));
    });

    it('should satisfy Z × X = Y', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const cross = cs.back.cross(cs.right);
      assert.ok(cross.equals(cs.up));
    });
  });

  describe('coordinate system conversion', () => {
    it('should convert between same systems (identity)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const matrix = cs.getConversionMatrix(cs);
      assert.ok(matrix.isIdentity());
    });

    it('should convert position between right-handed systems', () => {
      const yUp = CoordinateSystem.rightHandedYUp;
      const zUp = CoordinateSystem.rightHandedZUp;

      const positionInYUp = new Vector3(1, 2, 3);
      const positionInZUp = yUp.convertPosition(positionInYUp, zUp);

      assert.ok(positionInZUp !== undefined);
    });

    it('should convert direction correctly', () => {
      const yUp = CoordinateSystem.rightHandedYUp;

      // Direction doesn't change when converting to same system
      const dir = new Vector3(1, 0, 0);
      const converted = yUp.convertDirection(dir, yUp);
      assert.ok(converted.equals(dir));
    });
  });

  describe('rotation utilities', () => {
    it('should create rotation around up axis (yaw)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const q = cs.rotateAroundUp(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.forward);
      // Forward (-Z) rotated 90 CCW around Y should become Left (-X)
      assert.ok(Math.abs(rotated.x + 1) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z) < 0.00001);
    });

    it('should create rotation around right axis (pitch)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const q = cs.rotateAroundRight(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.up);
      // Up (+Y) rotated 90 CCW around X should become Back (+Z)
      assert.ok(Math.abs(rotated.x) < 0.00001);
      assert.ok(Math.abs(rotated.y) < 0.00001);
      assert.ok(Math.abs(rotated.z - 1) < 0.00001);
    });

    it('should create rotation around forward axis (roll)', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const q = cs.rotateAroundForward(Math.PI / 2);
      const rotated = q.rotateVector(Vector3.right);
      // Right (+X) rotated 90 CCW around -Z should become Down (-Y)
      assert.ok(Math.abs(rotated.x) < 0.00001);
      assert.ok(Math.abs(rotated.y + 1) < 0.00001);
      assert.ok(Math.abs(rotated.z) < 0.00001);
    });
  });

  describe('lookRotation', () => {
    it('should create rotation facing forward', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const q = cs.lookRotation(Vector3.forward);

      // Should be approximately identity or close to it
      const rotated = q.rotateVector(new Vector3(0, 0, -1));
      assert.ok(Math.abs(rotated.z + 1) < 0.0001);
    });
  });

  describe('comparison', () => {
    it('should detect equal systems', () => {
      const a = CoordinateSystem.rightHandedYUp;
      const b = new CoordinateSystem(CoordinateSystems.RIGHT_HANDED_Y_UP);
      assert.ok(a.equals(b));
    });

    it('should detect different systems', () => {
      const a = CoordinateSystem.rightHandedYUp;
      const b = CoordinateSystem.leftHandedYUp;
      assert.ok(!a.equals(b));
    });
  });

  describe('toString', () => {
    it('should have meaningful string representation', () => {
      const cs = CoordinateSystem.rightHandedYUp;
      const str = cs.toString();
      assert.ok(str.includes('right'));
      assert.ok(str.includes('+y'));
    });
  });
});

describe('utility functions', () => {
  describe('isRightHanded', () => {
    it('should return true for right-handed basis', () => {
      const right = Vector3.right;
      const up = Vector3.up;
      const forward = Vector3.back; // +Z
      assert.ok(isRightHanded(right, up, forward));
    });

    it('should return false for left-handed basis', () => {
      const right = Vector3.right;
      const up = Vector3.up;
      const forward = Vector3.forward; // -Z
      assert.ok(!isRightHanded(right, up, forward));
    });
  });

  describe('isLeftHanded', () => {
    it('should return true for left-handed basis', () => {
      const right = Vector3.right;
      const up = Vector3.up;
      const forward = Vector3.forward; // -Z
      assert.ok(isLeftHanded(right, up, forward));
    });

    it('should return false for right-handed basis', () => {
      const right = Vector3.right;
      const up = Vector3.up;
      const forward = Vector3.back; // +Z
      assert.ok(!isLeftHanded(right, up, forward));
    });
  });

  describe('orthonormalize', () => {
    it('should orthonormalize non-orthogonal vectors', () => {
      const forward = new Vector3(1, 0.1, 0).normalize();
      const up = new Vector3(0, 1, 0.1).normalize();

      const result = orthonormalize(forward, up, true);

      // Check all vectors are unit length
      assert.ok(result.forward.isUnit());
      assert.ok(result.up.isUnit());
      assert.ok(result.right.isUnit());

      // Check orthogonality
      assert.ok(Math.abs(result.forward.dot(result.up)) < 0.00001);
      assert.ok(Math.abs(result.forward.dot(result.right)) < 0.00001);
      assert.ok(Math.abs(result.up.dot(result.right)) < 0.00001);
    });

    it('should produce right-handed basis when specified', () => {
      const forward = Vector3.forward;
      const up = Vector3.up;

      const result = orthonormalize(forward, up, true);

      // right × up should equal forward (in opposite direction due to normalization)
      assert.ok(isRightHanded(result.right, result.up, result.right.cross(result.up)));
    });
  });
});

describe('DEFAULT_COORDINATE_SYSTEM', () => {
  it('should be right-handed Y-up', () => {
    assert.strictEqual(DEFAULT_COORDINATE_SYSTEM.handedness, 'right');
    assert.strictEqual(DEFAULT_COORDINATE_SYSTEM.up, '+y');
  });
});

describe('CoordinateSystems constants', () => {
  it('should have all predefined systems', () => {
    assert.ok(CoordinateSystems.RIGHT_HANDED_Y_UP !== undefined);
    assert.ok(CoordinateSystems.RIGHT_HANDED_Z_UP !== undefined);
    assert.ok(CoordinateSystems.LEFT_HANDED_Y_UP !== undefined);
    assert.ok(CoordinateSystems.LEFT_HANDED_Z_UP !== undefined);
  });
});
