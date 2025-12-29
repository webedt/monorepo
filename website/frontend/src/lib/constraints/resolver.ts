/**
 * Constraint Resolver
 *
 * Solves constraint equations to compute layout positions.
 * Uses an iterative approach to resolve interdependent constraints.
 */

import type {
  Constraint,
  ConstraintObjectData,
  ConstraintSolverResult,
  ConstraintError,
  ResolvedLayout,
  ViewportBounds,
  Bounds,
  PinConstraint,
  SizeConstraint,
  MarginConstraint,
  DistanceConstraint,
  AlignConstraint,
  AspectRatioConstraint,
  ChainConstraint,
  ConstraintTarget,
} from './types.js';
import { getAnchorPosition, applyAnchorOffset } from './types.js';

/**
 * Solver configuration options
 */
export interface SolverOptions {
  maxIterations: number;
  tolerance: number;
  relaxationFactor: number;
}

const DEFAULT_OPTIONS: SolverOptions = {
  maxIterations: 50,
  tolerance: 0.01,
  relaxationFactor: 0.5,
};

/**
 * Internal state for constraint solving
 */
interface SolverState {
  layouts: Map<string, ResolvedLayout>;
  objects: Map<string, ConstraintObjectData>;
  constraints: Map<string, Constraint[]>;
  viewport: ViewportBounds;
  errors: ConstraintError[];
}

/**
 * Constraint Resolver class
 */
export class ConstraintResolver {
  private options: SolverOptions;

  constructor(options: Partial<SolverOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Solve all constraints and return resolved layouts
   */
  solve(
    objects: ConstraintObjectData[],
    constraints: Constraint[],
    viewport: ViewportBounds
  ): ConstraintSolverResult {
    // Initialize state
    const state: SolverState = {
      layouts: new Map(),
      objects: new Map(),
      constraints: new Map(),
      viewport,
      errors: [],
    };

    // Build object map and initialize layouts
    for (const obj of objects) {
      state.objects.set(obj.id, obj);
      state.layouts.set(obj.id, this.boundsToLayout(obj.bounds));
    }

    // Group constraints by object
    for (const constraint of constraints) {
      if (!constraint.enabled) continue;

      const existing = state.constraints.get(constraint.objectId) || [];
      existing.push(constraint);
      state.constraints.set(constraint.objectId, existing);

      // Handle chain constraints (they affect multiple objects)
      if (constraint.type === 'chain') {
        for (const objId of constraint.objectIds) {
          if (objId !== constraint.objectId) {
            const objConstraints = state.constraints.get(objId) || [];
            objConstraints.push(constraint);
            state.constraints.set(objId, objConstraints);
          }
        }
      }
    }

    // Iterative solving
    let converged = false;
    let iterations = 0;

    while (iterations < this.options.maxIterations && !converged) {
      const previousLayouts = this.cloneLayouts(state.layouts);

      // Apply constraints in priority order
      this.applyConstraints(state);

      // Check for convergence
      converged = this.checkConvergence(previousLayouts, state.layouts);
      iterations++;
    }

    return {
      layouts: state.layouts,
      errors: state.errors,
      iterations,
      converged,
    };
  }

  /**
   * Apply all constraints to update layouts
   */
  private applyConstraints(state: SolverState): void {
    // Sort constraints by priority (higher first)
    const allConstraints: Array<{ objectId: string; constraint: Constraint }> = [];

    for (const [objectId, constraints] of state.constraints) {
      for (const constraint of constraints) {
        allConstraints.push({ objectId, constraint });
      }
    }

    allConstraints.sort((a, b) => b.constraint.priority - a.constraint.priority);

    // Apply each constraint
    for (const { objectId, constraint } of allConstraints) {
      const layout = state.layouts.get(objectId);
      if (!layout) continue;

      try {
        this.applyConstraint(state, objectId, constraint, layout);
      } catch (error) {
        state.errors.push({
          constraintId: constraint.id,
          objectId,
          message: error instanceof Error ? error.message : 'Unknown error',
          severity: 'error',
        });
      }
    }
  }

  /**
   * Apply a single constraint
   */
  private applyConstraint(
    state: SolverState,
    objectId: string,
    constraint: Constraint,
    layout: ResolvedLayout
  ): void {
    switch (constraint.type) {
      case 'pin':
        this.applyPinConstraint(state, objectId, constraint, layout);
        break;
      case 'size':
        this.applySizeConstraint(state, objectId, constraint, layout);
        break;
      case 'margin':
        this.applyMarginConstraint(state, objectId, constraint, layout);
        break;
      case 'distance':
        this.applyDistanceConstraint(state, objectId, constraint, layout);
        break;
      case 'align':
        this.applyAlignConstraint(state, objectId, constraint, layout);
        break;
      case 'aspectRatio':
        this.applyAspectRatioConstraint(state, objectId, constraint, layout);
        break;
      case 'chain':
        this.applyChainConstraint(state, constraint);
        break;
    }
  }

  /**
   * Apply pin constraint
   */
  private applyPinConstraint(
    state: SolverState,
    objectId: string,
    constraint: PinConstraint,
    layout: ResolvedLayout
  ): void {
    const targetBounds = this.getTargetBounds(state, objectId, constraint.target);
    if (!targetBounds) return;

    // Get anchor position on target
    const targetPos = getAnchorPosition(targetBounds, constraint.targetAnchor);

    // Apply offset
    const pinnedPos = {
      x: targetPos.x + constraint.offsetX,
      y: targetPos.y + constraint.offsetY,
    };

    // Calculate new position based on source anchor
    const newPos = applyAnchorOffset(
      pinnedPos,
      constraint.sourceAnchor,
      layout.width,
      layout.height
    );

    // Blend with relaxation factor for stability
    layout.x = this.blend(layout.x, newPos.x);
    layout.y = this.blend(layout.y, newPos.y);
  }

  /**
   * Apply size constraint
   */
  private applySizeConstraint(
    state: SolverState,
    objectId: string,
    constraint: SizeConstraint,
    layout: ResolvedLayout
  ): void {
    const object = state.objects.get(objectId);
    const parentBounds = this.getParentBounds(state, objectId);

    let newWidth = layout.width;
    let newHeight = layout.height;

    const calculateSize = (
      axis: 'width' | 'height',
      currentValue: number,
      parentValue: number
    ): number => {
      switch (constraint.mode) {
        case 'fixed':
          return constraint.value;
        case 'percentage':
          return (constraint.value / 100) * parentValue;
        case 'fill':
          return parentValue;
        case 'hug':
          // Use intrinsic size if available
          if (axis === 'width' && object?.intrinsicWidth) {
            return object.intrinsicWidth;
          }
          if (axis === 'height' && object?.intrinsicHeight) {
            return object.intrinsicHeight;
          }
          return currentValue;
        case 'aspect':
          // Handled by aspect ratio constraint
          return currentValue;
        default:
          return currentValue;
      }
    };

    if (constraint.axis === 'width' || constraint.axis === 'both') {
      newWidth = calculateSize('width', layout.width, parentBounds.width);
      if (constraint.minValue !== undefined) {
        newWidth = Math.max(newWidth, constraint.minValue);
      }
      if (constraint.maxValue !== undefined) {
        newWidth = Math.min(newWidth, constraint.maxValue);
      }
    }

    if (constraint.axis === 'height' || constraint.axis === 'both') {
      newHeight = calculateSize('height', layout.height, parentBounds.height);
      if (constraint.minValue !== undefined) {
        newHeight = Math.max(newHeight, constraint.minValue);
      }
      if (constraint.maxValue !== undefined) {
        newHeight = Math.min(newHeight, constraint.maxValue);
      }
    }

    layout.width = this.blend(layout.width, newWidth);
    layout.height = this.blend(layout.height, newHeight);
  }

  /**
   * Apply margin constraint
   */
  private applyMarginConstraint(
    state: SolverState,
    objectId: string,
    constraint: MarginConstraint,
    layout: ResolvedLayout
  ): void {
    const targetBounds = this.getTargetBounds(state, objectId, constraint.target);
    if (!targetBounds) return;

    // Calculate available space after margins
    const availableLeft = targetBounds.x + (constraint.left ?? 0);
    const availableTop = targetBounds.y + (constraint.top ?? 0);
    const availableRight = targetBounds.x + targetBounds.width - (constraint.right ?? 0);
    const availableBottom = targetBounds.y + targetBounds.height - (constraint.bottom ?? 0);

    // If we have opposing margins, stretch the element
    if (constraint.left !== undefined && constraint.right !== undefined) {
      layout.x = this.blend(layout.x, availableLeft);
      layout.width = this.blend(layout.width, availableRight - availableLeft);
    } else if (constraint.left !== undefined) {
      layout.x = this.blend(layout.x, availableLeft);
    } else if (constraint.right !== undefined) {
      layout.x = this.blend(layout.x, availableRight - layout.width);
    }

    if (constraint.top !== undefined && constraint.bottom !== undefined) {
      layout.y = this.blend(layout.y, availableTop);
      layout.height = this.blend(layout.height, availableBottom - availableTop);
    } else if (constraint.top !== undefined) {
      layout.y = this.blend(layout.y, availableTop);
    } else if (constraint.bottom !== undefined) {
      layout.y = this.blend(layout.y, availableBottom - layout.height);
    }
  }

  /**
   * Apply distance constraint
   */
  private applyDistanceConstraint(
    state: SolverState,
    objectId: string,
    constraint: DistanceConstraint,
    layout: ResolvedLayout
  ): void {
    const targetBounds = this.getTargetBounds(state, objectId, constraint.target);
    if (!targetBounds) return;

    const objectBounds = this.layoutToBounds(layout);
    const targetCenter = {
      x: targetBounds.x + targetBounds.width / 2,
      y: targetBounds.y + targetBounds.height / 2,
    };
    const objectCenter = {
      x: objectBounds.x + objectBounds.width / 2,
      y: objectBounds.y + objectBounds.height / 2,
    };

    // Calculate current distance
    const dx = objectCenter.x - targetCenter.x;
    const dy = objectCenter.y - targetCenter.y;
    const currentDistance = Math.sqrt(dx * dx + dy * dy);

    if (currentDistance < 0.001) return; // Avoid division by zero

    // Calculate desired distance
    let desiredDistance = constraint.distance;
    if (constraint.minDistance !== undefined) {
      desiredDistance = Math.max(desiredDistance, constraint.minDistance);
    }
    if (constraint.maxDistance !== undefined) {
      desiredDistance = Math.min(desiredDistance, constraint.maxDistance);
    }

    // Calculate new position
    const scale = desiredDistance / currentDistance;
    let newX = layout.x;
    let newY = layout.y;

    if (constraint.axis === 'horizontal' || constraint.axis === 'both') {
      newX = targetCenter.x + dx * scale - layout.width / 2;
    }
    if (constraint.axis === 'vertical' || constraint.axis === 'both') {
      newY = targetCenter.y + dy * scale - layout.height / 2;
    }

    layout.x = this.blend(layout.x, newX);
    layout.y = this.blend(layout.y, newY);
  }

  /**
   * Apply alignment constraint
   */
  private applyAlignConstraint(
    state: SolverState,
    objectId: string,
    constraint: AlignConstraint,
    layout: ResolvedLayout
  ): void {
    if (constraint.targets.length === 0) return;

    // Collect all target bounds
    const targetBoundsList: Bounds[] = [];
    for (const target of constraint.targets) {
      const bounds = this.getTargetBounds(state, objectId, target);
      if (bounds) {
        targetBoundsList.push(bounds);
      }
    }

    if (targetBoundsList.length === 0) return;

    // Calculate alignment reference
    let alignValue: number;

    switch (constraint.alignment) {
      case 'left':
        alignValue = Math.min(...targetBoundsList.map(b => b.x));
        layout.x = this.blend(layout.x, alignValue);
        break;
      case 'center':
        alignValue =
          targetBoundsList.reduce((sum, b) => sum + b.x + b.width / 2, 0) /
          targetBoundsList.length;
        layout.x = this.blend(layout.x, alignValue - layout.width / 2);
        break;
      case 'right':
        alignValue = Math.max(...targetBoundsList.map(b => b.x + b.width));
        layout.x = this.blend(layout.x, alignValue - layout.width);
        break;
      case 'top':
        alignValue = Math.min(...targetBoundsList.map(b => b.y));
        layout.y = this.blend(layout.y, alignValue);
        break;
      case 'middle':
        alignValue =
          targetBoundsList.reduce((sum, b) => sum + b.y + b.height / 2, 0) /
          targetBoundsList.length;
        layout.y = this.blend(layout.y, alignValue - layout.height / 2);
        break;
      case 'bottom':
        alignValue = Math.max(...targetBoundsList.map(b => b.y + b.height));
        layout.y = this.blend(layout.y, alignValue - layout.height);
        break;
      case 'distribute':
        // Distribute is handled by chain constraint
        break;
    }
  }

  /**
   * Apply aspect ratio constraint
   */
  private applyAspectRatioConstraint(
    state: SolverState,
    objectId: string,
    constraint: AspectRatioConstraint,
    layout: ResolvedLayout
  ): void {
    const object = state.objects.get(objectId);

    let ratio = constraint.ratio;
    if (constraint.lockToSource && object?.intrinsicWidth && object?.intrinsicHeight) {
      ratio = object.intrinsicWidth / object.intrinsicHeight;
    }

    // Determine which dimension to adjust
    const currentRatio = layout.width / layout.height;

    if (Math.abs(currentRatio - ratio) > this.options.tolerance) {
      // Keep the larger dimension, adjust the smaller
      if (currentRatio > ratio) {
        // Too wide, reduce width
        layout.width = this.blend(layout.width, layout.height * ratio);
      } else {
        // Too tall, reduce height
        layout.height = this.blend(layout.height, layout.width / ratio);
      }
    }
  }

  /**
   * Apply chain constraint (affects multiple objects)
   */
  private applyChainConstraint(state: SolverState, constraint: ChainConstraint): void {
    const objectIds = constraint.objectIds.filter(id => state.layouts.has(id));
    if (objectIds.length < 2) return;

    // Get parent bounds for chain positioning
    const firstObjectId = objectIds[0];
    const parentBounds = this.getParentBounds(state, firstObjectId);

    // Calculate total content size
    let totalSize = 0;
    const layouts: ResolvedLayout[] = [];

    for (const id of objectIds) {
      const layout = state.layouts.get(id)!;
      layouts.push(layout);
      totalSize += constraint.axis === 'horizontal' ? layout.width : layout.height;
    }

    // Calculate available space and spacing
    const availableSpace =
      constraint.axis === 'horizontal' ? parentBounds.width : parentBounds.height;
    const contentSpace = totalSize;
    const totalSpacing = constraint.spacing * (objectIds.length - 1);
    const remainingSpace = availableSpace - contentSpace - totalSpacing;

    // Position objects based on spread mode
    let currentPos =
      constraint.axis === 'horizontal' ? parentBounds.x : parentBounds.y;

    switch (constraint.spreadMode) {
      case 'packed':
        // Center the chain
        currentPos += remainingSpace / 2;
        break;
      case 'spread':
        // Spread evenly with equal space on edges
        currentPos += remainingSpace / (objectIds.length + 1);
        break;
      case 'spread-inside':
        // Spread with first and last at edges
        // Initial position stays at edge
        break;
    }

    // Position each object
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];

      if (constraint.axis === 'horizontal') {
        layout.x = this.blend(layout.x, currentPos);
        currentPos += layout.width;
      } else {
        layout.y = this.blend(layout.y, currentPos);
        currentPos += layout.height;
      }

      // Add spacing
      if (i < layouts.length - 1) {
        if (constraint.spreadMode === 'spread') {
          currentPos += remainingSpace / (objectIds.length + 1) + constraint.spacing;
        } else if (constraint.spreadMode === 'spread-inside') {
          const spreadSpacing =
            (remainingSpace + totalSpacing) / (objectIds.length - 1);
          currentPos += spreadSpacing;
        } else {
          currentPos += constraint.spacing;
        }
      }
    }
  }

  /**
   * Get bounds for a constraint target
   */
  private getTargetBounds(
    state: SolverState,
    objectId: string,
    target: ConstraintTarget
  ): Bounds | null {
    switch (target.type) {
      case 'parent':
        return this.getParentBounds(state, objectId);
      case 'viewport':
        return {
          x: state.viewport.x ?? 0,
          y: state.viewport.y ?? 0,
          width: state.viewport.width,
          height: state.viewport.height,
        };
      case 'object':
        const layout = state.layouts.get(target.objectId);
        return layout ? this.layoutToBounds(layout) : null;
    }
  }

  /**
   * Get parent bounds for an object
   */
  private getParentBounds(state: SolverState, objectId: string): Bounds {
    const object = state.objects.get(objectId);
    if (object?.parentId) {
      const parentLayout = state.layouts.get(object.parentId);
      if (parentLayout) {
        return this.layoutToBounds(parentLayout);
      }
    }
    // Default to viewport
    return {
      x: state.viewport.x ?? 0,
      y: state.viewport.y ?? 0,
      width: state.viewport.width,
      height: state.viewport.height,
    };
  }

  /**
   * Convert bounds to layout
   */
  private boundsToLayout(bounds: Bounds): ResolvedLayout {
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    };
  }

  /**
   * Convert layout to bounds
   */
  private layoutToBounds(layout: ResolvedLayout): Bounds {
    return {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    };
  }

  /**
   * Blend old and new values with relaxation factor
   */
  private blend(oldValue: number, newValue: number): number {
    return oldValue + (newValue - oldValue) * this.options.relaxationFactor;
  }

  /**
   * Clone layouts map
   */
  private cloneLayouts(
    layouts: Map<string, ResolvedLayout>
  ): Map<string, ResolvedLayout> {
    const cloned = new Map<string, ResolvedLayout>();
    for (const [id, layout] of layouts) {
      cloned.set(id, { ...layout });
    }
    return cloned;
  }

  /**
   * Check if layouts have converged
   */
  private checkConvergence(
    previous: Map<string, ResolvedLayout>,
    current: Map<string, ResolvedLayout>
  ): boolean {
    for (const [id, prevLayout] of previous) {
      const currLayout = current.get(id);
      if (!currLayout) continue;

      if (
        Math.abs(prevLayout.x - currLayout.x) > this.options.tolerance ||
        Math.abs(prevLayout.y - currLayout.y) > this.options.tolerance ||
        Math.abs(prevLayout.width - currLayout.width) > this.options.tolerance ||
        Math.abs(prevLayout.height - currLayout.height) > this.options.tolerance
      ) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Default resolver instance
 */
export const defaultResolver = new ConstraintResolver();

/**
 * Convenience function to solve constraints
 */
export function solveConstraints(
  objects: ConstraintObjectData[],
  constraints: Constraint[],
  viewport: ViewportBounds,
  options?: Partial<SolverOptions>
): ConstraintSolverResult {
  const resolver = options
    ? new ConstraintResolver(options)
    : defaultResolver;
  return resolver.solve(objects, constraints, viewport);
}
