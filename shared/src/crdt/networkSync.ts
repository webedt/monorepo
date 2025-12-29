/**
 * Network Sync Service for CRDT Operations
 *
 * Handles synchronization of CRDT operations between replicas over the network.
 * Supports both push (sending local operations) and pull (receiving remote operations).
 *
 * Key features:
 * - Batched operation sync
 * - Vector clock-based delta sync
 * - Automatic retry with backoff
 * - Conflict detection (though CRDTs minimize conflicts)
 * - Offline queue with persistence
 */

import { EventEmitter } from 'events';

import { INTERVALS, LIMITS, RETRY, CONTEXT_RETRY } from '../config/constants.js';

import type { CRDTConfig } from './types.js';
import type { ConflictInfo } from './types.js';
import type { DocumentSyncState } from './types.js';
import type { Operation } from './types.js';
import type { ReplicaId } from './types.js';
import type { SyncRequest } from './types.js';
import type { SyncResponse } from './types.js';
import type { VectorClock } from './types.js';

import { mergeVectorClocks, vectorClockDominates } from './documentState.js';
import { UndoManager } from './undoManager.js';

/**
 * Network transport interface
 */
export interface NetworkTransport {
  /** Send a sync request and receive a response */
  sync(request: SyncRequest): Promise<SyncResponse>;
  /** Subscribe to incoming operations (for WebSocket/SSE) */
  onOperations?(callback: (operations: Operation[]) => void): () => void;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Sync event types
 */
export type SyncEventType =
  | 'sync_start'
  | 'sync_complete'
  | 'sync_error'
  | 'operation_sent'
  | 'operation_received'
  | 'conflict_detected'
  | 'offline_queue_updated';

/**
 * Sync event payload
 */
export interface SyncEvent {
  type: SyncEventType;
  timestamp: number;
  details: Record<string, unknown>;
}

/**
 * Configuration for network sync
 */
export interface NetworkSyncConfig {
  /** This replica's ID */
  replicaId: ReplicaId;
  /** Whether to auto-sync on changes */
  autoSync: boolean;
  /** Sync interval in milliseconds */
  syncIntervalMs: number;
  /** Maximum operations per sync batch */
  maxBatchSize: number;
  /** Retry configuration */
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default network sync configuration
 * Values are sourced from centralized config for environment-based customization
 */
export const DEFAULT_NETWORK_SYNC_CONFIG: NetworkSyncConfig = {
  replicaId: '',
  autoSync: true,
  syncIntervalMs: INTERVALS.SYNC.CRDT,
  maxBatchSize: LIMITS.BATCH.CRDT_SIZE,
  retry: {
    maxAttempts: RETRY.DEFAULT.MAX_ATTEMPTS,
    baseDelayMs: RETRY.DEFAULT.BASE_DELAY_MS,
    maxDelayMs: CONTEXT_RETRY.CRDT.MAX_DELAY_MS,
  },
  debug: false,
};

/**
 * Pending operation in the offline queue
 */
interface PendingOperation {
  operation: Operation;
  addedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
}

/**
 * Network Sync Service
 *
 * Handles synchronization of CRDT operations with the server.
 */
export class NetworkSyncService extends EventEmitter {
  private config: NetworkSyncConfig;
  private transport: NetworkTransport;
  private undoManager: UndoManager;
  private pendingQueue: PendingOperation[] = [];
  private localVectorClock: VectorClock = {};
  private serverVectorClock: VectorClock = {};
  private syncInProgress = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeRealtime: (() => void) | null = null;

  constructor(
    transport: NetworkTransport,
    undoManager: UndoManager,
    config: Partial<NetworkSyncConfig> = {}
  ) {
    super();
    this.transport = transport;
    this.undoManager = undoManager;
    this.config = { ...DEFAULT_NETWORK_SYNC_CONFIG, ...config };
    this.localVectorClock = { [this.config.replicaId]: 0 };
  }

  /**
   * Start the sync service
   */
  start(): void {
    if (this.config.autoSync && !this.syncTimer) {
      this.syncTimer = setInterval(() => {
        this.sync().catch(this.handleSyncError.bind(this));
      }, this.config.syncIntervalMs);
    }

    // Subscribe to real-time updates if transport supports it
    if (this.transport.onOperations) {
      this.unsubscribeRealtime = this.transport.onOperations(
        this.handleIncomingOperations.bind(this)
      );
    }

    this.log('Sync service started');
  }

  /**
   * Stop the sync service
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
      this.unsubscribeRealtime = null;
    }

    this.log('Sync service stopped');
  }

  /**
   * Queue an operation for sync
   */
  queueOperation(operation: Operation): void {
    this.pendingQueue.push({
      operation,
      addedAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
    });

    // Update local vector clock
    this.localVectorClock = mergeVectorClocks(
      this.localVectorClock,
      operation.metadata.vectorClock
    );

    this.emit('event', {
      type: 'offline_queue_updated',
      timestamp: Date.now(),
      details: { queueSize: this.pendingQueue.length },
    } as SyncEvent);

    // Trigger immediate sync if connected
    if (this.config.autoSync && this.transport.isConnected()) {
      this.sync().catch(this.handleSyncError.bind(this));
    }
  }

  /**
   * Queue an undo operation
   *
   * This is the same as queueOperation because undo operations
   * ARE forward operations in our CRDT model.
   */
  queueUndoOperation(undoOperation: Operation): void {
    this.queueOperation(undoOperation);
  }

  /**
   * Perform a sync with the server
   */
  async sync(): Promise<SyncResponse> {
    if (this.syncInProgress) {
      return {
        success: false,
        serverClock: this.serverVectorClock,
        missingOperations: [],
        conflicts: [],
        error: 'Sync already in progress',
      };
    }

    if (!this.transport.isConnected()) {
      return {
        success: false,
        serverClock: this.serverVectorClock,
        missingOperations: [],
        conflicts: [],
        error: 'Not connected',
      };
    }

    this.syncInProgress = true;
    this.emit('event', {
      type: 'sync_start',
      timestamp: Date.now(),
      details: { pendingCount: this.pendingQueue.length },
    } as SyncEvent);

    try {
      // Prepare operations to send (respecting batch size)
      const operationsToSend = this.pendingQueue
        .slice(0, this.config.maxBatchSize)
        .map((p) => p.operation);

      // Create sync request
      const request: SyncRequest = {
        replicaId: this.config.replicaId,
        operations: operationsToSend,
        vectorClock: this.localVectorClock,
        requestOperationsSince: this.serverVectorClock,
      };

      // Send request with retry
      const response = await this.syncWithRetry(request);

      if (response.success) {
        // Remove sent operations from queue
        this.pendingQueue = this.pendingQueue.slice(operationsToSend.length);

        // Update server vector clock
        this.serverVectorClock = response.serverClock;

        // Process incoming operations
        if (response.missingOperations.length > 0) {
          this.handleIncomingOperations(response.missingOperations);
        }

        // Handle any conflicts
        if (response.conflicts.length > 0) {
          this.handleConflicts(response.conflicts);
        }

        this.emit('event', {
          type: 'sync_complete',
          timestamp: Date.now(),
          details: {
            sentCount: operationsToSend.length,
            receivedCount: response.missingOperations.length,
            conflictCount: response.conflicts.length,
          },
        } as SyncEvent);
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.emit('event', {
        type: 'sync_error',
        timestamp: Date.now(),
        details: { error: errorMessage },
      } as SyncEvent);

      return {
        success: false,
        serverClock: this.serverVectorClock,
        missingOperations: [],
        conflicts: [],
        error: errorMessage,
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync with retry logic
   */
  private async syncWithRetry(request: SyncRequest): Promise<SyncResponse> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.config.retry;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.transport.sync(request);
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }

        // Exponential backoff
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        await this.sleep(delay);
      }
    }

    throw new Error('Max retry attempts exceeded');
  }

  /**
   * Handle incoming operations from server
   */
  private handleIncomingOperations(operations: Operation[]): void {
    for (const operation of operations) {
      // Skip operations we've already seen
      if (vectorClockDominates(this.localVectorClock, operation.metadata.vectorClock)) {
        continue;
      }

      // Update the undo manager with remote operation
      this.undoManager.handleRemoteOperation(operation);

      // Update local vector clock
      this.localVectorClock = mergeVectorClocks(
        this.localVectorClock,
        operation.metadata.vectorClock
      );

      this.emit('event', {
        type: 'operation_received',
        timestamp: Date.now(),
        details: {
          operationId: operation.metadata.id,
          operationType: operation.payload.type,
          isInverse: operation.metadata.isInverse,
        },
      } as SyncEvent);
    }
  }

  /**
   * Handle conflicts detected during sync
   */
  private handleConflicts(conflicts: ConflictInfo[]): void {
    for (const conflict of conflicts) {
      this.emit('event', {
        type: 'conflict_detected',
        timestamp: Date.now(),
        details: {
          conflictType: conflict.type,
          resolution: conflict.resolution,
          operationCount: conflict.operations.length,
        },
      } as SyncEvent);

      // If there's a resolved operation, apply it
      if (conflict.resolvedOperation) {
        this.undoManager.handleRemoteOperation(conflict.resolvedOperation);
      }
    }
  }

  /**
   * Handle sync errors
   */
  private handleSyncError(error: Error): void {
    this.log(`Sync error: ${error.message}`, 'error');
    this.emit('event', {
      type: 'sync_error',
      timestamp: Date.now(),
      details: { error: error.message },
    } as SyncEvent);
  }

  /**
   * Get current sync state
   */
  getSyncState(): DocumentSyncState {
    return {
      localClock: { ...this.localVectorClock },
      serverClock: { ...this.serverVectorClock },
      pendingOperations: this.pendingQueue.map((p) => p.operation),
      syncing: this.syncInProgress,
      lastSyncAt: null, // Could track this
      syncError: null,
    };
  }

  /**
   * Get pending operation count
   */
  getPendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Check if there are pending operations
   */
  hasPendingOperations(): boolean {
    return this.pendingQueue.length > 0;
  }

  /**
   * Force an immediate sync
   */
  async forceSync(): Promise<SyncResponse> {
    return this.sync();
  }

  /**
   * Clear pending queue (use with caution)
   */
  clearPendingQueue(): void {
    this.pendingQueue = [];
    this.emit('event', {
      type: 'offline_queue_updated',
      timestamp: Date.now(),
      details: { queueSize: 0, cleared: true },
    } as SyncEvent);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Logging helper
   */
  private log(message: string, level: 'debug' | 'info' | 'error' = 'debug'): void {
    if (this.config.debug || level === 'error') {
      const prefix = `[NetworkSync:${this.config.replicaId}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }
}

/**
 * Create a mock transport for testing
 */
export function createMockTransport(): NetworkTransport {
  const operations: Operation[] = [];
  const listeners: ((ops: Operation[]) => void)[] = [];

  return {
    async sync(request: SyncRequest): Promise<SyncResponse> {
      // Store incoming operations
      operations.push(...request.operations);

      // Simulate server response
      return {
        success: true,
        serverClock: request.vectorClock,
        missingOperations: [],
        conflicts: [],
      };
    },

    onOperations(callback: (operations: Operation[]) => void): () => void {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },

    isConnected(): boolean {
      return true;
    },
  };
}

/**
 * Create a network sync service with the given configuration
 */
export function createNetworkSyncService(
  transport: NetworkTransport,
  undoManager: UndoManager,
  config?: Partial<CRDTConfig>
): NetworkSyncService {
  return new NetworkSyncService(transport, undoManager, {
    replicaId: config?.replicaId || '',
    autoSync: config?.autoSync ?? true,
    syncIntervalMs: config?.syncIntervalMs ?? 1000,
    maxBatchSize: config?.maxBatchSize ?? 50,
    debug: config?.debug ?? false,
  });
}
