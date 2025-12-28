/**
 * CRDT (Conflict-free Replicated Data Type) Types
 *
 * This module defines the core types for a CRDT-based collaborative editing system
 * where undo operations are implemented as new forward operations that apply inverse changes.
 */

/**
 * Unique identifier for a replica/peer in the distributed system
 */
export type ReplicaId = string;

/**
 * Unique identifier for an operation
 */
export type OperationId = string;

/**
 * Lamport timestamp for operation ordering
 */
export interface LamportTimestamp {
  /** Logical clock value */
  counter: number;
  /** Replica that created this timestamp */
  replicaId: ReplicaId;
}

/**
 * Vector clock for tracking causality across replicas
 */
export type VectorClock = Record<ReplicaId, number>;

/**
 * Base operation metadata common to all operations
 */
export interface OperationMetadata {
  /** Unique operation identifier */
  id: OperationId;
  /** Lamport timestamp for total ordering */
  timestamp: LamportTimestamp;
  /** Vector clock at time of operation */
  vectorClock: VectorClock;
  /** ID of the operation this undoes (if this is an undo operation) */
  undoOf?: OperationId;
  /** ID of the operation this redoes (if this is a redo operation) */
  redoOf?: OperationId;
  /** Whether this operation was created as an inverse (undo) operation */
  isInverse: boolean;
  /** The original operation ID that this is the inverse of */
  inverseOf?: OperationId;
}

/**
 * Text insert operation
 */
export interface TextInsertOperation {
  type: 'text_insert';
  /** Document/file path */
  path: string;
  /** Position to insert at (character offset) */
  position: number;
  /** Text to insert */
  content: string;
}

/**
 * Text delete operation
 */
export interface TextDeleteOperation {
  type: 'text_delete';
  /** Document/file path */
  path: string;
  /** Start position of deletion */
  position: number;
  /** Number of characters to delete */
  length: number;
  /** The deleted content (stored for inverse generation) */
  deletedContent: string;
}

/**
 * Text replace operation (atomic insert + delete)
 */
export interface TextReplaceOperation {
  type: 'text_replace';
  /** Document/file path */
  path: string;
  /** Start position of replacement */
  position: number;
  /** Original content being replaced */
  oldContent: string;
  /** New content to insert */
  newContent: string;
}

/**
 * File create operation
 */
export interface FileCreateOperation {
  type: 'file_create';
  /** Path of the new file */
  path: string;
  /** Initial content */
  content: string;
}

/**
 * File delete operation
 */
export interface FileDeleteOperation {
  type: 'file_delete';
  /** Path of the file to delete */
  path: string;
  /** Content of the file (stored for inverse) */
  content: string;
}

/**
 * File rename/move operation
 */
export interface FileRenameOperation {
  type: 'file_rename';
  /** Original path */
  oldPath: string;
  /** New path */
  newPath: string;
}

/**
 * Property set operation for key-value data
 */
export interface PropertySetOperation {
  type: 'property_set';
  /** Object/document path */
  path: string;
  /** Property key */
  key: string;
  /** Previous value (for inverse) */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
}

/**
 * Property delete operation
 */
export interface PropertyDeleteOperation {
  type: 'property_delete';
  /** Object/document path */
  path: string;
  /** Property key */
  key: string;
  /** Deleted value (for inverse) */
  deletedValue: unknown;
}

/**
 * Array insert operation
 */
export interface ArrayInsertOperation {
  type: 'array_insert';
  /** Array path */
  path: string;
  /** Index to insert at */
  index: number;
  /** Items to insert */
  items: unknown[];
}

/**
 * Array delete operation
 */
export interface ArrayDeleteOperation {
  type: 'array_delete';
  /** Array path */
  path: string;
  /** Start index */
  index: number;
  /** Number of items to delete */
  count: number;
  /** Deleted items (for inverse) */
  deletedItems: unknown[];
}

/**
 * Array move operation
 */
export interface ArrayMoveOperation {
  type: 'array_move';
  /** Array path */
  path: string;
  /** Source index */
  fromIndex: number;
  /** Destination index */
  toIndex: number;
  /** Number of items to move */
  count: number;
}

/**
 * Composite operation (batch of operations applied atomically)
 */
export interface CompositeOperation {
  type: 'composite';
  /** Child operations */
  operations: OperationPayload[];
  /** Description of the composite operation */
  description?: string;
}

/**
 * Union of all operation payload types
 */
export type OperationPayload =
  | TextInsertOperation
  | TextDeleteOperation
  | TextReplaceOperation
  | FileCreateOperation
  | FileDeleteOperation
  | FileRenameOperation
  | PropertySetOperation
  | PropertyDeleteOperation
  | ArrayInsertOperation
  | ArrayDeleteOperation
  | ArrayMoveOperation
  | CompositeOperation;

/**
 * Complete operation with metadata
 */
export interface Operation {
  metadata: OperationMetadata;
  payload: OperationPayload;
}

/**
 * Operation in the log with additional tracking info
 */
export interface LoggedOperation extends Operation {
  /** Whether this operation has been applied locally */
  appliedLocally: boolean;
  /** Whether this operation has been acknowledged by the server */
  acknowledged: boolean;
  /** Timestamp when the operation was received/created */
  receivedAt: number;
  /** Source replica */
  sourceReplica: ReplicaId;
}

/**
 * Undo entry in the undo stack
 */
export interface UndoEntry {
  /** The original operation that was performed */
  originalOperationId: OperationId;
  /** The inverse operation that undoes it */
  inverseOperation: Operation;
  /** Human-readable description */
  description: string;
  /** Timestamp when the operation was performed */
  performedAt: number;
}

/**
 * Undo/Redo stack state
 */
export interface UndoRedoState {
  /** Operations that can be undone (most recent last) */
  undoStack: UndoEntry[];
  /** Operations that were undone and can be redone (most recent last) */
  redoStack: UndoEntry[];
  /** Maximum size of each stack */
  maxStackSize: number;
}

/**
 * Document state snapshot
 */
export interface DocumentState {
  /** Document/file path */
  path: string;
  /** Current content */
  content: string;
  /** Vector clock representing current state */
  vectorClock: VectorClock;
  /** Last modified timestamp */
  lastModified: number;
  /** Checksum for integrity verification */
  checksum: string;
}

/**
 * Sync state for a document
 */
export interface DocumentSyncState {
  /** Local vector clock */
  localClock: VectorClock;
  /** Last known server clock */
  serverClock: VectorClock;
  /** Pending local operations not yet acknowledged */
  pendingOperations: Operation[];
  /** Whether sync is currently in progress */
  syncing: boolean;
  /** Last successful sync timestamp */
  lastSyncAt: number | null;
  /** Sync error if any */
  syncError: string | null;
}

/**
 * Sync message sent to server
 */
export interface SyncRequest {
  /** Replica sending the request */
  replicaId: ReplicaId;
  /** Operations to push */
  operations: Operation[];
  /** Client's current vector clock */
  vectorClock: VectorClock;
  /** Request for operations since this clock */
  requestOperationsSince?: VectorClock;
}

/**
 * Sync response from server
 */
export interface SyncResponse {
  /** Whether the sync was successful */
  success: boolean;
  /** Server's vector clock after applying operations */
  serverClock: VectorClock;
  /** Operations the client is missing */
  missingOperations: Operation[];
  /** Any conflicts detected */
  conflicts: ConflictInfo[];
  /** Error message if not successful */
  error?: string;
}

/**
 * Conflict information
 */
export interface ConflictInfo {
  /** Type of conflict */
  type: 'concurrent_edit' | 'delete_edit' | 'create_create';
  /** Operations involved in the conflict */
  operations: Operation[];
  /** How the conflict was resolved */
  resolution: 'merge' | 'last_write_wins' | 'manual_required';
  /** Result of automatic resolution if applicable */
  resolvedOperation?: Operation;
}

/**
 * Configuration for the CRDT system
 */
export interface CRDTConfig {
  /** This replica's unique identifier */
  replicaId: ReplicaId;
  /** Maximum undo/redo stack size */
  maxUndoStackSize: number;
  /** Whether to enable automatic sync */
  autoSync: boolean;
  /** Sync interval in milliseconds */
  syncIntervalMs: number;
  /** Maximum operations to batch in a single sync */
  maxBatchSize: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default CRDT configuration
 */
export const DEFAULT_CRDT_CONFIG: CRDTConfig = {
  replicaId: '',
  maxUndoStackSize: 100,
  autoSync: true,
  syncIntervalMs: 1000,
  maxBatchSize: 50,
  debug: false,
};
