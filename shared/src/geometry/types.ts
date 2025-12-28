/**
 * Core type definitions for 3D geometry with right-handed coordinate system.
 *
 * Right-Handed Coordinate System Convention:
 * - X-axis: Points right (positive = right)
 * - Y-axis: Points up (positive = up)
 * - Z-axis: Points toward the viewer (positive = out of screen)
 *
 * The right-hand rule applies:
 * - Thumb points in +X direction
 * - Index finger points in +Y direction
 * - Middle finger points in +Z direction
 *
 * Cross product follows right-hand rule: X × Y = Z
 * Rotation follows right-hand rule: positive rotation is counter-clockwise
 * when looking down the positive axis toward the origin.
 */

/**
 * Represents a 3D vector or point with x, y, z components.
 */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Tuple representation of a 3D vector [x, y, z].
 */
export type Vector3Tuple = readonly [number, number, number];

/**
 * Represents a quaternion for rotation in 3D space.
 * Quaternions avoid gimbal lock and provide smooth interpolation.
 */
export interface QuaternionLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * Tuple representation of a quaternion [x, y, z, w].
 */
export type QuaternionTuple = readonly [number, number, number, number];

/**
 * 4x4 transformation matrix stored in column-major order.
 * This is the standard for OpenGL and most graphics APIs.
 *
 * Matrix layout (column-major):
 * | m0  m4  m8   m12 |   | Xx  Yx  Zx  Tx |
 * | m1  m5  m9   m13 | = | Xy  Yy  Zy  Ty |
 * | m2  m6  m10  m14 |   | Xz  Yz  Zz  Tz |
 * | m3  m7  m11  m15 |   | 0   0   0   1  |
 *
 * Where X, Y, Z are basis vectors and T is translation.
 */
export type Matrix4Tuple = readonly [
  number, number, number, number, // column 0 (X basis + padding)
  number, number, number, number, // column 1 (Y basis + padding)
  number, number, number, number, // column 2 (Z basis + padding)
  number, number, number, number  // column 3 (translation + 1)
];

/**
 * Euler angles for rotation representation.
 * Order specifies the order of rotations applied.
 */
export interface EulerAngles {
  readonly x: number; // Pitch (rotation around X-axis) in radians
  readonly y: number; // Yaw (rotation around Y-axis) in radians
  readonly z: number; // Roll (rotation around Z-axis) in radians
  readonly order: EulerOrder;
}

/**
 * Euler rotation order.
 * XYZ means: rotate around X first, then Y, then Z.
 */
export type EulerOrder = 'XYZ' | 'XZY' | 'YXZ' | 'YZX' | 'ZXY' | 'ZYX';

/**
 * Axis-aligned bounding box in 3D space.
 */
export interface BoundingBox {
  readonly min: Vector3Like;
  readonly max: Vector3Like;
}

/**
 * A 3D transform combining position, rotation, and scale.
 */
export interface Transform3D {
  readonly position: Vector3Like;
  readonly rotation: QuaternionLike;
  readonly scale: Vector3Like;
}

/**
 * Coordinate system handedness.
 */
export type Handedness = 'right' | 'left';

/**
 * Axis direction in 3D space.
 */
export type Axis = 'x' | 'y' | 'z';

/**
 * Signed axis direction (positive or negative).
 */
export type SignedAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/**
 * Coordinate system configuration.
 */
export interface CoordinateSystemConfig {
  readonly handedness: Handedness;
  readonly up: SignedAxis;
  readonly forward: SignedAxis;
  readonly right: SignedAxis;
}

/**
 * Plane in 3D space represented by normal and distance from origin.
 * The plane equation is: normal · point + distance = 0
 */
export interface Plane {
  readonly normal: Vector3Like;
  readonly distance: number;
}

/**
 * Ray in 3D space with origin and direction.
 */
export interface Ray {
  readonly origin: Vector3Like;
  readonly direction: Vector3Like;
}

/**
 * Sphere in 3D space with center and radius.
 */
export interface Sphere {
  readonly center: Vector3Like;
  readonly radius: number;
}

/**
 * Result of a ray intersection test.
 */
export interface RayIntersection {
  readonly hit: boolean;
  readonly distance: number;
  readonly point: Vector3Like;
  readonly normal: Vector3Like;
}

/**
 * Numeric tolerance constants for floating-point comparisons.
 */
export const EPSILON = 1e-6;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
