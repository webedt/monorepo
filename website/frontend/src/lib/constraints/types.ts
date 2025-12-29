/**
 * Constraint-based Layout System Types
 *
 * Defines constraint types for positioning UI elements relative to each other,
 * their parent containers, or absolute positions.
 */

/**
 * Reference point on an element for constraint anchoring
 */
export type AnchorPoint =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * Reference target for constraints
 */
export type ConstraintTarget =
  | { type: 'parent' }
  | { type: 'viewport' }
  | { type: 'object'; objectId: string };

/**
 * Constraint axis
 */
export type ConstraintAxis = 'horizontal' | 'vertical' | 'both';

/**
 * Size constraint mode
 */
export type SizeMode =
  | 'fixed'        // Fixed pixel size
  | 'fill'         // Fill available space
  | 'hug'          // Hug content (fit to children)
  | 'percentage'   // Percentage of parent
  | 'aspect';      // Maintain aspect ratio

/**
 * Position constraint mode
 */
export type PositionMode =
  | 'absolute'     // Absolute position
  | 'relative'     // Relative to anchor
  | 'center'       // Centered in parent
  | 'stretch';     // Stretch between two anchors

/**
 * Base constraint interface
 */
export interface BaseConstraint {
  id: string;
  objectId: string;
  enabled: boolean;
  priority: number; // Higher priority constraints override lower ones
}

/**
 * Pin constraint - pins an anchor point to a target
 */
export interface PinConstraint extends BaseConstraint {
  type: 'pin';
  sourceAnchor: AnchorPoint;
  target: ConstraintTarget;
  targetAnchor: AnchorPoint;
  offsetX: number;
  offsetY: number;
}

/**
 * Distance constraint - maintains distance between objects
 */
export interface DistanceConstraint extends BaseConstraint {
  type: 'distance';
  target: ConstraintTarget;
  axis: ConstraintAxis;
  distance: number;
  minDistance?: number;
  maxDistance?: number;
}

/**
 * Size constraint - controls element dimensions
 */
export interface SizeConstraint extends BaseConstraint {
  type: 'size';
  axis: 'width' | 'height' | 'both';
  mode: SizeMode;
  value: number; // Fixed size, percentage, or aspect ratio
  minValue?: number;
  maxValue?: number;
}

/**
 * Alignment constraint - aligns with other elements
 */
export interface AlignConstraint extends BaseConstraint {
  type: 'align';
  targets: ConstraintTarget[];
  alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute';
}

/**
 * Margin constraint - maintains margins from parent/viewport
 */
export interface MarginConstraint extends BaseConstraint {
  type: 'margin';
  target: ConstraintTarget;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Aspect ratio constraint
 */
export interface AspectRatioConstraint extends BaseConstraint {
  type: 'aspectRatio';
  ratio: number; // width / height
  lockToSource: boolean; // If true, uses original aspect ratio
}

/**
 * Chain constraint - links multiple objects in a chain
 */
export interface ChainConstraint extends BaseConstraint {
  type: 'chain';
  objectIds: string[];
  axis: 'horizontal' | 'vertical';
  spacing: number;
  spreadMode: 'packed' | 'spread' | 'spread-inside';
}

/**
 * Union of all constraint types
 */
export type Constraint =
  | PinConstraint
  | DistanceConstraint
  | SizeConstraint
  | AlignConstraint
  | MarginConstraint
  | AspectRatioConstraint
  | ChainConstraint;

/**
 * Constraint type discriminator
 */
export type ConstraintType = Constraint['type'];

/**
 * Resolved layout values after constraint solving
 */
export interface ResolvedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Constraint solver result
 */
export interface ConstraintSolverResult {
  layouts: Map<string, ResolvedLayout>;
  errors: ConstraintError[];
  iterations: number;
  converged: boolean;
}

/**
 * Constraint error information
 */
export interface ConstraintError {
  constraintId: string;
  objectId: string;
  message: string;
  severity: 'warning' | 'error';
}

/**
 * Bounds for constraint solving
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Object data required for constraint solving
 */
export interface ConstraintObjectData {
  id: string;
  bounds: Bounds;
  parentId?: string;
  children?: string[];
  intrinsicWidth?: number;
  intrinsicHeight?: number;
}

/**
 * Viewport/container bounds for constraint solving
 */
export interface ViewportBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/**
 * Constraint set for an object
 */
export interface ObjectConstraints {
  objectId: string;
  constraints: Constraint[];
  horizontalBias: number; // 0-1, used when constraints conflict
  verticalBias: number;   // 0-1, used when constraints conflict
}

/**
 * Preset constraint configurations
 */
export type ConstraintPreset =
  | 'pin-top-left'
  | 'pin-top-right'
  | 'pin-bottom-left'
  | 'pin-bottom-right'
  | 'pin-center'
  | 'fill-parent'
  | 'fill-width'
  | 'fill-height'
  | 'center-horizontal'
  | 'center-vertical'
  | 'center-both';

/**
 * Factory functions for creating constraints
 */
export function createPinConstraint(
  objectId: string,
  sourceAnchor: AnchorPoint,
  target: ConstraintTarget,
  targetAnchor: AnchorPoint,
  offsetX = 0,
  offsetY = 0
): PinConstraint {
  return {
    id: `pin-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'pin',
    sourceAnchor,
    target,
    targetAnchor,
    offsetX,
    offsetY,
  };
}

export function createSizeConstraint(
  objectId: string,
  axis: 'width' | 'height' | 'both',
  mode: SizeMode,
  value: number
): SizeConstraint {
  return {
    id: `size-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'size',
    axis,
    mode,
    value,
  };
}

export function createMarginConstraint(
  objectId: string,
  target: ConstraintTarget,
  margins: { top?: number; right?: number; bottom?: number; left?: number }
): MarginConstraint {
  return {
    id: `margin-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'margin',
    target,
    ...margins,
  };
}

export function createDistanceConstraint(
  objectId: string,
  target: ConstraintTarget,
  axis: ConstraintAxis,
  distance: number
): DistanceConstraint {
  return {
    id: `distance-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'distance',
    target,
    axis,
    distance,
  };
}

export function createAlignConstraint(
  objectId: string,
  targets: ConstraintTarget[],
  alignment: AlignConstraint['alignment']
): AlignConstraint {
  return {
    id: `align-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'align',
    targets,
    alignment,
  };
}

export function createAspectRatioConstraint(
  objectId: string,
  ratio: number,
  lockToSource = false
): AspectRatioConstraint {
  return {
    id: `aspect-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId,
    enabled: true,
    priority: 1,
    type: 'aspectRatio',
    ratio,
    lockToSource,
  };
}

export function createChainConstraint(
  objectIds: string[],
  axis: 'horizontal' | 'vertical',
  spacing: number,
  spreadMode: ChainConstraint['spreadMode'] = 'packed'
): ChainConstraint {
  const primaryObjectId = objectIds[0] || '';
  return {
    id: `chain-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    objectId: primaryObjectId,
    enabled: true,
    priority: 1,
    type: 'chain',
    objectIds,
    axis,
    spacing,
    spreadMode,
  };
}

/**
 * Get anchor point coordinates relative to bounds
 */
export function getAnchorPosition(
  bounds: Bounds,
  anchor: AnchorPoint
): { x: number; y: number } {
  const { x, y, width, height } = bounds;

  switch (anchor) {
    case 'top-left':
      return { x, y };
    case 'top-center':
      return { x: x + width / 2, y };
    case 'top-right':
      return { x: x + width, y };
    case 'center-left':
      return { x, y: y + height / 2 };
    case 'center':
      return { x: x + width / 2, y: y + height / 2 };
    case 'center-right':
      return { x: x + width, y: y + height / 2 };
    case 'bottom-left':
      return { x, y: y + height };
    case 'bottom-center':
      return { x: x + width / 2, y: y + height };
    case 'bottom-right':
      return { x: x + width, y: y + height };
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

/**
 * Apply anchor offset to get new position
 */
export function applyAnchorOffset(
  position: { x: number; y: number },
  anchor: AnchorPoint,
  width: number,
  height: number
): { x: number; y: number } {
  let offsetX = 0;
  let offsetY = 0;

  // Horizontal offset
  if (anchor.includes('left')) {
    offsetX = 0;
  } else if (anchor.includes('right')) {
    offsetX = -width;
  } else {
    offsetX = -width / 2;
  }

  // Vertical offset
  if (anchor.includes('top')) {
    offsetY = 0;
  } else if (anchor.includes('bottom')) {
    offsetY = -height;
  } else {
    offsetY = -height / 2;
  }

  return {
    x: position.x + offsetX,
    y: position.y + offsetY,
  };
}
