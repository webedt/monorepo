import type { QuaternionLike } from './types.js';
import type { QuaternionTuple } from './types.js';
import type { Vector3Like } from './types.js';
import type { EulerAngles } from './types.js';
import type { EulerOrder } from './types.js';

import { EPSILON } from './types.js';
import { Vector3 } from './Vector3.js';

/**
 * Immutable quaternion class for 3D rotations.
 *
 * Quaternions avoid gimbal lock and provide smooth interpolation.
 * They represent rotations using four components (x, y, z, w) where:
 * - (x, y, z) represents the axis of rotation scaled by sin(angle/2)
 * - w represents cos(angle/2)
 *
 * For a unit quaternion: x² + y² + z² + w² = 1
 *
 * Right-handed rotation convention:
 * Positive rotation is counter-clockwise when looking down the positive axis
 * toward the origin.
 */
export class Quaternion implements QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;

  // Cached identity quaternion
  private static _identity: Quaternion | undefined;

  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  // ==================== Static Constructors ====================

  /** Identity quaternion (no rotation) */
  static get identity(): Quaternion {
    return Quaternion._identity ??= new Quaternion(0, 0, 0, 1);
  }

  /** Create from a QuaternionLike object */
  static from(q: QuaternionLike): Quaternion {
    return new Quaternion(q.x, q.y, q.z, q.w);
  }

  /** Create from a tuple [x, y, z, w] */
  static fromTuple(tuple: QuaternionTuple): Quaternion {
    return new Quaternion(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  /** Create from axis-angle representation */
  static fromAxisAngle(axis: Vector3Like, angle: number): Quaternion {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);

    // Normalize axis
    const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
    if (len < EPSILON) {
      return Quaternion.identity;
    }

    const invLen = 1 / len;
    return new Quaternion(
      axis.x * invLen * s,
      axis.y * invLen * s,
      axis.z * invLen * s,
      Math.cos(halfAngle)
    );
  }

  /** Create from Euler angles */
  static fromEuler(euler: EulerAngles): Quaternion;
  static fromEuler(x: number, y: number, z: number, order?: EulerOrder): Quaternion;
  static fromEuler(
    xOrEuler: number | EulerAngles,
    yVal?: number,
    zVal?: number,
    orderVal?: EulerOrder
  ): Quaternion {
    let x: number, y: number, z: number, order: EulerOrder;

    if (typeof xOrEuler === 'object') {
      x = xOrEuler.x;
      y = xOrEuler.y;
      z = xOrEuler.z;
      order = xOrEuler.order;
    } else {
      x = xOrEuler;
      y = yVal!;
      z = zVal!;
      order = orderVal ?? 'XYZ';
    }

    const c1 = Math.cos(x / 2);
    const c2 = Math.cos(y / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2);
    const s2 = Math.sin(y / 2);
    const s3 = Math.sin(z / 2);

    let qx: number, qy: number, qz: number, qw: number;

    switch (order) {
      case 'XYZ':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'YXZ':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case 'ZXY':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'ZYX':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case 'YZX':
        qx = s1 * c2 * c3 + c1 * s2 * s3;
        qy = c1 * s2 * c3 + s1 * c2 * s3;
        qz = c1 * c2 * s3 - s1 * s2 * c3;
        qw = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case 'XZY':
        qx = s1 * c2 * c3 - c1 * s2 * s3;
        qy = c1 * s2 * c3 - s1 * c2 * s3;
        qz = c1 * c2 * s3 + s1 * s2 * c3;
        qw = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      default:
        throw new Error(`Unknown Euler order: ${order}`);
    }

    return new Quaternion(qx, qy, qz, qw);
  }

  /** Create rotation from one direction to another */
  static fromUnitVectors(from: Vector3Like, to: Vector3Like): Quaternion {
    // Assumes both vectors are unit length
    let r = Vector3.from(from).dot(to) + 1;

    if (r < EPSILON) {
      // Vectors are opposite, find a perpendicular axis
      r = 0;
      let axis: Vector3;
      if (Math.abs(from.x) > Math.abs(from.z)) {
        axis = new Vector3(-from.y, from.x, 0);
      } else {
        axis = new Vector3(0, -from.z, from.y);
      }
      return new Quaternion(axis.x, axis.y, axis.z, r).normalize();
    }

    // Standard case: find the rotation axis (cross product)
    const cross = Vector3.from(from).cross(to);
    return new Quaternion(cross.x, cross.y, cross.z, r).normalize();
  }

  /**
   * Create a quaternion that rotates around the X axis.
   */
  static rotationX(angle: number): Quaternion {
    const half = angle / 2;
    return new Quaternion(Math.sin(half), 0, 0, Math.cos(half));
  }

  /**
   * Create a quaternion that rotates around the Y axis.
   */
  static rotationY(angle: number): Quaternion {
    const half = angle / 2;
    return new Quaternion(0, Math.sin(half), 0, Math.cos(half));
  }

  /**
   * Create a quaternion that rotates around the Z axis.
   */
  static rotationZ(angle: number): Quaternion {
    const half = angle / 2;
    return new Quaternion(0, 0, Math.sin(half), Math.cos(half));
  }

  // ==================== Basic Properties ====================

  /** Squared length (norm squared) */
  get lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  /** Length (norm) */
  get length(): number {
    return Math.sqrt(this.lengthSquared);
  }

  /** Check if this is a unit quaternion */
  isUnit(epsilon: number = EPSILON): boolean {
    return Math.abs(this.lengthSquared - 1) < epsilon;
  }

  // ==================== Basic Operations ====================

  /** Normalize to unit length */
  normalize(): Quaternion {
    const len = this.length;
    if (len < EPSILON) {
      return Quaternion.identity;
    }
    const invLen = 1 / len;
    return new Quaternion(
      this.x * invLen,
      this.y * invLen,
      this.z * invLen,
      this.w * invLen
    );
  }

  /** Conjugate (negate x, y, z) */
  conjugate(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  /** Inverse (conjugate / length²) - for unit quaternions, same as conjugate */
  inverse(): Quaternion {
    const lenSq = this.lengthSquared;
    if (lenSq < EPSILON) {
      return Quaternion.identity;
    }
    const invLenSq = 1 / lenSq;
    return new Quaternion(
      -this.x * invLenSq,
      -this.y * invLenSq,
      -this.z * invLenSq,
      this.w * invLenSq
    );
  }

  /** Negate all components */
  negate(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, -this.w);
  }

  /** Dot product */
  dot(q: QuaternionLike): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  // ==================== Quaternion Multiplication ====================

  /**
   * Multiply with another quaternion (this × q).
   * This combines rotations: applying q first, then this.
   */
  multiply(q: QuaternionLike): Quaternion {
    return new Quaternion(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z
    );
  }

  /**
   * Pre-multiply with another quaternion (q × this).
   * This combines rotations: applying this first, then q.
   */
  premultiply(q: QuaternionLike): Quaternion {
    return Quaternion.from(q).multiply(this);
  }

  // ==================== Interpolation ====================

  /** Linear interpolation (not recommended for rotations, use slerp) */
  lerp(q: QuaternionLike, t: number): Quaternion {
    return new Quaternion(
      this.x + (q.x - this.x) * t,
      this.y + (q.y - this.y) * t,
      this.z + (q.z - this.z) * t,
      this.w + (q.w - this.w) * t
    ).normalize();
  }

  /** Spherical linear interpolation (constant angular velocity) */
  slerp(q: QuaternionLike, t: number): Quaternion {
    if (t === 0) return this;
    if (t === 1) return Quaternion.from(q);

    let cosHalfTheta = this.dot(q);

    // If negative, negate one quaternion to take shorter path
    let qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      qx = -qx;
      qy = -qy;
      qz = -qz;
      qw = -qw;
    }

    // If quaternions are very close, use linear interpolation
    if (cosHalfTheta >= 1.0 - EPSILON) {
      return this.lerp({ x: qx, y: qy, z: qz, w: qw }, t);
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);

    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return new Quaternion(
      this.x * ratioA + qx * ratioB,
      this.y * ratioA + qy * ratioB,
      this.z * ratioA + qz * ratioB,
      this.w * ratioA + qw * ratioB
    );
  }

  // ==================== Vector Rotation ====================

  /** Rotate a vector by this quaternion */
  rotateVector(v: Vector3Like): Vector3 {
    // q * v * q^-1 (optimized version)
    const ix = this.w * v.x + this.y * v.z - this.z * v.y;
    const iy = this.w * v.y + this.z * v.x - this.x * v.z;
    const iz = this.w * v.z + this.x * v.y - this.y * v.x;
    const iw = -this.x * v.x - this.y * v.y - this.z * v.z;

    return new Vector3(
      ix * this.w + iw * -this.x + iy * -this.z - iz * -this.y,
      iy * this.w + iw * -this.y + iz * -this.x - ix * -this.z,
      iz * this.w + iw * -this.z + ix * -this.y - iy * -this.x
    );
  }

  // ==================== Conversion ====================

  /** Convert to axis-angle representation */
  toAxisAngle(): { axis: Vector3; angle: number } {
    // Ensure unit quaternion
    const q = this.normalize();

    // Clamp w to avoid NaN from acos
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, q.w)));

    const s = Math.sqrt(1 - q.w * q.w);
    if (s < EPSILON) {
      // Angle is 0, axis is arbitrary
      return { axis: Vector3.up, angle: 0 };
    }

    return {
      axis: new Vector3(q.x / s, q.y / s, q.z / s),
      angle
    };
  }

  /** Convert to Euler angles */
  toEuler(order: EulerOrder = 'XYZ'): EulerAngles {
    // Ensure unit quaternion
    const q = this.normalize();

    let x: number, y: number, z: number;

    switch (order) {
      case 'XYZ': {
        const sinP = 2 * (q.w * q.y - q.z * q.x);
        if (Math.abs(sinP) >= 1) {
          x = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          y = Math.sign(sinP) * Math.PI / 2;
          z = 0;
        } else {
          x = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          y = Math.asin(sinP);
          z = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        }
        break;
      }
      case 'YXZ': {
        const sinP = 2 * (q.w * q.x - q.y * q.z);
        if (Math.abs(sinP) >= 1) {
          x = Math.sign(sinP) * Math.PI / 2;
          y = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          z = 0;
        } else {
          x = Math.asin(sinP);
          y = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          z = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z));
        }
        break;
      }
      case 'ZXY': {
        const sinP = 2 * (q.w * q.x + q.y * q.z);
        if (Math.abs(sinP) >= 1) {
          x = Math.sign(sinP) * Math.PI / 2;
          y = 0;
          z = Math.atan2(2 * (q.w * q.z - q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z));
        } else {
          x = Math.asin(sinP);
          y = Math.atan2(2 * (q.w * q.y - q.x * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          z = Math.atan2(2 * (q.w * q.z - q.x * q.y), 1 - 2 * (q.x * q.x + q.z * q.z));
        }
        break;
      }
      case 'ZYX': {
        const sinP = 2 * (q.w * q.y + q.x * q.z);
        if (Math.abs(sinP) >= 1) {
          x = 0;
          y = Math.sign(sinP) * Math.PI / 2;
          z = Math.atan2(2 * (q.w * q.z - q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        } else {
          x = Math.atan2(2 * (q.w * q.x - q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
          y = Math.asin(sinP);
          z = Math.atan2(2 * (q.w * q.z - q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        }
        break;
      }
      case 'YZX': {
        const sinP = 2 * (q.w * q.z + q.x * q.y);
        if (Math.abs(sinP) >= 1) {
          x = 0;
          y = Math.atan2(2 * (q.w * q.y - q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
          z = Math.sign(sinP) * Math.PI / 2;
        } else {
          x = Math.atan2(2 * (q.w * q.x - q.y * q.z), 1 - 2 * (q.x * q.x + q.z * q.z));
          y = Math.atan2(2 * (q.w * q.y - q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
          z = Math.asin(sinP);
        }
        break;
      }
      case 'XZY': {
        const sinP = 2 * (q.w * q.z - q.x * q.y);
        if (Math.abs(sinP) >= 1) {
          x = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.z * q.z));
          y = 0;
          z = Math.sign(sinP) * Math.PI / 2;
        } else {
          x = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.z * q.z));
          y = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
          z = Math.asin(sinP);
        }
        break;
      }
      default:
        throw new Error(`Unknown Euler order: ${order}`);
    }

    return { x, y, z, order };
  }

  /** Convert to tuple [x, y, z, w] */
  toTuple(): QuaternionTuple {
    return [this.x, this.y, this.z, this.w];
  }

  /** Convert to array */
  toArray(): number[] {
    return [this.x, this.y, this.z, this.w];
  }

  /** Convert to plain object */
  toObject(): { x: number; y: number; z: number; w: number } {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }

  // ==================== Comparison ====================

  /** Check if approximately equal */
  equals(q: QuaternionLike, epsilon: number = EPSILON): boolean {
    // Quaternions q and -q represent the same rotation
    const dot = Math.abs(this.dot(q));
    return dot > 1 - epsilon;
  }

  /** Check if exactly equal (component-wise) */
  exactEquals(q: QuaternionLike): boolean {
    return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w;
  }

  // ==================== Utility ====================

  /** Clone this quaternion */
  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  /** String representation */
  toString(): string {
    return `Quaternion(${this.x}, ${this.y}, ${this.z}, ${this.w})`;
  }

  /** JSON representation */
  toJSON(): QuaternionLike {
    return { x: this.x, y: this.y, z: this.z, w: this.w };
  }

  /** Get the angle of rotation in radians */
  getAngle(): number {
    return 2 * Math.acos(Math.max(-1, Math.min(1, this.w)));
  }

  /** Get the axis of rotation */
  getAxis(): Vector3 {
    const s = Math.sqrt(1 - this.w * this.w);
    if (s < EPSILON) {
      return Vector3.up; // Arbitrary axis when angle is 0
    }
    return new Vector3(this.x / s, this.y / s, this.z / s);
  }
}
