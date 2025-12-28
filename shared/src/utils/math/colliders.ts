import type { Point2D } from './vec2.doc.js';
import type { ColliderBounds } from './colliders.doc.js';
import type { CollisionResult } from './colliders.doc.js';
import type { IBoxCollider } from './colliders.doc.js';
import type { ICircleCollider } from './colliders.doc.js';
import type { ICollider } from './colliders.doc.js';
import type { ILineCollider } from './colliders.doc.js';
import type { IPolygonCollider } from './colliders.doc.js';
import type { RaycastResult } from './colliders.doc.js';

export type {
  ColliderBounds,
  CollisionResult,
  IBoxCollider,
  ICircleCollider,
  ICollider,
  ILineCollider,
  IPolygonCollider,
  RaycastResult,
} from './colliders.doc.js';

const EPSILON = 1e-10;

const NO_COLLISION: CollisionResult = {
  colliding: false,
  depth: 0,
  normal: { x: 0, y: 0 },
  contacts: [],
};

const NO_HIT: RaycastResult = {
  hit: false,
  distance: Infinity,
  point: { x: 0, y: 0 },
  normal: { x: 0, y: 0 },
};

export class CircleCollider implements ICircleCollider {
  readonly type = 'circle' as const;
  readonly center: Point2D;
  readonly radius: number;

  constructor(center: Point2D, radius: number) {
    if (radius < 0) {
      throw new Error('Radius must be non-negative');
    }
    this.center = { x: center.x, y: center.y };
    this.radius = radius;
  }

  getBounds(): ColliderBounds {
    return {
      minX: this.center.x - this.radius,
      minY: this.center.y - this.radius,
      maxX: this.center.x + this.radius,
      maxY: this.center.y + this.radius,
    };
  }

  containsPoint(point: Point2D): boolean {
    const dx = point.x - this.center.x;
    const dy = point.y - this.center.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  getCenter(): Point2D {
    return { x: this.center.x, y: this.center.y };
  }
}

export class BoxCollider implements IBoxCollider {
  readonly type = 'box' as const;
  readonly min: Point2D;
  readonly max: Point2D;
  readonly width: number;
  readonly height: number;

  constructor(min: Point2D, max: Point2D) {
    if (max.x < min.x || max.y < min.y) {
      throw new Error('Max must be greater than or equal to min');
    }
    this.min = { x: min.x, y: min.y };
    this.max = { x: max.x, y: max.y };
    this.width = max.x - min.x;
    this.height = max.y - min.y;
  }

  static fromCenter(center: Point2D, width: number, height: number): BoxCollider {
    if (width < 0 || height < 0) {
      throw new Error('Width and height must be non-negative');
    }
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return new BoxCollider(
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight }
    );
  }

  getBounds(): ColliderBounds {
    return {
      minX: this.min.x,
      minY: this.min.y,
      maxX: this.max.x,
      maxY: this.max.y,
    };
  }

  containsPoint(point: Point2D): boolean {
    return (
      point.x >= this.min.x &&
      point.x <= this.max.x &&
      point.y >= this.min.y &&
      point.y <= this.max.y
    );
  }

  getCenter(): Point2D {
    return {
      x: (this.min.x + this.max.x) / 2,
      y: (this.min.y + this.max.y) / 2,
    };
  }
}

export class PolygonCollider implements IPolygonCollider {
  readonly type = 'polygon' as const;
  readonly vertices: readonly Point2D[];
  readonly vertexCount: number;

  constructor(vertices: readonly Point2D[]) {
    if (vertices.length < 3) {
      throw new Error('Polygon must have at least 3 vertices');
    }
    this.vertices = vertices.map((v) => ({ x: v.x, y: v.y }));
    this.vertexCount = vertices.length;
  }

  getBounds(): ColliderBounds {
    let minX = this.vertices[0].x;
    let minY = this.vertices[0].y;
    let maxX = minX;
    let maxY = minY;

    for (let i = 1; i < this.vertexCount; i++) {
      const v = this.vertices[i];
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }

    return { minX, minY, maxX, maxY };
  }

  containsPoint(point: Point2D): boolean {
    let inside = false;
    const n = this.vertexCount;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = this.vertices[i];
      const vj = this.vertices[j];

      if (
        vi.y > point.y !== vj.y > point.y &&
        point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
      ) {
        inside = !inside;
      }
    }

    return inside;
  }

  getCenter(): Point2D {
    let cx = 0;
    let cy = 0;

    for (const v of this.vertices) {
      cx += v.x;
      cy += v.y;
    }

    return {
      x: cx / this.vertexCount,
      y: cy / this.vertexCount,
    };
  }
}

export class LineCollider implements ILineCollider {
  readonly type = 'line' as const;
  readonly start: Point2D;
  readonly end: Point2D;
  readonly length: number;

  constructor(start: Point2D, end: Point2D) {
    this.start = { x: start.x, y: start.y };
    this.end = { x: end.x, y: end.y };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    this.length = Math.sqrt(dx * dx + dy * dy);
  }

  getBounds(): ColliderBounds {
    return {
      minX: Math.min(this.start.x, this.end.x),
      minY: Math.min(this.start.y, this.end.y),
      maxX: Math.max(this.start.x, this.end.x),
      maxY: Math.max(this.start.y, this.end.y),
    };
  }

  containsPoint(point: Point2D): boolean {
    const d1 = distance(this.start, point);
    const d2 = distance(this.end, point);
    return Math.abs(d1 + d2 - this.length) < EPSILON;
  }

  getCenter(): Point2D {
    return {
      x: (this.start.x + this.end.x) / 2,
      y: (this.start.y + this.end.y) / 2,
    };
  }
}

function distance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < EPSILON) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / len, y: v.y / len };
}

function dot(a: Point2D, b: Point2D): number {
  return a.x * b.x + a.y * b.y;
}

function subtract(a: Point2D, b: Point2D): Point2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const Collider = {
  circle(center: Point2D, radius: number): CircleCollider {
    return new CircleCollider(center, radius);
  },

  box(min: Point2D, max: Point2D): BoxCollider {
    return new BoxCollider(min, max);
  },

  boxFromCenter(center: Point2D, width: number, height: number): BoxCollider {
    return BoxCollider.fromCenter(center, width, height);
  },

  polygon(vertices: readonly Point2D[]): PolygonCollider {
    return new PolygonCollider(vertices);
  },

  line(start: Point2D, end: Point2D): LineCollider {
    return new LineCollider(start, end);
  },
};

export const Collision = {
  test(a: ICollider, b: ICollider): CollisionResult {
    if (a.type === 'circle' && b.type === 'circle') {
      return Collision.circleCircle(a as ICircleCollider, b as ICircleCollider);
    }
    if (a.type === 'box' && b.type === 'box') {
      return Collision.boxBox(a as IBoxCollider, b as IBoxCollider);
    }
    if (a.type === 'circle' && b.type === 'box') {
      return Collision.circleBox(a as ICircleCollider, b as IBoxCollider);
    }
    if (a.type === 'box' && b.type === 'circle') {
      const result = Collision.circleBox(b as ICircleCollider, a as IBoxCollider);
      if (!result.colliding) return result;
      return {
        ...result,
        normal: { x: -result.normal.x, y: -result.normal.y },
      };
    }
    if (a.type === 'polygon' && b.type === 'polygon') {
      return Collision.polygonPolygon(a as IPolygonCollider, b as IPolygonCollider);
    }
    if (a.type === 'circle' && b.type === 'polygon') {
      return Collision.circlePolygon(a as ICircleCollider, b as IPolygonCollider);
    }
    if (a.type === 'polygon' && b.type === 'circle') {
      const result = Collision.circlePolygon(b as ICircleCollider, a as IPolygonCollider);
      if (!result.colliding) return result;
      return {
        ...result,
        normal: { x: -result.normal.x, y: -result.normal.y },
      };
    }
    if (a.type === 'box' && b.type === 'polygon') {
      return Collision.boxPolygon(a as IBoxCollider, b as IPolygonCollider);
    }
    if (a.type === 'polygon' && b.type === 'box') {
      const result = Collision.boxPolygon(b as IBoxCollider, a as IPolygonCollider);
      if (!result.colliding) return result;
      return {
        ...result,
        normal: { x: -result.normal.x, y: -result.normal.y },
      };
    }

    if (!Collision.boundsOverlap(a.getBounds(), b.getBounds())) {
      return NO_COLLISION;
    }
    return NO_COLLISION;
  },

  circleCircle(a: ICircleCollider, b: ICircleCollider): CollisionResult {
    const dx = b.center.x - a.center.x;
    const dy = b.center.y - a.center.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = a.radius + b.radius;

    if (distSq > radiusSum * radiusSum) {
      return NO_COLLISION;
    }

    const dist = Math.sqrt(distSq);

    if (dist < EPSILON) {
      return {
        colliding: true,
        depth: radiusSum,
        normal: { x: 1, y: 0 },
        contacts: [{ x: a.center.x, y: a.center.y }],
      };
    }

    const normal = { x: dx / dist, y: dy / dist };
    const depth = radiusSum - dist;
    const contact = {
      x: a.center.x + normal.x * a.radius,
      y: a.center.y + normal.y * a.radius,
    };

    return {
      colliding: true,
      depth,
      normal,
      contacts: [contact],
    };
  },

  boxBox(a: IBoxCollider, b: IBoxCollider): CollisionResult {
    const overlapX1 = a.max.x - b.min.x;
    const overlapX2 = b.max.x - a.min.x;
    const overlapY1 = a.max.y - b.min.y;
    const overlapY2 = b.max.y - a.min.y;

    if (overlapX1 <= 0 || overlapX2 <= 0 || overlapY1 <= 0 || overlapY2 <= 0) {
      return NO_COLLISION;
    }

    const overlapX = Math.min(overlapX1, overlapX2);
    const overlapY = Math.min(overlapY1, overlapY2);

    let normal: Point2D;
    let depth: number;

    if (overlapX < overlapY) {
      depth = overlapX;
      normal = overlapX1 < overlapX2 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    } else {
      depth = overlapY;
      normal = overlapY1 < overlapY2 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    }

    const contactX = Math.max(a.min.x, b.min.x) + Math.min(a.max.x, b.max.x);
    const contactY = Math.max(a.min.y, b.min.y) + Math.min(a.max.y, b.max.y);

    return {
      colliding: true,
      depth,
      normal,
      contacts: [{ x: contactX / 2, y: contactY / 2 }],
    };
  },

  circleBox(circle: ICircleCollider, box: IBoxCollider): CollisionResult {
    const closestX = clamp(circle.center.x, box.min.x, box.max.x);
    const closestY = clamp(circle.center.y, box.min.y, box.max.y);

    const dx = circle.center.x - closestX;
    const dy = circle.center.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq > circle.radius * circle.radius) {
      return NO_COLLISION;
    }

    if (distSq < EPSILON) {
      const halfWidth = box.width / 2;
      const halfHeight = box.height / 2;
      const centerX = (box.min.x + box.max.x) / 2;
      const centerY = (box.min.y + box.max.y) / 2;

      const distToLeft = circle.center.x - box.min.x;
      const distToRight = box.max.x - circle.center.x;
      const distToBottom = circle.center.y - box.min.y;
      const distToTop = box.max.y - circle.center.y;

      const minDist = Math.min(distToLeft, distToRight, distToBottom, distToTop);

      let normal: Point2D;
      if (minDist === distToLeft) {
        normal = { x: -1, y: 0 };
      } else if (minDist === distToRight) {
        normal = { x: 1, y: 0 };
      } else if (minDist === distToBottom) {
        normal = { x: 0, y: -1 };
      } else {
        normal = { x: 0, y: 1 };
      }

      return {
        colliding: true,
        depth: circle.radius + minDist,
        normal,
        contacts: [{ x: closestX, y: closestY }],
      };
    }

    const dist = Math.sqrt(distSq);
    const normal = { x: dx / dist, y: dy / dist };
    const depth = circle.radius - dist;

    return {
      colliding: true,
      depth,
      normal,
      contacts: [{ x: closestX, y: closestY }],
    };
  },

  polygonPolygon(a: IPolygonCollider, b: IPolygonCollider): CollisionResult {
    let minDepth = Infinity;
    let minNormal: Point2D = { x: 0, y: 0 };

    const checkAxis = (vertices: readonly Point2D[], isA: boolean): boolean => {
      const n = vertices.length;
      for (let i = 0; i < n; i++) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % n];

        const edge = subtract(v2, v1);
        const axis = normalize({ x: -edge.y, y: edge.x });

        let minA = Infinity,
          maxA = -Infinity;
        for (const v of a.vertices) {
          const proj = dot(v, axis);
          if (proj < minA) minA = proj;
          if (proj > maxA) maxA = proj;
        }

        let minB = Infinity,
          maxB = -Infinity;
        for (const v of b.vertices) {
          const proj = dot(v, axis);
          if (proj < minB) minB = proj;
          if (proj > maxB) maxB = proj;
        }

        const overlap = Math.min(maxA - minB, maxB - minA);
        if (overlap <= 0) {
          return false;
        }

        if (overlap < minDepth) {
          minDepth = overlap;
          minNormal = isA ? axis : { x: -axis.x, y: -axis.y };
        }
      }
      return true;
    };

    if (!checkAxis(a.vertices, true)) return NO_COLLISION;
    if (!checkAxis(b.vertices, false)) return NO_COLLISION;

    const centerA = a.getCenter();
    const centerB = b.getCenter();
    const d = subtract(centerB, centerA);
    if (dot(d, minNormal) < 0) {
      minNormal = { x: -minNormal.x, y: -minNormal.y };
    }

    return {
      colliding: true,
      depth: minDepth,
      normal: minNormal,
      contacts: [],
    };
  },

  circlePolygon(circle: ICircleCollider, polygon: IPolygonCollider): CollisionResult {
    let minDist = Infinity;
    let closestPoint: Point2D = { x: 0, y: 0 };

    const n = polygon.vertexCount;
    for (let i = 0; i < n; i++) {
      const v1 = polygon.vertices[i];
      const v2 = polygon.vertices[(i + 1) % n];

      const edge = subtract(v2, v1);
      const toCircle = subtract(circle.center, v1);
      const edgeLenSq = dot(edge, edge);

      let t = 0;
      if (edgeLenSq > EPSILON) {
        t = clamp(dot(toCircle, edge) / edgeLenSq, 0, 1);
      }

      const closest = {
        x: v1.x + edge.x * t,
        y: v1.y + edge.y * t,
      };

      const dist = distance(circle.center, closest);
      if (dist < minDist) {
        minDist = dist;
        closestPoint = closest;
      }
    }

    if (minDist > circle.radius) {
      if (!polygon.containsPoint(circle.center)) {
        return NO_COLLISION;
      }
      const normal = normalize(subtract(closestPoint, circle.center));
      return {
        colliding: true,
        depth: circle.radius + minDist,
        normal,
        contacts: [closestPoint],
      };
    }

    const diff = subtract(circle.center, closestPoint);
    const normal = normalize(diff);

    return {
      colliding: true,
      depth: circle.radius - minDist,
      normal: normal.x === 0 && normal.y === 0 ? { x: 1, y: 0 } : normal,
      contacts: [closestPoint],
    };
  },

  boxPolygon(box: IBoxCollider, polygon: IPolygonCollider): CollisionResult {
    const boxPoly = new PolygonCollider([
      { x: box.min.x, y: box.min.y },
      { x: box.max.x, y: box.min.y },
      { x: box.max.x, y: box.max.y },
      { x: box.min.x, y: box.max.y },
    ]);
    return Collision.polygonPolygon(boxPoly, polygon);
  },

  raycast(
    start: Point2D,
    direction: Point2D,
    maxDistance: number,
    collider: ICollider
  ): RaycastResult {
    const dir = normalize(direction);

    if (collider.type === 'circle') {
      return raycastCircle(start, dir, maxDistance, collider as ICircleCollider);
    }
    if (collider.type === 'box') {
      return raycastBox(start, dir, maxDistance, collider as IBoxCollider);
    }
    if (collider.type === 'polygon') {
      return raycastPolygon(start, dir, maxDistance, collider as IPolygonCollider);
    }
    if (collider.type === 'line') {
      return raycastLine(start, dir, maxDistance, collider as ILineCollider);
    }

    return NO_HIT;
  },

  boundsOverlap(a: ColliderBounds, b: ColliderBounds): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  },

  pointInBounds(point: Point2D, bounds: ColliderBounds): boolean {
    return (
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    );
  },
};

function raycastCircle(
  start: Point2D,
  dir: Point2D,
  maxDistance: number,
  circle: ICircleCollider
): RaycastResult {
  const toCircle = subtract(circle.center, start);
  const tCenter = dot(toCircle, dir);

  if (tCenter < -circle.radius) {
    return NO_HIT;
  }

  const dSq = dot(toCircle, toCircle) - tCenter * tCenter;
  const rSq = circle.radius * circle.radius;

  if (dSq > rSq) {
    return NO_HIT;
  }

  const tOffset = Math.sqrt(rSq - dSq);
  let t = tCenter - tOffset;

  if (t < 0) {
    t = tCenter + tOffset;
    if (t < 0) {
      return NO_HIT;
    }
  }

  if (t > maxDistance) {
    return NO_HIT;
  }

  const point = {
    x: start.x + dir.x * t,
    y: start.y + dir.y * t,
  };
  const normal = normalize(subtract(point, circle.center));

  return {
    hit: true,
    distance: t,
    point,
    normal,
  };
}

function raycastBox(
  start: Point2D,
  dir: Point2D,
  maxDistance: number,
  box: IBoxCollider
): RaycastResult {
  let tMin = 0;
  let tMax = maxDistance;
  let normalX = 0;
  let normalY = 0;

  if (Math.abs(dir.x) < EPSILON) {
    if (start.x < box.min.x || start.x > box.max.x) {
      return NO_HIT;
    }
  } else {
    const invDirX = 1 / dir.x;
    let t1 = (box.min.x - start.x) * invDirX;
    let t2 = (box.max.x - start.x) * invDirX;
    let n = -1;

    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
      n = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      normalX = n;
      normalY = 0;
    }
    tMax = Math.min(tMax, t2);

    if (tMin > tMax) return NO_HIT;
  }

  if (Math.abs(dir.y) < EPSILON) {
    if (start.y < box.min.y || start.y > box.max.y) {
      return NO_HIT;
    }
  } else {
    const invDirY = 1 / dir.y;
    let t1 = (box.min.y - start.y) * invDirY;
    let t2 = (box.max.y - start.y) * invDirY;
    let n = -1;

    if (t1 > t2) {
      const temp = t1;
      t1 = t2;
      t2 = temp;
      n = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      normalX = 0;
      normalY = n;
    }
    tMax = Math.min(tMax, t2);

    if (tMin > tMax) return NO_HIT;
  }

  if (tMin < 0) return NO_HIT;

  return {
    hit: true,
    distance: tMin,
    point: {
      x: start.x + dir.x * tMin,
      y: start.y + dir.y * tMin,
    },
    normal: { x: normalX, y: normalY },
  };
}

function raycastPolygon(
  start: Point2D,
  dir: Point2D,
  maxDistance: number,
  polygon: IPolygonCollider
): RaycastResult {
  let closestT = Infinity;
  let closestNormal: Point2D = { x: 0, y: 0 };

  const n = polygon.vertexCount;
  for (let i = 0; i < n; i++) {
    const v1 = polygon.vertices[i];
    const v2 = polygon.vertices[(i + 1) % n];

    const edge = subtract(v2, v1);
    const cross = dir.x * edge.y - dir.y * edge.x;

    if (Math.abs(cross) < EPSILON) continue;

    const toV1 = subtract(v1, start);
    const t = (toV1.x * edge.y - toV1.y * edge.x) / cross;
    const u = (toV1.x * dir.y - toV1.y * dir.x) / cross;

    if (t >= 0 && t <= maxDistance && u >= 0 && u <= 1) {
      if (t < closestT) {
        closestT = t;
        closestNormal = normalize({ x: -edge.y, y: edge.x });
        if (dot(closestNormal, dir) > 0) {
          closestNormal = { x: -closestNormal.x, y: -closestNormal.y };
        }
      }
    }
  }

  if (closestT === Infinity) {
    return NO_HIT;
  }

  return {
    hit: true,
    distance: closestT,
    point: {
      x: start.x + dir.x * closestT,
      y: start.y + dir.y * closestT,
    },
    normal: closestNormal,
  };
}

function raycastLine(
  start: Point2D,
  dir: Point2D,
  maxDistance: number,
  line: ILineCollider
): RaycastResult {
  const edge = subtract(line.end, line.start);
  const cross = dir.x * edge.y - dir.y * edge.x;

  if (Math.abs(cross) < EPSILON) {
    return NO_HIT;
  }

  const toStart = subtract(line.start, start);
  const t = (toStart.x * edge.y - toStart.y * edge.x) / cross;
  const u = (toStart.x * dir.y - toStart.y * dir.x) / cross;

  if (t < 0 || t > maxDistance || u < 0 || u > 1) {
    return NO_HIT;
  }

  const normal = normalize({ x: -edge.y, y: edge.x });

  return {
    hit: true,
    distance: t,
    point: {
      x: start.x + dir.x * t,
      y: start.y + dir.y * t,
    },
    normal: dot(normal, dir) > 0 ? { x: -normal.x, y: -normal.y } : normal,
  };
}
