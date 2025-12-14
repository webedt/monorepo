/**
 * Cloud Services Implementation
 * Implements SPEC.md Section 4.5: Cloud Services for Library
 *
 * Provides cloud save functionality including:
 * - Sync cloud saves across devices automatically
 * - Shared platform libraries for games with cloud save API
 * - Integration hooks for leaderboards and achievements
 */

import type {
  CloudSaveData,
  CloudSaveSlot,
  CloudSaveOptions,
  CloudSaveResult,
  CloudSyncState,
  CloudSyncStatus,
  CloudServicesConfig,
  CloudServiceEvent,
  CloudServiceEventType,
  CloudServiceError,
  CloudServiceErrorCode,
} from '@/types/cloudServices';

// Default cloud services configuration
const DEFAULT_CONFIG: CloudServicesConfig = {
  cloudSaveEnabled: true,
  maxSaveSlots: 10,
  autoSyncInterval: 30000, // 30 seconds
  leaderboardsEnabled: true,
  achievementsEnabled: false, // Future feature
  offlineMode: true,
};

// Storage key for local cloud sync state
const CLOUD_SYNC_STATE_KEY = 'cloud-sync-state';
const CLOUD_CONFIG_KEY = 'cloud-services-config';
const PENDING_SYNCS_KEY = 'cloud-pending-syncs';

/**
 * Get cloud services configuration
 */
export function getCloudServicesConfig(): CloudServicesConfig {
  try {
    const stored = localStorage.getItem(CLOUD_CONFIG_KEY);
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('[CloudServices] Failed to load config:', e);
  }
  return DEFAULT_CONFIG;
}

/**
 * Update cloud services configuration
 */
export function updateCloudServicesConfig(config: Partial<CloudServicesConfig>): void {
  try {
    const current = getCloudServicesConfig();
    const updated = { ...current, ...config };
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('[CloudServices] Failed to save config:', e);
  }
}

/**
 * Get cloud sync state for a specific library item
 */
export function getCloudSyncState(itemId: number): CloudSyncState {
  try {
    const stored = localStorage.getItem(CLOUD_SYNC_STATE_KEY);
    if (stored) {
      const allStates: Record<number, CloudSyncState> = JSON.parse(stored);
      if (allStates[itemId]) {
        return allStates[itemId];
      }
    }
  } catch (e) {
    console.error('[CloudServices] Failed to load sync state:', e);
  }

  // Default state for items without existing state
  return {
    itemId,
    status: 'synced',
    saveCount: 0,
  };
}

/**
 * Get cloud sync states for all items
 */
export function getAllCloudSyncStates(): Record<number, CloudSyncState> {
  try {
    const stored = localStorage.getItem(CLOUD_SYNC_STATE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[CloudServices] Failed to load all sync states:', e);
  }
  return {};
}

/**
 * Update cloud sync state for a library item
 */
export function updateCloudSyncState(itemId: number, updates: Partial<CloudSyncState>): CloudSyncState {
  try {
    const stored = localStorage.getItem(CLOUD_SYNC_STATE_KEY);
    const allStates: Record<number, CloudSyncState> = stored ? JSON.parse(stored) : {};

    const currentState = allStates[itemId] || {
      itemId,
      status: 'synced' as CloudSyncStatus,
      saveCount: 0,
    };

    const updatedState: CloudSyncState = {
      ...currentState,
      ...updates,
      itemId, // Ensure itemId is not overwritten
    };

    allStates[itemId] = updatedState;
    localStorage.setItem(CLOUD_SYNC_STATE_KEY, JSON.stringify(allStates));

    return updatedState;
  } catch (e) {
    console.error('[CloudServices] Failed to update sync state:', e);
    return { itemId, status: 'error', saveCount: 0, errorMessage: 'Failed to update state' };
  }
}

// Event listeners for cloud service events
type CloudServiceEventListener = (event: CloudServiceEvent) => void;
const eventListeners: Map<CloudServiceEventType | '*', Set<CloudServiceEventListener>> = new Map();

/**
 * Subscribe to cloud service events
 */
export function subscribeToCloudEvents(
  eventType: CloudServiceEventType | '*',
  listener: CloudServiceEventListener
): () => void {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, new Set());
  }
  eventListeners.get(eventType)!.add(listener);

  // Return unsubscribe function
  return () => {
    eventListeners.get(eventType)?.delete(listener);
  };
}

/**
 * Emit a cloud service event
 */
function emitCloudEvent(event: CloudServiceEvent): void {
  // Notify specific listeners
  eventListeners.get(event.type)?.forEach((listener) => {
    try {
      listener(event);
    } catch (e) {
      console.error('[CloudServices] Event listener error:', e);
    }
  });

  // Notify wildcard listeners
  eventListeners.get('*')?.forEach((listener) => {
    try {
      listener(event);
    } catch (e) {
      console.error('[CloudServices] Wildcard listener error:', e);
    }
  });
}

/**
 * Create a cloud service error
 */
function createCloudError(
  code: CloudServiceErrorCode,
  message: string,
  retryable: boolean = false,
  retryAfter?: number
): CloudServiceError {
  return { code, message, retryable, retryAfter };
}

/**
 * Cloud Save Service - Main API for cloud saves
 */
export const cloudSaveService = {
  /**
   * Get all save slots for a library item
   */
  async getSaveSlots(itemId: number): Promise<CloudSaveSlot[]> {
    const config = getCloudServicesConfig();
    if (!config.cloudSaveEnabled) {
      return [];
    }

    try {
      // For now, return mock data from localStorage
      // In production, this would call the backend API
      const storageKey = `cloud-saves-${itemId}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const saves: CloudSaveData[] = JSON.parse(stored);
        return saves.map((save) => ({
          id: save.id,
          slotIndex: save.slotIndex,
          slotName: save.slotName,
          updatedAt: save.updatedAt,
          metadata: save.metadata,
        }));
      }
      return [];
    } catch (e) {
      console.error('[CloudServices] Failed to get save slots:', e);
      throw createCloudError('INVALID_DATA', 'Failed to retrieve save slots');
    }
  },

  /**
   * Get a specific save by ID
   */
  async getSave(itemId: number, saveId: string): Promise<CloudSaveData | null> {
    const config = getCloudServicesConfig();
    if (!config.cloudSaveEnabled) {
      return null;
    }

    try {
      const storageKey = `cloud-saves-${itemId}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const saves: CloudSaveData[] = JSON.parse(stored);
        return saves.find((save) => save.id === saveId) || null;
      }
      return null;
    } catch (e) {
      console.error('[CloudServices] Failed to get save:', e);
      throw createCloudError('NOT_FOUND', 'Save not found');
    }
  },

  /**
   * Get save by slot index
   */
  async getSaveBySlot(itemId: number, slotIndex: number): Promise<CloudSaveData | null> {
    const config = getCloudServicesConfig();
    if (!config.cloudSaveEnabled) {
      return null;
    }

    try {
      const storageKey = `cloud-saves-${itemId}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const saves: CloudSaveData[] = JSON.parse(stored);
        return saves.find((save) => save.slotIndex === slotIndex) || null;
      }
      return null;
    } catch (e) {
      console.error('[CloudServices] Failed to get save by slot:', e);
      throw createCloudError('NOT_FOUND', 'Save slot not found');
    }
  },

  /**
   * Create or update a cloud save
   */
  async saveToCloud(
    itemId: number,
    slotIndex: number,
    data: Record<string, unknown>,
    options: CloudSaveOptions = {}
  ): Promise<CloudSaveResult> {
    const config = getCloudServicesConfig();
    if (!config.cloudSaveEnabled) {
      return { success: false, error: 'Cloud saves are disabled' };
    }

    if (slotIndex >= config.maxSaveSlots) {
      return { success: false, error: `Maximum save slots (${config.maxSaveSlots}) exceeded` };
    }

    try {
      // Update sync status to pending
      updateCloudSyncState(itemId, { status: 'pending', lastModifiedAt: new Date().toISOString() });

      emitCloudEvent({
        type: 'sync_started',
        itemId,
        timestamp: new Date().toISOString(),
        data: { slotIndex },
      });

      const storageKey = `cloud-saves-${itemId}`;
      const stored = localStorage.getItem(storageKey);
      const saves: CloudSaveData[] = stored ? JSON.parse(stored) : [];

      const existingIndex = saves.findIndex((s) => s.slotIndex === slotIndex);
      const now = new Date().toISOString();
      const saveId = existingIndex >= 0 ? saves[existingIndex].id : `save-${itemId}-${slotIndex}-${Date.now()}`;
      const version = existingIndex >= 0 ? saves[existingIndex].version + 1 : 1;

      const saveData: CloudSaveData = {
        id: saveId,
        itemId,
        userId: 'current-user', // In production, get from auth
        slotIndex,
        data,
        metadata: {
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
        },
        createdAt: existingIndex >= 0 ? saves[existingIndex].createdAt : now,
        updatedAt: now,
        version,
      };

      if (existingIndex >= 0) {
        saves[existingIndex] = saveData;
      } else {
        saves.push(saveData);
      }

      localStorage.setItem(storageKey, JSON.stringify(saves));

      // Update sync status to synced
      updateCloudSyncState(itemId, {
        status: 'synced',
        lastSyncedAt: now,
        saveCount: saves.length,
      });

      emitCloudEvent({
        type: existingIndex >= 0 ? 'save_updated' : 'save_created',
        itemId,
        timestamp: now,
        data: { saveId, slotIndex, version },
      });

      emitCloudEvent({
        type: 'sync_completed',
        itemId,
        timestamp: now,
      });

      return { success: true, saveId, version };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      updateCloudSyncState(itemId, { status: 'error', errorMessage });

      emitCloudEvent({
        type: 'sync_failed',
        itemId,
        timestamp: new Date().toISOString(),
        data: { error: errorMessage },
      });

      return { success: false, error: errorMessage };
    }
  },

  /**
   * Delete a cloud save
   */
  async deleteSave(itemId: number, saveId: string): Promise<CloudSaveResult> {
    const config = getCloudServicesConfig();
    if (!config.cloudSaveEnabled) {
      return { success: false, error: 'Cloud saves are disabled' };
    }

    try {
      const storageKey = `cloud-saves-${itemId}`;
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return { success: false, error: 'No saves found' };
      }

      const saves: CloudSaveData[] = JSON.parse(stored);
      const filteredSaves = saves.filter((s) => s.id !== saveId);

      if (filteredSaves.length === saves.length) {
        return { success: false, error: 'Save not found' };
      }

      localStorage.setItem(storageKey, JSON.stringify(filteredSaves));

      updateCloudSyncState(itemId, {
        saveCount: filteredSaves.length,
        lastSyncedAt: new Date().toISOString(),
      });

      emitCloudEvent({
        type: 'save_deleted',
        itemId,
        timestamp: new Date().toISOString(),
        data: { saveId },
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  },

  /**
   * Trigger manual sync for an item
   */
  async syncItem(itemId: number): Promise<CloudSaveResult> {
    try {
      updateCloudSyncState(itemId, { status: 'syncing', syncProgress: 0 });

      emitCloudEvent({
        type: 'sync_started',
        itemId,
        timestamp: new Date().toISOString(),
      });

      // Simulate sync progress (in production, this would be real progress)
      for (let progress = 0; progress <= 100; progress += 20) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        updateCloudSyncState(itemId, { syncProgress: progress });
      }

      const now = new Date().toISOString();
      updateCloudSyncState(itemId, {
        status: 'synced',
        lastSyncedAt: now,
        syncProgress: undefined,
      });

      emitCloudEvent({
        type: 'sync_completed',
        itemId,
        timestamp: now,
      });

      return { success: true };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Sync failed';
      updateCloudSyncState(itemId, { status: 'error', errorMessage });

      emitCloudEvent({
        type: 'sync_failed',
        itemId,
        timestamp: new Date().toISOString(),
        data: { error: errorMessage },
      });

      return { success: false, error: errorMessage };
    }
  },

  /**
   * Resolve a sync conflict
   */
  async resolveConflict(
    itemId: number,
    resolution: 'use_local' | 'use_remote' | 'merge'
  ): Promise<CloudSaveResult> {
    const currentState = getCloudSyncState(itemId);
    if (currentState.status !== 'conflict') {
      return { success: false, error: 'No conflict to resolve' };
    }

    try {
      // In production, implement actual conflict resolution logic
      updateCloudSyncState(itemId, {
        status: 'synced',
        conflictDetails: undefined,
        lastSyncedAt: new Date().toISOString(),
      });

      emitCloudEvent({
        type: 'conflict_resolved',
        itemId,
        timestamp: new Date().toISOString(),
        data: { resolution },
      });

      return { success: true, conflictResolved: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Failed to resolve conflict' };
    }
  },
};

/**
 * Cloud Sync Manager - Handles automatic syncing
 */
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

export const cloudSyncManager = {
  /**
   * Start automatic sync for all items
   */
  startAutoSync(): void {
    const config = getCloudServicesConfig();
    if (!config.autoSyncInterval || syncIntervalId) {
      return;
    }

    syncIntervalId = setInterval(() => {
      const states = getAllCloudSyncStates();
      Object.keys(states).forEach((itemId) => {
        const state = states[Number(itemId)];
        if (state.status === 'pending') {
          cloudSaveService.syncItem(Number(itemId));
        }
      });
    }, config.autoSyncInterval);

    console.log('[CloudServices] Auto-sync started');
  },

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
      console.log('[CloudServices] Auto-sync stopped');
    }
  },

  /**
   * Check if auto-sync is running
   */
  isAutoSyncRunning(): boolean {
    return syncIntervalId !== null;
  },
};

// Helper functions
function getDeviceId(): string {
  let deviceId = localStorage.getItem('device-id');
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('device-id', deviceId);
  }
  return deviceId;
}

function getDeviceName(): string {
  const platform = navigator.platform || 'Unknown';
  const userAgent = navigator.userAgent;

  if (userAgent.includes('Mobile')) {
    return `Mobile Device (${platform})`;
  }
  if (userAgent.includes('Tablet')) {
    return `Tablet (${platform})`;
  }
  return `Desktop (${platform})`;
}

/**
 * Initialize cloud services
 */
export function initializeCloudServices(): void {
  const config = getCloudServicesConfig();

  if (config.cloudSaveEnabled && config.autoSyncInterval) {
    cloudSyncManager.startAutoSync();
  }

  // Listen for online/offline status
  window.addEventListener('online', () => {
    console.log('[CloudServices] Device online');
    const states = getAllCloudSyncStates();
    Object.keys(states).forEach((itemId) => {
      if (states[Number(itemId)].status === 'offline') {
        updateCloudSyncState(Number(itemId), { status: 'pending' });
      }
    });
  });

  window.addEventListener('offline', () => {
    console.log('[CloudServices] Device offline');
    const states = getAllCloudSyncStates();
    Object.keys(states).forEach((itemId) => {
      if (states[Number(itemId)].status === 'syncing') {
        updateCloudSyncState(Number(itemId), { status: 'offline' });
      }
    });
  });

  console.log('[CloudServices] Initialized');
}

/**
 * Cleanup cloud services
 */
export function cleanupCloudServices(): void {
  cloudSyncManager.stopAutoSync();
  console.log('[CloudServices] Cleaned up');
}
