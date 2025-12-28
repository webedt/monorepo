/**
 * 2D Vector Mathematics Documentation
 *
 * This module provides 2D vector operations using standard mathematical conventions:
 * - X axis: positive values increase to the right
 * - Y axis: positive values increase upward
 *
 * @module utils/math/vec2
 */

/**
 * Represents a 2D point or vector with x and y coordinates.
 *
 * Uses standard mathematical coordinate system:
 * - X increases to the right (positive = right, negative = left)
 * - Y increases upward (positive = up, negative = down)
 */
export interface Point2D {
  /** X coordinate (positive = right) */
  readonly x: number;
  /** Y coordinate (positive = up) */
  readonly y: number;
}

/**
 * Read-only 2D vector interface for immutable operations.
 */
export interface IVec2 extends Point2D {
  /**
   * Returns the magnitude (length) of the vector.
   * Calculated as sqrt(x^2 + y^2).
   */
  magnitude(): number;

  /**
   * Returns the squared magnitude of the vector.
   * More efficient than magnitude() when only comparing lengths.
   */
  magnitudeSquared(): number;

  /**
   * Returns a new normalized (unit) vector with magnitude 1.
   * Returns zero vector if magnitude is 0.
   */
  normalized(): IVec2;

  /**
   * Calculates the dot product with another vector.
   * @param other - The other vector
   * @returns The dot product (x1*x2 + y1*y2)
   */
  dot(other: Point2D): number;

  /**
   * Calculates the 2D cross product (z-component of 3D cross).
   * Returns a scalar representing the signed area of the parallelogram.
   * @param other - The other vector
   * @returns The cross product (x1*y2 - y1*x2)
   */
  cross(other: Point2D): number;

  /**
   * Calculates the angle of this vector in radians.
   * Returns angle from positive X axis, counterclockwise positive.
   * Range: [-PI, PI]
   */
  angle(): number;

  /**
   * Calculates the angle between this vector and another in radians.
   * @param other - The other vector
   * @returns Angle in radians [0, PI]
   */
  angleTo(other: Point2D): number;

  /**
   * Calculates the signed angle to another vector in radians.
   * Positive = counterclockwise, negative = clockwise.
   * @param other - The other vector
   * @returns Signed angle in radians [-PI, PI]
   */
  signedAngleTo(other: Point2D): number;

  /**
   * Calculates the distance to another point.
   * @param other - The other point
   */
  distanceTo(other: Point2D): number;

  /**
   * Calculates the squared distance to another point.
   * More efficient than distanceTo() when only comparing distances.
   * @param other - The other point
   */
  distanceSquaredTo(other: Point2D): number;

  /**
   * Returns a new vector that is the sum of this and another.
   * @param other - The vector to add
   */
  add(other: Point2D): IVec2;

  /**
   * Returns a new vector that is the difference of this and another.
   * @param other - The vector to subtract
   */
  subtract(other: Point2D): IVec2;

  /**
   * Returns a new vector scaled by a factor.
   * @param scalar - The scale factor
   */
  scale(scalar: number): IVec2;

  /**
   * Returns a new vector with negated components.
   */
  negate(): IVec2;

  /**
   * Returns a new vector rotated by the given angle in radians.
   * Rotation is counterclockwise (standard mathematical convention).
   * @param radians - The rotation angle in radians
   */
  rotate(radians: number): IVec2;

  /**
   * Returns a new vector rotated 90 degrees counterclockwise.
   * Equivalent to rotate(PI/2) but more efficient.
   */
  perpendicular(): IVec2;

  /**
   * Returns a new vector rotated 90 degrees clockwise.
   */
  perpendicularClockwise(): IVec2;

  /**
   * Linearly interpolates between this vector and another.
   * @param other - The target vector
   * @param t - Interpolation factor (0 = this, 1 = other)
   */
  lerp(other: Point2D, t: number): IVec2;

  /**
   * Projects this vector onto another vector.
   * @param onto - The vector to project onto
   */
  projectOnto(onto: Point2D): IVec2;

  /**
   * Reflects this vector across a normal.
   * @param normal - The normal vector (should be normalized)
   */
  reflect(normal: Point2D): IVec2;

  /**
   * Returns a new vector with components clamped to a maximum magnitude.
   * @param maxMagnitude - The maximum allowed magnitude
   */
  clampMagnitude(maxMagnitude: number): IVec2;

  /**
   * Returns a new vector with each component clamped to a range.
   * @param min - Minimum value for each component
   * @param max - Maximum value for each component
   */
  clamp(min: number, max: number): IVec2;

  /**
   * Returns a new vector with components rounded to nearest integer.
   */
  round(): IVec2;

  /**
   * Returns a new vector with components floored.
   */
  floor(): IVec2;

  /**
   * Returns a new vector with components ceiled.
   */
  ceil(): IVec2;

  /**
   * Returns a new vector with absolute values of components.
   */
  abs(): IVec2;

  /**
   * Checks if this vector equals another within a tolerance.
   * @param other - The other vector
   * @param epsilon - Tolerance for comparison (default: Number.EPSILON)
   */
  equals(other: Point2D, epsilon?: number): boolean;

  /**
   * Checks if this is a zero vector.
   * @param epsilon - Tolerance for comparison (default: Number.EPSILON)
   */
  isZero(epsilon?: number): boolean;

  /**
   * Returns a plain object with x and y properties.
   */
  toObject(): Point2D;

  /**
   * Returns an array [x, y].
   */
  toArray(): [number, number];

  /**
   * Returns a string representation.
   */
  toString(): string;
}

/**
 * Documentation interface for Vec2 static factory methods.
 */
export interface IVec2Static {
  /**
   * Creates a new Vec2 from x and y coordinates.
   */
  create(x: number, y: number): IVec2;

  /**
   * Creates a Vec2 from a Point2D object.
   */
  fromPoint(point: Point2D): IVec2;

  /**
   * Creates a Vec2 from an array [x, y].
   */
  fromArray(arr: [number, number]): IVec2;

  /**
   * Creates a Vec2 from polar coordinates.
   * @param radius - The distance from origin
   * @param angle - The angle in radians from positive X axis
   */
  fromPolar(radius: number, angle: number): IVec2;

  /**
   * Creates a unit vector pointing in the given direction (radians).
   */
  fromAngle(radians: number): IVec2;

  /**
   * Returns the zero vector (0, 0).
   */
  zero(): IVec2;

  /**
   * Returns the unit vector pointing right (1, 0).
   */
  right(): IVec2;

  /**
   * Returns the unit vector pointing left (-1, 0).
   */
  left(): IVec2;

  /**
   * Returns the unit vector pointing up (0, 1).
   */
  up(): IVec2;

  /**
   * Returns the unit vector pointing down (0, -1).
   */
  down(): IVec2;

  /**
   * Returns the unit vector (1, 1) normalized.
   */
  one(): IVec2;

  /**
   * Returns the minimum components from two vectors.
   */
  min(a: Point2D, b: Point2D): IVec2;

  /**
   * Returns the maximum components from two vectors.
   */
  max(a: Point2D, b: Point2D): IVec2;

  /**
   * Calculates the distance between two points.
   */
  distance(a: Point2D, b: Point2D): number;

  /**
   * Linearly interpolates between two vectors.
   */
  lerp(a: Point2D, b: Point2D, t: number): IVec2;
}
