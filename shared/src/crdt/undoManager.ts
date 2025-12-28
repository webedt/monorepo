/**
 * Undo Manager
 *
 * Implements undo/redo functionality using the CRDT pattern where
 * undo operations are NEW FORWARD OPERATIONS that apply inverse changes.
 *
 * Key principles:
 * 1. Undo never deletes operations from history
 * 2. Undo creates a new operation that applies the inverse transformation
 * 3. Operations are always additive (append-only log)
 * 4. This enables conflict-free replication of undo operations
 *
 * Benefits of this approach:
 * - Works seamlessly in distributed/collaborative environments
 * - Full operation history is preserved
 * - Undo operations can be replicated like any other operation
 * - No need for special handling of undo at the network layer
 */

import type { CRDTConfig } from './types.js';
import type { LamportTimestamp } from './types.js';
import type { Operation } from './types.js';
import type { OperationId } from './types.js';
import type { ReplicaId } from './types.js';
import type { UndoEntry } from './types.js';
import type { UndoRedoState } from './types.js';
import type { VectorClock } from './types.js';

import { DocumentStateManager } from './documentState.js';
import { canCollapseOperations, collapseOperations, generateInverseOperation, incrementTimestamp, incrementVectorClock } from './inverseGenerator.js';

/**
 * Configuration for undo behavior
 */
export interface UndoConfig {
  /** Maximum number of operations in undo stack */
  maxUndoStackSize: number;
  /** Whether to collapse consecutive similar operations */
  collapseConsecutive: boolean;
  /** Time window (ms) for collapsing consecutive operations */
  collapseWindowMs: number;
  /** Paths that should be excluded from undo tracking */
  excludedPaths: string[];
}

/**
 * Default undo configuration
 */
export const DEFAULT_UNDO_CONFIG: UndoConfig = {
  maxUndoStackSize: 100,
  collapseConsecutive: true,
  collapseWindowMs: 500,
  excludedPaths: [],
};

/**
 * Event emitted when undo/redo state changes
 */
export interface UndoStateChangeEvent {
  type: 'push' | 'undo' | 'redo' | 'clear';
  canUndo: boolean;
  canRedo: boolean;
  undoDescription: string | null;
  redoDescription: string | null;
}

/**
 * Listener for undo state changes
 */
export type UndoStateChangeListener = (event: UndoStateChangeEvent) => void;

/**
 * Undo Manager
 *
 * Manages undo/redo stacks and generates forward operations for undo actions.
 */
export class UndoManager {
  private state: UndoRedoState;
  private config: UndoConfig;
  private replicaId: ReplicaId;
  private currentTimestamp: LamportTimestamp;
  private currentVectorClock: VectorClock;
  private documentManager: DocumentStateManager;
  private listeners: Set<UndoStateChangeListener> = new Set();
  private lastOperationTime: number = 0;

  constructor(
    replicaId: ReplicaId,
    documentManager: DocumentStateManager,
    config: Partial<UndoConfig> = {}
  ) {
    this.replicaId = replicaId;
    this.documentManager = documentManager;
    this.config = { ...DEFAULT_UNDO_CONFIG, ...config };
    this.state = {
      undoStack: [],
      redoStack: [],
      maxStackSize: this.config.maxUndoStackSize,
    };
    this.currentTimestamp = { counter: 0, replicaId };
    this.currentVectorClock = { [replicaId]: 0 };
  }

  /**
   * Subscribe to undo state changes
   */
  subscribe(listener: UndoStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a state change event
   */
  private emitStateChange(type: UndoStateChangeEvent['type']): void {
    const event: UndoStateChangeEvent = {
      type,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoDescription: this.getUndoDescription(),
      redoDescription: this.getRedoDescription(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Update clocks from an external operation
   */
  updateClocks(operation: Operation): void {
    // Update Lamport timestamp
    const opCounter = operation.metadata.timestamp.counter;
    if (opCounter >= this.currentTimestamp.counter) {
      this.currentTimestamp = {
        counter: opCounter + 1,
        replicaId: this.replicaId,
      };
    }

    // Update vector clock
    for (const [replica, counter] of Object.entries(operation.metadata.vectorClock)) {
      this.currentVectorClock[replica] = Math.max(
        this.currentVectorClock[replica] || 0,
        counter
      );
    }
  }

  /**
   * Check if an operation should be tracked for undo
   *
   * Note: Inverse operations (undos) ARE tracked because they are forward
   * operations in our CRDT model. This allows other replicas to undo the undo
   * if needed, which is essential for collaborative editing.
   */
  private shouldTrack(operation: Operation): boolean {
    const payload = operation.payload;

    // Check path exclusions
    if ('path' in payload) {
      for (const excluded of this.config.excludedPaths) {
        if (payload.path.startsWith(excluded)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Record an operation for potential undo
   *
   * This should be called after an operation is successfully applied.
   * It creates an undo entry with the inverse operation ready to be applied.
   */
  recordOperation(operation: Operation, description?: string): void {
    if (!this.shouldTrack(operation)) {
      return;
    }

    // First, synchronize our clocks with the operation's clocks
    // This ensures the inverse operation has a higher clock than both
    // the original operation and the document state
    this.updateClocks(operation);

    const now = Date.now();

    // Check if we can collapse with the previous operation
    if (
      this.config.collapseConsecutive &&
      this.state.undoStack.length > 0 &&
      now - this.lastOperationTime < this.config.collapseWindowMs
    ) {
      const lastEntry = this.state.undoStack[this.state.undoStack.length - 1];

      // For collapsing, we need to check the original operations, not the inverses
      // This is a simplification - full implementation would track original ops
      if (canCollapseOperations(lastEntry.inverseOperation, operation)) {
        // Update the last entry's inverse to include both operations
        const collapsedOp = collapseOperations(
          lastEntry.inverseOperation,
          operation,
          {
            replicaId: this.replicaId,
            currentTimestamp: this.currentTimestamp,
            currentVectorClock: this.currentVectorClock,
          }
        );

        // Regenerate inverse for the collapsed operation
        const result = generateInverseOperation(collapsedOp, {
          replicaId: this.replicaId,
          currentTimestamp: this.currentTimestamp,
          currentVectorClock: this.currentVectorClock,
        });

        lastEntry.inverseOperation = result.inverseOperation;
        lastEntry.description = description || result.description;
        this.currentTimestamp = result.newTimestamp;
        this.currentVectorClock = result.newVectorClock;
        this.lastOperationTime = now;
        return;
      }
    }

    // Generate the inverse operation
    const result = generateInverseOperation(operation, {
      replicaId: this.replicaId,
      currentTimestamp: this.currentTimestamp,
      currentVectorClock: this.currentVectorClock,
    });

    // Create the undo entry
    const entry: UndoEntry = {
      originalOperationId: operation.metadata.id,
      inverseOperation: result.inverseOperation,
      description: description || result.description,
      performedAt: now,
    };

    // Add to undo stack
    this.state.undoStack.push(entry);

    // Trim stack if needed
    while (this.state.undoStack.length > this.state.maxStackSize) {
      this.state.undoStack.shift();
    }

    // Clear redo stack (new operation invalidates redo history)
    this.state.redoStack = [];

    // Update clocks
    this.currentTimestamp = result.newTimestamp;
    this.currentVectorClock = result.newVectorClock;
    this.lastOperationTime = now;

    this.emitStateChange('push');
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.state.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.state.redoStack.length > 0;
  }

  /**
   * Get the description of what undo will do
   */
  getUndoDescription(): string | null {
    if (this.state.undoStack.length === 0) {
      return null;
    }
    return this.state.undoStack[this.state.undoStack.length - 1].description;
  }

  /**
   * Get the description of what redo will do
   */
  getRedoDescription(): string | null {
    if (this.state.redoStack.length === 0) {
      return null;
    }
    return this.state.redoStack[this.state.redoStack.length - 1].description;
  }

  /**
   * Perform an undo operation
   *
   * Returns the inverse operation that should be applied and broadcast.
   * The returned operation IS a forward operation - it's a new operation
   * that applies the inverse changes.
   */
  undo(): Operation | null {
    if (!this.canUndo()) {
      return null;
    }

    // Pop from undo stack
    const entry = this.state.undoStack.pop()!;

    // The inverse operation payload is ready, but we need fresh clocks
    // to ensure the operation is not considered a no-op by vector clock checks
    const newTimestamp = incrementTimestamp(this.currentTimestamp, this.replicaId);
    const newVectorClock = incrementVectorClock(this.currentVectorClock, this.replicaId);

    // Create the undo operation with updated clocks
    const undoOperation: Operation = {
      metadata: {
        ...entry.inverseOperation.metadata,
        timestamp: newTimestamp,
        vectorClock: newVectorClock,
      },
      payload: entry.inverseOperation.payload,
    };

    // Update our clocks
    this.currentTimestamp = newTimestamp;
    this.currentVectorClock = newVectorClock;

    // Apply the undo operation to our document manager
    this.documentManager.applyOperation(undoOperation);

    // Create a redo entry (inverse of the undo, which is the original operation effect)
    const redoResult = generateInverseOperation(undoOperation, {
      replicaId: this.replicaId,
      currentTimestamp: this.currentTimestamp,
      currentVectorClock: this.currentVectorClock,
    });

    // Push to redo stack
    this.state.redoStack.push({
      originalOperationId: undoOperation.metadata.id,
      inverseOperation: redoResult.inverseOperation,
      description: `Redo: ${entry.description.replace(/^Undo /, '')}`,
      performedAt: Date.now(),
    });

    // Trim redo stack if needed
    while (this.state.redoStack.length > this.state.maxStackSize) {
      this.state.redoStack.shift();
    }

    // Update clocks
    this.currentTimestamp = redoResult.newTimestamp;
    this.currentVectorClock = redoResult.newVectorClock;

    this.emitStateChange('undo');

    // Return the operation to be broadcast to other replicas
    return undoOperation;
  }

  /**
   * Perform a redo operation
   *
   * Returns the forward operation that should be applied and broadcast.
   */
  redo(): Operation | null {
    if (!this.canRedo()) {
      return null;
    }

    // Pop from redo stack
    const entry = this.state.redoStack.pop()!;

    // The redo operation payload is ready, but we need fresh clocks
    // to ensure the operation is not considered a no-op by vector clock checks
    const newTimestamp = incrementTimestamp(this.currentTimestamp, this.replicaId);
    const newVectorClock = incrementVectorClock(this.currentVectorClock, this.replicaId);

    // Create the redo operation with updated clocks
    const redoOperation: Operation = {
      metadata: {
        ...entry.inverseOperation.metadata,
        timestamp: newTimestamp,
        vectorClock: newVectorClock,
      },
      payload: entry.inverseOperation.payload,
    };

    // Update our clocks
    this.currentTimestamp = newTimestamp;
    this.currentVectorClock = newVectorClock;

    // Apply the redo operation to our document manager
    this.documentManager.applyOperation(redoOperation);

    // Create an undo entry for this redo
    const undoResult = generateInverseOperation(redoOperation, {
      replicaId: this.replicaId,
      currentTimestamp: this.currentTimestamp,
      currentVectorClock: this.currentVectorClock,
    });

    // Push to undo stack
    this.state.undoStack.push({
      originalOperationId: redoOperation.metadata.id,
      inverseOperation: undoResult.inverseOperation,
      description: entry.description.replace(/^Redo: /, ''),
      performedAt: Date.now(),
    });

    // Trim undo stack if needed
    while (this.state.undoStack.length > this.state.maxStackSize) {
      this.state.undoStack.shift();
    }

    // Update clocks
    this.currentTimestamp = undoResult.newTimestamp;
    this.currentVectorClock = undoResult.newVectorClock;

    this.emitStateChange('redo');

    // Return the operation to be broadcast to other replicas
    return redoOperation;
  }

  /**
   * Clear all undo/redo history
   */
  clear(): void {
    this.state.undoStack = [];
    this.state.redoStack = [];
    this.emitStateChange('clear');
  }

  /**
   * Get the current undo/redo state
   */
  getState(): UndoRedoState {
    return {
      ...this.state,
      undoStack: [...this.state.undoStack],
      redoStack: [...this.state.redoStack],
    };
  }

  /**
   * Get the number of operations in the undo stack
   */
  getUndoCount(): number {
    return this.state.undoStack.length;
  }

  /**
   * Get the number of operations in the redo stack
   */
  getRedoCount(): number {
    return this.state.redoStack.length;
  }

  /**
   * Get current clocks
   */
  getCurrentClocks(): { timestamp: LamportTimestamp; vectorClock: VectorClock } {
    return {
      timestamp: { ...this.currentTimestamp },
      vectorClock: { ...this.currentVectorClock },
    };
  }

  /**
   * Handle an incoming remote operation
   *
   * This updates clocks and potentially adjusts undo stack if needed
   */
  handleRemoteOperation(operation: Operation): void {
    // Update our clocks
    this.updateClocks(operation);

    // Apply the operation
    this.documentManager.applyOperation(operation);

    // If this is an undo operation from another replica, we might need
    // to adjust our undo stack to maintain consistency
    if (operation.metadata.isInverse && operation.metadata.inverseOf) {
      this.handleRemoteUndo(operation);
    }
  }

  /**
   * Handle a remote undo operation
   *
   * When another replica undoes an operation, we need to update our
   * local undo stack if we had that operation recorded.
   */
  private handleRemoteUndo(undoOperation: Operation): void {
    const undoneId = undoOperation.metadata.inverseOf;
    if (!undoneId) return;

    // Remove the undone operation from our undo stack if present
    const undoIndex = this.state.undoStack.findIndex(
      (entry) => entry.originalOperationId === undoneId
    );

    if (undoIndex !== -1) {
      // Remove it - the remote undo takes precedence
      this.state.undoStack.splice(undoIndex, 1);
      this.emitStateChange('push'); // Signal state change
    }
  }

  /**
   * Create a checkpoint/savepoint
   *
   * Returns an ID that can be used to undo back to this point
   */
  createCheckpoint(): string {
    const checkpointId = `checkpoint-${Date.now()}-${this.replicaId}`;
    // We could store checkpoint metadata here if needed
    return checkpointId;
  }

  /**
   * Get all undo operations since a checkpoint
   *
   * Returns the operations needed to undo back to the checkpoint
   */
  getOperationsSinceCheckpoint(
    checkpointId: string
  ): Operation[] | null {
    // Extract timestamp from checkpoint ID
    const match = checkpointId.match(/^checkpoint-(\d+)-/);
    if (!match) {
      return null;
    }

    const checkpointTime = parseInt(match[1], 10);

    // Find all operations after the checkpoint
    const entriesToUndo = this.state.undoStack.filter(
      (entry) => entry.performedAt > checkpointTime
    );

    // Return inverse operations in reverse order
    return entriesToUndo
      .reverse()
      .map((entry) => entry.inverseOperation);
  }
}

/**
 * Create an undo manager with default configuration
 */
export function createUndoManager(
  replicaId: ReplicaId,
  documentManager: DocumentStateManager,
  config?: Partial<CRDTConfig & UndoConfig>
): UndoManager {
  return new UndoManager(replicaId, documentManager, {
    maxUndoStackSize: config?.maxUndoStackSize ?? DEFAULT_UNDO_CONFIG.maxUndoStackSize,
    collapseConsecutive: config?.collapseConsecutive ?? DEFAULT_UNDO_CONFIG.collapseConsecutive,
    collapseWindowMs: config?.collapseWindowMs ?? DEFAULT_UNDO_CONFIG.collapseWindowMs,
    excludedPaths: config?.excludedPaths ?? DEFAULT_UNDO_CONFIG.excludedPaths,
  });
}
