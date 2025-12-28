/**
 * 2D Mathematics Utilities
 *
 * Provides 2D vector and coordinate system operations using standard
 * mathematical conventions:
 * - X axis: positive values increase to the right
 * - Y axis: positive values increase upward
 *
 * @module utils/math
 */

// Vec2 - 2D Vector operations
export { Vec2 } from './vec2.js';
export type { Point2D, IVec2 } from './vec2.js';

// CoordinateSystem2D - Coordinate system conversions
export { CoordinateSystem2D } from './coordinateSystem.js';
export type {
  AxisDirection,
  Bounds2D,
  CoordinateSystemConfig,
  ICoordinateSystem2D,
  Rect2D,
  Transform2DMatrix,
} from './coordinateSystem.js';
