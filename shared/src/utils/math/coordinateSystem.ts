import type { Point2D } from './vec2.doc.js';
import type { AxisDirection } from './coordinateSystem.doc.js';
import type { Bounds2D } from './coordinateSystem.doc.js';
import type { CoordinateSystemConfig } from './coordinateSystem.doc.js';
import type { ICoordinateSystem2D } from './coordinateSystem.doc.js';
import type { Rect2D } from './coordinateSystem.doc.js';
import type { Transform2DMatrix } from './coordinateSystem.doc.js';

export type {
  AxisDirection,
  Bounds2D,
  CoordinateSystemConfig,
  ICoordinateSystem2D,
  Rect2D,
  Transform2DMatrix,
} from './coordinateSystem.doc.js';

const DEFAULT_CONFIG: CoordinateSystemConfig = {
  origin: { x: 0, y: 0 },
  xDirection: 'positive',
  yDirection: 'positive',
  scaleX: 1,
  scaleY: 1,
};

export class CoordinateSystem2D implements ICoordinateSystem2D {
  readonly config: Readonly<CoordinateSystemConfig>;

  private readonly xSign: number;
  private readonly ySign: number;

  constructor(config: Partial<CoordinateSystemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.xSign = this.config.xDirection === 'positive' ? 1 : -1;
    this.ySign = this.config.yDirection === 'positive' ? 1 : -1;
  }

  static math(): CoordinateSystem2D {
    return new CoordinateSystem2D({
      origin: { x: 0, y: 0 },
      xDirection: 'positive',
      yDirection: 'positive',
      scaleX: 1,
      scaleY: 1,
    });
  }

  static screen(): CoordinateSystem2D {
    return new CoordinateSystem2D({
      origin: { x: 0, y: 0 },
      xDirection: 'positive',
      yDirection: 'negative',
      scaleX: 1,
      scaleY: 1,
    });
  }

  static centered(width: number, height: number): CoordinateSystem2D {
    return new CoordinateSystem2D({
      origin: { x: width / 2, y: height / 2 },
      xDirection: 'positive',
      yDirection: 'positive',
      scaleX: 1,
      scaleY: 1,
    });
  }

  static custom(config: Partial<CoordinateSystemConfig>): CoordinateSystem2D {
    return new CoordinateSystem2D(config);
  }

  static forCanvas(
    canvasWidth: number,
    canvasHeight: number,
    worldWidth: number,
    worldHeight: number
  ): CoordinateSystem2D {
    return new CoordinateSystem2D({
      origin: { x: 0, y: canvasHeight },
      xDirection: 'positive',
      yDirection: 'positive',
      scaleX: canvasWidth / worldWidth,
      scaleY: canvasHeight / worldHeight,
    });
  }

  fromMath(point: Point2D): Point2D {
    return {
      x: this.config.origin.x + point.x * this.xSign * this.config.scaleX,
      y: this.config.origin.y - point.y * this.ySign * this.config.scaleY,
    };
  }

  toMath(point: Point2D): Point2D {
    return {
      x: ((point.x - this.config.origin.x) / this.config.scaleX) * this.xSign,
      y: -((point.y - this.config.origin.y) / this.config.scaleY) * this.ySign,
    };
  }

  fromScreen(point: Point2D, screenHeight: number): Point2D {
    const mathY = screenHeight - point.y;
    return this.fromMath({ x: point.x, y: mathY });
  }

  toScreen(point: Point2D, screenHeight: number): Point2D {
    const mathPoint = this.toMath(point);
    return {
      x: mathPoint.x,
      y: screenHeight - mathPoint.y,
    };
  }

  deltaFromMath(delta: Point2D): Point2D {
    return {
      x: delta.x * this.xSign * this.config.scaleX,
      y: -delta.y * this.ySign * this.config.scaleY,
    };
  }

  deltaToMath(delta: Point2D): Point2D {
    return {
      x: (delta.x / this.config.scaleX) * this.xSign,
      y: -(delta.y / this.config.scaleY) * this.ySign,
    };
  }

  boundsFromMath(bounds: Bounds2D): Bounds2D {
    const p1 = this.fromMath({ x: bounds.minX, y: bounds.minY });
    const p2 = this.fromMath({ x: bounds.maxX, y: bounds.maxY });
    return {
      minX: Math.min(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y),
      maxX: Math.max(p1.x, p2.x),
      maxY: Math.max(p1.y, p2.y),
    };
  }

  boundsToMath(bounds: Bounds2D): Bounds2D {
    const p1 = this.toMath({ x: bounds.minX, y: bounds.minY });
    const p2 = this.toMath({ x: bounds.maxX, y: bounds.maxY });
    return {
      minX: Math.min(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y),
      maxX: Math.max(p1.x, p2.x),
      maxY: Math.max(p1.y, p2.y),
    };
  }

  rectFromMath(rect: Rect2D): Rect2D {
    const bottomLeft = this.fromMath({ x: rect.x, y: rect.y });
    const topRight = this.fromMath({ x: rect.x + rect.width, y: rect.y + rect.height });
    const minX = Math.min(bottomLeft.x, topRight.x);
    const minY = Math.min(bottomLeft.y, topRight.y);
    const maxX = Math.max(bottomLeft.x, topRight.x);
    const maxY = Math.max(bottomLeft.y, topRight.y);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  rectToMath(rect: Rect2D): Rect2D {
    const p1 = this.toMath({ x: rect.x, y: rect.y });
    const p2 = this.toMath({ x: rect.x + rect.width, y: rect.y + rect.height });
    const minX = Math.min(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxX = Math.max(p1.x, p2.x);
    const maxY = Math.max(p1.y, p2.y);
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  angleFromMath(radians: number): number {
    let angle = radians;
    if (this.xSign < 0) {
      angle = Math.PI - angle;
    }
    if (this.ySign < 0) {
      angle = -angle;
    }
    return angle;
  }

  angleToMath(radians: number): number {
    let angle = radians;
    if (this.ySign < 0) {
      angle = -angle;
    }
    if (this.xSign < 0) {
      angle = Math.PI - angle;
    }
    return angle;
  }

  getTransformMatrix(): Transform2DMatrix {
    const a = this.xSign * this.config.scaleX;
    const b = 0;
    const c = 0;
    const d = -this.ySign * this.config.scaleY;
    const tx = this.config.origin.x;
    const ty = this.config.origin.y;
    return [a, b, c, d, tx, ty];
  }

  getInverseTransformMatrix(): Transform2DMatrix {
    const a = this.xSign / this.config.scaleX;
    const b = 0;
    const c = 0;
    const d = -this.ySign / this.config.scaleY;
    const tx = -this.config.origin.x * a;
    const ty = -this.config.origin.y * d;
    return [a, b, c, d, tx, ty];
  }

  isPointInBounds(point: Point2D, bounds: Bounds2D): boolean {
    return (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    );
  }

  isPointInRect(point: Point2D, rect: Rect2D): boolean {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  }

  clampToBounds(point: Point2D, bounds: Bounds2D): Point2D {
    return {
      x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
      y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
    };
  }

  snapToGrid(point: Point2D, gridSize: number): Point2D {
    return {
      x: Math.round(point.x / gridSize) * gridSize,
      y: Math.round(point.y / gridSize) * gridSize,
    };
  }
}
