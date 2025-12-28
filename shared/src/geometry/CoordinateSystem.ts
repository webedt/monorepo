import type { CoordinateSystemConfig } from './types.js';
import type { Handedness } from './types.js';
import type { SignedAxis } from './types.js';

import { Vector3 } from './Vector3.js';
import { Matrix4 } from './Matrix4.js';
import { Quaternion } from './Quaternion.js';

/**
 * Standard right-handed coordinate system utilities.
 *
 * Right-Handed Coordinate System Convention:
 * ==========================================
 *
 * Axis Orientation (Y-Up):
 * - X-axis: Points right (positive = right)
 * - Y-axis: Points up (positive = up)
 * - Z-axis: Points toward the viewer (positive = out of screen)
 *
 * Visual representation (looking at screen):
 *
 *          +Y (up)
 *           │
 *           │
 *           │
 *           └───────── +X (right)
 *          /
 *         /
 *        +Z (toward viewer)
 *
 * Right-Hand Rule:
 * - Point thumb in +X direction
 * - Point index finger in +Y direction
 * - Middle finger points in +Z direction
 *
 * Rotation Convention (right-hand rule):
 * - Wrap fingers around axis with thumb pointing in positive direction
 * - Fingers curl in positive rotation direction
 * - Positive rotation is counter-clockwise when looking down the positive axis
 *
 * Common Coordinate System Conventions:
 * =====================================
 *
 * OpenGL/WebGL (Right-handed, Y-up):
 * - Right: +X, Up: +Y, Forward: -Z (into screen)
 *
 * DirectX (Left-handed, Y-up):
 * - Right: +X, Up: +Y, Forward: +Z (into screen)
 *
 * Blender (Right-handed, Z-up):
 * - Right: +X, Forward: +Y, Up: +Z
 *
 * Unity (Left-handed, Y-up):
 * - Right: +X, Up: +Y, Forward: +Z
 *
 * Unreal Engine (Left-handed, Z-up):
 * - Right: +X, Forward: +Y, Up: +Z
 */

/**
 * Predefined coordinate system configurations.
 */
export const CoordinateSystems = {
  /**
   * Standard right-handed Y-up system (OpenGL/WebGL convention).
   * This is the default and recommended coordinate system.
   */
  RIGHT_HANDED_Y_UP: {
    handedness: 'right' as Handedness,
    up: '+y' as SignedAxis,
    forward: '-z' as SignedAxis,
    right: '+x' as SignedAxis,
  },

  /**
   * Right-handed Z-up system (Blender convention).
   */
  RIGHT_HANDED_Z_UP: {
    handedness: 'right' as Handedness,
    up: '+z' as SignedAxis,
    forward: '+y' as SignedAxis,
    right: '+x' as SignedAxis,
  },

  /**
   * Left-handed Y-up system (DirectX/Unity convention).
   */
  LEFT_HANDED_Y_UP: {
    handedness: 'left' as Handedness,
    up: '+y' as SignedAxis,
    forward: '+z' as SignedAxis,
    right: '+x' as SignedAxis,
  },

  /**
   * Left-handed Z-up system (Unreal Engine convention).
   */
  LEFT_HANDED_Z_UP: {
    handedness: 'left' as Handedness,
    up: '+z' as SignedAxis,
    forward: '+x' as SignedAxis,
    right: '+y' as SignedAxis,
  },
} as const;

/**
 * The default coordinate system (right-handed, Y-up).
 */
export const DEFAULT_COORDINATE_SYSTEM = CoordinateSystems.RIGHT_HANDED_Y_UP;

/**
 * Coordinate system utility class.
 * Provides helpers for working with the right-handed coordinate system
 * and converting between different coordinate system conventions.
 */
export class CoordinateSystem {
  readonly config: CoordinateSystemConfig;

  // Cached basis vectors
  private _up: Vector3 | undefined;
  private _right: Vector3 | undefined;
  private _forward: Vector3 | undefined;
  private _down: Vector3 | undefined;
  private _left: Vector3 | undefined;
  private _back: Vector3 | undefined;

  constructor(config: CoordinateSystemConfig = DEFAULT_COORDINATE_SYSTEM) {
    this.config = config;
  }

  // ==================== Static Instances ====================

  private static _rightHandedYUp: CoordinateSystem | undefined;
  private static _rightHandedZUp: CoordinateSystem | undefined;
  private static _leftHandedYUp: CoordinateSystem | undefined;
  private static _leftHandedZUp: CoordinateSystem | undefined;

  /** Standard right-handed Y-up coordinate system (OpenGL/WebGL) */
  static get rightHandedYUp(): CoordinateSystem {
    return CoordinateSystem._rightHandedYUp ??=
      new CoordinateSystem(CoordinateSystems.RIGHT_HANDED_Y_UP);
  }

  /** Right-handed Z-up coordinate system (Blender) */
  static get rightHandedZUp(): CoordinateSystem {
    return CoordinateSystem._rightHandedZUp ??=
      new CoordinateSystem(CoordinateSystems.RIGHT_HANDED_Z_UP);
  }

  /** Left-handed Y-up coordinate system (DirectX/Unity) */
  static get leftHandedYUp(): CoordinateSystem {
    return CoordinateSystem._leftHandedYUp ??=
      new CoordinateSystem(CoordinateSystems.LEFT_HANDED_Y_UP);
  }

  /** Left-handed Z-up coordinate system (Unreal Engine) */
  static get leftHandedZUp(): CoordinateSystem {
    return CoordinateSystem._leftHandedZUp ??=
      new CoordinateSystem(CoordinateSystems.LEFT_HANDED_Z_UP);
  }

  /** Default coordinate system (right-handed Y-up) */
  static get default(): CoordinateSystem {
    return CoordinateSystem.rightHandedYUp;
  }

  // ==================== Basis Vectors ====================

  /** Parse a signed axis string to a vector */
  private static parseAxis(axis: SignedAxis): Vector3 {
    switch (axis) {
      case '+x': return Vector3.right;
      case '-x': return Vector3.left;
      case '+y': return Vector3.up;
      case '-y': return Vector3.down;
      case '+z': return Vector3.back; // +Z points toward viewer
      case '-z': return Vector3.forward; // -Z points into screen
      default: throw new Error(`Invalid axis: ${axis}`);
    }
  }

  /** Up direction vector */
  get up(): Vector3 {
    return this._up ??= CoordinateSystem.parseAxis(this.config.up);
  }

  /** Right direction vector */
  get right(): Vector3 {
    return this._right ??= CoordinateSystem.parseAxis(this.config.right);
  }

  /** Forward direction vector */
  get forward(): Vector3 {
    return this._forward ??= CoordinateSystem.parseAxis(this.config.forward);
  }

  /** Down direction (opposite of up) */
  get down(): Vector3 {
    return this._down ??= this.up.negate();
  }

  /** Left direction (opposite of right) */
  get left(): Vector3 {
    return this._left ??= this.right.negate();
  }

  /** Back direction (opposite of forward) */
  get back(): Vector3 {
    return this._back ??= this.forward.negate();
  }

  /** Check if this is a right-handed system */
  get isRightHanded(): boolean {
    return this.config.handedness === 'right';
  }

  /** Check if this is a left-handed system */
  get isLeftHanded(): boolean {
    return this.config.handedness === 'left';
  }

  // ==================== Validation ====================

  /**
   * Validate that the basis vectors form a valid orthonormal basis.
   * For right-handed: right × up = back (opposite of forward)
   * For left-handed: right × up = forward
   */
  validate(): boolean {
    const crossProduct = this.right.cross(this.up);
    // In right-handed: X × Y = Z, and back = +Z, forward = -Z
    // In left-handed: X × Y = -Z (opposite), forward = +Z
    const expected = this.isRightHanded
      ? this.back  // right × up = +Z = back
      : this.forward;  // right × up should give forward direction

    return crossProduct.equals(expected);
  }

  // ==================== Conversion ====================

  /**
   * Create a transformation matrix to convert from this coordinate system
   * to another coordinate system.
   */
  getConversionMatrix(to: CoordinateSystem): Matrix4 {
    // Build the conversion by mapping basis vectors
    const fromRight = this.right;
    const fromUp = this.up;
    const fromForward = this.forward;

    const toRight = to.right;
    const toUp = to.up;
    const toForward = to.forward;

    // The conversion matrix maps from 'this' basis to 'to' basis
    // Each column represents where the source basis vector ends up in the target system
    return new Matrix4([
      fromRight.dot(toRight), fromRight.dot(toUp), fromRight.dot(toForward), 0,
      fromUp.dot(toRight), fromUp.dot(toUp), fromUp.dot(toForward), 0,
      fromForward.dot(toRight), fromForward.dot(toUp), fromForward.dot(toForward), 0,
      0, 0, 0, 1
    ]);
  }

  /**
   * Convert a position from this coordinate system to another.
   */
  convertPosition(position: Vector3, to: CoordinateSystem): Vector3 {
    const matrix = this.getConversionMatrix(to);
    return matrix.transformPoint(position);
  }

  /**
   * Convert a direction from this coordinate system to another.
   */
  convertDirection(direction: Vector3, to: CoordinateSystem): Vector3 {
    const matrix = this.getConversionMatrix(to);
    return matrix.transformDirection(direction);
  }

  /**
   * Convert a rotation from this coordinate system to another.
   */
  convertRotation(rotation: Quaternion, to: CoordinateSystem): Quaternion {
    // For rotation conversion, we need to handle handedness change
    if (this.config.handedness !== to.config.handedness) {
      // Flip rotation direction when converting between handedness
      return new Quaternion(-rotation.x, -rotation.y, -rotation.z, rotation.w);
    }

    // For same handedness, apply basis transformation
    const matrix = this.getConversionMatrix(to);
    const axis = rotation.getAxis();
    const angle = rotation.getAngle();

    const newAxis = matrix.transformDirection(axis);
    return Quaternion.fromAxisAngle(newAxis, angle);
  }

  // ==================== Utility Methods ====================

  /**
   * Create a look-at rotation quaternion.
   * Returns a rotation that makes an object face the target direction.
   */
  lookRotation(forward: Vector3, up: Vector3 = this.up): Quaternion {
    const normalizedForward = forward.normalize();
    const normalizedUp = up.normalize();

    // Calculate right vector
    let right = normalizedUp.cross(normalizedForward);
    if (right.isZero()) {
      // Forward and up are parallel, use a fallback
      right = this.right;
    }
    right = right.normalize();

    // Recalculate up to ensure orthogonality
    const correctedUp = normalizedForward.cross(right).normalize();

    // Build rotation matrix from basis vectors
    const matrix = new Matrix4([
      right.x, right.y, right.z, 0,
      correctedUp.x, correctedUp.y, correctedUp.z, 0,
      -normalizedForward.x, -normalizedForward.y, -normalizedForward.z, 0,
      0, 0, 0, 1
    ]);

    const decomposed = matrix.decompose();
    return Quaternion.from(decomposed.rotation);
  }

  /**
   * Calculate the signed angle between two vectors around an axis.
   * Positive angle follows the right-hand rule (counter-clockwise when looking down axis).
   */
  signedAngle(from: Vector3, to: Vector3, axis: Vector3): number {
    const angle = from.angleTo(to);
    const cross = from.cross(to);
    const sign = cross.dot(axis);

    if (this.isLeftHanded) {
      return sign < 0 ? angle : -angle;
    }
    return sign >= 0 ? angle : -angle;
  }

  /**
   * Create a rotation around the up axis (yaw).
   */
  rotateAroundUp(angle: number): Quaternion {
    return Quaternion.fromAxisAngle(this.up, angle);
  }

  /**
   * Create a rotation around the right axis (pitch).
   */
  rotateAroundRight(angle: number): Quaternion {
    return Quaternion.fromAxisAngle(this.right, angle);
  }

  /**
   * Create a rotation around the forward axis (roll).
   */
  rotateAroundForward(angle: number): Quaternion {
    return Quaternion.fromAxisAngle(this.forward, angle);
  }

  // ==================== Comparison ====================

  /**
   * Check if this coordinate system is equivalent to another.
   */
  equals(other: CoordinateSystem): boolean {
    return (
      this.config.handedness === other.config.handedness &&
      this.config.up === other.config.up &&
      this.config.forward === other.config.forward &&
      this.config.right === other.config.right
    );
  }

  // ==================== String Representation ====================

  toString(): string {
    return `CoordinateSystem(${this.config.handedness}, up=${this.config.up}, forward=${this.config.forward}, right=${this.config.right})`;
  }
}

// ==================== Utility Functions ====================

/**
 * Check if a set of basis vectors forms a right-handed system.
 * Uses the cross product: right × up should equal forward.
 */
export function isRightHanded(right: Vector3, up: Vector3, forward: Vector3): boolean {
  const cross = right.cross(up);
  return cross.equals(forward);
}

/**
 * Check if a set of basis vectors forms a left-handed system.
 * Uses the cross product: right × up should equal -forward.
 */
export function isLeftHanded(right: Vector3, up: Vector3, forward: Vector3): boolean {
  const cross = right.cross(up);
  return cross.equals(forward.negate());
}

/**
 * Ensure vectors form an orthonormal basis using Gram-Schmidt orthogonalization.
 * Preserves the forward direction and adjusts up and right.
 */
export function orthonormalize(
  forward: Vector3,
  up: Vector3,
  rightHanded: boolean = true
): { forward: Vector3; up: Vector3; right: Vector3 } {
  const normalizedForward = forward.normalize();

  // Remove forward component from up
  let adjustedUp = up.subtract(normalizedForward.multiply(up.dot(normalizedForward)));
  if (adjustedUp.isZero()) {
    // Up is parallel to forward, use a fallback
    adjustedUp = Math.abs(normalizedForward.y) < 0.9999
      ? new Vector3(0, 1, 0)
      : new Vector3(1, 0, 0);
    adjustedUp = adjustedUp.subtract(normalizedForward.multiply(adjustedUp.dot(normalizedForward)));
  }
  const normalizedUp = adjustedUp.normalize();

  // Calculate right using cross product
  const right = rightHanded
    ? normalizedUp.cross(normalizedForward).normalize()
    : normalizedForward.cross(normalizedUp).normalize();

  return {
    forward: normalizedForward,
    up: normalizedUp,
    right
  };
}
