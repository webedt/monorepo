/**
 * Viewport utility for center-origin coordinate system
 *
 * This module provides coordinate transformation utilities where:
 * - Origin (0, 0) is at the center of the viewport/canvas
 * - Positive X extends to the right
 * - Positive Y extends upward (mathematical convention)
 * - Supports pan and zoom operations
 */

export interface Point {
  x: number;
  y: number;
}

export interface ViewportConfig {
  /** Canvas/viewport width in pixels */
  width: number;
  /** Canvas/viewport height in pixels */
  height: number;
  /** Initial zoom level (default: 1) */
  zoom?: number;
  /** Initial pan offset in world coordinates */
  panOffset?: Point;
  /** Minimum zoom level (default: 0.1) */
  minZoom?: number;
  /** Maximum zoom level (default: 10) */
  maxZoom?: number;
}

export class Viewport {
  private _width: number;
  private _height: number;
  private _zoom: number;
  private _panOffset: Point;
  private _minZoom: number;
  private _maxZoom: number;

  constructor(config: ViewportConfig) {
    this._width = config.width;
    this._height = config.height;
    this._zoom = config.zoom ?? 1;
    this._panOffset = config.panOffset ?? { x: 0, y: 0 };
    this._minZoom = config.minZoom ?? 0.1;
    this._maxZoom = config.maxZoom ?? 10;
  }

  /** Get the center point of the viewport in screen coordinates */
  get center(): Point {
    return {
      x: this._width / 2,
      y: this._height / 2,
    };
  }

  /** Get viewport width */
  get width(): number {
    return this._width;
  }

  /** Get viewport height */
  get height(): number {
    return this._height;
  }

  /** Get current zoom level */
  get zoom(): number {
    return this._zoom;
  }

  /** Set zoom level (clamped to min/max) */
  set zoom(value: number) {
    this._zoom = Math.max(this._minZoom, Math.min(this._maxZoom, value));
  }

  /** Get current pan offset in world coordinates */
  get panOffset(): Point {
    return { ...this._panOffset };
  }

  /** Set pan offset */
  set panOffset(value: Point) {
    this._panOffset = { ...value };
  }

  /**
   * Update viewport dimensions
   */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  /**
   * Convert screen coordinates (canvas pixels) to world coordinates (center-origin)
   *
   * @param screenX - X position in screen/canvas pixels (0 = left edge)
   * @param screenY - Y position in screen/canvas pixels (0 = top edge)
   * @returns World coordinates where (0, 0) is center, +Y is up
   */
  screenToWorld(screenX: number, screenY: number): Point {
    const centerX = this._width / 2;
    const centerY = this._height / 2;

    // Convert from screen coordinates to center-origin
    // In screen: (0, 0) is top-left, +Y is down
    // In world: (0, 0) is center, +Y is up
    return {
      x: (screenX - centerX) / this._zoom - this._panOffset.x,
      y: (centerY - screenY) / this._zoom - this._panOffset.y, // Flip Y axis
    };
  }

  /**
   * Convert world coordinates (center-origin) to screen coordinates (canvas pixels)
   *
   * @param worldX - X position in world coordinates (0 = center)
   * @param worldY - Y position in world coordinates (0 = center, +Y is up)
   * @returns Screen coordinates where (0, 0) is top-left, +Y is down
   */
  worldToScreen(worldX: number, worldY: number): Point {
    const centerX = this._width / 2;
    const centerY = this._height / 2;

    return {
      x: (worldX + this._panOffset.x) * this._zoom + centerX,
      y: centerY - (worldY + this._panOffset.y) * this._zoom, // Flip Y axis
    };
  }

  /**
   * Convert a distance/size from screen units to world units
   */
  screenDistanceToWorld(distance: number): number {
    return distance / this._zoom;
  }

  /**
   * Convert a distance/size from world units to screen units
   */
  worldDistanceToScreen(distance: number): number {
    return distance * this._zoom;
  }

  /**
   * Apply viewport transformation to a canvas context
   * Call this before drawing world-space objects
   *
   * @param ctx - Canvas 2D rendering context
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const centerX = this._width / 2;
    const centerY = this._height / 2;

    // Move origin to center of canvas
    ctx.translate(centerX, centerY);

    // Apply zoom
    ctx.scale(this._zoom, -this._zoom); // Negative Y to flip axis (Y+ goes up)

    // Apply pan offset
    ctx.translate(this._panOffset.x, this._panOffset.y);
  }

  /**
   * Reset the viewport to default state (centered, no zoom, no pan)
   */
  reset(): void {
    this._zoom = 1;
    this._panOffset = { x: 0, y: 0 };
  }

  /**
   * Pan the viewport by a delta in screen coordinates
   */
  panByScreen(deltaX: number, deltaY: number): void {
    // Convert screen delta to world delta
    this._panOffset.x += deltaX / this._zoom;
    this._panOffset.y -= deltaY / this._zoom; // Flip Y for world coordinates
  }

  /**
   * Zoom to a specific point (keeping that point fixed on screen)
   *
   * @param screenX - Screen X coordinate to zoom towards
   * @param screenY - Screen Y coordinate to zoom towards
   * @param zoomDelta - Change in zoom level (positive = zoom in)
   */
  zoomToPoint(screenX: number, screenY: number, zoomDelta: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY);

    this.zoom = this._zoom + zoomDelta;

    const worldAfter = this.screenToWorld(screenX, screenY);

    // Adjust pan to keep the point fixed
    this._panOffset.x += worldAfter.x - worldBefore.x;
    this._panOffset.y += worldAfter.y - worldBefore.y;
  }

  /**
   * Get the visible world bounds
   * @returns Object with minX, maxX, minY, maxY in world coordinates
   */
  getVisibleBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this._width, this._height);

    return {
      minX: Math.min(topLeft.x, bottomRight.x),
      maxX: Math.max(topLeft.x, bottomRight.x),
      minY: Math.min(topLeft.y, bottomRight.y),
      maxY: Math.max(topLeft.y, bottomRight.y),
    };
  }

  /**
   * Check if a world-space point is visible in the viewport
   */
  isPointVisible(worldX: number, worldY: number, margin = 0): boolean {
    const bounds = this.getVisibleBounds();
    return (
      worldX >= bounds.minX - margin &&
      worldX <= bounds.maxX + margin &&
      worldY >= bounds.minY - margin &&
      worldY <= bounds.maxY + margin
    );
  }

  /**
   * Center the viewport on a world-space point
   */
  centerOn(worldX: number, worldY: number): void {
    this._panOffset = { x: -worldX, y: -worldY };
  }
}
