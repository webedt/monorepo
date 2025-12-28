/**
 * Document State Manager
 *
 * Manages the state of documents and applies CRDT operations to them.
 * Operations are applied in Lamport timestamp order to ensure convergence.
 */

import { createHash } from 'crypto';

import type { DocumentState } from './types.js';
import type { LamportTimestamp } from './types.js';
import type { Operation } from './types.js';
import type { OperationPayload } from './types.js';
import type { VectorClock } from './types.js';

/**
 * Result of applying an operation
 */
export interface ApplyResult {
  /** Whether the operation was successfully applied */
  success: boolean;
  /** The new document state after applying */
  newState: DocumentState;
  /** Error message if not successful */
  error?: string;
  /** Whether the operation was a no-op (already applied or superseded) */
  noOp: boolean;
}

/**
 * Compute a checksum for document content
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Compare two Lamport timestamps for ordering
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareLamportTimestamps(
  a: LamportTimestamp,
  b: LamportTimestamp
): number {
  if (a.counter !== b.counter) {
    return a.counter - b.counter;
  }
  // Tie-breaker: lexicographic comparison of replica IDs
  return a.replicaId.localeCompare(b.replicaId);
}

/**
 * Merge two vector clocks, taking the maximum of each component
 */
export function mergeVectorClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [replicaId, counter] of Object.entries(b)) {
    result[replicaId] = Math.max(result[replicaId] || 0, counter);
  }
  return result;
}

/**
 * Check if vector clock a dominates (happened after or concurrent with) b
 */
export function vectorClockDominates(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    if ((a[key] || 0) < (b[key] || 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if two vector clocks are concurrent (neither dominates the other)
 */
export function vectorClocksConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !vectorClockDominates(a, b) && !vectorClockDominates(b, a);
}

/**
 * Create an empty document state
 */
export function createEmptyDocumentState(path: string): DocumentState {
  return {
    path,
    content: '',
    vectorClock: {},
    lastModified: Date.now(),
    checksum: computeChecksum(''),
  };
}

/**
 * Create a document state with initial content
 */
export function createDocumentState(path: string, content: string): DocumentState {
  return {
    path,
    content,
    vectorClock: {},
    lastModified: Date.now(),
    checksum: computeChecksum(content),
  };
}

/**
 * Apply a text insert operation to content
 */
function applyTextInsert(
  content: string,
  payload: Extract<OperationPayload, { type: 'text_insert' }>
): string {
  const pos = Math.min(Math.max(0, payload.position), content.length);
  return content.slice(0, pos) + payload.content + content.slice(pos);
}

/**
 * Apply a text delete operation to content
 */
function applyTextDelete(
  content: string,
  payload: Extract<OperationPayload, { type: 'text_delete' }>
): string {
  const pos = Math.min(Math.max(0, payload.position), content.length);
  const endPos = Math.min(pos + payload.length, content.length);
  return content.slice(0, pos) + content.slice(endPos);
}

/**
 * Apply a text replace operation to content
 */
function applyTextReplace(
  content: string,
  payload: Extract<OperationPayload, { type: 'text_replace' }>
): string {
  const pos = Math.min(Math.max(0, payload.position), content.length);
  const endPos = Math.min(pos + payload.oldContent.length, content.length);
  return content.slice(0, pos) + payload.newContent + content.slice(endPos);
}

/**
 * Apply an operation payload to document content
 */
export function applyPayloadToContent(
  content: string,
  payload: OperationPayload
): string {
  switch (payload.type) {
    case 'text_insert':
      return applyTextInsert(content, payload);
    case 'text_delete':
      return applyTextDelete(content, payload);
    case 'text_replace':
      return applyTextReplace(content, payload);
    case 'composite':
      // Apply each operation in order
      let result = content;
      for (const op of payload.operations) {
        result = applyPayloadToContent(result, op);
      }
      return result;
    default:
      // Non-text operations don't modify content
      return content;
  }
}

/**
 * Apply an operation to a document state
 */
export function applyOperation(
  state: DocumentState,
  operation: Operation
): ApplyResult {
  try {
    const payload = operation.payload;

    // Check if operation applies to this document
    if ('path' in payload && payload.path !== state.path) {
      return {
        success: false,
        newState: state,
        error: `Operation path ${payload.path} does not match document path ${state.path}`,
        noOp: true,
      };
    }

    // Check if operation has already been applied (via vector clock)
    if (vectorClockDominates(state.vectorClock, operation.metadata.vectorClock)) {
      return {
        success: true,
        newState: state,
        noOp: true,
      };
    }

    // Apply the operation to content
    const newContent = applyPayloadToContent(state.content, payload);

    // Merge vector clocks
    const newVectorClock = mergeVectorClocks(state.vectorClock, operation.metadata.vectorClock);

    const newState: DocumentState = {
      path: state.path,
      content: newContent,
      vectorClock: newVectorClock,
      lastModified: Date.now(),
      checksum: computeChecksum(newContent),
    };

    return {
      success: true,
      newState,
      noOp: false,
    };
  } catch (err) {
    return {
      success: false,
      newState: state,
      error: err instanceof Error ? err.message : 'Unknown error applying operation',
      noOp: false,
    };
  }
}

/**
 * Apply multiple operations to a document state
 * Operations are sorted by Lamport timestamp before applying
 */
export function applyOperations(
  state: DocumentState,
  operations: Operation[]
): ApplyResult {
  // Sort operations by Lamport timestamp for deterministic ordering
  const sortedOps = [...operations].sort((a, b) =>
    compareLamportTimestamps(a.metadata.timestamp, b.metadata.timestamp)
  );

  let currentState = state;
  let anyApplied = false;

  for (const op of sortedOps) {
    const result = applyOperation(currentState, op);
    if (!result.success) {
      return result;
    }
    if (!result.noOp) {
      anyApplied = true;
    }
    currentState = result.newState;
  }

  return {
    success: true,
    newState: currentState,
    noOp: !anyApplied,
  };
}

/**
 * Manager for multiple document states
 */
export class DocumentStateManager {
  private documents: Map<string, DocumentState> = new Map();
  private operationLog: Operation[] = [];

  /**
   * Get or create a document state
   */
  getDocument(path: string): DocumentState {
    let doc = this.documents.get(path);
    if (!doc) {
      doc = createEmptyDocumentState(path);
      this.documents.set(path, doc);
    }
    return doc;
  }

  /**
   * Set document content directly (for initial load)
   */
  setDocument(path: string, content: string): DocumentState {
    const doc = createDocumentState(path, content);
    this.documents.set(path, doc);
    return doc;
  }

  /**
   * Check if a document exists
   */
  hasDocument(path: string): boolean {
    return this.documents.has(path);
  }

  /**
   * Delete a document
   */
  deleteDocument(path: string): boolean {
    return this.documents.delete(path);
  }

  /**
   * Rename a document
   */
  renameDocument(oldPath: string, newPath: string): boolean {
    const doc = this.documents.get(oldPath);
    if (!doc) {
      return false;
    }
    this.documents.delete(oldPath);
    doc.path = newPath;
    this.documents.set(newPath, doc);
    return true;
  }

  /**
   * Apply an operation and log it
   */
  applyOperation(operation: Operation): ApplyResult {
    const payload = operation.payload;
    let path: string;

    // Handle file operations
    if (payload.type === 'file_create') {
      const newDoc = createDocumentState(payload.path, payload.content);
      newDoc.vectorClock = mergeVectorClocks(newDoc.vectorClock, operation.metadata.vectorClock);
      this.documents.set(payload.path, newDoc);
      this.operationLog.push(operation);
      return { success: true, newState: newDoc, noOp: false };
    }

    if (payload.type === 'file_delete') {
      const doc = this.documents.get(payload.path);
      if (doc) {
        this.documents.delete(payload.path);
        this.operationLog.push(operation);
        return { success: true, newState: doc, noOp: false };
      }
      return { success: true, newState: createEmptyDocumentState(payload.path), noOp: true };
    }

    if (payload.type === 'file_rename') {
      if (this.renameDocument(payload.oldPath, payload.newPath)) {
        const doc = this.documents.get(payload.newPath)!;
        doc.vectorClock = mergeVectorClocks(doc.vectorClock, operation.metadata.vectorClock);
        this.operationLog.push(operation);
        return { success: true, newState: doc, noOp: false };
      }
      return {
        success: false,
        newState: createEmptyDocumentState(payload.oldPath),
        error: 'Source file does not exist',
        noOp: true,
      };
    }

    // For other operations, get the path from payload
    if ('path' in payload) {
      path = payload.path;
    } else {
      return {
        success: false,
        newState: createEmptyDocumentState(''),
        error: 'Operation does not specify a path',
        noOp: true,
      };
    }

    // Get or create document
    const doc = this.getDocument(path);

    // Apply the operation
    const result = applyOperation(doc, operation);

    if (result.success && !result.noOp) {
      this.documents.set(path, result.newState);
      this.operationLog.push(operation);
    }

    return result;
  }

  /**
   * Get the full operation log
   */
  getOperationLog(): Operation[] {
    return [...this.operationLog];
  }

  /**
   * Get operations since a given vector clock
   */
  getOperationsSince(since: VectorClock): Operation[] {
    return this.operationLog.filter(
      (op) => !vectorClockDominates(since, op.metadata.vectorClock)
    );
  }

  /**
   * Get all document paths
   */
  getAllPaths(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get all document states
   */
  getAllDocuments(): DocumentState[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get the merged vector clock across all documents
   */
  getMergedVectorClock(): VectorClock {
    let merged: VectorClock = {};
    for (const doc of this.documents.values()) {
      merged = mergeVectorClocks(merged, doc.vectorClock);
    }
    return merged;
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.documents.clear();
    this.operationLog = [];
  }
}
