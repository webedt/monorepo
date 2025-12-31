/**
 * Offline Status Manager
 * Handles connectivity detection and offline state management
 */

export type ConnectionStatus = 'online' | 'offline' | 'slow';

export interface OfflineStatusListener {
  (status: ConnectionStatus, wasOffline: boolean): void;
}

interface PendingOperation {
  id: string;
  type: 'save' | 'sync' | 'api';
  data: unknown;
  timestamp: number;
  retryCount: number;
}

class OfflineManager {
  private status: ConnectionStatus = 'online';
  private listeners: Set<OfflineStatusListener> = new Set();
  private pendingOperations: Map<string, PendingOperation> = new Map();
  private checkInterval: number | null = null;
  private lastOnlineTime: number = Date.now();

  // Store bound handlers for proper cleanup
  private boundHandleOnline: () => void;
  private boundHandleOffline: () => void;

  constructor() {
    // Bind handlers once in constructor for consistent references
    this.boundHandleOnline = () => this.handleOnline();
    this.boundHandleOffline = () => this.handleOffline();
    this.initialize();
  }

  private initialize(): void {
    // Set initial status based on navigator.onLine
    this.status = navigator.onLine ? 'online' : 'offline';

    // Listen for online/offline events
    window.addEventListener('online', this.boundHandleOnline);
    window.addEventListener('offline', this.boundHandleOffline);

    // Periodic connectivity check for slow connections
    this.startConnectivityCheck();
  }

  private handleOnline(): void {
    const wasOffline = this.status === 'offline';
    this.status = 'online';
    this.lastOnlineTime = Date.now();
    this.notifyListeners(wasOffline);
    this.processPendingOperations();
  }

  private handleOffline(): void {
    const wasOffline = this.status === 'offline';
    this.status = 'offline';
    this.notifyListeners(wasOffline);
  }

  private notifyListeners(wasOffline: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(this.status, wasOffline);
      } catch (error) {
        console.error('[Offline] Listener error:', error);
      }
    }
  }

  private startConnectivityCheck(): void {
    // Check connectivity every 30 seconds
    this.checkInterval = window.setInterval(() => {
      this.checkConnectivity();
    }, 30000);
  }

  private async checkConnectivity(): Promise<void> {
    if (!navigator.onLine) {
      if (this.status !== 'offline') {
        this.status = 'offline';
        this.notifyListeners(false);
      }
      return;
    }

    try {
      const start = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Use a simple health check endpoint
      const response = await fetch('/health', {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = performance.now() - start;

      if (response.ok) {
        const wasOffline = this.status === 'offline';
        // Slow connection if response takes > 2 seconds
        this.status = duration > 2000 ? 'slow' : 'online';
        this.lastOnlineTime = Date.now();
        if (wasOffline) {
          this.notifyListeners(true);
          this.processPendingOperations();
        }
      }
    } catch {
      // Connectivity check failed
      if (this.status !== 'offline') {
        this.status = 'offline';
        this.notifyListeners(false);
      }
    }
  }

  private async processPendingOperations(): Promise<void> {
    if (this.status === 'offline' || this.pendingOperations.size === 0) {
      return;
    }

    console.log(`[Offline] Processing ${this.pendingOperations.size} pending operations`);

    for (const [id, operation] of this.pendingOperations) {
      try {
        // Emit event for the operation to be processed
        window.dispatchEvent(new CustomEvent('offline:process-operation', {
          detail: operation,
        }));
        this.pendingOperations.delete(id);
      } catch (error) {
        console.error(`[Offline] Failed to process operation ${id}:`, error);
        operation.retryCount++;
        if (operation.retryCount > 3) {
          this.pendingOperations.delete(id);
          console.warn(`[Offline] Giving up on operation ${id} after 3 retries`);
        }
      }
    }
  }

  /**
   * Subscribe to connection status changes
   */
  subscribe(listener: OfflineStatusListener): () => void {
    this.listeners.add(listener);
    // Immediately notify of current status
    listener(this.status, false);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Check if currently online
   */
  isOnline(): boolean {
    return this.status === 'online' || this.status === 'slow';
  }

  /**
   * Check if currently offline
   */
  isOffline(): boolean {
    return this.status === 'offline';
  }

  /**
   * Get time since last online
   */
  getTimeSinceOnline(): number {
    return Date.now() - this.lastOnlineTime;
  }

  /**
   * Queue an operation to be executed when online
   */
  queueOperation(type: PendingOperation['type'], data: unknown): string {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.pendingOperations.set(id, {
      id,
      type,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    });
    return id;
  }

  /**
   * Remove a queued operation
   */
  removeOperation(id: string): boolean {
    return this.pendingOperations.delete(id);
  }

  /**
   * Get pending operations count
   */
  getPendingCount(): number {
    return this.pendingOperations.size;
  }

  /**
   * Get all pending operations
   */
  getPendingOperations(): PendingOperation[] {
    return Array.from(this.pendingOperations.values());
  }

  /**
   * Force a connectivity check
   */
  async forceCheck(): Promise<ConnectionStatus> {
    await this.checkConnectivity();
    return this.status;
  }

  /**
   * Cleanup - removes all event listeners and clears state
   */
  destroy(): void {
    // Remove window event listeners
    window.removeEventListener('online', this.boundHandleOnline);
    window.removeEventListener('offline', this.boundHandleOffline);

    // Clear connectivity check interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all registered listeners and pending operations
    this.listeners.clear();
    this.pendingOperations.clear();
  }
}

// Export singleton instance
export const offlineManager = new OfflineManager();

// Export convenience functions
export const isOnline = () => offlineManager.isOnline();
export const isOffline = () => offlineManager.isOffline();
export const getConnectionStatus = () => offlineManager.getStatus();
export const subscribeToConnectionStatus = (listener: OfflineStatusListener) =>
  offlineManager.subscribe(listener);
