/**
 * 2D Collider Documentation
 *
 * Physics collision shapes for 2D collision detection.
 * Uses standard mathematical coordinate system (Y-up).
 *
 * Supported collider types:
 * - CircleCollider: Circular collision shape
 * - BoxCollider: Axis-aligned bounding box (AABB)
 * - PolygonCollider: Convex polygon collision shape
 * - LineCollider: Line segment for raycasting
 *
 * @module utils/math/colliders
 */

import type { Point2D } from './vec2.doc.js';

/**
 * Types of colliders supported by the collision system.
 */
export type ColliderType = 'circle' | 'box' | 'polygon' | 'line';

/**
 * Base interface for all collider shapes.
 */
export interface ICollider {
  /** Type identifier for the collider */
  readonly type: ColliderType;

  /**
   * Gets the axis-aligned bounding box of this collider.
   * Used for broad-phase collision detection.
   */
  getBounds(): ColliderBounds;

  /**
   * Checks if a point is inside this collider.
   * @param point - The point to test
   */
  containsPoint(point: Point2D): boolean;

  /**
   * Gets the center point of this collider.
   */
  getCenter(): Point2D;
}

/**
 * Axis-aligned bounding box for broad-phase collision detection.
 */
export interface ColliderBounds {
  /** Minimum X coordinate */
  readonly minX: number;
  /** Minimum Y coordinate */
  readonly minY: number;
  /** Maximum X coordinate */
  readonly maxX: number;
  /** Maximum Y coordinate */
  readonly maxY: number;
}

/**
 * Circular collision shape.
 * Defined by a center point and radius.
 */
export interface ICircleCollider extends ICollider {
  readonly type: 'circle';
  /** Center point of the circle */
  readonly center: Point2D;
  /** Radius of the circle */
  readonly radius: number;
}

/**
 * Axis-aligned bounding box collision shape.
 * Defined by minimum and maximum points or center and half-extents.
 */
export interface IBoxCollider extends ICollider {
  readonly type: 'box';
  /** Minimum corner (bottom-left in math coords) */
  readonly min: Point2D;
  /** Maximum corner (top-right in math coords) */
  readonly max: Point2D;
  /** Width of the box */
  readonly width: number;
  /** Height of the box */
  readonly height: number;
}

/**
 * Convex polygon collision shape.
 * Vertices must be in counter-clockwise order.
 */
export interface IPolygonCollider extends ICollider {
  readonly type: 'polygon';
  /** Vertices of the polygon in counter-clockwise order */
  readonly vertices: readonly Point2D[];
  /** Number of vertices */
  readonly vertexCount: number;
}

/**
 * Line segment for raycasting and line intersection tests.
 */
export interface ILineCollider extends ICollider {
  readonly type: 'line';
  /** Start point of the line */
  readonly start: Point2D;
  /** End point of the line */
  readonly end: Point2D;
  /** Length of the line segment */
  readonly length: number;
}

/**
 * Result of a collision test between two colliders.
 */
export interface CollisionResult {
  /** Whether the colliders are intersecting */
  readonly colliding: boolean;
  /** Penetration depth (0 if not colliding) */
  readonly depth: number;
  /** Collision normal pointing from first to second collider */
  readonly normal: Point2D;
  /** Contact point(s) where collision occurs */
  readonly contacts: readonly Point2D[];
}

/**
 * Result of a raycast against a collider.
 */
export interface RaycastResult {
  /** Whether the ray hit the collider */
  readonly hit: boolean;
  /** Distance along the ray to the hit point */
  readonly distance: number;
  /** Point where the ray intersects the collider */
  readonly point: Point2D;
  /** Surface normal at the hit point */
  readonly normal: Point2D;
}

/**
 * Static factory methods for creating colliders.
 */
export interface IColliderStatic {
  /**
   * Creates a circle collider.
   * @param center - Center point of the circle
   * @param radius - Radius of the circle
   */
  circle(center: Point2D, radius: number): ICircleCollider;

  /**
   * Creates a box collider from min/max points.
   * @param min - Minimum corner (bottom-left)
   * @param max - Maximum corner (top-right)
   */
  box(min: Point2D, max: Point2D): IBoxCollider;

  /**
   * Creates a box collider from center and dimensions.
   * @param center - Center point of the box
   * @param width - Width of the box
   * @param height - Height of the box
   */
  boxFromCenter(center: Point2D, width: number, height: number): IBoxCollider;

  /**
   * Creates a polygon collider from vertices.
   * Vertices must be in counter-clockwise order.
   * @param vertices - Array of vertices
   */
  polygon(vertices: readonly Point2D[]): IPolygonCollider;

  /**
   * Creates a line collider.
   * @param start - Start point of the line
   * @param end - End point of the line
   */
  line(start: Point2D, end: Point2D): ILineCollider;
}

/**
 * Collision detection functions.
 */
export interface ICollisionDetection {
  /**
   * Tests collision between two colliders of any type.
   * @param a - First collider
   * @param b - Second collider
   */
  test(a: ICollider, b: ICollider): CollisionResult;

  /**
   * Tests collision between two circles.
   * @param a - First circle
   * @param b - Second circle
   */
  circleCircle(a: ICircleCollider, b: ICircleCollider): CollisionResult;

  /**
   * Tests collision between two boxes (AABB).
   * @param a - First box
   * @param b - Second box
   */
  boxBox(a: IBoxCollider, b: IBoxCollider): CollisionResult;

  /**
   * Tests collision between a circle and a box.
   * @param circle - The circle collider
   * @param box - The box collider
   */
  circleBox(circle: ICircleCollider, box: IBoxCollider): CollisionResult;

  /**
   * Tests collision between two convex polygons using SAT.
   * @param a - First polygon
   * @param b - Second polygon
   */
  polygonPolygon(a: IPolygonCollider, b: IPolygonCollider): CollisionResult;

  /**
   * Tests collision between a circle and a polygon.
   * @param circle - The circle collider
   * @param polygon - The polygon collider
   */
  circlePolygon(circle: ICircleCollider, polygon: IPolygonCollider): CollisionResult;

  /**
   * Tests collision between a box and a polygon.
   * @param box - The box collider
   * @param polygon - The polygon collider
   */
  boxPolygon(box: IBoxCollider, polygon: IPolygonCollider): CollisionResult;

  /**
   * Performs a raycast against a collider.
   * @param start - Ray origin
   * @param direction - Ray direction (should be normalized)
   * @param maxDistance - Maximum ray distance
   * @param collider - Collider to test against
   */
  raycast(
    start: Point2D,
    direction: Point2D,
    maxDistance: number,
    collider: ICollider
  ): RaycastResult;

  /**
   * Tests if two axis-aligned bounding boxes overlap.
   * Fast broad-phase check.
   * @param a - First bounds
   * @param b - Second bounds
   */
  boundsOverlap(a: ColliderBounds, b: ColliderBounds): boolean;

  /**
   * Tests if a point is inside an axis-aligned bounding box.
   * @param point - Point to test
   * @param bounds - Bounds to test against
   */
  pointInBounds(point: Point2D, bounds: ColliderBounds): boolean;
}
