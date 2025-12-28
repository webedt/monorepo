/**
 * 3D Geometry Module
 *
 * Provides a standard right-handed coordinate system implementation
 * with Vector3, Matrix4, Quaternion, and coordinate system utilities.
 *
 * Right-Handed Coordinate System Convention:
 * - X-axis: Points right (positive = right)
 * - Y-axis: Points up (positive = up)
 * - Z-axis: Points toward the viewer (positive = out of screen)
 *
 * The right-hand rule applies:
 * - Cross product: X × Y = Z
 * - Positive rotation is counter-clockwise when looking down the positive axis
 *
 * @example
 * ```typescript
 * import {
 *   Vector3,
 *   Matrix4,
 *   Quaternion,
 *   CoordinateSystem
 * } from '@webedt/shared/geometry';
 *
 * // Create vectors
 * const position = new Vector3(1, 2, 3);
 * const direction = Vector3.forward; // (0, 0, -1)
 *
 * // Create rotations
 * const rotation = Quaternion.fromEuler(0, Math.PI / 4, 0); // 45° around Y
 * const rotatedDir = rotation.rotateVector(direction);
 *
 * // Create transformation matrices
 * const transform = Matrix4.compose(
 *   position,
 *   rotation,
 *   Vector3.one
 * );
 *
 * // Use coordinate system utilities
 * const coordSystem = CoordinateSystem.rightHandedYUp;
 * console.log(coordSystem.up);      // Vector3(0, 1, 0)
 * console.log(coordSystem.right);   // Vector3(1, 0, 0)
 * console.log(coordSystem.forward); // Vector3(0, 0, -1)
 * ```
 */

// Core types and constants
export type { Vector3Like } from './types.js';
export type { Vector3Tuple } from './types.js';
export type { QuaternionLike } from './types.js';
export type { QuaternionTuple } from './types.js';
export type { Matrix4Tuple } from './types.js';
export type { EulerAngles } from './types.js';
export type { EulerOrder } from './types.js';
export type { BoundingBox } from './types.js';
export type { Transform3D } from './types.js';
export type { Handedness } from './types.js';
export type { Axis } from './types.js';
export type { SignedAxis } from './types.js';
export type { CoordinateSystemConfig } from './types.js';
export type { Plane } from './types.js';
export type { Ray } from './types.js';
export type { Sphere } from './types.js';
export type { RayIntersection } from './types.js';

export { EPSILON } from './types.js';
export { DEG_TO_RAD } from './types.js';
export { RAD_TO_DEG } from './types.js';

// Core classes
export { Vector3 } from './Vector3.js';
export { Matrix4 } from './Matrix4.js';
export { Quaternion } from './Quaternion.js';

// Coordinate system
export { CoordinateSystem } from './CoordinateSystem.js';
export { CoordinateSystems } from './CoordinateSystem.js';
export { DEFAULT_COORDINATE_SYSTEM } from './CoordinateSystem.js';
export { isRightHanded } from './CoordinateSystem.js';
export { isLeftHanded } from './CoordinateSystem.js';
export { orthonormalize } from './CoordinateSystem.js';
