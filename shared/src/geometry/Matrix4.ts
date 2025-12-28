import type { Matrix4Tuple } from './types.js';
import type { Vector3Like } from './types.js';
import type { QuaternionLike } from './types.js';

import { EPSILON } from './types.js';
import { Vector3 } from './Vector3.js';

/**
 * Immutable 4x4 transformation matrix for 3D graphics.
 * Stored in column-major order (OpenGL convention).
 *
 * Matrix layout (column-major storage, indices shown):
 * | 0  4  8  12 |   | Xx  Yx  Zx  Tx |
 * | 1  5  9  13 | = | Xy  Yy  Zy  Ty |
 * | 2  6  10 14 |   | Xz  Yz  Zz  Tz |
 * | 3  7  11 15 |   | 0   0   0   1  |
 *
 * Mathematical notation (row-major visual):
 * | m00 m01 m02 m03 |   | 0  4  8  12 |
 * | m10 m11 m12 m13 | = | 1  5  9  13 |
 * | m20 m21 m22 m23 |   | 2  6  10 14 |
 * | m30 m31 m32 m33 |   | 3  7  11 15 |
 *
 * For right-handed coordinate system with Y-up:
 * - Positive rotation around X (pitch): nose down
 * - Positive rotation around Y (yaw): turn left
 * - Positive rotation around Z (roll): tilt left
 */
export class Matrix4 {
  private readonly elements: Float64Array;

  // Cached identity matrix
  private static _identity: Matrix4 | undefined;

  constructor(elements?: Matrix4Tuple | Float64Array) {
    this.elements = new Float64Array(16);
    if (elements) {
      for (let i = 0; i < 16; i++) {
        this.elements[i] = elements[i];
      }
    } else {
      // Default to identity
      this.elements[0] = 1;
      this.elements[5] = 1;
      this.elements[10] = 1;
      this.elements[15] = 1;
    }
  }

  // ==================== Static Constructors ====================

  /** Identity matrix */
  static get identity(): Matrix4 {
    return Matrix4._identity ??= new Matrix4();
  }

  /** Create from column-major tuple */
  static fromTuple(tuple: Matrix4Tuple): Matrix4 {
    return new Matrix4(tuple);
  }

  /** Create from row-major array (common mathematical notation) */
  static fromRowMajor(elements: readonly number[]): Matrix4 {
    return new Matrix4([
      elements[0], elements[4], elements[8], elements[12],
      elements[1], elements[5], elements[9], elements[13],
      elements[2], elements[6], elements[10], elements[14],
      elements[3], elements[7], elements[11], elements[15]
    ]);
  }

  /** Create translation matrix */
  static translation(x: number, y: number, z: number): Matrix4;
  static translation(v: Vector3Like): Matrix4;
  static translation(xOrV: number | Vector3Like, y?: number, z?: number): Matrix4 {
    const tx = typeof xOrV === 'number' ? xOrV : xOrV.x;
    const ty = typeof xOrV === 'number' ? y! : xOrV.y;
    const tz = typeof xOrV === 'number' ? z! : xOrV.z;

    return new Matrix4([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      tx, ty, tz, 1
    ]);
  }

  /** Create uniform scale matrix */
  static scale(s: number): Matrix4;
  /** Create non-uniform scale matrix */
  static scale(x: number, y: number, z: number): Matrix4;
  static scale(v: Vector3Like): Matrix4;
  static scale(xOrV: number | Vector3Like, y?: number, z?: number): Matrix4 {
    let sx: number, sy: number, sz: number;

    if (typeof xOrV === 'number') {
      sx = xOrV;
      sy = y ?? xOrV;
      sz = z ?? xOrV;
    } else {
      sx = xOrV.x;
      sy = xOrV.y;
      sz = xOrV.z;
    }

    return new Matrix4([
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      0, 0, 0, 1
    ]);
  }

  /** Create rotation matrix around X axis (pitch) */
  static rotationX(angle: number): Matrix4 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return new Matrix4([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1
    ]);
  }

  /** Create rotation matrix around Y axis (yaw) */
  static rotationY(angle: number): Matrix4 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return new Matrix4([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ]);
  }

  /** Create rotation matrix around Z axis (roll) */
  static rotationZ(angle: number): Matrix4 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return new Matrix4([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  /** Create rotation matrix around arbitrary axis */
  static rotationAxis(axis: Vector3Like, angle: number): Matrix4 {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;

    const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
    if (len < EPSILON) {
      return Matrix4.identity;
    }

    const x = axis.x / len;
    const y = axis.y / len;
    const z = axis.z / len;

    return new Matrix4([
      t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
      0, 0, 0, 1
    ]);
  }

  /** Create rotation matrix from quaternion */
  static fromQuaternion(q: QuaternionLike): Matrix4 {
    const x2 = q.x + q.x;
    const y2 = q.y + q.y;
    const z2 = q.z + q.z;

    const xx = q.x * x2;
    const xy = q.x * y2;
    const xz = q.x * z2;
    const yy = q.y * y2;
    const yz = q.y * z2;
    const zz = q.z * z2;
    const wx = q.w * x2;
    const wy = q.w * y2;
    const wz = q.w * z2;

    return new Matrix4([
      1 - (yy + zz), xy + wz, xz - wy, 0,
      xy - wz, 1 - (xx + zz), yz + wx, 0,
      xz + wy, yz - wx, 1 - (xx + yy), 0,
      0, 0, 0, 1
    ]);
  }

  /** Create TRS (Translation-Rotation-Scale) matrix */
  static compose(
    position: Vector3Like,
    rotation: QuaternionLike,
    scale: Vector3Like
  ): Matrix4 {
    // Build rotation matrix from quaternion
    const x2 = rotation.x + rotation.x;
    const y2 = rotation.y + rotation.y;
    const z2 = rotation.z + rotation.z;

    const xx = rotation.x * x2;
    const xy = rotation.x * y2;
    const xz = rotation.x * z2;
    const yy = rotation.y * y2;
    const yz = rotation.y * z2;
    const zz = rotation.z * z2;
    const wx = rotation.w * x2;
    const wy = rotation.w * y2;
    const wz = rotation.w * z2;

    return new Matrix4([
      (1 - (yy + zz)) * scale.x,
      (xy + wz) * scale.x,
      (xz - wy) * scale.x,
      0,
      (xy - wz) * scale.y,
      (1 - (xx + zz)) * scale.y,
      (yz + wx) * scale.y,
      0,
      (xz + wy) * scale.z,
      (yz - wx) * scale.z,
      (1 - (xx + yy)) * scale.z,
      0,
      position.x,
      position.y,
      position.z,
      1
    ]);
  }

  /**
   * Create look-at view matrix (right-handed).
   * Positions camera at `eye` looking at `target` with `up` orientation.
   */
  static lookAt(eye: Vector3Like, target: Vector3Like, up: Vector3Like): Matrix4 {
    const eyeVec = Vector3.from(eye);
    const targetVec = Vector3.from(target);
    const upVec = Vector3.from(up);

    // Forward direction (from target to eye for right-handed)
    let zAxis = eyeVec.subtract(targetVec);
    if (zAxis.isZero()) {
      zAxis = new Vector3(0, 0, 1);
    } else {
      zAxis = zAxis.normalize();
    }

    // Right direction
    let xAxis = upVec.cross(zAxis);
    if (xAxis.isZero()) {
      // Up and forward are parallel, use a fallback
      if (Math.abs(zAxis.z) > 0.9999) {
        xAxis = new Vector3(1, 0, 0);
      } else {
        xAxis = new Vector3(0, 0, 1).cross(zAxis);
      }
    }
    xAxis = xAxis.normalize();

    // Recalculate up to ensure orthogonality
    const yAxis = zAxis.cross(xAxis);

    return new Matrix4([
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      -xAxis.dot(eyeVec), -yAxis.dot(eyeVec), -zAxis.dot(eyeVec), 1
    ]);
  }

  /** Create perspective projection matrix (right-handed, depth range -1 to 1) */
  static perspective(
    fovY: number,
    aspect: number,
    near: number,
    far: number
  ): Matrix4 {
    const f = 1.0 / Math.tan(fovY / 2);
    const rangeInv = 1 / (near - far);

    return new Matrix4([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * rangeInv, -1,
      0, 0, 2 * far * near * rangeInv, 0
    ]);
  }

  /** Create orthographic projection matrix (right-handed) */
  static orthographic(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ): Matrix4 {
    const w = 1.0 / (right - left);
    const h = 1.0 / (top - bottom);
    const p = 1.0 / (far - near);

    return new Matrix4([
      2 * w, 0, 0, 0,
      0, 2 * h, 0, 0,
      0, 0, -2 * p, 0,
      -(right + left) * w, -(top + bottom) * h, -(far + near) * p, 1
    ]);
  }

  // ==================== Element Access ====================

  /** Get element at column-major index */
  get(index: number): number {
    return this.elements[index];
  }

  /** Get element at row, column */
  getElement(row: number, col: number): number {
    return this.elements[col * 4 + row];
  }

  /** Set element at column-major index, returning new matrix */
  set(index: number, value: number): Matrix4 {
    const elements = new Float64Array(this.elements);
    elements[index] = value;
    return new Matrix4(elements);
  }

  /** Set element at row, column, returning new matrix */
  setElement(row: number, col: number, value: number): Matrix4 {
    return this.set(col * 4 + row, value);
  }

  /** Get column as Vector3 (ignoring w component) */
  getColumn(col: number): Vector3 {
    const offset = col * 4;
    return new Vector3(
      this.elements[offset],
      this.elements[offset + 1],
      this.elements[offset + 2]
    );
  }

  /** Get row as Vector3 (ignoring w component) */
  getRow(row: number): Vector3 {
    return new Vector3(
      this.elements[row],
      this.elements[row + 4],
      this.elements[row + 8]
    );
  }

  /** Get translation component */
  getTranslation(): Vector3 {
    return new Vector3(this.elements[12], this.elements[13], this.elements[14]);
  }

  /** Get scale component (assumes no shear) */
  getScale(): Vector3 {
    return new Vector3(
      Math.sqrt(
        this.elements[0] * this.elements[0] +
        this.elements[1] * this.elements[1] +
        this.elements[2] * this.elements[2]
      ),
      Math.sqrt(
        this.elements[4] * this.elements[4] +
        this.elements[5] * this.elements[5] +
        this.elements[6] * this.elements[6]
      ),
      Math.sqrt(
        this.elements[8] * this.elements[8] +
        this.elements[9] * this.elements[9] +
        this.elements[10] * this.elements[10]
      )
    );
  }

  // ==================== Matrix Operations ====================

  /** Multiply with another matrix (this × other) */
  multiply(other: Matrix4): Matrix4 {
    const a = this.elements;
    const b = other.elements;
    const result = new Float64Array(16);

    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        result[col * 4 + row] =
          a[row] * b[col * 4] +
          a[row + 4] * b[col * 4 + 1] +
          a[row + 8] * b[col * 4 + 2] +
          a[row + 12] * b[col * 4 + 3];
      }
    }

    return new Matrix4(result);
  }

  /** Pre-multiply with another matrix (other × this) */
  premultiply(other: Matrix4): Matrix4 {
    return other.multiply(this);
  }

  /** Transpose the matrix */
  transpose(): Matrix4 {
    const e = this.elements;
    return new Matrix4([
      e[0], e[4], e[8], e[12],
      e[1], e[5], e[9], e[13],
      e[2], e[6], e[10], e[14],
      e[3], e[7], e[11], e[15]
    ]);
  }

  /** Calculate determinant */
  determinant(): number {
    const e = this.elements;

    const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
    const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
    const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
    const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];

    return (
      n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    );
  }

  /** Calculate inverse matrix */
  inverse(): Matrix4 {
    const e = this.elements;
    const result = new Float64Array(16);

    const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
    const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
    const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
    const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;

    if (Math.abs(det) < EPSILON) {
      throw new Error('Matrix is not invertible (determinant is zero)');
    }

    const detInv = 1 / det;

    result[0] = t11 * detInv;
    result[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
    result[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
    result[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;

    result[4] = t12 * detInv;
    result[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
    result[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
    result[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;

    result[8] = t13 * detInv;
    result[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
    result[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
    result[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;

    result[12] = t14 * detInv;
    result[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
    result[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
    result[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;

    return new Matrix4(result);
  }

  // ==================== Vector Transformation ====================

  /** Transform a point (applies translation) */
  transformPoint(v: Vector3Like): Vector3 {
    const e = this.elements;
    const w = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
    const invW = Math.abs(w) < EPSILON ? 1 : 1 / w;

    return new Vector3(
      (e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]) * invW,
      (e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]) * invW,
      (e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]) * invW
    );
  }

  /** Transform a direction vector (ignores translation) */
  transformDirection(v: Vector3Like): Vector3 {
    const e = this.elements;
    return new Vector3(
      e[0] * v.x + e[4] * v.y + e[8] * v.z,
      e[1] * v.x + e[5] * v.y + e[9] * v.z,
      e[2] * v.x + e[6] * v.y + e[10] * v.z
    );
  }

  /** Transform a normal vector (uses inverse transpose) */
  transformNormal(v: Vector3Like): Vector3 {
    // For normals, we need to use the inverse transpose of the upper 3x3
    const invTranspose = this.inverse().transpose();
    return invTranspose.transformDirection(v).normalize();
  }

  // ==================== Decomposition ====================

  /** Decompose into translation, rotation (as quaternion), and scale */
  decompose(): {
    position: Vector3;
    rotation: { x: number; y: number; z: number; w: number };
    scale: Vector3;
  } {
    const e = this.elements;

    // Extract scale
    const sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    const sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    const sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);

    // Determine if we have a negative scale (reflection)
    const det = this.determinant();
    const signX = det < 0 ? -1 : 1;

    const invSx = 1 / (sx * signX);
    const invSy = 1 / sy;
    const invSz = 1 / sz;

    // Extract rotation matrix (normalized)
    const m11 = e[0] * invSx, m12 = e[4] * invSy, m13 = e[8] * invSz;
    const m21 = e[1] * invSx, m22 = e[5] * invSy, m23 = e[9] * invSz;
    const m31 = e[2] * invSx, m32 = e[6] * invSy, m33 = e[10] * invSz;

    // Convert rotation matrix to quaternion
    const trace = m11 + m22 + m33;
    let qx: number, qy: number, qz: number, qw: number;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      qw = 0.25 / s;
      qx = (m32 - m23) * s;
      qy = (m13 - m31) * s;
      qz = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      qw = (m32 - m23) / s;
      qx = 0.25 * s;
      qy = (m12 + m21) / s;
      qz = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      qw = (m13 - m31) / s;
      qx = (m12 + m21) / s;
      qy = 0.25 * s;
      qz = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      qw = (m21 - m12) / s;
      qx = (m13 + m31) / s;
      qy = (m23 + m32) / s;
      qz = 0.25 * s;
    }

    return {
      position: new Vector3(e[12], e[13], e[14]),
      rotation: { x: qx, y: qy, z: qz, w: qw },
      scale: new Vector3(sx * signX, sy, sz)
    };
  }

  // ==================== Conversion ====================

  /** Convert to column-major tuple */
  toTuple(): Matrix4Tuple {
    return Array.from(this.elements) as unknown as Matrix4Tuple;
  }

  /** Convert to column-major array */
  toArray(): number[] {
    return Array.from(this.elements);
  }

  /** Convert to row-major array */
  toRowMajorArray(): number[] {
    const e = this.elements;
    return [
      e[0], e[4], e[8], e[12],
      e[1], e[5], e[9], e[13],
      e[2], e[6], e[10], e[14],
      e[3], e[7], e[11], e[15]
    ];
  }

  /** Convert to Float32Array for WebGL */
  toFloat32Array(): Float32Array {
    return new Float32Array(this.elements);
  }

  // ==================== Comparison ====================

  /** Check if approximately equal */
  equals(other: Matrix4, epsilon: number = EPSILON): boolean {
    for (let i = 0; i < 16; i++) {
      if (Math.abs(this.elements[i] - other.elements[i]) >= epsilon) {
        return false;
      }
    }
    return true;
  }

  /** Check if this is an identity matrix */
  isIdentity(epsilon: number = EPSILON): boolean {
    return this.equals(Matrix4.identity, epsilon);
  }

  // ==================== Utility ====================

  /** Clone this matrix */
  clone(): Matrix4 {
    return new Matrix4(this.elements);
  }

  /** String representation */
  toString(): string {
    const e = this.elements;
    return `Matrix4(\n  ${e[0].toFixed(4)}, ${e[4].toFixed(4)}, ${e[8].toFixed(4)}, ${e[12].toFixed(4)}\n  ${e[1].toFixed(4)}, ${e[5].toFixed(4)}, ${e[9].toFixed(4)}, ${e[13].toFixed(4)}\n  ${e[2].toFixed(4)}, ${e[6].toFixed(4)}, ${e[10].toFixed(4)}, ${e[14].toFixed(4)}\n  ${e[3].toFixed(4)}, ${e[7].toFixed(4)}, ${e[11].toFixed(4)}, ${e[15].toFixed(4)}\n)`;
  }
}
