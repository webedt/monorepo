/**
 * 2D Coordinate System Documentation
 *
 * Provides utilities for working with 2D coordinate systems and converting
 * between different coordinate conventions.
 *
 * Standard Mathematical Coordinates (Y-up):
 * - Origin at bottom-left (or center)
 * - X increases to the right
 * - Y increases upward
 * - Angles measured counterclockwise from positive X axis
 *
 * Screen Coordinates (Y-down):
 * - Origin at top-left
 * - X increases to the right
 * - Y increases downward
 * - Common in canvas/DOM rendering
 *
 * @module utils/math/coordinateSystem
 */

import type { Point2D } from './vec2.doc.js';

/**
 * Axis orientation for a coordinate system.
 */
export type AxisDirection = 'positive' | 'negative';

/**
 * Configuration for a 2D coordinate system.
 */
export interface CoordinateSystemConfig {
  /** Origin point in the coordinate space */
  origin: Point2D;
  /** Direction of positive X (right = positive, left = negative) */
  xDirection: AxisDirection;
  /** Direction of positive Y (up = positive, down = negative) */
  yDirection: AxisDirection;
  /** Scale factor for X axis (pixels per unit) */
  scaleX: number;
  /** Scale factor for Y axis (pixels per unit) */
  scaleY: number;
}

/**
 * Bounding box in 2D space.
 */
export interface Bounds2D {
  /** Minimum X coordinate */
  minX: number;
  /** Minimum Y coordinate */
  minY: number;
  /** Maximum X coordinate */
  maxX: number;
  /** Maximum Y coordinate */
  maxY: number;
}

/**
 * Rectangle defined by position and size.
 */
export interface Rect2D {
  /** X position (left edge in screen coords, can be any edge in math coords) */
  x: number;
  /** Y position (top edge in screen coords, bottom in math coords) */
  y: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
}

/**
 * Transform matrix for 2D operations (3x3 affine transform).
 * Stored as [a, b, c, d, tx, ty] where:
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 */
export type Transform2DMatrix = [number, number, number, number, number, number];

/**
 * Interface for 2D coordinate system operations.
 */
export interface ICoordinateSystem2D {
  /** The configuration of this coordinate system */
  readonly config: Readonly<CoordinateSystemConfig>;

  /**
   * Converts a point from mathematical coordinates (Y-up) to this system.
   * @param point - Point in mathematical coordinates
   * @returns Point in this coordinate system
   */
  fromMath(point: Point2D): Point2D;

  /**
   * Converts a point from this system to mathematical coordinates (Y-up).
   * @param point - Point in this coordinate system
   * @returns Point in mathematical coordinates
   */
  toMath(point: Point2D): Point2D;

  /**
   * Converts a point from screen coordinates (Y-down) to this system.
   * @param point - Point in screen coordinates
   * @param screenHeight - Height of the screen/canvas
   * @returns Point in this coordinate system
   */
  fromScreen(point: Point2D, screenHeight: number): Point2D;

  /**
   * Converts a point from this system to screen coordinates (Y-down).
   * @param point - Point in this coordinate system
   * @param screenHeight - Height of the screen/canvas
   * @returns Point in screen coordinates
   */
  toScreen(point: Point2D, screenHeight: number): Point2D;

  /**
   * Converts a delta/direction vector from mathematical coordinates.
   * Unlike points, deltas don't include origin translation.
   * @param delta - Delta in mathematical coordinates
   * @returns Delta in this coordinate system
   */
  deltaFromMath(delta: Point2D): Point2D;

  /**
   * Converts a delta/direction vector to mathematical coordinates.
   * @param delta - Delta in this coordinate system
   * @returns Delta in mathematical coordinates
   */
  deltaToMath(delta: Point2D): Point2D;

  /**
   * Converts bounds from mathematical coordinates to this system.
   * @param bounds - Bounds in mathematical coordinates
   * @returns Bounds in this coordinate system
   */
  boundsFromMath(bounds: Bounds2D): Bounds2D;

  /**
   * Converts bounds from this system to mathematical coordinates.
   * @param bounds - Bounds in this coordinate system
   * @returns Bounds in mathematical coordinates
   */
  boundsToMath(bounds: Bounds2D): Bounds2D;

  /**
   * Converts a rectangle from mathematical coordinates to this system.
   * @param rect - Rectangle in mathematical coordinates
   * @returns Rectangle in this coordinate system
   */
  rectFromMath(rect: Rect2D): Rect2D;

  /**
   * Converts a rectangle from this system to mathematical coordinates.
   * @param rect - Rectangle in this coordinate system
   * @returns Rectangle in mathematical coordinates
   */
  rectToMath(rect: Rect2D): Rect2D;

  /**
   * Converts an angle from mathematical convention (counterclockwise from +X)
   * to this system's convention.
   * @param radians - Angle in radians (math convention)
   * @returns Angle in this system's convention
   */
  angleFromMath(radians: number): number;

  /**
   * Converts an angle from this system's convention to mathematical convention.
   * @param radians - Angle in this system's convention
   * @returns Angle in radians (math convention)
   */
  angleToMath(radians: number): number;

  /**
   * Gets the transformation matrix to convert from math coordinates to this system.
   * Can be used with Canvas2D setTransform().
   */
  getTransformMatrix(): Transform2DMatrix;

  /**
   * Gets the inverse transformation matrix (this system to math coordinates).
   */
  getInverseTransformMatrix(): Transform2DMatrix;

  /**
   * Checks if a point is within the given bounds.
   * @param point - Point to check
   * @param bounds - Bounds to check against
   */
  isPointInBounds(point: Point2D, bounds: Bounds2D): boolean;

  /**
   * Checks if a point is within the given rectangle.
   * @param point - Point to check
   * @param rect - Rectangle to check against
   */
  isPointInRect(point: Point2D, rect: Rect2D): boolean;

  /**
   * Clamps a point to be within the given bounds.
   * @param point - Point to clamp
   * @param bounds - Bounds to clamp to
   */
  clampToBounds(point: Point2D, bounds: Bounds2D): Point2D;

  /**
   * Snaps a point to the nearest grid intersection.
   * @param point - Point to snap
   * @param gridSize - Size of grid cells
   */
  snapToGrid(point: Point2D, gridSize: number): Point2D;
}

/**
 * Static factory methods for creating coordinate systems.
 */
export interface ICoordinateSystem2DStatic {
  /**
   * Creates a mathematical coordinate system with Y increasing upward.
   * Origin at (0, 0), no scaling.
   */
  math(): ICoordinateSystem2D;

  /**
   * Creates a screen coordinate system with Y increasing downward.
   * Origin at (0, 0), no scaling.
   */
  screen(): ICoordinateSystem2D;

  /**
   * Creates a centered mathematical coordinate system.
   * Origin at center of given dimensions, Y increases upward.
   * @param width - Width of the coordinate space
   * @param height - Height of the coordinate space
   */
  centered(width: number, height: number): ICoordinateSystem2D;

  /**
   * Creates a custom coordinate system from configuration.
   * @param config - Configuration options
   */
  custom(config: Partial<CoordinateSystemConfig>): ICoordinateSystem2D;

  /**
   * Creates a coordinate system for canvas rendering with mathematical conventions.
   * Origin at bottom-left, Y increases upward, scaled to fit canvas.
   * @param canvasWidth - Width of the canvas in pixels
   * @param canvasHeight - Height of the canvas in pixels
   * @param worldWidth - Width of the world in units
   * @param worldHeight - Height of the world in units
   */
  forCanvas(
    canvasWidth: number,
    canvasHeight: number,
    worldWidth: number,
    worldHeight: number
  ): ICoordinateSystem2D;
}
