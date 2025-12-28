/**
 * CRDT (Conflict-free Replicated Data Type) Module
 *
 * This module provides a CRDT-based system for collaborative editing
 * where undo operations are implemented as new forward operations
 * that apply inverse changes.
 *
 * Key components:
 * - types.ts: Type definitions for operations, clocks, and state
 * - inverseGenerator.ts: Generates inverse operations for undo
 * - documentState.ts: Manages document state and applies operations
 * - undoManager.ts: Manages undo/redo stacks using forward operations
 * - networkSync.ts: Handles network synchronization of operations
 *
 * Usage:
 * ```typescript
 * import {
 *   DocumentStateManager,
 *   UndoManager,
 *   NetworkSyncService,
 *   createMockTransport,
 * } from '@shared/crdt';
 *
 * // Create document manager
 * const docManager = new DocumentStateManager();
 * docManager.setDocument('file.txt', 'Hello World');
 *
 * // Create undo manager
 * const undoManager = new UndoManager('replica-1', docManager);
 *
 * // Create network sync
 * const transport = createMockTransport();
 * const syncService = new NetworkSyncService(transport, undoManager, {
 *   replicaId: 'replica-1',
 * });
 *
 * // Apply an operation
 * const operation = {
 *   metadata: { ... },
 *   payload: { type: 'text_insert', path: 'file.txt', position: 6, content: ' Beautiful' },
 * };
 * docManager.applyOperation(operation);
 * undoManager.recordOperation(operation);
 * syncService.queueOperation(operation);
 *
 * // Undo the operation (generates a new forward operation)
 * const undoOp = undoManager.undo();
 * if (undoOp) {
 *   syncService.queueOperation(undoOp);
 * }
 * ```
 */

// Types
export type {
  ReplicaId,
  OperationId,
  LamportTimestamp,
  VectorClock,
  OperationMetadata,
  TextInsertOperation,
  TextDeleteOperation,
  TextReplaceOperation,
  FileCreateOperation,
  FileDeleteOperation,
  FileRenameOperation,
  PropertySetOperation,
  PropertyDeleteOperation,
  ArrayInsertOperation,
  ArrayDeleteOperation,
  ArrayMoveOperation,
  CompositeOperation,
  OperationPayload,
  Operation,
  LoggedOperation,
  UndoEntry,
  UndoRedoState,
  DocumentState,
  DocumentSyncState,
  SyncRequest,
  SyncResponse,
  ConflictInfo,
  CRDTConfig,
} from './types.js';

export { DEFAULT_CRDT_CONFIG } from './types.js';

// Inverse generator
export type {
  InverseGenerationContext,
  InverseGenerationResult,
} from './inverseGenerator.js';

export {
  generateOperationId,
  incrementTimestamp,
  incrementVectorClock,
  generateInversePayload,
  generateInverseOperation,
  isInverseOf,
  canCollapseOperations,
  collapseOperations,
} from './inverseGenerator.js';

// Document state
export type { ApplyResult } from './documentState.js';

export {
  computeChecksum,
  compareLamportTimestamps,
  mergeVectorClocks,
  vectorClockDominates,
  vectorClocksConcurrent,
  createEmptyDocumentState,
  createDocumentState,
  applyPayloadToContent,
  applyOperation,
  applyOperations,
  DocumentStateManager,
} from './documentState.js';

// Undo manager
export type {
  UndoConfig,
  UndoStateChangeEvent,
  UndoStateChangeListener,
} from './undoManager.js';

export {
  DEFAULT_UNDO_CONFIG,
  UndoManager,
  createUndoManager,
} from './undoManager.js';

// Network sync
export type {
  NetworkTransport,
  SyncEventType,
  SyncEvent,
  NetworkSyncConfig,
} from './networkSync.js';

export {
  DEFAULT_NETWORK_SYNC_CONFIG,
  NetworkSyncService,
  createMockTransport,
  createNetworkSyncService,
} from './networkSync.js';
