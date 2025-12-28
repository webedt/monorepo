import type { Vector3Like } from './types.js';
import type { Vector3Tuple } from './types.js';

import { EPSILON } from './types.js';

/**
 * Immutable 3D vector class for use in a right-handed coordinate system.
 *
 * All operations return new Vector3 instances, preserving immutability.
 * This design enables functional composition and prevents side effects.
 *
 * Right-handed coordinate system:
 * - X-axis points right
 * - Y-axis points up
 * - Z-axis points toward the viewer (out of the screen)
 */
export class Vector3 implements Vector3Like {
  /** X component (right direction in right-handed system) */
  readonly x: number;

  /** Y component (up direction in right-handed system) */
  readonly y: number;

  /** Z component (toward viewer in right-handed system) */
  readonly z: number;

  // Common constant vectors (lazily initialized)
  private static _zero: Vector3 | undefined;
  private static _one: Vector3 | undefined;
  private static _up: Vector3 | undefined;
  private static _down: Vector3 | undefined;
  private static _right: Vector3 | undefined;
  private static _left: Vector3 | undefined;
  private static _forward: Vector3 | undefined;
  private static _back: Vector3 | undefined;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // ==================== Static Constructors ====================

  /** Zero vector (0, 0, 0) */
  static get zero(): Vector3 {
    return Vector3._zero ??= new Vector3(0, 0, 0);
  }

  /** Unit vector (1, 1, 1) */
  static get one(): Vector3 {
    return Vector3._one ??= new Vector3(1, 1, 1);
  }

  /** Up direction (0, 1, 0) - positive Y */
  static get up(): Vector3 {
    return Vector3._up ??= new Vector3(0, 1, 0);
  }

  /** Down direction (0, -1, 0) - negative Y */
  static get down(): Vector3 {
    return Vector3._down ??= new Vector3(0, -1, 0);
  }

  /** Right direction (1, 0, 0) - positive X */
  static get right(): Vector3 {
    return Vector3._right ??= new Vector3(1, 0, 0);
  }

  /** Left direction (-1, 0, 0) - negative X */
  static get left(): Vector3 {
    return Vector3._left ??= new Vector3(-1, 0, 0);
  }

  /** Forward direction (0, 0, -1) - negative Z (into the screen in right-handed system) */
  static get forward(): Vector3 {
    return Vector3._forward ??= new Vector3(0, 0, -1);
  }

  /** Back direction (0, 0, 1) - positive Z (out of screen in right-handed system) */
  static get back(): Vector3 {
    return Vector3._back ??= new Vector3(0, 0, 1);
  }

  /** Create from a Vector3Like object */
  static from(v: Vector3Like): Vector3 {
    return new Vector3(v.x, v.y, v.z);
  }

  /** Create from a tuple [x, y, z] */
  static fromTuple(tuple: Vector3Tuple): Vector3 {
    return new Vector3(tuple[0], tuple[1], tuple[2]);
  }

  /** Create from an array (uses first 3 elements) */
  static fromArray(array: readonly number[], offset: number = 0): Vector3 {
    return new Vector3(
      array[offset] ?? 0,
      array[offset + 1] ?? 0,
      array[offset + 2] ?? 0
    );
  }

  /** Create from spherical coordinates (radius, polar angle θ, azimuthal angle φ) */
  static fromSpherical(radius: number, theta: number, phi: number): Vector3 {
    const sinTheta = Math.sin(theta);
    return new Vector3(
      radius * sinTheta * Math.cos(phi),
      radius * Math.cos(theta),
      radius * sinTheta * Math.sin(phi)
    );
  }

  /** Create from cylindrical coordinates (radius, angle θ, height) */
  static fromCylindrical(radius: number, theta: number, height: number): Vector3 {
    return new Vector3(
      radius * Math.cos(theta),
      height,
      radius * Math.sin(theta)
    );
  }

  // ==================== Conversion Methods ====================

  /** Convert to tuple [x, y, z] */
  toTuple(): Vector3Tuple {
    return [this.x, this.y, this.z];
  }

  /** Convert to array */
  toArray(): number[] {
    return [this.x, this.y, this.z];
  }

  /** Convert to plain object */
  toObject(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y, z: this.z };
  }

  // ==================== Basic Operations ====================

  /** Add another vector */
  add(v: Vector3Like): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  /** Subtract another vector */
  subtract(v: Vector3Like): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /** Alias for subtract */
  sub(v: Vector3Like): Vector3 {
    return this.subtract(v);
  }

  /** Multiply by a scalar */
  multiply(scalar: number): Vector3 {
    return new Vector3(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  /** Alias for multiply */
  scale(scalar: number): Vector3 {
    return this.multiply(scalar);
  }

  /** Divide by a scalar */
  divide(scalar: number): Vector3 {
    if (Math.abs(scalar) < EPSILON) {
      throw new Error('Division by zero or near-zero value');
    }
    const inv = 1 / scalar;
    return new Vector3(this.x * inv, this.y * inv, this.z * inv);
  }

  /** Negate the vector */
  negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  /** Component-wise multiplication (Hadamard product) */
  multiplyComponents(v: Vector3Like): Vector3 {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }

  /** Component-wise division */
  divideComponents(v: Vector3Like): Vector3 {
    if (Math.abs(v.x) < EPSILON || Math.abs(v.y) < EPSILON || Math.abs(v.z) < EPSILON) {
      throw new Error('Division by zero or near-zero component');
    }
    return new Vector3(this.x / v.x, this.y / v.y, this.z / v.z);
  }

  // ==================== Vector Products ====================

  /**
   * Dot product (scalar product).
   * Returns the cosine of the angle times the magnitudes: |a||b|cos(θ)
   */
  dot(v: Vector3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  /**
   * Cross product (vector product) following right-hand rule.
   * Returns a vector perpendicular to both inputs.
   * The resulting vector points in the direction your thumb points
   * when curling fingers from this vector to v.
   */
  cross(v: Vector3Like): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  // ==================== Length & Normalization ====================

  /** Squared length (magnitude squared) - faster than length when comparing */
  get lengthSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** Length (magnitude) of the vector */
  get length(): number {
    return Math.sqrt(this.lengthSquared);
  }

  /** Alias for length */
  get magnitude(): number {
    return this.length;
  }

  /** Normalize to unit length (magnitude = 1) */
  normalize(): Vector3 {
    const len = this.length;
    if (len < EPSILON) {
      return Vector3.zero;
    }
    return this.divide(len);
  }

  /** Set length to a specific value */
  setLength(length: number): Vector3 {
    return this.normalize().multiply(length);
  }

  /** Limit the length to a maximum value */
  clampLength(min: number, max: number): Vector3 {
    const len = this.length;
    if (len < min) {
      return this.setLength(min);
    }
    if (len > max) {
      return this.setLength(max);
    }
    return this;
  }

  // ==================== Angle & Distance ====================

  /** Distance to another vector */
  distanceTo(v: Vector3Like): number {
    return this.subtract(v).length;
  }

  /** Squared distance to another vector (faster for comparisons) */
  distanceSquaredTo(v: Vector3Like): number {
    return this.subtract(v).lengthSquared;
  }

  /** Angle between this vector and another (in radians) */
  angleTo(v: Vector3Like): number {
    const denominator = Math.sqrt(this.lengthSquared * (v.x * v.x + v.y * v.y + v.z * v.z));
    if (denominator < EPSILON) {
      return 0;
    }
    const cosAngle = this.dot(v) / denominator;
    return Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  }

  /** Signed angle around an axis (in radians) */
  signedAngleTo(v: Vector3Like, axis: Vector3Like): number {
    const angle = this.angleTo(v);
    const cross = this.cross(v);
    const sign = cross.dot(axis);
    return sign < 0 ? -angle : angle;
  }

  // ==================== Interpolation ====================

  /** Linear interpolation between this and another vector */
  lerp(v: Vector3Like, t: number): Vector3 {
    return new Vector3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  /** Spherical linear interpolation (great circle path) */
  slerp(v: Vector3Like, t: number): Vector3 {
    const dot = Math.max(-1, Math.min(1, this.normalize().dot(Vector3.from(v).normalize())));
    const theta = Math.acos(dot) * t;
    const relative = Vector3.from(v).subtract(this.multiply(dot)).normalize();
    return this.multiply(Math.cos(theta)).add(relative.multiply(Math.sin(theta)));
  }

  // ==================== Projection & Reflection ====================

  /** Project this vector onto another vector */
  projectOnto(v: Vector3Like): Vector3 {
    const vVec = Vector3.from(v);
    const denominator = vVec.lengthSquared;
    if (denominator < EPSILON) {
      return Vector3.zero;
    }
    return vVec.multiply(this.dot(v) / denominator);
  }

  /** Project this vector onto a plane defined by its normal */
  projectOntoPlane(planeNormal: Vector3Like): Vector3 {
    return this.subtract(this.projectOnto(planeNormal));
  }

  /** Reflect this vector off a surface with the given normal */
  reflect(normal: Vector3Like): Vector3 {
    const n = Vector3.from(normal).normalize();
    return this.subtract(n.multiply(2 * this.dot(n)));
  }

  // ==================== Component Access ====================

  /** Get component by index (0=x, 1=y, 2=z) */
  getComponent(index: number): number {
    switch (index) {
      case 0: return this.x;
      case 1: return this.y;
      case 2: return this.z;
      default: throw new Error(`Invalid component index: ${index}`);
    }
  }

  /** Set component by index, returning new vector */
  setComponent(index: number, value: number): Vector3 {
    switch (index) {
      case 0: return new Vector3(value, this.y, this.z);
      case 1: return new Vector3(this.x, value, this.z);
      case 2: return new Vector3(this.x, this.y, value);
      default: throw new Error(`Invalid component index: ${index}`);
    }
  }

  /** Get minimum component value */
  get minComponent(): number {
    return Math.min(this.x, this.y, this.z);
  }

  /** Get maximum component value */
  get maxComponent(): number {
    return Math.max(this.x, this.y, this.z);
  }

  /** Component-wise minimum */
  min(v: Vector3Like): Vector3 {
    return new Vector3(
      Math.min(this.x, v.x),
      Math.min(this.y, v.y),
      Math.min(this.z, v.z)
    );
  }

  /** Component-wise maximum */
  max(v: Vector3Like): Vector3 {
    return new Vector3(
      Math.max(this.x, v.x),
      Math.max(this.y, v.y),
      Math.max(this.z, v.z)
    );
  }

  /** Clamp each component to a range */
  clamp(min: Vector3Like, max: Vector3Like): Vector3 {
    return new Vector3(
      Math.max(min.x, Math.min(max.x, this.x)),
      Math.max(min.y, Math.min(max.y, this.y)),
      Math.max(min.z, Math.min(max.z, this.z))
    );
  }

  /** Floor each component */
  floor(): Vector3 {
    return new Vector3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }

  /** Ceil each component */
  ceil(): Vector3 {
    return new Vector3(Math.ceil(this.x), Math.ceil(this.y), Math.ceil(this.z));
  }

  /** Round each component */
  round(): Vector3 {
    return new Vector3(Math.round(this.x), Math.round(this.y), Math.round(this.z));
  }

  /** Absolute value of each component */
  abs(): Vector3 {
    return new Vector3(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z));
  }

  // ==================== Comparison ====================

  /** Check if approximately equal within epsilon */
  equals(v: Vector3Like, epsilon: number = EPSILON): boolean {
    return (
      Math.abs(this.x - v.x) < epsilon &&
      Math.abs(this.y - v.y) < epsilon &&
      Math.abs(this.z - v.z) < epsilon
    );
  }

  /** Check if exactly equal */
  exactEquals(v: Vector3Like): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  /** Check if this is a zero vector */
  isZero(epsilon: number = EPSILON): boolean {
    return this.lengthSquared < epsilon * epsilon;
  }

  /** Check if this is a unit vector (length ≈ 1) */
  isUnit(epsilon: number = EPSILON): boolean {
    return Math.abs(this.lengthSquared - 1) < epsilon;
  }

  // ==================== Utility ====================

  /** Clone this vector */
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  /** String representation */
  toString(): string {
    return `Vector3(${this.x}, ${this.y}, ${this.z})`;
  }

  /** JSON representation */
  toJSON(): Vector3Like {
    return { x: this.x, y: this.y, z: this.z };
  }
}
