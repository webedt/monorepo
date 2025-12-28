import type { Point2D } from './vec2.doc.js';
import type { IVec2 } from './vec2.doc.js';

export type { Point2D, IVec2 } from './vec2.doc.js';

const EPSILON = 1e-10;

export class Vec2 implements IVec2 {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  static create(x: number, y: number): Vec2 {
    return new Vec2(x, y);
  }

  static fromPoint(point: Point2D): Vec2 {
    return new Vec2(point.x, point.y);
  }

  static fromArray(arr: [number, number]): Vec2 {
    return new Vec2(arr[0], arr[1]);
  }

  static fromPolar(radius: number, angle: number): Vec2 {
    return new Vec2(radius * Math.cos(angle), radius * Math.sin(angle));
  }

  static fromAngle(radians: number): Vec2 {
    return new Vec2(Math.cos(radians), Math.sin(radians));
  }

  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  static right(): Vec2 {
    return new Vec2(1, 0);
  }

  static left(): Vec2 {
    return new Vec2(-1, 0);
  }

  static up(): Vec2 {
    return new Vec2(0, 1);
  }

  static down(): Vec2 {
    return new Vec2(0, -1);
  }

  static one(): Vec2 {
    const val = Math.SQRT1_2;
    return new Vec2(val, val);
  }

  static min(a: Point2D, b: Point2D): Vec2 {
    return new Vec2(Math.min(a.x, b.x), Math.min(a.y, b.y));
  }

  static max(a: Point2D, b: Point2D): Vec2 {
    return new Vec2(Math.max(a.x, b.x), Math.max(a.y, b.y));
  }

  static distance(a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  static lerp(a: Point2D, b: Point2D, t: number): Vec2 {
    return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalized(): Vec2 {
    const mag = this.magnitude();
    if (mag < EPSILON) {
      return Vec2.zero();
    }
    return new Vec2(this.x / mag, this.y / mag);
  }

  dot(other: Point2D): number {
    return this.x * other.x + this.y * other.y;
  }

  cross(other: Point2D): number {
    return this.x * other.y - this.y * other.x;
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  angleTo(other: Point2D): number {
    const dot = this.x * other.x + this.y * other.y;
    const magProduct = this.magnitude() * Math.sqrt(other.x * other.x + other.y * other.y);
    if (magProduct < EPSILON) {
      return 0;
    }
    const cos = Math.max(-1, Math.min(1, dot / magProduct));
    return Math.acos(cos);
  }

  signedAngleTo(other: Point2D): number {
    return Math.atan2(this.cross(other), this.dot(other));
  }

  distanceTo(other: Point2D): number {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceSquaredTo(other: Point2D): number {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    return dx * dx + dy * dy;
  }

  add(other: Point2D): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  subtract(other: Point2D): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
  }

  negate(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  perpendicular(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  perpendicularClockwise(): Vec2 {
    return new Vec2(this.y, -this.x);
  }

  lerp(other: Point2D, t: number): Vec2 {
    return new Vec2(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t);
  }

  projectOnto(onto: Point2D): Vec2 {
    const ontoMagSq = onto.x * onto.x + onto.y * onto.y;
    if (ontoMagSq < EPSILON * EPSILON) {
      return Vec2.zero();
    }
    const scalar = this.dot(onto) / ontoMagSq;
    return new Vec2(onto.x * scalar, onto.y * scalar);
  }

  reflect(normal: Point2D): Vec2 {
    const dot2 = 2 * this.dot(normal);
    return new Vec2(this.x - dot2 * normal.x, this.y - dot2 * normal.y);
  }

  clampMagnitude(maxMagnitude: number): Vec2 {
    const magSq = this.magnitudeSquared();
    if (magSq > maxMagnitude * maxMagnitude) {
      const mag = Math.sqrt(magSq);
      return new Vec2((this.x / mag) * maxMagnitude, (this.y / mag) * maxMagnitude);
    }
    return new Vec2(this.x, this.y);
  }

  clamp(min: number, max: number): Vec2 {
    return new Vec2(
      Math.max(min, Math.min(max, this.x)),
      Math.max(min, Math.min(max, this.y))
    );
  }

  round(): Vec2 {
    return new Vec2(Math.round(this.x), Math.round(this.y));
  }

  floor(): Vec2 {
    return new Vec2(Math.floor(this.x), Math.floor(this.y));
  }

  ceil(): Vec2 {
    return new Vec2(Math.ceil(this.x), Math.ceil(this.y));
  }

  abs(): Vec2 {
    return new Vec2(Math.abs(this.x), Math.abs(this.y));
  }

  equals(other: Point2D, epsilon: number = Number.EPSILON): boolean {
    return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon;
  }

  isZero(epsilon: number = Number.EPSILON): boolean {
    return Math.abs(this.x) <= epsilon && Math.abs(this.y) <= epsilon;
  }

  toObject(): Point2D {
    return { x: this.x, y: this.y };
  }

  toArray(): [number, number] {
    return [this.x, this.y];
  }

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }
}
