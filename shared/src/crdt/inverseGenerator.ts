/**
 * Inverse Operation Generator
 *
 * This module generates inverse (undo) operations for any given operation.
 * The key insight is that undo operations are NOT reversals - they are new
 * forward operations that apply the inverse changes. This allows:
 *
 * 1. Operations to be commutative (order-independent in most cases)
 * 2. Undo to work in distributed systems without coordination
 * 3. Full history preservation (no operation is ever deleted)
 * 4. Conflict-free replication of undo operations
 */

import { randomUUID } from 'crypto';

import type { LamportTimestamp } from './types.js';
import type { Operation } from './types.js';
import type { OperationId } from './types.js';
import type { OperationMetadata } from './types.js';
import type { OperationPayload } from './types.js';
import type { ReplicaId } from './types.js';
import type { VectorClock } from './types.js';

/**
 * Context needed to generate inverse operations
 */
export interface InverseGenerationContext {
  /** The replica generating the inverse */
  replicaId: ReplicaId;
  /** Current Lamport timestamp */
  currentTimestamp: LamportTimestamp;
  /** Current vector clock */
  currentVectorClock: VectorClock;
}

/**
 * Result of inverse generation
 */
export interface InverseGenerationResult {
  /** The generated inverse operation */
  inverseOperation: Operation;
  /** Updated Lamport timestamp after generation */
  newTimestamp: LamportTimestamp;
  /** Updated vector clock after generation */
  newVectorClock: VectorClock;
  /** Human-readable description of the undo action */
  description: string;
}

/**
 * Generate a unique operation ID
 */
export function generateOperationId(): OperationId {
  return randomUUID();
}

/**
 * Increment a Lamport timestamp
 */
export function incrementTimestamp(
  timestamp: LamportTimestamp,
  replicaId: ReplicaId
): LamportTimestamp {
  return {
    counter: timestamp.counter + 1,
    replicaId,
  };
}

/**
 * Increment a vector clock for a specific replica
 */
export function incrementVectorClock(
  clock: VectorClock,
  replicaId: ReplicaId
): VectorClock {
  return {
    ...clock,
    [replicaId]: (clock[replicaId] || 0) + 1,
  };
}

/**
 * Generate the inverse payload for a text insert operation.
 * The inverse of inserting text is deleting that same text.
 */
function generateTextInsertInverse(
  payload: Extract<OperationPayload, { type: 'text_insert' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'text_delete',
      path: payload.path,
      position: payload.position,
      length: payload.content.length,
      deletedContent: payload.content,
    },
    description: `Undo insert of ${payload.content.length} characters at position ${payload.position}`,
  };
}

/**
 * Generate the inverse payload for a text delete operation.
 * The inverse of deleting text is inserting that same text back.
 */
function generateTextDeleteInverse(
  payload: Extract<OperationPayload, { type: 'text_delete' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'text_insert',
      path: payload.path,
      position: payload.position,
      content: payload.deletedContent,
    },
    description: `Undo delete of ${payload.length} characters at position ${payload.position}`,
  };
}

/**
 * Generate the inverse payload for a text replace operation.
 * The inverse of replacing text is replacing it back with the original.
 */
function generateTextReplaceInverse(
  payload: Extract<OperationPayload, { type: 'text_replace' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'text_replace',
      path: payload.path,
      position: payload.position,
      oldContent: payload.newContent,
      newContent: payload.oldContent,
    },
    description: `Undo replace at position ${payload.position}`,
  };
}

/**
 * Generate the inverse payload for a file create operation.
 * The inverse of creating a file is deleting it.
 */
function generateFileCreateInverse(
  payload: Extract<OperationPayload, { type: 'file_create' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'file_delete',
      path: payload.path,
      content: payload.content,
    },
    description: `Undo create file: ${payload.path}`,
  };
}

/**
 * Generate the inverse payload for a file delete operation.
 * The inverse of deleting a file is creating it back with original content.
 */
function generateFileDeleteInverse(
  payload: Extract<OperationPayload, { type: 'file_delete' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'file_create',
      path: payload.path,
      content: payload.content,
    },
    description: `Undo delete file: ${payload.path}`,
  };
}

/**
 * Generate the inverse payload for a file rename operation.
 * The inverse of renaming is renaming back.
 */
function generateFileRenameInverse(
  payload: Extract<OperationPayload, { type: 'file_rename' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'file_rename',
      oldPath: payload.newPath,
      newPath: payload.oldPath,
    },
    description: `Undo rename: ${payload.newPath} → ${payload.oldPath}`,
  };
}

/**
 * Generate the inverse payload for a property set operation.
 * The inverse is setting the property back to its old value.
 */
function generatePropertySetInverse(
  payload: Extract<OperationPayload, { type: 'property_set' }>
): { inverse: OperationPayload; description: string } {
  // If old value was undefined, the inverse is a delete
  if (payload.oldValue === undefined) {
    return {
      inverse: {
        type: 'property_delete',
        path: payload.path,
        key: payload.key,
        deletedValue: payload.newValue,
      },
      description: `Undo set property: ${payload.key}`,
    };
  }

  return {
    inverse: {
      type: 'property_set',
      path: payload.path,
      key: payload.key,
      oldValue: payload.newValue,
      newValue: payload.oldValue,
    },
    description: `Undo set property: ${payload.key}`,
  };
}

/**
 * Generate the inverse payload for a property delete operation.
 * The inverse is setting the property back to its deleted value.
 */
function generatePropertyDeleteInverse(
  payload: Extract<OperationPayload, { type: 'property_delete' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'property_set',
      path: payload.path,
      key: payload.key,
      oldValue: undefined,
      newValue: payload.deletedValue,
    },
    description: `Undo delete property: ${payload.key}`,
  };
}

/**
 * Generate the inverse payload for an array insert operation.
 * The inverse is deleting the inserted items.
 */
function generateArrayInsertInverse(
  payload: Extract<OperationPayload, { type: 'array_insert' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'array_delete',
      path: payload.path,
      index: payload.index,
      count: payload.items.length,
      deletedItems: payload.items,
    },
    description: `Undo insert ${payload.items.length} items at index ${payload.index}`,
  };
}

/**
 * Generate the inverse payload for an array delete operation.
 * The inverse is inserting the deleted items back.
 */
function generateArrayDeleteInverse(
  payload: Extract<OperationPayload, { type: 'array_delete' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'array_insert',
      path: payload.path,
      index: payload.index,
      items: payload.deletedItems,
    },
    description: `Undo delete ${payload.count} items at index ${payload.index}`,
  };
}

/**
 * Generate the inverse payload for an array move operation.
 * The inverse is moving the items back to their original position.
 */
function generateArrayMoveInverse(
  payload: Extract<OperationPayload, { type: 'array_move' }>
): { inverse: OperationPayload; description: string } {
  return {
    inverse: {
      type: 'array_move',
      path: payload.path,
      fromIndex: payload.toIndex,
      toIndex: payload.fromIndex,
      count: payload.count,
    },
    description: `Undo move ${payload.count} items from index ${payload.fromIndex} to ${payload.toIndex}`,
  };
}

/**
 * Generate the inverse payload for a composite operation.
 * The inverse is a composite of inverse operations in reverse order.
 */
function generateCompositeInverse(
  payload: Extract<OperationPayload, { type: 'composite' }>
): { inverse: OperationPayload; description: string } {
  const inverseOperations: OperationPayload[] = [];

  // Generate inverse for each operation in reverse order
  for (let i = payload.operations.length - 1; i >= 0; i--) {
    const op = payload.operations[i];
    const result = generateInversePayload(op);
    inverseOperations.push(result.inverse);
  }

  return {
    inverse: {
      type: 'composite',
      operations: inverseOperations,
      description: payload.description ? `Undo: ${payload.description}` : 'Undo composite operation',
    },
    description: payload.description ? `Undo: ${payload.description}` : 'Undo composite operation',
  };
}

/**
 * Generate the inverse payload for any operation type
 */
export function generateInversePayload(
  payload: OperationPayload
): { inverse: OperationPayload; description: string } {
  switch (payload.type) {
    case 'text_insert':
      return generateTextInsertInverse(payload);
    case 'text_delete':
      return generateTextDeleteInverse(payload);
    case 'text_replace':
      return generateTextReplaceInverse(payload);
    case 'file_create':
      return generateFileCreateInverse(payload);
    case 'file_delete':
      return generateFileDeleteInverse(payload);
    case 'file_rename':
      return generateFileRenameInverse(payload);
    case 'property_set':
      return generatePropertySetInverse(payload);
    case 'property_delete':
      return generatePropertyDeleteInverse(payload);
    case 'array_insert':
      return generateArrayInsertInverse(payload);
    case 'array_delete':
      return generateArrayDeleteInverse(payload);
    case 'array_move':
      return generateArrayMoveInverse(payload);
    case 'composite':
      return generateCompositeInverse(payload);
    default: {
      // Exhaustive check - this should never happen
      const _exhaustive: never = payload;
      throw new Error(`Unknown operation type: ${(_exhaustive as OperationPayload).type}`);
    }
  }
}

/**
 * Generate a complete inverse operation for a given operation.
 *
 * This is the main entry point for generating undo operations.
 * The generated inverse operation is a NEW forward operation that,
 * when applied, will reverse the effects of the original operation.
 *
 * @param operation - The operation to generate an inverse for
 * @param context - Context including replica ID and current clocks
 * @returns The inverse operation and updated clocks
 */
export function generateInverseOperation(
  operation: Operation,
  context: InverseGenerationContext
): InverseGenerationResult {
  // Generate the inverse payload
  const { inverse, description } = generateInversePayload(operation.payload);

  // Update timestamps
  const newTimestamp = incrementTimestamp(context.currentTimestamp, context.replicaId);
  const newVectorClock = incrementVectorClock(context.currentVectorClock, context.replicaId);

  // Create the inverse operation metadata
  const inverseMetadata: OperationMetadata = {
    id: generateOperationId(),
    timestamp: newTimestamp,
    vectorClock: newVectorClock,
    isInverse: true,
    inverseOf: operation.metadata.id,
    // Track if this is undoing an undo (i.e., a redo)
    undoOf: !operation.metadata.isInverse ? operation.metadata.id : undefined,
    redoOf: operation.metadata.isInverse ? operation.metadata.id : undefined,
  };

  return {
    inverseOperation: {
      metadata: inverseMetadata,
      payload: inverse,
    },
    newTimestamp,
    newVectorClock,
    description,
  };
}

/**
 * Check if an operation is a pure inverse of another operation.
 * This is useful for detecting undo/redo pairs and optimizing sync.
 */
export function isInverseOf(op1: Operation, op2: Operation): boolean {
  // If one explicitly marks itself as inverse of the other
  if (op1.metadata.inverseOf === op2.metadata.id) {
    return true;
  }
  if (op2.metadata.inverseOf === op1.metadata.id) {
    return true;
  }

  // Check by payload type matching
  const p1 = op1.payload;
  const p2 = op2.payload;

  // Text insert <-> Text delete
  if (p1.type === 'text_insert' && p2.type === 'text_delete') {
    return (
      p1.path === p2.path &&
      p1.position === p2.position &&
      p1.content === p2.deletedContent
    );
  }
  if (p1.type === 'text_delete' && p2.type === 'text_insert') {
    return (
      p1.path === p2.path &&
      p1.position === p2.position &&
      p1.deletedContent === p2.content
    );
  }

  // Text replace <-> Text replace (swapped old/new)
  if (p1.type === 'text_replace' && p2.type === 'text_replace') {
    return (
      p1.path === p2.path &&
      p1.position === p2.position &&
      p1.oldContent === p2.newContent &&
      p1.newContent === p2.oldContent
    );
  }

  // File create <-> File delete
  if (p1.type === 'file_create' && p2.type === 'file_delete') {
    return p1.path === p2.path && p1.content === p2.content;
  }
  if (p1.type === 'file_delete' && p2.type === 'file_create') {
    return p1.path === p2.path && p1.content === p2.content;
  }

  // File rename <-> File rename (swapped paths)
  if (p1.type === 'file_rename' && p2.type === 'file_rename') {
    return p1.oldPath === p2.newPath && p1.newPath === p2.oldPath;
  }

  return false;
}

/**
 * Detect if two operations can be collapsed (combined) into a single operation.
 * This is useful for optimizing undo stacks - consecutive character inserts
 * can become a single insert, for example.
 */
export function canCollapseOperations(
  op1: Operation,
  op2: Operation
): boolean {
  const p1 = op1.payload;
  const p2 = op2.payload;

  // Consecutive text inserts
  if (p1.type === 'text_insert' && p2.type === 'text_insert') {
    return (
      p1.path === p2.path &&
      p2.position === p1.position + p1.content.length
    );
  }

  // Consecutive text deletes (backspace style)
  if (p1.type === 'text_delete' && p2.type === 'text_delete') {
    return (
      p1.path === p2.path &&
      p2.position === p1.position - p2.length
    );
  }

  // Consecutive property sets on same key
  if (p1.type === 'property_set' && p2.type === 'property_set') {
    return p1.path === p2.path && p1.key === p2.key;
  }

  return false;
}

/**
 * Collapse two operations into one combined operation.
 * Should only be called if canCollapseOperations returns true.
 */
export function collapseOperations(
  op1: Operation,
  op2: Operation,
  context: InverseGenerationContext
): Operation {
  const p1 = op1.payload;
  const p2 = op2.payload;

  let collapsedPayload: OperationPayload;

  if (p1.type === 'text_insert' && p2.type === 'text_insert') {
    collapsedPayload = {
      type: 'text_insert',
      path: p1.path,
      position: p1.position,
      content: p1.content + p2.content,
    };
  } else if (p1.type === 'text_delete' && p2.type === 'text_delete') {
    collapsedPayload = {
      type: 'text_delete',
      path: p1.path,
      position: p2.position,
      length: p1.length + p2.length,
      deletedContent: p2.deletedContent + p1.deletedContent,
    };
  } else if (p1.type === 'property_set' && p2.type === 'property_set') {
    collapsedPayload = {
      type: 'property_set',
      path: p1.path,
      key: p1.key,
      oldValue: p1.oldValue,
      newValue: p2.newValue,
    };
  } else {
    throw new Error('Cannot collapse these operation types');
  }

  const newTimestamp = incrementTimestamp(context.currentTimestamp, context.replicaId);
  const newVectorClock = incrementVectorClock(context.currentVectorClock, context.replicaId);

  return {
    metadata: {
      id: generateOperationId(),
      timestamp: newTimestamp,
      vectorClock: newVectorClock,
      isInverse: false,
    },
    payload: collapsedPayload,
  };
}
